"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { sendSms, smsSegments, SMS_SEGMENT_RATE_GHS } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import { round2, toMoney, num, nextInvoiceNumber } from "@/lib/fees-helpers";
import {
  feeStructures,
  feeStructureItems,
  feeCategories,
  discounts,
  discountTiers,
  classes,
  students,
  studentGuardians,
  invoices,
  invoiceLineItems,
  notificationLog,
} from "@/db/schema";

/** Current academic year as "YYYY/YY" (Sept rollover) — mirrors app/(app)/billing/page.tsx. */
function currentAcademicYear(): string {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

type Result = { ok: boolean; error?: string };

// ------------------------------------------------------------ fee structures
const StructureSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80),
  level: z.string().max(40).optional().nullable(),
  academicYear: z.string().min(4, "Enter the academic year").max(12),
  items: z
    .array(
      z.object({
        description: z.string().min(1, "Description required").max(120),
        amount: z.coerce.number().positive("Amount must be > 0"),
      }),
    )
    .min(1, "Add at least one line item"),
});

export async function createFeeStructure(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = StructureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const [s] = await tx
        .insert(feeStructures)
        .values({
          schoolId: school.id,
          name: d.name.trim(),
          level: d.level?.trim() || null,
          academicYear: d.academicYear.trim(),
        })
        .returning({ id: feeStructures.id });
      await tx.insert(feeStructureItems).values(
        d.items.map((li) => ({
          schoolId: school.id,
          feeStructureId: s.id,
          description: li.description.trim(),
          amount: toMoney(li.amount),
        })),
      );
      // Remember each item label as a fee category so it joins the dropdown next time.
      const cats = Array.from(
        new Set(d.items.map((li) => li.description.trim()).filter(Boolean)),
      );
      if (cats.length > 0) {
        await tx
          .insert(feeCategories)
          .values(cats.map((name) => ({ schoolId: school.id, name })))
          .onConflictDoNothing({ target: [feeCategories.schoolId, feeCategories.name] });
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "fee_structure",
        entityId: s.id,
        after: { name: d.name, items: d.items.length },
        reason: "Fee structure created",
      });
    });
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not create — that name may already exist." };
  }
}

export async function deleteFeeStructure(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const id = z
    .string()
    .uuid()
    .safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .delete(feeStructures)
        .where(and(eq(feeStructures.id, id.data), eq(feeStructures.schoolId, school.id))),
    );
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete." };
  }
}

// ------------------------------------------------------------------ discounts
const TierSchema = z.object({
  rank: z.coerce.number().int().min(1).max(20),
  value: z.coerce.number().min(0),
});
const DiscountSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().min(0).default(0),
  appliesToCategoryId: z.string().uuid().optional().or(z.literal("")).nullable(),
  durationLabel: z.string().max(40).optional().or(z.literal("")).nullable(),
  requiresApproval: z.coerce.boolean().default(false),
  stackable: z.coerce.boolean().default(true),
  isTiered: z.coerce.boolean().default(false),
  tiers: z.array(TierSchema).optional(),
});

export async function createDiscount(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = DiscountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const overCap = (v: number) => d.kind === "PERCENT" && v > 100;

  // Normalise tiers (dedupe by rank, drop blanks) when tiered.
  const tiers = d.isTiered
    ? Array.from(
        new Map((d.tiers ?? []).map((t) => [t.rank, round2(t.value)])).entries(),
      )
        .map(([rank, value]) => ({ rank, value }))
        .sort((a, b) => a.rank - b.rank)
    : [];

  if (d.isTiered) {
    if (tiers.length === 0) {
      return { ok: false, error: "Add at least one sibling-rank tier." };
    }
    if (tiers.some((t) => overCap(t.value))) {
      return { ok: false, error: "A percentage tier can't exceed 100." };
    }
  } else {
    if (d.value <= 0) return { ok: false, error: "Value must be > 0." };
    if (overCap(d.value)) return { ok: false, error: "A percentage can't exceed 100." };
  }

  try {
    await withSchool(school.id, async (tx) => {
      const [created] = await tx
        .insert(discounts)
        .values({
          schoolId: school.id,
          name: d.name.trim(),
          kind: d.kind,
          value: toMoney(d.isTiered ? 0 : d.value),
          appliesToCategoryId: d.appliesToCategoryId || null,
          durationLabel: d.durationLabel?.trim() || null,
          requiresApproval: d.requiresApproval,
          stackable: d.stackable,
          isTiered: d.isTiered,
        })
        .returning({ id: discounts.id });
      if (tiers.length > 0) {
        await tx.insert(discountTiers).values(
          tiers.map((t) => ({
            schoolId: school.id,
            discountId: created.id,
            rank: t.rank,
            value: toMoney(t.value),
          })),
        );
      }
    });
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not create — that name may already exist." };
  }
}

