import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  numeric,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * Optional staff profile — the extended Personal & contact and Qualifications &
 * licensure fields from schoolup-staff-record-multirole §01. Kept off `ref_user`
 * (which is the cross-school login identity) and school-scoped instead: each school
 * curates its own staff record, and RLS stays uniform. Every field is optional — a
 * staff member is fully usable with just a name + phone + role.
 */
export const staffProfiles = pgTable(
  "staff_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Personal & contact
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"), // "Male" | "Female" (free text — staff demographics)
    address: text("address"),
    emergencyContact: text("emergency_contact"), // "Name · relationship · phone"

    // Qualifications & licensure
    /** Coarse level for averaging/sorting — one of QUALIFICATION_LEVELS codes. */
    qualificationLevel: text("qualification_level"),
    /** Free-text detail, e.g. "MEd Mathematics Education · University of Cape Coast · 2019". */
    highestQualification: text("highest_qualification"),
    undergraduate: text("undergraduate"),
    ntcLicenceNumber: text("ntc_licence_number"),
    ntcLicenceExpiry: date("ntc_licence_expiry"),
    /**
     * Nursing & Midwifery Council of Ghana licence — the matron's clinical credential (sickbay
     * INCR-21 / 0056). Deliberately a SECOND pair beside the NTC one rather than a generalised
     * `licence_body` triple (Kofi R22): a teacher-turned-matron holds BOTH licences, and one
     * generalised triple cannot hold two. An N&MC number is a PUBLIC statutory-register
     * credential, not medical PII — it is the only new "clinical" datum in 0056.
     */
    nmcLicenceNumber: text("nmc_licence_number"),
    nmcLicenceExpiry: date("nmc_licence_expiry"),
    specialisations: text("specialisations"), // comma-separated tags

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqStaff: unique("uniq_staff_profile_per_school").on(t.schoolId, t.userId),
    bySchool: index("staff_profile_school_idx").on(t.schoolId),
  }),
);

/**
 * Staff compensation — the current pay record per staff member (schoolup-staff-
 * compensation §01). One row per (school, user). Salary status distinguishes
 * school-paid (hits the P&L salaries line), GES-paid (government-seconded, a footnote
 * on the books), and allowance-only (part-time/volunteer). SSNIT + PAYE are deductions;
 * net = monthly_amount − ssnit − paye. All amounts in the school's currency (GHS).
 */
export const staffCompensation = pgTable(
  "staff_compensation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** SCHOOL_PAID | GES_PAID | ALLOWANCE */
    salaryStatus: text("salary_status").notNull().default("SCHOOL_PAID"),
    monthlyAmount: numeric("monthly_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    payMethod: text("pay_method").notNull().default("BANK"), // BANK | CASH | MOMO
    payCadence: text("pay_cadence").notNull().default("MONTHLY"),
    ssnitDeduction: numeric("ssnit_deduction", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    payeDeduction: numeric("paye_deduction", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    effectiveFrom: date("effective_from"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqComp: unique("uniq_staff_compensation_per_school").on(t.schoolId, t.userId),
    bySchool: index("staff_compensation_school_idx").on(t.schoolId),
  }),
);
