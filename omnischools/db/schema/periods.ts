import {
  pgTable,
  uuid,
  text,
  smallint,
  date,
  timestamp,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { periodTypeEnum, periodSourceEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";

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