export async function approveDiscount(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const id = z
    .string()
    .uuid()
    .safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(discounts)
        .set({ approvedAt: new Date(), approvedByUserId: actor.id ?? undefined })
        .where(and(eq(discounts.id, id.data), eq(discounts.schoolId, school.id)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "approved",
        entityType: "discount",
        entityId: id.data,
        reason: "Discount approved for use",
      });
    });
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not approve." };
  }
}

export async function deleteDiscount(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const id = z
    .string()
    .uuid()
    .safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .delete(discounts)
        .where(and(eq(discounts.id, id.data), eq(discounts.schoolId, school.id))),
    );
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete." };
  }
}

// --------------------------------------------- generate invoices for a class
const GenerateSchema = z.object({
  structureId: z.string().uuid(),
  classId: z.string().uuid(),
  discountIds: z.array(z.string().uuid()).optional(),
});

export type GenerateResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

/** Tier value for a sibling rank: the highest tier whose rank ≤ the student's. */
function tierValueForRank(
  tiers: { rank: number; value: string }[],
  rank: number,
): number {
  if (tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.rank - b.rank);
  let chosen = sorted[0];
  for (const t of sorted) if (t.rank <= rank) chosen = t;
  return num(chosen.value);
}

export async function generateInvoicesForClass(input: unknown): Promise<GenerateResult> {
  const { school } = await requireSchool();
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { structureId, classId } = parsed.data;
  const discountIds = Array.from(new Set(parsed.data.discountIds ?? [])).filter(Boolean);
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [structure] = await tx
        .select()
        .from(feeStructures)
        .where(
          and(eq(feeStructures.id, structureId), eq(feeStructures.schoolId, school.id)),
        );
      if (!structure) return { ok: false as const, error: "Fee structure not found." };

      const items = await tx
        .select()
        .from(feeStructureItems)
        .where(eq(feeStructureItems.feeStructureId, structureId));
      if (items.length === 0)
        return { ok: false as const, error: "Structure has no items." };

      // Selected discounts (for stacking) + validation.
      const selected = discountIds.length
        ? await tx
            .select()
            .from(discounts)
            .where(
              and(eq(discounts.schoolId, school.id), inArray(discounts.id, discountIds)),
            )
        : [];
      if (selected.length !== discountIds.length) {
        return { ok: false as const, error: "A selected discount no longer exists." };
      }
      const unapproved = selected.find((d) => d.requiresApproval && !d.approvedAt);
      if (unapproved) {
        return {
          ok: false as const,
          error: `"${unapproved.name}" needs approval before it can be used.`,
        };
      }
      if (selected.length > 1 && selected.some((d) => !d.stackable)) {
        const nonStack = selected.find((d) => !d.stackable);
        return {
          ok: false as const,
          error: `"${nonStack?.name}" can't be combined with other discounts.`,
        };
      }

      // Tiers for any tiered discount, grouped by discount.
      const tieredIds = selected.filter((d) => d.isTiered).map((d) => d.id);
      const tierRows = tieredIds.length
        ? await tx
            .select()
            .from(discountTiers)
            .where(inArray(discountTiers.discountId, tieredIds))
        : [];
      const tiersByDiscount = new Map<string, { rank: number; value: string }[]>();
      for (const t of tierRows) {
        const arr = tiersByDiscount.get(t.discountId) ?? [];
        arr.push({ rank: t.rank, value: t.value });
        tiersByDiscount.set(t.discountId, arr);
      }

      // applies-to category names (matched against item descriptions).
      const catIds = Array.from(
        new Set(
          selected.map((d) => d.appliesToCategoryId).filter((x): x is string => !!x),
        ),
      );
      const catRows = catIds.length
        ? await tx
            .select({ id: feeCategories.id, name: feeCategories.name })
            .from(feeCategories)
            .where(
              and(eq(feeCategories.schoolId, school.id), inArray(feeCategories.id, catIds)),
            )
        : [];
      const catName = new Map(catRows.map((c) => [c.id, c.name.toLowerCase()]));

      const roster = await tx
        .select({ id: students.id, householdId: students.householdId })
        .from(students)
        .where(
          and(
            eq(students.schoolId, school.id),
            eq(students.classId, classId),
            eq(students.status, "ACTIVE"),
          ),
        );
      if (roster.length === 0) {
        return { ok: false as const, error: "No active students in that class." };
      }

      // Sibling rank per student: position within their household by enrolment.
      const householdIds = Array.from(
        new Set(roster.map((r) => r.householdId).filter((x): x is string => !!x)),
      );
      const rankByStudent = new Map<string, number>();
      if (householdIds.length) {
        const members = await tx
          .select({
            id: students.id,
            householdId: students.householdId,
            enrolledOn: students.enrolledOn,
            createdAt: students.createdAt,
          })
          .from(students)
          .where(
            and(
              eq(students.schoolId, school.id),
              eq(students.status, "ACTIVE"),
              inArray(students.householdId, householdIds),
            ),
          );
        const byHouse = new Map<string, typeof members>();
        for (const m of members) {
          if (!m.householdId) continue;
          const arr = byHouse.get(m.householdId) ?? [];
          arr.push(m);
          byHouse.set(m.householdId, arr);
        }
        const keyOf = (m: (typeof members)[number]) =>
          `${m.enrolledOn ?? m.createdAt.toISOString().slice(0, 10)}|${m.id}`;
        for (const [, arr] of Array.from(byHouse)) {
          arr
            .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
            .forEach((m, i) => rankByStudent.set(m.id, i + 1));
        }
      }

      const subtotal = round2(items.reduce((s, li) => s + num(li.amount), 0));
      const baseFor = (d: (typeof selected)[number]): number => {
        if (!d.appliesToCategoryId) return subtotal;
        const name = catName.get(d.appliesToCategoryId);
        if (!name) return 0;
        return round2(
          items
            .filter((li) => li.description.toLowerCase() === name)
            .reduce((s, li) => s + num(li.amount), 0),
        );
      };
      const discountForStudent = (studentId: string): number => {
        const rank = rankByStudent.get(studentId) ?? 1;
        let total = 0;
        for (const d of selected) {
          const base = baseFor(d);
          if (base <= 0) continue;
          const value = d.isTiered
            ? tierValueForRank(tiersByDiscount.get(d.id) ?? [], rank)
            : num(d.value);
          total += d.kind === "PERCENT" ? base * (value / 100) : Math.min(value, base);
        }
        return round2(Math.min(total, subtotal));
      };

      let created = 0;
      let skipped = 0;
      for (const stu of roster) {
        const existing = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.schoolId, school.id),
              eq(invoices.studentId, stu.id),
              eq(invoices.academicYear, structure.academicYear),
              sql`${invoices.status} <> 'VOIDED'`,
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const discAmount = discountForStudent(stu.id);
        const billed = round2(subtotal - discAmount);
        const invoiceNumber = await nextInvoiceNumber(tx, school.id);
        const [inv] = await tx
          .insert(invoices)
          .values({
            schoolId: school.id,
            studentId: stu.id,
            invoiceNumber,
            academicYear: structure.academicYear,
            subtotalAmount: toMoney(subtotal),
            discountAmount: toMoney(discAmount),
            billedAmount: toMoney(billed),
            paidAmount: "0.00",
            balanceAmount: toMoney(billed),
            status: "ISSUED",
          })
          .returning({ id: invoices.id });
        await tx.insert(invoiceLineItems).values(
          items.map((li) => ({
            schoolId: school.id,
            invoiceId: inv.id,
            feeCategoryId: li.feeCategoryId,
            description: li.description,
            amount: li.amount,
          })),
        );
        created++;
      }

      // Track how many bills each discount has been applied to.
      if (created > 0 && selected.length > 0) {
        for (const d of selected) {
          await tx
            .update(discounts)
            .set({ appliedCount: sql`${discounts.appliedCount} + ${created}` })
            .where(eq(discounts.id, d.id));
        }
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invoice_batch",
        entityId: classId,
        after: {
          structure: structure.name,
          created,
          skipped,
          discounts: selected.map((d) => d.name),
        },
        reason: "Invoices generated from fee structure",
      });

      return { ok: true as const, created, skipped };
    });

    if (!out.ok) return out;
    safeRevalidate("/billing");
    safeRevalidate("/fees");
    safeRevalidate("/reports");
    return out;
  } catch {
    return { ok: false, error: "Could not generate invoices. Please try again." };
  }
}

