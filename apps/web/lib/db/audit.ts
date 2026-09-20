import { auditLog } from "@/db/schema";
import type { Tx } from "@/lib/db";

/**
 * Write one append-only audit row inside the SAME transaction as the mutation it
 * records. Every state-changing operation MUST call this — corrections are new
 * events (before/after snapshots), never silent edits.
 */
export interface AuditEntry {
  schoolId: string;
  actionType: string; // created | updated | voided | settled | ...
  entityType: string; // student | invoice | payment | role_assignment | ...
  entityId?: string;
  actorUserId?: string;
  actorRole?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    schoolId: entry.schoolId,
    actionType: entry.actionType,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    beforeState: entry.before ?? null,
    afterState: entry.after ?? null,
    reason: entry.reason,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
  });
}
