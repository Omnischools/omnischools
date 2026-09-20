"use client";
/**
 * §O5 outbreak-monitor actions (SHS module 4.4 / INCR-27).
 *
 * 🔴 D9 / R221 — "Notify GHS-Amenfi" produces a PRINTABLE district artefact and NOTHING else: no
 * external API, no SMS, no integration. The whole monitor page is COUNTS-ONLY (no student named), so
 * printing it IS the aggregate district outbreak report. (A student-free `sickbay_notification` row is
 * not written: that table's `student_id` is NOT NULL, so an aggregate row has no home there — print is
 * the deliverable, F-27F.)
 *
 * "Configure thresholds" is DEFERRED (F-27C): the 4 / 8 / 50% thresholds are lib/ constants this
 * release, so the control is inert and says so honestly — never a fake editor.
 */
export function OutbreakActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-[5px] border border-terra bg-terra px-[14px] py-[8px] text-[12px] font-bold text-bg"
      >
        Notify GHS-Amenfi (district health)
      </button>
      <button
        type="button"
        disabled
        title="Thresholds are fixed at 4 / 8 / 50% this release."
        className="cursor-not-allowed rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy-3 opacity-70"
      >
        Configure thresholds
      </button>
    </div>
  );
}
