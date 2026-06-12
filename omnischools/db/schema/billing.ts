import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { discountKindEnum } from "./_enums";
import { schools } from "./tenancy";
import { feeCategories } from "./fees";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * A reusable fee plan for a grade/level in a year (e.g. "JHS 1 — 2025/26").
 * Bursars define these in Billing, then generate invoices for a whole class from
 * one in a click. Distinct from `invoice` (Fees), which is the issued bill.
 */
export const feeStructures = pgTable(
  "fee_structure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: text("level"),
    academicYear: text("academic_year").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_fee_structure_per_school").on(t.schoolId, t.name) }),
);

/** One line of a fee structure (Tuition 300, Books 80, ...). */
export const feeStructureItems = pgTable("fee_structure_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  feeStructureId: uuid("fee_structure_id")
    .notNull()
    .references(() => feeStructures.id, { onDelete: "cascade" }),
  feeCategoryId: uuid("fee_category_id").references(() => feeCategories.id, {
    onDelete: "set null",
  }),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
});

/** A named discount the bursar can apply when generating invoices. */
export const discounts = pgTable(
  "discount",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: discountKindEnum("kind").notNull().default("FIXED"),
    value: money("value").notNull(), // percent (0-100) or fixed GHS
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_discount_per_school").on(t.schoolId, t.name) }),
);
