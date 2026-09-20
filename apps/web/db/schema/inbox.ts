import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  boolean,
  smallint,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { conversationStatusEnum, messageDirectionEnum } from "./_enums";
import { schools } from "./tenancy";
import { students } from "./students";
import { users } from "./identity";

/**
 * A two-way message thread with a parent/contact (by phone). Outbound replies go
 * via the SMS interface; inbound messages arrive through the provider webhook
 * (POST /api/inbox/inbound). Optionally linked to a student and assigned to staff.
 */
export const conversations = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    contactPhone: text("contact_phone").notNull(), // E.164
    contactName: text("contact_name"),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    subject: text("subject"),
    status: conversationStatusEnum("status").notNull().default("OPEN"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Delivery channel — "SMS" today; "WHATSAPP" once that channel is wired. */
    channel: text("channel").notNull().default("SMS"),
    /** Detected subject for routing/filtering: BILLING | ATTENDANCE | ACADEMIC |
     * SCHEDULE | URGENT | OTHER (null until classified). */
    topic: text("topic"),
    /** Provenance: the routing rule that auto-assigned this thread (name snapshotted
     * so it survives rule edits/deletes). */
    routedByRuleId: uuid("routed_by_rule_id"),
    routedByRuleName: text("routed_by_rule_name"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When a staff member last opened/replied to this thread. A thread is UNREAD when
     * `read_at IS NULL OR last_message_at > read_at` — a new inbound advances
     * last_message_at past read_at; opening or replying sets read_at = now(). Null on
     * threads started by an inbound reply (nobody has opened them yet). */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolActivity: index("conversation_school_activity_idx").on(
      t.schoolId,
      t.status,
      t.lastMessageAt,
    ),
    byPhone: index("conversation_phone_idx").on(t.schoolId, t.contactPhone),
    // Composite-FK target for inbox_message (school_id, conversation_id).
    tenantUk: unique("conversation_tenant_uk").on(t.schoolId, t.id),
  }),
);

/** One message in a conversation (inbound from the parent or outbound from staff). */
export const inboxMessages = pgTable(
  "inbox_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConversation: index("inbox_message_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    // Composite school-scoped FK — conversation must belong to the same tenant.
    conversationFk: foreignKey({
      columns: [t.schoolId, t.conversationId],
      foreignColumns: [conversations.schoolId, conversations.id],
    }).onDelete("cascade"),
  }),
);

/**
 * Inbox routing rule. Rules are evaluated top-to-bottom by `position`; the first
 * enabled rule whose conditions all match wins, assigning the thread (or leaving it
 * unassigned) and optionally pinging all admins. A single `isFallback` rule per school
 * always sits last and catches anything unmatched. Conditions are AND-ed; an empty
 * condition means "any". See schoolup-inbox-routing §03.
 */
export const inboxRoutingRules = pgTable(
  "inbox_routing_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: smallint("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    isFallback: boolean("is_fallback").notNull().default(false),

    // Conditions (all AND-ed; null/empty = "any")
    matchTopic: text("match_topic"), // one topic code, or null
    matchClass: text("match_class"), // substring of the student's class label, e.g. "JHS 2A" / "JHS 3"
    matchKeywords: text("match_keywords"), // comma-separated; any keyword present in the message

    // Action
    assignToUserId: uuid("assign_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }), // null = leave unassigned
    notifyAllAdmins: boolean("notify_all_admins").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolPos: index("inbox_routing_rule_school_pos_idx").on(t.schoolId, t.position),
  }),
);
