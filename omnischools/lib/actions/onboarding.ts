"use server";
import { eq, and } from "drizzle-orm";
import { OnboardSchema, type OnboardResult } from "@/lib/onboarding";
import { withoutTenantScope } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { normalizeGhanaPhone } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { captureEvent, captureError } from "@/lib/observability";
import {
  regions,
  districts,
  schools,
  schoolProducts,
  users,
  roles,
  roleAssignments,
  academicPeriodConfig,
  academicPeriod,
  genPeriodDefaults,
} from "@/db/schema";

const FOUNDER_EMAIL = "hello@omnischools.gh";

const slug = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

const shortName = (s: string) =>
  s
    .replace(/\b(senior high school|basic school|school|jhs|shs|m\/a|r\/c)\b/gi, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 8) || "SCHOOL";

/** Current Ghanaian academic year, e.g. "2025/26" (rolls over in September). */
function currentAcademicYear(now = new Date()): string {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 8 ? y : y - 1; // month 8 = September
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function onboardSchool(input: unknown): Promise<OnboardResult> {
  const parsed = OnboardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }
  const d = parsed.data;
  const academicYear = currentAcademicYear();
  const schoolType = d.product === "COMBINED" ? "COMBINED" : d.product;
  const productLine = d.product === "SENIOR" ? "SENIOR" : "BASIC";
  const periodType = productLine === "SENIOR" ? "SEMESTER" : "TERM";
  const periodCount = productLine === "SENIOR" ? 2 : 3;
  const productRows: ("BASIC" | "SENIOR")[] =
    d.product === "COMBINED" ? ["BASIC", "SENIOR"] : [d.product];

  try {
    const result = await withoutTenantScope(async (tx) => {
      // region (find-or-create)
      const regionCode = slug(d.region);
      let regionId = (
        await tx
          .select({ id: regions.id })
          .from(regions)
          .where(eq(regions.name, d.region))
      )[0]?.id;
      if (!regionId) {
        const [r] = await tx
          .insert(regions)
          .values({ name: d.region, code: regionCode })
          .onConflictDoNothing({ target: regions.code })
          .returning();
        regionId =
          r?.id ??
          (
            await tx
              .select({ id: regions.id })
              .from(regions)
              .where(eq(regions.code, regionCode))
          )[0].id;
      }

      // district (find-or-create under region)
      const districtCode = `${regionCode}-${slug(d.district)}`;
      let districtId = (
        await tx
          .select({ id: districts.id })
          .from(districts)
          .where(and(eq(districts.regionId, regionId), eq(districts.name, d.district)))
      )[0]?.id;
      if (!districtId) {
        const [dist] = await tx
          .insert(districts)
          .values({ regionId, name: d.district, code: districtCode })
          .onConflictDoNothing({ target: districts.code })
          .returning();
        districtId =
          dist?.id ??
          (
            await tx
              .select({ id: districts.id })
              .from(districts)
              .where(eq(districts.code, districtCode))
          )[0].id;
      }

      // school
      const [school] = await tx
        .insert(schools)
        .values({
          name: d.schoolName,
          shortName: shortName(d.schoolName),
          gesCode: d.gesCode,
          schoolType,
          ownership: d.ownership,
          districtId,
          regionId,
        })
        .returning();

      // products
      await tx
        .insert(schoolProducts)
        .values(productRows.map((p) => ({ schoolId: school.id, product: p })));

      // ensure ADMIN + HEADMASTER roles exist
      await tx
        .insert(roles)
        .values([
          {
            code: "ADMIN",
            label: "Administrator",
            description: "School office / system admin",
          },
          { code: "HEADMASTER", label: "Headmaster", description: "Head of school" },
        ])
        .onConflictDoNothing({ target: roles.code });
      const roleRows = await tx.select().from(roles);
      const roleId = (code: "ADMIN" | "HEADMASTER") =>
        roleRows.find((r) => r.code === code)!.id;

      // users (find-or-create by phone)
      const adminPhone = normalizeGhanaPhone(d.adminPhone);
      const headmasterPhone = normalizeGhanaPhone(d.headmasterPhone);
      async function upsertUser(phone: string, name: string, email?: string) {
        const [u] = await tx
          .insert(users)
          .values({ phone, fullName: name, email: email || null })
          .onConflictDoNothing({ target: users.phone })
          .returning();
        return (
          u?.id ??
          (await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)))[0]
            .id
        );
      }
      const adminId = await upsertUser(adminPhone, d.adminName, d.adminEmail);
      const headmasterId = await upsertUser(
        headmasterPhone,
        d.headmasterName,
        d.headmasterEmail,
      );

      await tx.insert(roleAssignments).values([
        { userId: adminId, schoolId: school.id, roleId: roleId("ADMIN") },
        { userId: headmasterId, schoolId: school.id, roleId: roleId("HEADMASTER") },
      ]);

      // academic period config
      await tx.insert(academicPeriodConfig).values({
        schoolId: school.id,
        academicYear,
        periodType,
        periodCount,
        source: "GES_DEFAULT",
        configuredBy: adminId,
      });

      // dated periods from GES defaults, if available for this year/line
      const defaults = await tx
        .select()
        .from(genPeriodDefaults)
        .where(
          and(
            eq(genPeriodDefaults.academicYear, academicYear),
            eq(genPeriodDefaults.productLine, productLine),
          ),
        );
      let periodsCreated = 0;
      if (defaults.length > 0) {
        await tx.insert(academicPeriod).values(
          defaults.map((p) => ({
            schoolId: school.id,
            academicYear,
            periodNumber: p.periodNumber,
            periodLabel: p.periodLabel,
            startsOn: p.startsOn,
            endsOn: p.endsOn,
          })),
        );
        periodsCreated = defaults.length;
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: adminId,
        actorRole: "ADMIN",
        actionType: "created",
        entityType: "school",
        entityId: school.id,
        after: { name: d.schoolName, gesCode: d.gesCode, product: d.product },
        reason: "School onboarding wizard",
      });

      return { schoolId: school.id, periodsCreated, adminPhone, headmasterPhone };
    });

    // notifications (stubbed providers)
    await sendSms(
      result.adminPhone,
      `Welcome to Omnischools, ${d.adminName}. ${d.schoolName} is set up. Sign in with this number to begin.`,
    );
    await sendEmail({
      to: FOUNDER_EMAIL,
      subject: `New school onboarded: ${d.schoolName}`,
      html: `<p><b>${d.schoolName}</b> (${d.gesCode}, ${d.product}) — ${d.region} / ${d.district}</p>
             <p>Headmaster: ${d.headmasterName} · Admin: ${d.adminName}</p>`,
    });
    captureEvent("school_onboarded", { product: d.product, region: d.region });

    return {
      ok: true,
      schoolId: result.schoolId,
      academicYear,
      periodsCreated: result.periodsCreated,
    };
  } catch (err) {
    captureError(err, { action: "onboardSchool", gesCode: d.gesCode });
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("ref_school_ges_code_unique") || msg.includes("duplicate key")) {
      return { ok: false, error: "A school with this GES code already exists." };
    }
    return { ok: false, error: "Could not complete onboarding. Please try again." };
  }
}
