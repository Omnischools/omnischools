import type { SenAccommodationRecord } from "@/lib/sen/register-data";
import {
  SEN_CATEGORY_ORDER,
  SEN_CATEGORY_LABEL,
  SEN_CATEGORY_PILL,
  SEN_SEVERITY_LABEL,
  SEN_SEVERITY_PILL,
  initials,
} from "@/lib/sen/vocab";

/**
 * GOV-10b/10c (R436/R451) · the GRANTEE view — a teacher granted per-student access sees ONLY their granted
 * students' classroom accommodations: category (one or MORE — R445 multi-category), severity, support notes,
 * accommodation tags. NO diagnosis, NO consent records, NO census, NO other students (`getSenAccommodationsForGrantee`
 * enforces the scope; `SenAccommodationRecord` has no diagnosis field at all). Design: Lucy's grantee surface-map,
 * reconciled to Kofi's per-student-detail ruling — one card per student, multiple category pills, a SINGLE
 * per-student severity/notes/accommodations (categories are tags; the detail is not per-category).
 */
const pillBase =
  "inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

export function SenGranteeView({ records }: { records: SenAccommodationRecord[] }) {
  return (
    <div className="mx-auto max-w-page space-y-6">
      {/* Eyebrow + title + lede */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Students / <span className="text-gold">Accommodations</span>
        </div>
        <h1 className="mt-2 font-display text-3xl font-medium text-navy">
          Support <em className="italic text-gold">accommodations</em>
        </h1>
        <p className="mt-1 max-w-[740px] text-sm text-navy-3">
          Classroom accommodations for the students an administrator has granted you access to ·{" "}
          <b className="text-navy-2">for accommodation planning only</b>. You do not see diagnoses, consent
          records, the census, or any other students.
        </p>
      </div>

      {/* Privacy reassurance strip — the teacher-side mirror of the admin banner (renders in every state) */}
      <div className="grid grid-cols-[28px_1fr] items-start gap-3.5 rounded-xl border border-gold-soft bg-gold-bg px-4 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold font-display text-[13px] font-bold text-navy">
          !
        </div>
        <div className="text-xs leading-relaxed text-navy-2">
          <b className="text-navy">Confidential — treat with care.</b> An administrator granted you access to
          these students&apos; classroom accommodations so you can plan lessons around them. This is{" "}
          <b className="text-navy">sensitive personal data</b> — keep it to your teaching of these students, and
          do not share or copy it. You are shown support needs only, never diagnoses or medical records.
        </div>
      </div>

      {records.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-navy-3">
          No accommodation records to show. When an administrator grants you access to a student, their
          classroom accommodations appear here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {records.map((r, i) => {
            const cats = SEN_CATEGORY_ORDER.filter(
              (c) => c === r.category || r.secondaryCategories.includes(c),
            );
            return (
              <div key={i} className="rounded-xl border border-border bg-surface p-4">
                {/* Identity header */}
                <div className="grid grid-cols-[32px_1fr] items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
                    {initials(r.studentName)}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-navy">{r.studentName}</h2>
                    <div className="text-[11px] italic text-navy-3">
                      {r.className ?? r.level ?? "Unassigned"}
                    </div>
                  </div>
                </div>

                {/* Category pill(s) + severity */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {cats.map((c) => (
                    <span key={c} className={`${pillBase} ${SEN_CATEGORY_PILL[c]}`}>
                      {SEN_CATEGORY_LABEL[c]}
                    </span>
                  ))}
                  {r.severity && (
                    <span
                      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEN_SEVERITY_PILL[r.severity]}`}
                    >
                      {SEN_SEVERITY_LABEL[r.severity]}
                    </span>
                  )}
                </div>

                {/* Support notes (per student) */}
                {r.supportNotes && (
                  <p className="mt-2 text-[12px] leading-relaxed text-navy-2">{r.supportNotes}</p>
                )}

                {/* Accommodation tags (per student) */}
                {r.accommodations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.accommodations.map((a, j) => (
                      <span
                        key={j}
                        className="rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] font-semibold text-navy-3"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
