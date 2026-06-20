"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/field-options";
import { bookCategories, bookEntries } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

const KIND = z.enum(["INCOME", "EXPENSE"]);

// ----------------------------------------------------------- chart of accounts
const AddCategorySchema = z.object({
  name: z.string().min(1, "Enter a category name").max(60),
  kind: KIND,
});

export async function addBookCategory(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const [c] = await tx
        .insert(bookCategories)
        .values({ schoolId: school.id, name: parsed.data.name.trim(), kind: parsed.data.kind })
        .onConflictDoNothing({
          target: [bookCategories.schoolId, bookCategories.kind, bookCategories.name],
        })
        .returning({ id: bookCategories.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "book_category",
        entityId: c?.id,
        after: { name: parsed.data.name, kind: parsed.data.kind },
        reason: "Book category added",
      });
      return c?.id;
    });
    safeRevalidate("/books/settings");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not add category — it may already exist." };
  }
}

const RenameSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(60) });
export async function renameBookCategory(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(bookCategories)
        .set({ name: parsed.data.name.trim() })
        .where(
          and(
            eq(bookCategories.id, parsed.data.id),
            eq(bookCategories.schoolId, school.id),
          ),
        ),
    );
    safeRevalidate("/books/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not rename — that name may already exist." };
  }
}

const ActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });
export async function setBookCategoryActive(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = ActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(bookCategories)
        .set({ active: parsed.data.active })
        .where(
          and(
            eq(bookCategories.id, parsed.data.id),
            eq(bookCategories.schoolId, school.id),
          ),
        ),
    );
    safeRevalidate("/books/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update category." };
  }
}

/** One-click: seed the GES-typical income/expense categories (skips any that exist). */
export async function seedDefaultBookCategories(): Promise<Result & { added?: number }> {
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const added = await withSchool(school.id, async (tx) => {
      const rows = [
        ...INCOME_CATEGORIES.map((name) => ({ schoolId: school.id, name, kind: "INCOME" as const })),
        ...EXPENSE_CATEGORIES.map((name) => ({ schoolId: school.id, name, kind: "EXPENSE" as const })),
      ];
      const ins = await tx
        .insert(bookCategories)
        .values(rows)
        .onConflictDoNothing({
          target: [bookCategories.schoolId, bookCategories.kind, bookCategories.name],
        })
        .returning({ id: bookCategories.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "book_category",
        after: { seeded: ins.length },
        reason: "Default book categories seeded",
      });
      return ins.length;
    });
    safeRevalidate("/books/settings");
    return { ok: true, added };
  } catch {
    return { ok: false, error: "Could not seed default categories." };
  }
}

// ----------------------------------------------------------- income / expense entries
const isIsoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const AddEntrySchema = z.object({
  kind: KIND,
  entryDate: z.string().refine(isIsoDate, "Enter a valid date"),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().max(200).optional().or(z.literal("")),
  party: z.string().max(120).optional().or(z.literal("")),
  method: z.string().max(40).optional().or(z.literal("")),
  reference: z.string().max(60).optional().or(z.literal("")),
  amount: z.coerce.number().positive("Amount must be greater than 0").max(100000000),
});

export async function addBookEntry(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const [e] = await tx
        .insert(bookEntries)
        .values({
          schoolId: school.id,
          kind: d.kind,
          entryDate: d.entryDate,
          categoryId: d.categoryId || null,
          description: nz(d.description),
          party: nz(d.party),
          method: nz(d.method),
          reference: nz(d.reference),
          amount: String(d.amount),
          createdByUserId: actor.id ?? null,
        })
        .returning({ id: bookEntries.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "book_entry",
        entityId: e.id,
        after: { kind: d.kind, amount: d.amount },
        reason: `${d.kind === "INCOME" ? "Income" : "Expense"} recorded`,
      });
      return e.id;
    });
    safeRevalidate("/books");
    safeRevalidate(d.kind === "INCOME" ? "/books/income" : "/books/expenses");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not save the entry. Please try again." };
  }
}

const DeleteEntrySchema = z.object({ id: z.string().uuid() });
export async function deleteBookEntry(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = DeleteEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [row] = await tx
        .select({ kind: bookEntries.kind })
        .from(bookEntries)
        .where(and(eq(bookEntries.id, parsed.data.id), eq(bookEntries.schoolId, school.id)));
      if (!row) return { error: "Entry not found." };
      await tx
        .delete(bookEntries)
        .where(and(eq(bookEntries.id, parsed.data.id), eq(bookEntries.schoolId, school.id)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "book_entry",
        entityId: parsed.data.id,
        reason: "Book entry deleted",
      });
      return { ok: true as const, kind: row.kind };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/books");
    safeRevalidate(outcome.kind === "INCOME" ? "/books/income" : "/books/expenses");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete the entry." };
  }
}