// ------------------------------------------------ school-wide invoice issuance
export type IssueAllResult =
  | {
      ok: true;
      created: number;
      skipped: number;
      classesIssued: number;
      classesWithoutStructure: number;
    }
  | { ok: false; error: string };

/**
 * Issue invoices across the whole school for the current academic year: every
 * ACTIVE student gets a bill at the FULL amount of the active fee structure that
 * matches their class level. Idempotent (skips students already invoiced for the
 * year), bills the full subtotal (no auto-discounts — those apply per-invoice via
 * the existing flow) and sends NO SMS (reminders are the separate sendFeeReminders
 * flow). Mirrors generateInvoicesForClass's invoice-creation exactly.
 */
export async function issueAllInvoices(): Promise<IssueAllResult> {
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  const year = currentAcademicYear();

  try {
    const out = await withSchool(school.id, async (tx) => {
      // Active fee structures for the year, with their line items.
      const structureRows = await tx
        .select()
        .from(feeStructures)
        .where(
          and(
            eq(feeStructures.schoolId, school.id),
            eq(feeStructures.academicYear, year),
            eq(feeStructures.active, true),
          ),
        );
      if (structureRows.length === 0) {
        return {
          ok: false as const,
          error: `No active fee structure for ${year}.`,
        };
      }

      const structureIds = structureRows.map((s) => s.id);
      const items = await tx
        .select()
        .from(feeStructureItems)
        .where(inArray(feeStructureItems.feeStructureId, structureIds));
      const itemsByStructure = new Map<string, typeof items>();
      for (const li of items) {
        const arr = itemsByStructure.get(li.feeStructureId) ?? [];
        arr.push(li);
        itemsByStructure.set(li.feeStructureId, arr);
      }

      // Resolve each class → the active structure whose level matches the class.
      // First matching structure per level wins (deterministic by load order).
      const structureByLevel = new Map<string, (typeof structureRows)[number]>();
      for (const s of structureRows) {
        if (s.level && !structureByLevel.has(s.level)) structureByLevel.set(s.level, s);
      }

      const classRows = await tx
        .select({ id: classes.id, name: classes.name, level: classes.level })
        .from(classes)
        .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)));

      let created = 0;
      let skipped = 0;
      let classesIssued = 0;
      let classesWithoutStructure = 0;

      for (const cls of classRows) {
        const structure = cls.level ? structureByLevel.get(cls.level) : undefined;
        if (!structure) {
          classesWithoutStructure++;
          continue;
        }
        const structItems = itemsByStructure.get(structure.id) ?? [];
        if (structItems.length === 0) {
          // An active structure with no line items can't bill anything.
          classesWithoutStructure++;
          continue;
        }

        const subtotal = round2(structItems.reduce((s, li) => s + num(li.amount), 0));

        const roster = await tx
          .select({ id: students.id })
          .from(students)
          .where(
            and(
              eq(students.schoolId, school.id),
              eq(students.classId, cls.id),
              eq(students.status, "ACTIVE"),
            ),
          );
        if (roster.length === 0) continue;

        let classCreated = 0;
        for (const stu of roster) {
          const existing = await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.schoolId, school.id),
                eq(invoices.studentId, stu.id),
                eq(invoices.academicYear, year),
                sql`${invoices.status} <> 'VOIDED'`,
              ),
            )
            .limit(1);
          if (existing.length > 0) {
            skipped++;
            continue;
          }

          const invoiceNumber = await nextInvoiceNumber(tx, school.id);
          const [inv] = await tx
            .insert(invoices)
            .values({
              schoolId: school.id,
              studentId: stu.id,
              invoiceNumber,
              academicYear: year,
              subtotalAmount: toMoney(subtotal),
              discountAmount: "0.00",
              billedAmount: toMoney(subtotal),
              paidAmount: "0.00",
              balanceAmount: toMoney(subtotal),
              status: "ISSUED",
            })
            .returning({ id: invoices.id });
          await tx.insert(invoiceLineItems).values(
            structItems.map((li) => ({
              schoolId: school.id,
              invoiceId: inv.id,
              feeCategoryId: li.feeCategoryId,
              description: li.description,
              amount: li.amount,
            })),
          );
          created++;
          classCreated++;
        }
        if (classCreated > 0) classesIssued++;
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invoice_batch",
        entityId: school.id,
        after: { created, skipped, classesIssued, classesWithoutStructure, year },
        reason: "School-wide invoice issuance",
      });

      return {
        ok: true as const,
        created,
        skipped,
        classesIssued,
        classesWithoutStructure,
      };
    });

    if (!out.ok) return out;
    safeRevalidate("/billing");
    safeRevalidate("/fees");
    safeRevalidate("/reports");
    return out;
  } catch {
    return { ok: false, error: "Could not issue invoices. Please try again." };
  }
}

