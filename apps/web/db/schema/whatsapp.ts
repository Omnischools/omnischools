import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * A WhatsApp message template (schoolup-whatsapp-template-authoring). WhatsApp Business
 * requires every outbound message to use a Meta-approved template. This holds the
 * composed template + its approval lifecycle. Meta submission/approval is stubbed for
 * now (no Business API wired) — a simple Utility template auto-approves; anything that
 * would trigger Meta's manual review (document header / 2+ buttons / Marketing) lands
 * in PENDING until a real integration resolves it. See docs/senior-tier-backlog.md.
 */
export const whatsappTemplates = pgTable(
  "whatsapp_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),

    name: text("name").notNull(), // snake_case identifier, unique per school
    category: text("category").notNull().default("UTILITY"), // UTILITY | MARKETING
    language: text("language").notNull().default("en_GH"), // en_GH | tw | gaa

    headerType: text("header_type").notNull().default("NONE"), // NONE | TEXT | IMAGE | DOCUMENT
    headerText: text("header_text"), // for TEXT headers
    headerFilename: text("header_filename"), // filename pattern for DOCUMENT headers

    body: text("body").notNull(), // may contain {variables}
    footer: text("footer"), // <= 60 chars
    /** [{ type: "URL"|"PHONE"|"QUICK_REPLY", label, value? }] */
    buttons: jsonb("buttons"),
    /** { "{parent_name}": "Ama Boateng", ... } — sample values Meta needs for review */
    sampleValues: jsonb("sample_values"),

    status: text("status").notNull().default("DRAFT"), // DRAFT | PENDING | APPROVED | REJECTED
    rejectionReason: text("rejection_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_whatsapp_template_name_per_school").on(t.schoolId, t.name),
    bySchool: index("whatsapp_template_school_idx").on(t.schoolId),
  }),
);
