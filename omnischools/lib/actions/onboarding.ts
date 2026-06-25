"use server";
import { eq, and } from "drizzle-orm";
import {
  OnboardSchema,
  type OnboardResult,
  GRADE_SCALE_PRESETS,
  defaultGradePreset,
  defaultClasses,
  defaultSubjects,
  defaultFees,
  DEFAULT_PAYMENT_METHODS,
} from "@/lib/onboarding";
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
  gradeScale,
  classes,
  subjects,
  feeStructures,
  feeStructureItems,
  invites,
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
  if (!d.termsAccepted) {
    return { ok: false, error: "Please accept the Terms & Privacy Policy to continue." };
  }
  const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
  const academicYear = nz(d.academicYear) ?? currentAcademicYear();
  const schoolType = d.product === "COMBINED" ? "COMBINED" : d.product;
  const productLine = d.product === "SENIOR" ? "SENIOR" : "BASIC";
  // Step 3 calendar — prefer the wizard's choices, else the GES tier default.
  const periodType = d.periodType ?? (productLine === "SENIOR" ? "SEMESTER" : "TERM");
  const periodCount = d.periodCount ?? (productLine === "SENIOR" ? 2 : 3);
  // Terms the user dated themselves (both ends) — these override the GES calendar.
  const datedTerms = (d.terms ?? []).filter((t) => nz(t.startsOn) && nz(t.endsOn));
  const customCalendar = datedTerms.length > 0 || !!d.periodType || !!nz(d.academicYear);
  // Grade scale — the wizard's rows, else the tier preset.
  const gradeRows =
    d.gradeScale && d.gradeScale.length > 0
      ? d.gradeScale
      : GRADE_SCALE_PRESETS[defaultGradePreset(d.subtype)];
  // Academic structure — the wizard's lists, else the tier defaults.
  const uniqTrim = (xs: string[]) =>
    Array.from(new Set(xs.map((s) => s.trim()).filter(Boolean)));
  const classNames = uniqTrim(d.classes ?? defaultClasses(d.subtype));
  const subjectNames = uniqTrim(d.subjects ?? defaultSubjects(d.subtype));
  // Billing — the wizard's fee lines (named, any amount) else the tier defaults.
  const feeLines = (d.fees ?? defaultFees(d.subtype, d.ownership)).filter((fee) =>
    nz(fee.item),
  );
  const billingCadence = d.billingCadence ?? "TERM";
  const paymentMethods =
    d.paymentMethods && d.paymentMethods.length > 0
      ? d.paymentMethods
      : DEFAULT_PAYMENT_METHODS;
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
          shortName: nz(d.shortName) ?? shortName(d.schoolName),
          gesCode: d.gesCode,
          csspsCode: nz(d.csspsCode),
          schoolType,
          subtype: d.subtype ?? null,
          ownership: d.ownership,
          yearFounded: nz(d.yearFounded),
          address: nz(d.address),
          billingCadence,
          paymentMethods,
          termsAcceptedAt: new Date(),
          // SHS-only steps 7–8 (null for Basic — steps never shown)
          residencyModel: d.residencyModel ?? null,
          houseCount: d.houseCount ?? null,
          visitingDay: nz(d.visitingDay),
          waecCentreCode: nz(d.waecCentreCode),
          waecOffice: nz(d.waecOffice),
          firstWassceYear: nz(d.firstWassceYear),
          districtId,
          regionId,
        })
        .returning();

      // products
      await tx
        .insert(schoolProducts)
        .values(productRows.map((p) => ({ schoolId: school.id, product: p })));

      // ensure ADMIN + HEADMASTER + ACCOUNTANT roles exist
      await tx
        .insert(roles)
        .values([
          {
            code: "ADMIN",
            label: "Administrator",
            description: "School office / system admin",
          },
          { code: "HEADMASTER", label: "Headmaster", description: "Head of school" },
          {
            code: "ACCOUNTANT",
            label: "Accountant",
            description: "Billing, fees & financial reports",
          },
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

      // Separate accountant → create a pending invite (the accept flow then makes the
      // user + ACCOUNTANT assignment when they set their password). "I'll handle it
      // myself" keeps billing on the ADMIN role — no extra assignment needed.
      // Skipped when the accountant fields were left blank (role available later).
      let accountantInvite: { phone: string; email: string | null; token: string } | null =
        null;
      const accName = nz(d.accountantName);
      const accPhoneRaw = nz(d.accountantPhone);
      if (d.billingHandler === "ACCOUNTANT" && accName && accPhoneRaw) {
        const accPhone = normalizeGhanaPhone(accPhoneRaw);
        const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
        const expiresAt = new Date(Date.now() + 14 * 86400_000);
        await tx.insert(invites).values({
          schoolId: school.id,
          token,
          role: "ACCOUNTANT",
          fullName: accName,
          email: nz(d.accountantEmail),
          phone: accPhone,
          expiresAt,
          invitedByUserId: adminId,
        });
        accountantInvite = { phone: accPhone, email: nz(d.accountantEmail), token };
      }

      // academic period config (school override if the wizard set the calendar)
      await tx.insert(academicPeriodConfig).values({
        schoolId: school.id,
        academicYear,
        periodType,
        periodCount,
        source: customCalendar ? "SCHOOL_OVERRIDE" : "GES_DEFAULT",
        configuredBy: adminId,
      });

      // dated periods — prefer the wizard's term dates, else GES defaults.
      let periodsCreated = 0;
      if (datedTerms.length > 0) {
        await tx.insert(academicPeriod).values(
          datedTerms.map((t, i) => ({
            schoolId: school.id,
            academicYear,
            periodNumber: i + 1,
            periodLabel: t.label?.trim() || `Period ${i + 1}`,
            startsOn: t.startsOn as string,
            endsOn: t.endsOn as string,
          })),
        );
        periodsCreated = datedTerms.length;
      } else {
        const defaults = await tx
          .select()
          .from(genPeriodDefaults)
          .where(
            and(
              eq(genPeriodDefaults.academicYear, academicYear),
              eq(genPeriodDefaults.productLine, productLine),
            ),
          );
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
      }

      // grade scale — wizard rows, else the tier preset. Ordered highest-first.
      const orderedGrades = [...gradeRows].sort((a, b) => b.minScore - a.minScore);
      await tx.insert(gradeScale).values(
        orderedGrades.map((g, i) => ({
          schoolId: school.id,
          grade: g.grade.trim(),
          label: nz(g.label) ?? null,
          minScore: String(g.minScore),
          ordinal: i,
        })),
      );

      // academic structure — seed classes + subjects (wizard lists or tier defaults)
      if (classNames.length > 0) {
        await tx
          .insert(classes)
          .values(classNames.map((name) => ({ schoolId: school.id, name })))
          .onConflictDoNothing({ target: [classes.schoolId, classes.name] });
      }
      if (subjectNames.length > 0) {
        await tx
          .insert(subjects)
          .values(subjectNames.map((name) => ({ schoolId: school.id, name })))
          .onConflictDoNothing({ target: [subjects.schoolId, subjects.name] });
      }

      // billing — a default fee structure for the year + its line items
      if (feeLines.length > 0) {
        const [fs] = await tx
          .insert(feeStructures)
          .values({
            schoolId: school.id,
            name: `Default fees · ${academicYear}`,
            academicYear,
          })
          .returning({ id: feeStructures.id });
        await tx.insert(feeStructureItems).values(
          feeLines.map((fee) => ({
            schoolId: school.id,
            feeStructureId: fs.id,
            description: fee.item.trim(),
            amount: String(fee.amount ?? 0),
          })),
        );
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

      return {
        schoolId: school.id,
        periodsCreated,
        adminPhone,
        headmasterPhone,
        accountantInvite,
      };
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
    // Accountant invite — secure link to set their password (mirrors createInvite).
    if (result.accountantInvite) {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const link = `${base}/accept/${result.accountantInvite.token}`;
      const sender = nz(d.shortName) ?? "Omnischools";
      await sendSms(
        result.accountantInvite.phone,
        `${sender}: You've been added as Accountant at ${d.schoolName}. Set up your account: ${link}`,
      );
      if (result.accountantInvite.email) {
        await sendEmail({
          to: result.accountantInvite.email,
          subject: `You're invited to ${d.schoolName} on Omnischools`,
          html: `<p>You've been added as <b>Accountant</b> at ${d.schoolName}.</p><p><a href="${link}">Accept the invite & set your password</a>.</p>`,
        });
      }
    }
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