// ---------------------------------------------------------------- reminders
/** The SMS body sent to a guardian about an outstanding balance. */
function feeReminderMessage(sender: string, firstName: string, amount: number): string {
  return `${sender}: Dear parent, ${firstName} has an outstanding fee balance of GHS ${toMoney(amount)}. Kindly settle at your earliest convenience. Thank you.`;
}

/** Outstanding-balance rows (one per student) with the primary guardian phone. */
function reminderRows(schoolId: string) {
  return withSchool(schoolId, (tx) =>
    tx
      .select({
        studentId: invoices.studentId,
        firstName: students.firstName,
        outstanding: sql<string>`sum(${invoices.balanceAmount})`,
        phone: studentGuardians.phone,
      })
      .from(invoices)
      .innerJoin(students, eq(invoices.studentId, students.id))
      .leftJoin(
        studentGuardians,
        and(
          eq(studentGuardians.studentId, students.id),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .where(
        and(
          eq(invoices.schoolId, schoolId),
          inArray(invoices.status, ["ISSUED", "PARTIAL", "OVERDUE"]),
          sql`${invoices.balanceAmount} > 0`,
        ),
      )
      .groupBy(invoices.studentId, students.firstName, studentGuardians.phone)
      .limit(1000),
  );
}

export type ReminderPreview = {
  recipients: number; // families with a phone on file (will receive an SMS)
  noPhone: number; // families with a balance but no phone (skipped)
  totalOutstanding: number;
  segments: number; // total SMS segments across all recipients
  estCost: number; // segments × per-segment rate, in GHS
};

export async function previewFeeReminders(): Promise<
  { ok: true; preview: ReminderPreview } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  try {
    const rows = await reminderRows(school.id);
    const sender = school.shortName ?? "Omnischools";
    let recipients = 0;
    let noPhone = 0;
    let segments = 0;
    let totalOutstanding = 0;
    for (const r of rows) {
      const amount = num(r.outstanding);
      totalOutstanding = round2(totalOutstanding + amount);
      if (!r.phone) {
        noPhone++;
        continue;
      }
      recipients++;
      segments += smsSegments(feeReminderMessage(sender, r.firstName, amount));
    }
    return {
      ok: true,
      preview: {
        recipients,
        noPhone,
        totalOutstanding,
        segments,
        estCost: round2(segments * SMS_SEGMENT_RATE_GHS),
      },
    };
  } catch {
    return { ok: false, error: "Could not load the reminder preview." };
  }
}

export type RemindersResult =
  | { ok: true; sent: number; noPhone: number }
  | { ok: false; error: string };

export async function sendFeeReminders(): Promise<RemindersResult> {
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const rows = await reminderRows(school.id);
    let sent = 0;
    let noPhone = 0;
    const sender = school.shortName ?? "Omnischools";
    for (const r of rows) {
      if (!r.phone) {
        noPhone++;
        continue;
      }
      const msg = feeReminderMessage(sender, r.firstName, num(r.outstanding));
      await sendSms(r.phone, msg);
      await withSchool(school.id, (tx) =>
        tx.insert(notificationLog).values({
          schoolId: school.id,
          studentId: r.studentId,
          phone: r.phone as string,
          message: msg,
          status: "SENT",
          sentByUserId: actor.id ?? undefined,
        }),
      );
      sent++;
    }
    safeRevalidate("/billing");
    return { ok: true, sent, noPhone };
  } catch {
    return { ok: false, error: "Could not send reminders. Please try again." };
  }
}

