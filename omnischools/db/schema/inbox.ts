import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
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
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySchoolActivity: index("conversation_school_activity_idx").on(
      t.schoolId,
      t.status,
      t.lastMessageAt,
    ),
    byPhone: index("conversation_phone_idx").on(t.schoolId, t.contactPhone),
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
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
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
  }),
);
