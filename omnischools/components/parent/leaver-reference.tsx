import type { ParentLeaverReference } from "@/lib/parent/parent-reference-data";

/**
 * 🔴 INCR-46 · the read-only parent view of the FM-authored school-leaver character reference (SHS module
 * 4.5 × parent portal 4.3). Renders ONLY the pre-formatted frozen key-set from `parent-reference-data.ts`
 * — the reader is the column guard, this card is presentation.
 *
 * The dignified gold-gradient idiom (mirrors the WASSCE tab's ReadinessCard), NOT the staff navy
 * confidential panel: on the parent side the reference is a gift, presented warm. Read-only by
 * construction — NO status pill, NO date/lock stamp, NO PDF/download, NO edit/lock affordance, NO draft
 * state, no server action. The body is the FM's finalised free text, verbatim.
 */

const READINESS_GRADIENT = "linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)";

export function LeaverReference({ reference }: { reference: ParentLeaverReference }) {
  const { studentFirstName, studentFullName, schoolName, body, authorName } = reference;
  // The heading mirrors the ChildCard: first name plain, surname in gold.
  const surname = studentFullName.startsWith(studentFirstName)
    ? studentFullName.slice(studentFirstName.length).trim()
    : studentFullName;

  return (
    <section
      className="rounded-xl border border-gold-soft px-6 py-[22px]"
      style={{ background: READINESS_GRADIENT }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
        School-leaver character reference
      </div>
      <div className="font-display text-[22px] font-medium leading-tight text-navy">
        {studentFirstName} <em className="not-italic text-gold">{surname}</em>
      </div>
      <div className="mt-1 text-[11px] text-navy-3">
        {/* No hard-coded role suffix: author_user_id may be the FM OR the Dean (schema), and the
            null-author fallback is itself a role phrase — a fixed ", Form Master" would mis-title a
            Dean author and double-print "the Form Master, Form Master" (Dex/Quinn INCR-46 LOW-2). */}
        Written by {authorName} · {schoolName}
      </div>
      <div className="mt-3.5 whitespace-pre-wrap border-t border-gold-soft pt-3.5 font-display text-[15px] leading-relaxed text-navy-2">
        {body}
      </div>
    </section>
  );
}
