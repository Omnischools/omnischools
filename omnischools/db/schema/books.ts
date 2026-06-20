import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  date,
  smallint,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { bookEntryKindEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * Books — the school's own bookkeeping (income & expenses), separate from fee invoices.
 * `book_category` is the chart of accounts; `book_entry` is a dated income/expense line;
 * `fixed_asset` tracks capital items with depreciation. Tenant-scoped (RLS on school_id).
 */
export const bookCategories = pgTable(
  "book_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: bookEntryKindEnum("kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_book_category_per_school").on(t.schoolId, t.kind, t.name),
    bySchool: index("book_category_school_idx").on(t.schoolId),
  }),
);

export const bookEntries = pgTable(
  "book_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    kind: bookEntryKindEnum("kind").notNull(),
    entryDate: date("entry_date").notNull(),
    categoryId: uuid("category_id").references(() => bookCategories.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    party: text("party"), // source (income) / payee (expense)
    method: text("method"), // cash, MoMo, bank…
    reference: text("reference"), // receipt / voucher number
    amount: money("amount").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolDate: index("book_entry_school_date_idx").on(t.schoolId, t.entryDate),
  }),
);

export const fixedAssets = pgTable(
  "fixed_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    acquiredOn: date("acquired_on"),
    originalCost: money("original_cost").notNull(),
    accumulatedDepreciation: money("accumulated_depreciation").notNull().default("0"),
    usefulLifeYears: smallint("useful_life_years"),
    condition: text("condition"), // New / Good / Fair / Poor
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySchool: index("fixed_asset_school_idx").on(t.schoolId) }),
);