export type SingleReminderResult =
  | { ok: true; sent: boolean }
  | { ok: false; error: string };

/** Send the fee reminder to one student's primary guardian (used from Reports). */
export async function sendReminderToStudent(input: unknown): Promise<SingleReminderResult> {
  const { school } = await requireSchool();
  const sid = z
    .string()
    .uuid()
    .safeParse((input as { studentId?: string })?.studentId);
  if (!sid.success) return { ok: false, error: "Invalid student." };
  const actor = await resolveActor(school.id);
  try {
    const data = await withSchool(school.id, async (tx) => {
      const [stu] = await tx
        .select({ firstName: students.firstName })
        .from(students)
        .where(and(eq(students.id, sid.data), eq(students.schoolId, school.id)));
      if (!stu) return null;
      const [bal] = await tx
        .select({
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.studentId, sid.data),
            inArray(invoices.status, ["ISSUED", "PARTIAL", "OVERDUE"]),
          ),
        );
      const [g] = await tx
        .select({ phone: studentGuardians.phone })
        .from(studentGuardians)
        .where(
          and(
            eq(studentGuardians.studentId, sid.data),
            eq(studentGuardians.isPrimary, true),
          ),
        )
        .limit(1);
      return { firstName: stu.firstName, outstanding: num(bal?.outstanding), phone: g?.phone ?? null };
    });

    if (!data) return { ok: false, error: "Student not found." };
    if (data.outstanding <= 0) return { ok: true, sent: false };
    if (!data.phone) return { ok: false, error: "No guardian phone on file." };

    const msg = feeReminderMessage(
      school.shortName ?? "Omnischools",
      data.firstName,
      data.outstanding,
    );
    await sendSms(data.phone, msg);
    await withSchool(school.id, (tx) =>
      tx.insert(notificationLog).values({
        schoolId: school.id,
        studentId: sid.data,
        phone: data.phone as string,
        message: msg,
        status: "SENT",
        sentByUserId: actor.id ?? undefined,
      }),
    );
    return { ok: true, sent: true };
  } catch {
    return { ok: false, error: "Could not send the reminder." };
  }
}
