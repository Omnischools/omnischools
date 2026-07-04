import {
  pgTable,
  uuid,
  text,
  smallint,
  date,
  timestamp,
  primaryKey,
  foreignKey,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { periodTypeEnum, periodSourceEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * School holidays / breaks / events / exam weeks within a term. Drives the
 * school-day counter ("Day 47 of 62"), trend holiday bands and the term grid.
 * `kind`: PUBLIC | BREAK | EVENT | EXAM.
 */
export const schoolHolidays = pgTable(
  "school_holiday",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    kind: text("kind").notNull().default("PUBLIC"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySchool: index("school_holiday_school_idx").on(t.schoolId) }),
);

/**
 * Academic period configuration — Item 0 of the score-ledger build sequence.
 * Foundational time dimension for all tiers (Basic = 3 terms, Senior = 2 semesters).
 */
export const academicPeriodConfig = pgTable(
  "ref_academic_period_config",
  {
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    academicYear: text("academic_year").notNull(), // e.g. "2025/26"
    periodType: periodTypeEnum("period_type").notNull(),
    periodCount: smallint("period_count").notNull(), // 2 | 3
    source: periodSourceEnum("source").notNull(),
    configuredAt: timestamp("configured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    configuredBy: uuid("configured_by").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.schoolId, t.academicYear] }),
  }),
);

export const academicPeriod = pgTable(
  "academic_period",
  {
    periodId: uuid("period_id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    academicYear: text("academic_year").notNull(),
    periodNumber: smallint("period_number").notNull(), // 1, 2, [3]
    periodLabel: text("period_label").notNull(), // "Semester 1", "Term 2"
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
  },
  (t) => ({
    configFk: foreignKey({
      columns: [t.schoolId, t.academicYear],
      foreignColumns: [academicPeriodConfig.schoolId, academicPeriodConfig.academicYear],
    }).onDelete("cascade"),
    // Composite-FK target: lets child tables reference (school_id, period_id) so a
    // cross-tenant period reference is structurally impossible. See prod-paste-0034.
    tenantUk: unique("academic_period_tenant_uk").on(t.schoolId, t.periodId),
  }),
);

/** GES default period calendars, seeded manually. Global reference (no tenant scope). */
export const genPeriodDefaults = pgTable(
  "gen_period_defaults",
  {
    academicYear: text("academic_year").notNull(),
    productLine: text("product_line").notNull(), // BASIC | SENIOR | SENIOR_F3
    periodNumber: smallint("period_number").notNull(),
    periodLabel: text("period_label").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    sourceUrl: text("source_url"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.academicYear, t.productLine, t.periodNumber],
    }),
  }),
);
