import { pgTable, uuid, text, date, timestamp, index } from "drizzle-orm/pg-core";
import { sexEnum, admissionStatusEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students } from "./students";

/** A prospective student's application. On ACCEPT it produces a `students` row. */
export const admissionApplications = pgTable(
  "admission_application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    applicantFirstName: text("applicant_first_name").notNull(),
    applicantLastName: text("applicant_last_name").notNull(),
    applicantOtherNames: text("applicant_other_names"),
    sex: sexEnum("sex").notNull(),
    dateOfBirth: date("date_of_birth"),
    desiredClassLabel: text("desired_class_label"),
    guardianName: text("guardian_name").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    guardianEmail: text("guardian_email"),
    status: admissionStatusEnum("status").notNull().default("SUBMITTED"),
    notes: text("notes"),
    studentId: uuid("student_id").references(() => students.id), // set on ACCEPT
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => ({
    bySchoolStatus: index("admission_school_status_idx").on(t.schoolId, t.status),
  }),
);

/** Uploaded supporting documents (metadata; files live in Supabase Storage). */
export const admissionDocuments = pgTable("admission_document", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => admissionApplications.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  fileKey: text("file_key").notNull(), // storage object key
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});
