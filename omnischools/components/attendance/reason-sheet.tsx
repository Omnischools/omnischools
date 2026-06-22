"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ATTENDANCE_REASONS } from "@/lib/attendance-reasons";
import {
  ATTENDANCE_STATUS_META,
  ATTENDANCE_STATUS_ORDER,
  type AttendanceStatus,
} from "@/lib/attendance-status";

export type SheetStudent = {
  id: string;
  name: string;
  initials: string;
  className: string;
  termPct: number | null;
};

/** Selected-tile tint per status (surface `.sheet-status-tile.selected.*`). */
const TILE_SELECTED: Record<AttendanceStatus, string> = {
  PRESENT: "border-green bg-green-bg text-green",
  LATE: "border-gold bg-gold-bg text-gold",
  EXCUSED: "border-warn bg-warn-bg text-warn",
  MEDICAL: "border-navy-2 bg-bg text-navy-2",
  ABSENT: "border-terra bg-terra-bg text-terra",
};

function smsNotice(status: AttendanceStatus, hasReason: boolean) {
  if (status === "ABSENT")
    return (
      <>
        <b className="font-semibold text-navy">An absence SMS will be sent</b> to the guardian
        when you submit the register.
      </>
    );
  if (status === "EXCUSED" || status === "MEDICAL")
    return (
      <>
        <b className="font-semibold text-navy">No SMS will go out</b> for this student today —
        excused absences {hasReason ? "with a noted reason " : ""}are not flagged to the parent.
      </>
    );
  return (
    <>
      <b className="font-semibold text-navy">No SMS will go out</b> for a late arrival.
    </>
  );
}

export function ReasonSheet({
  student,
  initialStatus,
  initialReason,
  initialNote,
  onSave,
  onClose,
}: {
  student: SheetStudent;
  initialStatus: AttendanceStatus;
  initialReason: string;
  initialNote: string;
  onSave: (status: AttendanceStatus, reasonCode: string | null, note: string | null) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus>(initialStatus);
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPresent = status === "PRESENT";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: "rgba(26,43,71,0.45)", backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-surface px-[18px] pb-6 pt-2 sm:max-h-[88vh] sm:max-w-md sm:rounded-2xl sm:p-5"
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-border-2 sm:hidden" />

        {/* Head */}
        <div className="mb-3.5 flex items-center gap-3 border-b border-border pb-3.5">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-sm font-semibold text-navy">
            {student.initials}
          </span>
          <div className="flex-1">
            <div className="font-display text-base font-semibold text-navy">{student.name}</div>
            <div className="mt-px text-[11px] text-navy-3">
              {student.className}
              {student.termPct !== null ? ` · ${student.termPct}% term attendance` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-border bg-bg text-sm font-semibold text-navy-3"
          >
            ×
          </button>
        </div>

        {/* Status tiles */}
        <div className="mb-4 grid grid-cols-5 gap-2">
          {ATTENDANCE_STATUS_ORDER.map((s) => {
            const m = ATTENDANCE_STATUS_META[s];
            const sel = status === s;
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-xl border-[1.5px] px-1.5 py-2.5 text-center transition-colors",
                  sel ? TILE_SELECTED[s] : "border-border-2 bg-surface text-navy",
                )}
              >
                <div className="font-display text-base font-bold leading-none">{m.letter}</div>
                <div className="mt-1 text-[10px] font-bold text-navy-2">{m.label}</div>
              </button>
            );
          })}
        </div>

        {!isPresent && (
          <>
            {/* Reason radio list */}
            <div className="mb-3.5">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                Reason
              </div>
              <div className="flex flex-col gap-1.5">
                {ATTENDANCE_REASONS.map((r) => {
                  const sel = reason === r.code;
                  return (
                    <button
                      key={r.code}
                      onClick={() => setReason(r.code)}
                      className={cn(
                        "grid grid-cols-[18px_1fr] items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left",
                        sel ? "border-warn bg-warn-bg" : "border-border bg-bg",
                      )}
                    >
                      <span
                        className={cn(
                          "relative h-[18px] w-[18px] rounded-full border-[1.5px]",
                          sel ? "border-warn bg-warn" : "border-border-2 bg-surface",
                        )}
                      >
                        {sel && (
                          <span className="absolute inset-1 rounded-full bg-white" />
                        )}
                      </span>
                      <span>
                        <span className="block text-xs font-semibold text-navy">{r.label}</span>
                        <span className="mt-px block text-[10px] text-navy-3">{r.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div className="mb-3.5">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                Note (optional)
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="e.g. mother called this morning, will return tomorrow"
                className="min-h-[60px] w-full resize-none rounded-lg border border-border-2 bg-surface px-3 py-2.5 text-xs text-navy outline-none placeholder:italic placeholder:text-navy-3 focus:border-gold"
              />
            </div>

            {/* SMS notice */}
            <div className="mb-3 grid grid-cols-[22px_1fr] items-start gap-2.5 rounded-[10px] border border-gold-soft bg-gold-bg px-3.5 py-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold font-display text-[11px] font-bold text-navy">
                i
              </span>
              <span className="text-[11px] leading-relaxed text-navy-2">
                {smsNotice(status, reason !== "")}
              </span>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
          <button
            onClick={onClose}
            className="rounded-pill border border-border bg-bg py-3 text-sm font-semibold text-navy"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave(
                status,
                isPresent ? null : reason || null,
                isPresent ? null : note || null,
              )
            }
            className="rounded-pill bg-navy py-3 text-sm font-bold text-bg hover:bg-navy-deep"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
