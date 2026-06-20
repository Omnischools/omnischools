"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/field-options";
import { bookCategories } from "@/db/schema";

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
