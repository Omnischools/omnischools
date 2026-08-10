import type { SenAccommodationRecord } from "@/lib/sen/register-data";
import {
  SEN_CATEGORY_LABEL,
  SEN_CATEGORY_PILL,
  SEN_SEVERITY_LABEL,
  SEN_SEVERITY_PILL,
} from "@/lib/sen/vocab";

/**
 * GOV-10b · the GRANTEE view (R436) — a teacher granted per-student access sees ONLY their granted students'
 * classroom accommodations: category / severity / support / accommodation tags. NO diagnosis, NO consent
 * records, NO census, NO other students (the reader `getSenAccommodationsForGrantee` enforces this; the type
 * `SenAccommodationRecord` has no diagnosis field at all).
 */
export function SenGranteeView({ records }: { records: SenAccommodationRecord[] }) {
  return (
    <div className="mx-auto max-w-page space-y-6">
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
          records, or any other students.
        </p>
      </div>

      {records.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-navy-3">
          No accommodation records to show. When an administrator grants you access to a student, their
          classroom accommodations appear here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {records.map((r, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-navy">{r.studentName}</div>
                <div className="text-[11px] text-navy-3">{r.className ?? "—"}</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${SEN_CATEGORY_PILL[r.category]}`}
                >
                  {SEN_CATEGORY_LABEL[r.category]}
                </span>
                {r.severity && (
                  <span
                    className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEN_SEVERITY_PILL[r.severity]}`}
                  >
                    {SEN_SEVERITY_LABEL[r.severity]}
                  </span>
                )}
              </div>
              {r.supportNotes && (
                <p className="mt-2 text-[12px] leading-relaxed text-navy-2">{r.supportNotes}</p>
              )}
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
          ))}
        </div>
      )}
    </div>
  );
}
