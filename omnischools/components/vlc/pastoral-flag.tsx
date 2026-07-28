"use client";
/**
 * 🔴 INCR-42b — the CONFIDENTIAL pastoral-flag callout + raise/resolve affordances (SHS module 4.5). This
 * component is rendered by the session page ONLY for a gated viewer (own-class FM / Dean) — the server
 * decides `canAccessPastoralFlag` and fetches the flags BEFORE mounting this; a non-gated viewer's page
 * never renders it (no callout, no "flag exists" leak). Every viewer who reaches it can also write (read
 * gate === write gate), so no extra client gate is needed — the server actions re-check regardless.
 *
 * Terra-tinted, the classic no-alpha trap surface (memory `no-alpha-token-opacity`): every terra usage is a
 * SOLID token (`bg-terra-bg` / `border-terra` / `text-terra` / `text-bg` on terra), never a slash-opacity.
 * Copy is surface-faithful with Lucy's drift #1 fix: "Surfaced by" (honest — the PG did not write it), the
 * verbatim "FM + DEAN ONLY" pill, and the derived "Queued for FM check-in" status (active = resolved_at
 * NULL). The INCR-43 buttons ("Open private case note" / "Add to FM check-in queue" / "Escalate to Dean")
 * are OMITTED-not-faked; there is NO free-text narrative box (the bereavement paragraph is INCR-43).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VLC_PASTORAL_SEVERITY } from "@/lib/vlc/defaults";
import type { PastoralFlagView } from "@/lib/vlc/pastoral-data";
import { raisePastoralFlag, resolvePastoralFlag } from "@/lib/actions/vlc-pastoral";

export function PastoralFlagPanel({
  flags,
  roster,
  sessionId,
}: {
  flags: PastoralFlagView[];
  roster: { studentId: string; name: string }[];
  sessionId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showRaise, setShowRaise] = useState(false);

  const resolve = (flagId: string) => {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await resolvePastoralFlag({ flagId });
      if (!res.ok) setError(res.error ?? "Could not resolve the flag.");
      else router.refresh();
    });
  };

  return (
    <section className="mb-10" aria-label="Pastoral flags — Form Master and Dean only">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-terra">
          Pastoral · confidential
        </div>
        <button
          type="button"
          onClick={() => setShowRaise((v) => !v)}
          className="rounded-md border border-terra px-3 py-1.5 text-[11px] font-bold text-terra hover:bg-terra-bg"
        >
          {showRaise ? "Cancel" : "Raise flag"}
        </button>
      </div>

      {flags.length === 0 && !showRaise && (
        <p className="text-[12px] italic text-navy-3">
          No active pastoral flags for this class. Only you (the class Form Master) and the Dean of Students
          can see this.
        </p>
      )}

      {flags.map((f) => (
        <div
          key={f.id}
          className="mb-3 rounded-xl border-[1.5px] border-terra bg-terra-bg px-[22px] py-[18px]"
        >
          {/* head — the flag metadata line */}
          <div className="mb-3 flex items-start gap-3 border-b border-dashed border-terra pb-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-terra font-display text-base font-bold text-bg">
              !
            </div>
            <div className="flex-1">
              <h4 className="font-display text-base font-semibold text-navy">
                Pastoral flag raised <em className="italic text-terra">· {f.raisedAtLabel}</em>
              </h4>
              <div className="mt-0.5 text-[11px] text-navy-2">
                {f.surfacedBy ? (
                  <>
                    Surfaced by <b className="font-bold text-terra">{f.surfacedBy}</b> ·{" "}
                  </>
                ) : null}
                student: <b className="font-bold text-terra">{f.studentName}</b>
                {f.context ? <> · context: {f.context}</> : null} · severity:{" "}
                <b className="font-bold text-terra">{f.severity}</b>
              </div>
            </div>
            <div className="ml-auto shrink-0 rounded-full bg-terra px-[11px] py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
              FM + DEAN ONLY
            </div>
          </div>

          {/* derived active status (NOT a stored narrative — INCR-43) + the case-note deep-link + resolve */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-navy-2">
              <b className="font-semibold text-navy">Queued for FM check-in</b>
            </span>
            <div className="flex items-center gap-2">
              {/* INCR-43a — the honest replacement for 42b's omitted "Open private case note" button. Only a
                  gated viewer renders this callout, so the confidential journal link is gated identically. */}
              <Link
                href={`/senior/vlc/journal/${f.studentId}`}
                className="rounded-md border border-terra px-3 py-1.5 text-[11px] font-bold text-terra hover:bg-terra-bg"
              >
                Open journal
              </Link>
              <button
                type="button"
                onClick={() => resolve(f.id)}
                disabled={pending}
                className="rounded-md border border-border-2 bg-bg px-3 py-1.5 text-[11px] font-bold text-navy hover:brightness-95 disabled:opacity-60"
              >
                Mark resolved
              </button>
            </div>
          </div>
        </div>
      ))}

      {showRaise && (
        <RaiseForm
          roster={roster}
          sessionId={sessionId}
          pending={pending}
          onSubmit={(payload) => {
            setError(null);
            start(async () => {
              const res = await raisePastoralFlag(payload);
              if (!res.ok) setError(res.error ?? "Could not raise the flag.");
              else {
                setShowRaise(false);
                router.refresh();
              }
            });
          }}
        />
      )}

      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </section>
  );
}

function RaiseForm({
  roster,
  sessionId,
  pending,
  onSubmit,
}: {
  roster: { studentId: string; name: string }[];
  sessionId: string | null;
  pending: boolean;
  onSubmit: (payload: {
    studentId: string;
    sessionId: string | null;
    severity: string;
    context: string;
    surfacedBy: string;
  }) => void;
}) {
  const [studentId, setStudentId] = useState(roster[0]?.studentId ?? "");
  const [severity, setSeverity] = useState<string>("CONCERN"); // middle of the 3-level scale
  const [context, setContext] = useState("");
  const [surfacedBy, setSurfacedBy] = useState("");

  return (
    <div className="rounded-xl border-[1.5px] border-terra bg-terra-bg px-[22px] py-[18px]">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-terra">
        Raise a pastoral flag
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2">
          Student
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
          >
            {roster.map((s) => (
              <option key={s.studentId} value={s.studentId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2">
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
          >
            {VLC_PASTORAL_SEVERITY.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2 sm:col-span-2">
          Context <span className="normal-case text-navy-3">(a short locator — not a case note)</span>
          <input
            type="text"
            value={context}
            maxLength={280}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Group B plenary share-back"
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2 sm:col-span-2">
          Surfaced by <span className="normal-case text-navy-3">(the Peer Guide who raised it — optional)</span>
          <input
            type="text"
            value={surfacedBy}
            maxLength={80}
            onChange={(e) => setSurfacedBy(e.target.value)}
            placeholder="Akua Gyamfi (PG)"
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => onSubmit({ studentId, sessionId, severity, context, surfacedBy })}
        disabled={pending || !studentId}
        className="mt-3 rounded-md border border-terra bg-terra px-4 py-2 text-xs font-bold text-bg hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Raising…" : "Raise flag"}
      </button>
    </div>
  );
}
