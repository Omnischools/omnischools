import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
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
    specialisations: text("specialisations"), // comma-separated tags

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqStaff: unique("uniq_staff_profile_per_school").on(t.schoolId, t.userId),
    bySchool: index("staff_profile_school_idx").on(t.schoolId),
  }),
);
