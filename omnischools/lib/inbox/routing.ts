import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { conversations, inboxRoutingRules, students } from "@/db/schema";
import { detectTopic } from "./topics";

export type RoutingOutcome = {
  assignToUserId: string | null;
  ruleId: string;
  ruleName: string;
  notifyAllAdmins: boolean;
} | null;

/**
 * Evaluate the school's enabled rules against a (topic, class, body) in `position`
 * order — first rule whose conditions ALL match wins; otherwise the fallback (if any).
 * Conditions are AND-ed; an empty condition means "any".
 */
export async function evaluateRouting(
  tx: Tx,
  schoolId: string,
  ctx: { topic: string | null; classLabel: string | null; body: string },
): Promise<RoutingOutcome> {
  const rules = await tx
    .select()
    .from(inboxRoutingRules)
    .where(
      and(eq(inboxRoutingRules.schoolId, schoolId), eq(inboxRoutingRules.enabled, true)),
    )
    .orderBy(asc(inboxRoutingRules.position));

  const fallback = rules.find((r) => r.isFallback) ?? null;
  const body = ctx.body.toLowerCase();
  const cls = (ctx.classLabel ?? "").toLowerCase();

  for (const r of rules) {
    if (r.isFallback) continue;
    if (r.matchTopic && r.matchTopic !== ctx.topic) continue;
    if (r.matchClass && !cls.includes(r.matchClass.toLowerCase())) continue;
    if (r.matchKeywords) {
      const kws = r.matchKeywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (kws.length > 0 && !kws.some((k) => body.includes(k))) continue;
    }
    return {
      assignToUserId: r.assignToUserId,
      ruleId: r.id,
      ruleName: r.name,
      notifyAllAdmins: r.notifyAllAdmins,
    };
  }

  if (fallback) {
    return {
      assignToUserId: fallback.assignToUserId,
      ruleId: fallback.id,
      ruleName: fallback.name,
      notifyAllAdmins: fallback.notifyAllAdmins,
    };
  }
  return null;
}

/**
 * Classify a conversation's latest message into a topic and auto-route it. Topic is
 * always (re)set; assignment is only applied when the thread is currently unassigned —
 * a human assignment is never overwritten. Returns the outcome (for notification).
 */
export async function applyRoutingToConversation(
  tx: Tx,
  schoolId: string,
  conversationId: string,
  body: string,
): Promise<RoutingOutcome> {
  const [conv] = await tx
    .select({
      studentId: conversations.studentId,
      assignedToUserId: conversations.assignedToUserId,
    })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.schoolId, schoolId)),
    );
  if (!conv) return null;

  const topic = detectTopic(body);

  let classLabel: string | null = null;
  if (conv.studentId) {
    const [s] = await tx
      .select({ c: students.currentClassLabel })
      .from(students)
      .where(eq(students.id, conv.studentId));
    classLabel = s?.c ?? null;
  }

  const outcome = await evaluateRouting(tx, schoolId, { topic, classLabel, body });

  const patch: {
    topic: string;
    assignedToUserId?: string | null;
    routedByRuleId?: string | null;
    routedByRuleName?: string | null;
  } = { topic };

  // Only auto-route an unassigned thread; never override a human owner.
  if (conv.assignedToUserId == null && outcome) {
    patch.assignedToUserId = outcome.assignToUserId;
    patch.routedByRuleId = outcome.ruleId;
    patch.routedByRuleName = outcome.ruleName;
  }

  await tx
    .update(conversations)
    .set(patch)
    .where(eq(conversations.id, conversationId));

  return outcome;
}
