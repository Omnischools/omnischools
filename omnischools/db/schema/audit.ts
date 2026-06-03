import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * Append-only audit trail. Every mutation in the system writes a row here
 * (see lib/db/audit.ts). Never updated or deleted — corrections are new events.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    auditId: uuid("audit_id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id), // null = system
    actorRole: text("actor_role"),
    actionType: text("action_type").notNull(), // created | updated | voided | ...
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    beforeState: jsonb("before_jsonb"),
    afterState: jsonb("after_jsonb"),
    reason: text("reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolTime: index("audit_school_time_idx").on(t.schoolId, t.occurredAt.desc()),
    byEntity: index("audit_entity_idx").on(t.entityType, t.entityId),
  }),
);
