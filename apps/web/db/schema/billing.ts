import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  integer,
  timestamp,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { discountKindEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";
import { feeCategories, invoices } from "./fees";
import { students } from "./students";

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
  (t) => ({
    uniqName: unique("uniq_fee_structure_per_school").on(t.schoolId, t.name),
    // Composite-FK target for fee_structure_item (school_id, id).
    tenantUk: unique("fee_structure_tenant_uk").on(t.schoolId, t.id),
  }),
);

/** One line of a fee structure (Tuition 300, Books 80, ...). */
export const feeStructureItems = pgTable(
  "fee_structure_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    feeStructureId: uuid("fee_structure_id").notNull(),
    feeCategoryId: uuid("fee_category_id").references(() => feeCategories.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => ({
    // Composite school-scoped FK — the parent fee structure must be in the same tenant.
    structureFk: foreignKey({
      columns: [t.schoolId, t.feeStructureId],
      foreignColumns: [feeStructures.schoolId, feeStructures.id],
    }).onDelete("cascade"),
  }),
);

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
    value: money("value").notNull(), // percent (0-100) or fixed GHS; ignored when tiered
    // null = whole invoice; else the discount only reduces items in this category.
    appliesToCategoryId: uuid("applies_to_category_id").references(
      () => feeCategories.id,
      { onDelete: "set null" },
    ),
    durationLabel: text("duration_label"), // e.g. "1 term", "Full year" — metadata
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    stackable: boolean("stackable").notNull().default(true),
    // when true, the per-student value comes from discount_tier (by sibling rank).
    isTiered: boolean("is_tiered").notNull().default(false),
    appliedCount: integer("applied_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_discount_per_school").on(t.schoolId, t.name),
    // Composite-FK target for discount_tier / invoice_discount_application (school_id, id).
    tenantUk: unique("discount_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * A sibling-rank tier of a discount: rank 1 = 1st child, 2 = 2nd, … Each tier's
 * `value` is read using the parent discount's `kind`. A student's rank comes from
 * their household membership; ranks beyond the highest tier reuse the top tier.
 */
export const discountTiers = pgTable(
  "discount_tier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    discountId: uuid("discount_id").notNull(),
    rank: integer("rank").notNull(),
    value: money("value").notNull(),
  },
  (t) => ({
    uniqRank: unique("uniq_discount_tier_rank").on(t.discountId, t.rank),
    // Composite school-scoped FK — the parent discount must be in the same tenant.
    discountFk: foreignKey({
      columns: [t.schoolId, t.discountId],
      foreignColumns: [discounts.schoolId, discounts.id],
    }).onDelete("cascade"),
  }),
);

/**
 * Attributes a discount applied on an invoice to the specific `discount` scheme
 * that granted it — the missing link that powers the Discounts report (per-scheme
 * value, top recipients, application timeline). Written by the invoice-issue flow
 * when a scheme is selected; recorded from issuance onward (no historical backfill).
 */
export const invoiceDiscountApplications = pgTable(
  "invoice_discount_application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    studentId: uuid("student_id").notNull(),
    discountId: uuid("discount_id").notNull(),
    amount: money("amount").notNull(), // GHS value granted on this invoice
    kindSnapshot: discountKindEnum("kind_snapshot"), // discount kind at application time
    rank: integer("rank"), // sibling rank, when the scheme is tiered
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    appliedByUserId: uuid("applied_by_user_id").references(() => users.id),
  },
  (t) => ({
    bySchool: index("invoice_discount_app_school_idx").on(t.schoolId),
    byInvoice: index("invoice_discount_app_invoice_idx").on(t.invoiceId),
    byDiscount: index("invoice_discount_app_discount_idx").on(t.discountId),
    // Composite school-scoped FKs — invoice, student and discount are same-tenant.
    invoiceFk: foreignKey({
      columns: [t.schoolId, t.invoiceId],
      foreignColumns: [invoices.schoolId, invoices.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    discountFk: foreignKey({
      columns: [t.schoolId, t.discountId],
      foreignColumns: [discounts.schoolId, discounts.id],
    }).onDelete("restrict"),
  }),
);
