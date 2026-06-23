"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { decideCorrection } from "@/lib/actions/attendance";
import { reasonLabel } from "@/lib/attendance-reasons";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/lib/attendance-status";

export type CorrectionRow = {
  id: string;
  status: string; // PENDING | APPROVED | REJECTED
  requestedStatus: string;
  recordStatus: string;
  reason: string;
  reasonAttribution: string;
  requesterName: string;
  requesterInitials: string;
  requesterEditCount: number;
  className: string;
  registerDate: string;
  submittedLabel: string;
  requestedLabel: string;
  markedByName: string | null;
  recordReasonCode: string | null;
  recordNote: string | null;
  studentName: string;
  studentInitials: string;
  studentCode: string;
  guardianName: string | null;
  guardianPhone: string | null;
  termPct: number | null;
  last14: { date: string; status: string }[];
  absenceSmsWasSent: boolean;
};

const meta = (s: string) => ATTENDANCE_STATUS_META[s as AttendanceStatus];
const TINT: Record<string, string> = {
  PRESENT: "bg-green-bg",
  LATE: "bg-gold-bg",
  EXCUSED: "bg-warn-bg",
  MEDICAL: "bg-bg",
  ABSENT: "bg-terra-bg",
};
const SPARK: Record<string, string> = {
  PRESENT: "bg-green",
  LATE: "bg-gold",
  EXCUSED: "bg-warn",
  MEDICAL: "bg-navy-2",
  ABSENT: "bg-terra",
};
const pctTone = (p: number | null) =>
  p === null ? "text-navy-3" : p >= 90 ? "text-green" : p >= 70 ? "text-gold" : "text-terra";

function MiniPill({ status }: { status: string }) {
  const m = meta(status);
  return (
    <span className={cn("rounded-pill px-2 py-0.5 text-xs font-semibold", m?.seg ?? "bg-bg text-navy-3")}>
      {m?.label ?? status}
    </span>
  );
}

