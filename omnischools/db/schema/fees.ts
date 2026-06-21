import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import {
  invoiceStatusEnum,
  paymentMethodEnum,
  settlementStatusEnum,
  allocationTypeEnum,
  allocationMethodEnum,
  paymentEventTypeEnum,
  paymentActorTypeEnum,
} from "./_enums";
import { schools } from "./tenancy";
import { students } from "./students";
import { users } from "./identity";
import { academicPeriod } from "./periods";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Fee categories (Tuition, Books, Transport, ...) — per school. */
export const feeCategories = pgTable(
  "fee_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_fee_category_per_school").on(t.schoolId, t.name) }),
);

/** A bill issued to a student for a term. paid/balance denormalised for fast reads. */
export const invoices = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    academicYear: text("academic_year").notNull(),
    periodId: uuid("period_id").references(() => academicPeriod.periodId),
    subtotalAmount: money("subtotal_amount").notNull(),
    discountAmount: money("discount_amount").notNull().default("0"),
    billedAmount: money("billed_amount").notNull(),
    paidAmount: money("paid_amount").notNull().default("0"),
    balanceAmount: money("balance_amount").notNull(),
    status: invoiceStatusEnum("status").notNull().default("ISSUED"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => ({
    uniqNumber: unique("uniq_invoice_number_per_school").on(t.schoolId, t.invoiceNumber),
    byStudent: index("invoice_student_idx").on(t.studentId),
  }),
);

export const invoiceLineItems = pgTable("invoice_line_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  feeCategoryId: uuid("fee_category_id").references(() => feeCategories.id),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
  isOptional: boolean("is_optional").notNull().default(false),
});

/** One row per flow of money in. aggregator stays null in MVP1 (manual entry). */
export const payments = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    grossAmount: money("gross_amount").notNull(),
    feeAmount: money("fee_amount").notNull().default("0"),
    netAmount: money("net_amount").notNull(),
    currency: text("currency").notNull().default("GHS"),
    method: paymentMethodEnum("method").notNull(),
    methodReference: text("method_reference"),
    aggregator: text("aggregator"), // null in MVP1
    settlementStatus: settlementStatusEnum("settlement_status")
      .notNull()
      .default("PENDING"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id),
    voidReason: text("void_reason"),
    voidIsRefund: boolean("void_is_refund").notNull().default(false),
  },
  (t) => ({ byStudent: index("payment_student_idx").on(t.studentId) }),
);

/** Distribution of a payment across invoices (or credit/refund). */
export const paymentAllocations = pgTable("payment_allocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  allocationType: allocationTypeEnum("allocation_type").notNull().default("INVOICE"),
  amount: money("amount").notNull(),
  allocationMethod: allocationMethodEnum("allocation_method").notNull().default("MANUAL"),
  allocatedByUserId: uuid("allocated_by_user_id").references(() => users.id),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
});

/** One receipt per payment (1:1), generated on successful recording. */
export const receipts = pgTable(
  "receipt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" })
      .unique(),
    receiptNumber: text("receipt_number").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    pdfUrl: text("pdf_url"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReplacementId: uuid("void_replacement_id"),
  },
  (t) => ({
    uniqNumber: unique("uniq_receipt_number_per_school").on(t.schoolId, t.receiptNumber),
  }),
);

/** Append-only history of all payment events. Never updated or deleted. */
export const paymentAuditLog = pgTable(
  "payment_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id"),
    invoiceId: uuid("invoice_id"),
    eventType: paymentEventTypeEnum("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorType: paymentActorTypeEnum("actor_type").notNull().default("ADMIN"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolTime: index("payment_audit_school_time_idx").on(t.schoolId, t.createdAt),
  }),
);
