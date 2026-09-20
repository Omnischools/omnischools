import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import { loadParentComms, type ParentCommsMessage } from "@/lib/parent/parent-comms-data";
import { relationshipLabel } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";
import { Compose } from "./compose";

/**
 * INCR-COMM · the parent-portal Communications ("Messages") tab — a 2-way in-app thread between a parent
 * and their school (reader is parent-comms-data — the safe key-set; write is the sendParentMessage action).
 * Same PARENT session gate as the other (parent) routes; the thread is resolved from the SESSION (child +
 * the parent's own stored phone), never a URL id. The parent reads staff replies here and can send a
 * message — in-app only, NO SMS. Every message is real (R90): no fabricated thread / staff name / delivery
 * state / unread dot. URL is /messages (the staff route is /communication).
 */
export const dynamic = "force-dynamic";

const STAMP = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
});
const stamp = (d: Date) => STAMP.format(d);

export default async function ParentMessagesPage() {
  const { user, school } = await requireParent();
  const data = await loadParentPortal(school.id, user.id);
  const child = data.children[0] ?? null;
  const comms = child ? await loadParentComms(school.id, user.id, data.guardianPhone) : null;

  const guardianDisplay = data.guardianName ?? user.name ?? "Parent";
  const relation = data.guardianRelationship ? relationshipLabel(data.guardianRelationship) : "Parent";

  return (
    <div className="mx-auto max-w-[980px]">
      <ParentHeader
        schoolName={school.name}
        childName={child?.fullName ?? null}
        guardianDisplay={guardianDisplay}
        relation={relation}
      />
      <ParentNav active="Messages" />

      <div className="px-7 pb-9 pt-6">
        {!child ? (
          <NoChild />
        ) : (
          <div className="space-y-5">
            <Greeting schoolName={school.name} childFirstName={child.firstName} />
            <Tone total={comms!.total} repliedByYou={comms!.repliedByYou} lastMessageAt={comms!.lastMessageAt} />
            <Thread messages={comms!.messages} schoolName={school.name} />
            <Compose childFirstName={child.firstName} />
            <PrivacyFooter />
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue, not a message fact (mirrors the sibling tabs). Compose hidden. */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── greeting ── */

function Greeting({ schoolName, childFirstName }: { schoolName: string; childFirstName: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold">
        Messages from {schoolName}
      </div>
      <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.018em] text-navy">
        Your <em className="text-gold">conversation</em> with the school
      </h2>
      <p className="mt-1 text-[13px] text-navy-3">
        Everything the school has sent you about <b className="text-navy-2">{childFirstName}</b>, and what
        you&apos;ve replied.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── tone ── */

function Tone({
  total,
  repliedByYou,
  lastMessageAt,
}: {
  total: number;
  repliedByYou: number;
  lastMessageAt: Date | null;
}) {
  return (
    <section className="rounded-[14px] border border-border bg-surface px-[18px] py-4">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-gold">This term</div>
      {total === 0 ? (
        <p className="mt-1 font-display text-[15px] text-navy">You have no messages with the school yet.</p>
      ) : (
        <>
          <p className="mt-1 font-display text-[15px] text-navy">
            You and the school have exchanged <em className="text-gold">{msgs(total)}</em>. You replied to{" "}
            <b>{repliedByYou} of them</b>.
          </p>
          {lastMessageAt && (
            <p className="mt-2 border-t border-dashed border-border pt-2 text-[11px] text-navy-3">
              Last message: <span className="font-mono">{stamp(lastMessageAt)}</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
const msgs = (n: number) => `${n} message${n === 1 ? "" : "s"}`;

/* ─────────────────────────────────────────────────────────────────── thread ── */

function Thread({ messages, schoolName }: { messages: ParentCommsMessage[]; schoolName: string }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-6 text-center text-[13px] leading-relaxed text-navy-2">
        You haven&apos;t exchanged any messages with the school yet. Send one below and the school will reply
        here.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <Bubble key={i} m={m} schoolName={schoolName} />
      ))}
    </div>
  );
}

function Bubble({ m, schoolName }: { m: ParentCommsMessage; schoolName: string }) {
  const you = m.sender === "you";
  return (
    <div
      className={
        "rounded-xl px-4 py-3.5 " +
        (you ? "border border-gold-soft bg-gold-bg" : "border border-border border-l-[3px] border-l-gold bg-surface")
      }
    >
      <div className="mb-1.5 flex items-start justify-between gap-2.5">
        <span className="text-[11px] font-semibold text-navy">{you ? "You" : schoolName}</span>
        <span className="font-mono text-[10px] text-navy-3">{stamp(m.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-normal text-navy-2">{m.body}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── privacy footer ── */

function PrivacyFooter() {
  return (
    <div className="rounded-[10px] border border-dashed border-border-2 bg-bg px-[14px] py-3 text-[11px] leading-relaxed text-navy-3">
      <b className="text-navy-2">What you see here:</b> messages the school sent you and your replies.{" "}
      <b className="text-navy-2">What you don&apos;t see:</b> internal staff notes about your account and
      the school&apos;s operational data — <em className="font-display text-gold">those are private to the
      school</em>. For anything else, contact the school office.
    </div>
  );
}