export function EditRequestReview({ rows }: { rows: CorrectionRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const pending = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status !== "PENDING");
  const open = rows.find((r) => r.id === openId) ?? null;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
        <p className="font-display text-lg text-navy">No correction requests.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <ListGroup
          title={`${pending.length} awaiting your co-sign`}
          rows={pending}
          onReview={setOpenId}
          pending
        />
        {decided.length > 0 && (
          <ListGroup title="Decided" rows={decided} onReview={setOpenId} />
        )}
      </div>
      {open && <Drawer row={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ListGroup({
  title,
  rows,
  onReview,
  pending,
}: {
  title: string;
  rows: CorrectionRow[];
  onReview: (id: string) => void;
  pending?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-navy-3">{title}</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0">
              <div className="font-medium text-navy">
                {r.studentName} <span className="text-xs text-navy-3">· {r.registerDate}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <MiniPill status={r.recordStatus} />
                <span className="text-navy-3">→</span>
                <MiniPill status={r.requestedStatus} />
              </div>
              <div className="mt-1 text-[11px] text-navy-3">
                Request from <span className="font-medium text-navy-2">{r.requesterName}</span> ·{" "}
                {r.className}
              </div>
            </div>
            {pending ? (
              <button
                onClick={() => onReview(r.id)}
                className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-bg hover:bg-navy-deep"
              >
                Review →
              </button>
            ) : (
              <span
                className={cn(
                  "rounded-pill px-2 py-0.5 text-xs font-medium",
                  r.status === "APPROVED" ? "bg-green-bg text-green" : "bg-terra-bg text-terra",
                )}
              >
                {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Drawer({ row, onClose }: { row: CorrectionRow; onClose: () => void }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const before = meta(row.recordStatus);
  const after = meta(row.requestedStatus);
  const becomesExcused = row.requestedStatus === "EXCUSED" || row.requestedStatus === "MEDICAL";

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideCorrection({ correctionId: row.id, approve });
      if (res.ok) {
        router.refresh();
        onClose();
      } else setError(res.error ?? "Could not save the decision.");
    });
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ backgroundColor: "rgba(26,43,71,0.45)", backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col bg-surface shadow-2xl"
      >
        {/* Head */}
        <div className="border-b border-border p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
              Edit request · review
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-navy-3"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full bg-navy font-display text-lg font-semibold text-gold">
              {row.requesterInitials}
            </span>
            <div>
              <div className="text-xs text-navy-3">Request from</div>
              <div className="font-display text-lg font-semibold text-navy">{row.requesterName}</div>
              <div className="text-[11px] text-navy-3">
                {row.className} ·{" "}
                <b className="font-semibold text-navy-2">
                  {row.requesterEditCount} edit request{row.requesterEditCount === 1 ? "" : "s"}
                </b>{" "}
                this term
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-bg p-3">
            {[
              { lbl: "Register", val: `${row.className} · ${row.registerDate}` },
              { lbl: "Submitted", val: row.submittedLabel },
              { lbl: "Requested", val: row.requestedLabel },
            ].map((c) => (
              <div key={c.lbl}>
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
                  {c.lbl}
                </div>
                <div className="mt-0.5 font-display text-xs font-semibold text-navy">{c.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* §1 The change */}
          <Section num="1" title="The change" />
          <div className="grid grid-cols-[1fr_24px_1fr] items-stretch gap-1">
            <DiffCard
              label="Currently marked"
              m={before}
              detail={`Marked at ${row.submittedLabel}${row.markedByName ? ` by ${row.markedByName}` : ""} · ${
                reasonLabel(row.recordReasonCode) ?? row.recordNote ?? "no reason logged"
              }`}
              tint="bg-bg"
            />
            <div className="flex items-center justify-center font-display text-xl text-gold">→</div>
            <DiffCard
              label="Proposed change"
              m={after}
              detail={`Requested ${row.requestedLabel}`}
              tint={TINT[row.requestedStatus] ?? "bg-bg"}
            />
          </div>

          {/* student context */}
          <div className="mt-3 grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-bg font-display text-xs font-semibold text-navy">
              {row.studentInitials}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-navy">{row.studentName}</div>
              <div className="text-[10px] text-navy-3">
                {row.studentCode} · {row.className}
                {row.guardianName ? (
                  <>
                    {" · guardian "}
                    <b className="font-semibold text-navy-2">{row.guardianName}</b>
                  </>
                ) : null}
              </div>
            </div>
            {row.termPct !== null && (
              <span className={cn("rounded-pill px-2 py-0.5 font-mono text-[11px] font-bold", pctTone(row.termPct), "bg-bg")}>
                {row.termPct}%
              </span>
            )}
          </div>

          {/* §2 Teacher's reason */}
          <Section num="2" title="Teacher's reason" />
          <div className="rounded-r-lg border-l-[3px] border-gold bg-bg p-3">
            <p className="text-[13px] italic leading-relaxed text-navy-2">&ldquo;{row.reason}&rdquo;</p>
            <p className="mt-2 text-[10px] not-italic text-navy-3">{row.reasonAttribution}</p>
          </div>

          {/* §3 Context */}
          <Section num="3" title="Context" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-navy-3">
                  {row.studentName.split(" ")[0]}&apos;s term
                </span>
                <span className={cn("font-display text-base font-semibold", pctTone(row.termPct))}>
                  {row.termPct === null ? "—" : `${row.termPct}%`}
                </span>
              </div>
              <div className="mt-2 flex items-end gap-0.5">
                {row.last14.length ? (
                  row.last14.map((d, i) => (
                    <span
                      key={i}
                      title={`${d.date} · ${d.status.charAt(0) + d.status.slice(1).toLowerCase()}`}
                      className={cn("h-5 w-1.5 rounded-sm", SPARK[d.status] ?? "bg-border-2")}
                    />
                  ))
                ) : (
                  <span className="text-[10px] text-navy-3">no recent records</span>
                )}
              </div>
              <div className="mt-1.5 text-[10px] italic text-navy-3">Last {row.last14.length} school days</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-navy-3">
                  {row.requesterName.split(" ")[0]}&apos;s edits
                </span>
                <span className="font-display text-base font-semibold text-navy">
                  {row.requesterEditCount} / term
                </span>
              </div>
              <div className="mt-2 text-[11px] text-navy-3">
                {row.requesterEditCount === 1
                  ? "First request this term · low edit volume."
                  : "Edit requests logged this term."}
              </div>
            </div>
          </div>

          {/* §4 If you approve */}
          <Section num="4" title="If you approve" />
          <div className="rounded-lg border border-gold-soft bg-gold-bg p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold font-display text-[11px] font-bold text-navy">
                {row.absenceSmsWasSent ? "!" : "i"}
              </span>
              <span className="font-display text-[13px] font-semibold text-navy">
                {row.absenceSmsWasSent ? "An SMS already went out" : "No SMS impact"}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-navy-2">
              {row.absenceSmsWasSent ? (
                <>
                  An auto-absence SMS was sent to the guardian when {row.studentName.split(" ")[0]}{" "}
                  was marked Absent. Approving reclassifies it as{" "}
                  <b className="font-semibold text-navy">{after?.label}</b>
                  {becomesExcused ? " — excused days still count toward term attendance." : "."}{" "}
                  A correction SMS is not sent automatically yet.
                </>
              ) : (
                <>
                  No absence SMS was tied to this mark, so changing it to{" "}
                  <b className="font-semibold text-navy">{after?.label}</b> is a register
                  correction with no message consequence.
                </>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="text-[11px] text-navy-3">
            <b className="block font-display text-xs font-semibold text-navy">
              {row.absenceSmsWasSent ? "Guardian was notified" : "Register edit"}
            </b>
            {row.absenceSmsWasSent && row.guardianPhone
              ? `${row.guardianName ?? "Guardian"} · ${row.guardianPhone}`
              : `${row.className} · ${row.registerDate}`}
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-[11px] text-terra">{error}</span>}
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="rounded-md border border-terra/40 px-3 py-2 text-sm font-semibold text-terra hover:bg-terra-bg disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="rounded-md bg-green px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Approve change ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ num, title }: { num: string; title: string }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 first:mt-0">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gold font-display text-[10px] font-bold text-navy">
        {num}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{title}</span>
    </div>
  );
}

function DiffCard({
  label,
  m,
  detail,
  tint,
}: {
  label: string;
  m: { letter: string; label: string; seg: string } | undefined;
  detail: string;
  tint: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border p-3", tint)}>
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg font-display text-base font-bold", m?.seg ?? "bg-bg")}>
          {m?.letter ?? "?"}
        </span>
        <span className="font-display text-sm font-semibold text-navy">{m?.label ?? "—"}</span>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-navy-2">{detail}</p>
    </div>
  );
}
