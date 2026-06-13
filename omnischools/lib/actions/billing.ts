"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { sendSms } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import { round2, toMoney, num, nextInvoiceNumber } from "@/lib/fees-helpers";
import {
  feeStructures,
  feeStructureItems,
  feeCategories,
  discounts,
  students,
  studentGuardians,
  invoices,
  invoiceLineItems,
  notificationLog,
} from "@/db/schema";

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
const DiscountSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().positive("Value must be > 0"),
});

export async function createDiscount(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = DiscountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  if (d.kind === "PERCENT" && d.value > 100) {
    return { ok: false, error: "A percentage can't exceed 100." };
  }
  try {
    await withSchool(school.id, (tx) =>
      tx.insert(discounts).values({
        schoolId: school.id,
        name: d.name.trim(),
        kind: d.kind,
        value: toMoney(d.value),
      }),
    );
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not create — that name may already exist." };
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
  discountId: z.string().optional().nullable(),
});

export type GenerateResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

export async function generateInvoicesForClass(input: unknown): Promise<GenerateResult> {
  const { school } = await requireSchool();
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { structureId, classId } = parsed.data;
  const discountId = parsed.data.discountId?.trim() || null;
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

      let discount: { kind: string; value: string } | null = null;
      if (discountId) {
        const [d] = await tx
          .select({ kind: discounts.kind, value: discounts.value })
          .from(discounts)
          .where(and(eq(discounts.id, discountId), eq(discounts.schoolId, school.id)));
        discount = d ?? null;
      }

      const roster = await tx
        .select({ id: students.id })
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

      const subtotal = round2(items.reduce((s, li) => s + num(li.amount), 0));
      const discAmount = discount
        ? round2(
            Math.min(
              discount.kind === "PERCENT"
                ? subtotal * (num(discount.value) / 100)
                : num(discount.value),
              subtotal,
            ),
          )
        : 0;
      const billed = round2(subtotal - discAmount);

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

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invoice_batch",
        entityId: classId,
        after: { structure: structure.name, created, skipped },
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

// ---------------------------------------------------------------- reminders
export type RemindersResult =
  | { ok: true; sent: number; noPhone: number }
  | { ok: false; error: string };

export async function sendFeeReminders(): Promise<RemindersResult> {
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const rows = await withSchool(school.id, (tx) =>
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
            eq(invoices.schoolId, school.id),
            inArray(invoices.status, ["ISSUED", "PARTIAL", "OVERDUE"]),
            sql`${invoices.balanceAmount} > 0`,
          ),
        )
        .groupBy(invoices.studentId, students.firstName, studentGuardians.phone)
        .limit(1000),
    );

    let sent = 0;
    let noPhone = 0;
    const sender = school.shortName ?? "Omnischools";
    for (const r of rows) {
      if (!r.phone) {
        noPhone++;
        continue;
      }
      const msg = `${sender}: Dear parent, ${r.firstName} has an outstanding fee balance of GHS ${toMoney(num(r.outstanding))}. Kindly settle at your earliest convenience. Thank you.`;
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
