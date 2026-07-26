"use client";
/**
 * Sickbay comms compose affordances (SHS module 4.4 / INCR-26) — the MATRON write panel for the §02
 * referral thread and the §05 visit log. Client component: PLAIN SERIALIZABLE props only, never a
 * `*-reads` module. Rendered only for the MATRON (`canWrite`); every action re-checks the gate
 * server-side. Console-only — a sent SMS renders "Queued · console", never "delivered" (the row itself
 * carries the truth; this panel never asserts delivery).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmEventNotification,
  logInboundContact,
  logParentCall,
  scheduleReminder,
  sendParentSms,
} from "@/lib/actions/sickbay-notify";
import type { SickbayEventKind } from "@/lib/sickbay/notify";

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";

type Result = { ok: boolean; error?: string };
type Run = (fn: () => Promise<Result>) => void;

export function CommsCompose({
  referralId,
  visitId,
  eventKind,
  canConfirm,
}: {
  referralId?: string;
  visitId?: string;
  eventKind: SickbayEventKind;
  /** true for tier ≥ 2 events (admission / referral): the parent + HM fan-out is offered. */
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const anchor: Anchor = { referralId, visitId };

  const run: Run = (fn) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Could not complete that.");
      else router.refresh();
    });
  };

  return (
    <div className="mt-4 rounded-[12px] border border-border bg-surface p-[16px_20px]">
      <h3 className="mb-3 font-display text-[15px] font-semibold text-navy">
        Record <em className="font-normal italic text-gold">contact</em>
      </h3>
      {error && (
        <div className="mb-3 rounded-lg border border-terra bg-terra-bg px-3 py-2 text-[11px] font-semibold text-terra">
          {error}
        </div>
      )}

      {canConfirm && (
        <div className="mb-4 rounded-lg border border-gold-soft bg-gold-bg p-[12px_14px]">
          <p className="mb-2 text-[11px] text-navy-2">
            Send the parent a diagnosis-free confirmation
            {eventKind === "REFERRAL" ? " and notify the Housemaster (name + location only)" : ""}.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => confirmEventNotification({ ...anchor, eventKind }))}
            className="rounded-md border border-gold bg-gold px-3 py-[6px] text-[11px] font-bold text-navy disabled:opacity-50"
          >
            Send confirmation
          </button>
        </div>
      )}

      <SendSms anchor={anchor} eventKind={eventKind} pending={pending} run={run} />
      <LogCall anchor={anchor} eventKind={eventKind} pending={pending} run={run} />
      <RecordInbound anchor={anchor} eventKind={eventKind} pending={pending} run={run} />
      <ScheduleReminder anchor={anchor} eventKind={eventKind} pending={pending} run={run} />
    </div>
  );
}

type Anchor = { referralId?: string; visitId?: string };

function SendSms({ anchor, eventKind, pending, run }: { anchor: Anchor; eventKind: SickbayEventKind; pending: boolean; run: Run }) {
  const [body, setBody] = useState("");
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Send SMS to parent</h4>
      <textarea
        className={`${FIELD} min-h-[54px]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message to the parent (convey the condition by phone, not SMS)"
      />
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={() =>
          run(async () => {
            const res = await sendParentSms({ ...anchor, eventKind, body: body.trim() });
            if (res.ok) setBody("");
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Send SMS (console)
      </button>
    </div>
  );
}

function LogCall({ anchor, eventKind, pending, run }: { anchor: Anchor; eventKind: SickbayEventKind; pending: boolean; run: Run }) {
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [answered, setAnswered] = useState(true);
  const [mins, setMins] = useState("");
  const [secs, setSecs] = useState("");
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Log outbound call</h4>
      <textarea
        className={`${FIELD} min-h-[54px]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What was communicated (parent-facing summary)"
      />
      <textarea
        className={`${FIELD} mt-2 min-h-[40px]`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Private matron note (never sent to the parent)"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-navy-2">
          <input type="checkbox" checked={answered} onChange={(e) => setAnswered(e.target.checked)} />
          Answered
        </label>
        {answered && (
          <span className="flex items-center gap-1">
            <input className={`${FIELD} max-w-[64px]`} value={mins} onChange={(e) => setMins(e.target.value)} placeholder="min" inputMode="numeric" />
            <input className={`${FIELD} max-w-[64px]`} value={secs} onChange={(e) => setSecs(e.target.value)} placeholder="sec" inputMode="numeric" />
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={() =>
          run(async () => {
            const duration = answered ? (Number(mins || 0) * 60 + Number(secs || 0)) || null : null;
            const res = await logParentCall({
              ...anchor,
              eventKind,
              body: body.trim(),
              privateNote: note.trim() || null,
              answered,
              callDurationSeconds: duration,
            });
            if (res.ok) {
              setBody("");
              setNote("");
              setMins("");
              setSecs("");
              setAnswered(true);
            }
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Log call
      </button>
    </div>
  );
}

function RecordInbound({ anchor, eventKind, pending, run }: { anchor: Anchor; eventKind: SickbayEventKind; pending: boolean; run: Run }) {
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"CALL" | "SMS">("CALL");
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Record parent-initiated contact</h4>
      <div className="mb-2 flex gap-2">
        {(["CALL", "SMS"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${
              channel === c ? "bg-navy text-bg" : "border border-border-2 bg-surface text-navy-2"
            }`}
          >
            {c === "CALL" ? "Call in" : "SMS in"}
          </button>
        ))}
      </div>
      <textarea
        className={`${FIELD} min-h-[54px]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What the parent said (matron-transcribed)"
      />
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={() =>
          run(async () => {
            const res = await logInboundContact({ ...anchor, eventKind, channel, body: body.trim(), answered: true });
            if (res.ok) setBody("");
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Record contact
      </button>
    </div>
  );
}

function ScheduleReminder({ anchor, eventKind, pending, run }: { anchor: Anchor; eventKind: SickbayEventKind; pending: boolean; run: Run }) {
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Schedule a reminder</h4>
      <p className="mb-2 text-[10px] italic text-navy-3">Renders as due at the window — nothing auto-fires; you send it manually.</p>
      <input type="datetime-local" className={FIELD} value={when} onChange={(e) => setWhen(e.target.value)} />
      <textarea
        className={`${FIELD} mt-2 min-h-[40px]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Reminder message"
      />
      <button
        type="button"
        disabled={pending || !body.trim() || !when}
        onClick={() =>
          run(async () => {
            const res = await scheduleReminder({ ...anchor, eventKind, body: body.trim(), scheduledFor: new Date(when).toISOString() });
            if (res.ok) {
              setBody("");
              setWhen("");
            }
            return res;
          })
        }
        className="mt-2 rounded-md border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy disabled:opacity-50"
      >
        Schedule reminder
      </button>
    </div>
  );
}
