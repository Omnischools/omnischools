import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Inbound demo/contact leads (pre-tenant — no school_id, no RLS).
 * Captured from the public marketing site; the founder is notified by email.
 */
export const marketingLeads = pgTable("marketing_lead", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role"),
  organisation: text("organisation"),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message"),
  source: text("source").notNull().default("demo_form"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
