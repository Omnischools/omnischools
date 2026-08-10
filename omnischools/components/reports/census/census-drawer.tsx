import Link from "next/link";
import type { CensusView, CensusRowView, RowTag } from "@/lib/reports/census/view";
import { handFillRows } from "@/lib/reports/census/view";
import type { CensusIdentification } from "@/lib/reports/census/schema";
import { CensusGenerateButton } from "@/components/reports/census/census-generate-button";

/**
 * GOV-8 · the GES census GENERATION drawer (Lucy's map). Every Auto/Partial/Manual tag and the "% auto-filled"
 * are COMPUTED from the `view` (live section coverage) — never the surface's static demo numbers (GOV8-17).
 * Annual-only sections render greyed with an `Annual` tag in a mid-year run. Both cadences get a print-and-sign
 * PDF (annual adds a hand-fill) in the sibling CensusCompletionPanel (GOV-9 / GOV-9b); no electronic upload.
 *
 * Token discipline: the warn rows + partial tags use the SOLID `border-gold-soft` tint (not `border-warn/30`)
 * to dodge the raw-hex slash-opacity trap ([[no-alpha-token-opacity]]); the hatch is an arbitrary-value
 * gradient (raw hex is fine in an arbitrary value — it's the slash-opacity form that breaks).
 */

const TAG_CLASS: Record<RowTag, string> = {
  Auto: "bg-green-bg text-green",
  Partial: "bg-warn-bg text-warn border border-gold-soft",
  Manual: "bg-bg text-navy-3 border border-border",
  Annual: "bg-bg text-navy-3 border border-border",
  "N/A": "bg-bg text-navy-3 border border-border",
};

function CheckMark({ row }: { row: CensusRowView }) {
  if (row.tag === "Auto")
    return (
      <div className="flex size-[22px] items-center justify-center rounded-full bg-green font-display text-[11px] font-bold text-white">
        ✓
      </div>
    );
  if (row.tag === "Partial" || row.tag === "Manual")
    return (
      <div className="flex size-[22px] items-center justify-center rounded-full bg-warn font-display text-[11px] font-bold text-white">
        !
      </div>
    );
  return (
    <div className="flex size-[22px] items-center justify-center rounded-full border border-border bg-bg text-[11px] font-bold text-navy-3">
      –
    </div>
  );
}

function ChecklistRow({ row }: { row: CensusRowView }) {
  const rowTint = row.cadenceGated
    ? "opacity-50 border-border bg-surface"
    : row.tag === "Partial" || row.tag === "Manual"
      ? "border-gold-soft bg-warn-bg"
      : "border-border bg-surface";
  return (
    <div className={`grid grid-cols-[22px_1fr_auto] items-start gap-3 rounded-lg border px-3 py-2.5 ${rowTint}`}>
      <CheckMark row={row} />
      <div>
        <div className="text-xs font-bold text-navy">{row.name}</div>
        <div className="mt-0.5 text-[10px] leading-snug text-navy-3">{row.meta}</div>
        {row.captureHref && (
          <Link href={row.captureHref} className="mt-0.5 inline-block text-[10px] font-semibold text-gold underline">
            Fill by hand →
          </Link>
        )}
      </div>
      <div className={`rounded-full px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.06em] ${TAG_CLASS[row.tag]}`}>
        {row.tag}
      </div>
    </div>
  );
}

type IdField = { label: string; value: string; mono?: boolean };

export function CensusDrawer({
  cadence,
  academicYear,
  periodLabel,
  identification,
  filename,
  view,
  periodId,
}: {
  cadence: "MID_YEAR" | "ANNUAL";
  academicYear: string;
  periodLabel: string | null;
  identification: CensusIdentification;
  filename: string;
  view: CensusView;
  periodId: string | null;
}) {
  const isMid = cadence === "MID_YEAR";
  const idFields: IdField[] = [
    { label: "School name", value: identification.schoolName || "—" },
    { label: "GES School ID", value: identification.gesCode || "—", mono: true },
    { label: "District", value: identification.district || "—" },
    { label: "Circuit", value: identification.circuit || "—" },
    { label: "Region", value: identification.region || "—" },
    { label: "Year established", value: identification.yearFounded || "—", mono: true },
    { label: "Ownership", value: identification.ownership || "—" },
  ];
  const handRows = handFillRows(view);

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
      {/* Head */}
      <div className="border-b border-border px-7 pb-5 pt-6">
        <div className="flex items-start justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
            {isMid ? "Mid-year census" : "Annual census"} · {academicYear}
          </div>
          {/* Cadence toggle — GOV-8 is the mid-year path; annual shows its extra sections greyed. */}
          <div className="flex items-center gap-1 text-[10px] font-semibold">
            <Link
              href="?cadence=MID_YEAR"
              className={`rounded px-2 py-1 ${isMid ? "bg-navy text-bg" : "text-navy-3"}`}
            >
              Mid-year
            </Link>
            <Link
              href="?cadence=ANNUAL"
              className={`rounded px-2 py-1 ${!isMid ? "bg-navy text-bg" : "text-navy-3"}`}
            >
              Annual
            </Link>
          </div>
        </div>
        <h1 className="mt-2 font-display text-2xl font-medium text-navy">
          Generate <em className="font-normal italic text-gold">{isMid ? "mid-year census" : "annual census"}</em>
        </h1>
        <p className="mt-1 text-xs text-navy-3">
          {isMid ? (
            <>
              The termly signal · enrolment, staff, attendance, and admissions for this period ·{" "}
              <b className="font-semibold text-navy-2">almost entirely auto-filled</b> from Omnischools.
              Infrastructure, results, and programmes are annual-only — they appear greyed.
            </>
          ) : (
            <>
              The full return · combines enrolment, staff, attendance, performance, and infrastructure. Most data
              auto-fills; some sections still need your hand. Generate, then complete &amp; download the
              print-and-sign PDF below.
            </>
          )}
        </p>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 px-7 py-6">
        {/* Step 1 — year */}
        <section>
          <StepTag n={1} label="Academic year" />
          <div className="flex items-center justify-between rounded-[10px] border border-border bg-bg px-4 py-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">Filing for</div>
              <div className="font-display text-lg font-semibold text-navy">
                Academic year <em className="italic text-gold">{academicYear}</em>
              </div>
            </div>
            {periodLabel && <div className="text-[10px] text-navy-3">{periodLabel} in progress</div>}
          </div>
        </section>

        {/* Step 2 — identification */}
        <section>
          <StepTag n={2} label="School identification" />
          <div className="grid grid-cols-2 gap-2.5 rounded-[10px] border border-border bg-bg px-4 py-3.5">
            {idFields.map((f) => (
              <div key={f.label}>
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{f.label}</div>
                <div className={`text-xs font-semibold text-navy ${f.mono ? "font-mono" : ""}`}>{f.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Step 3 — auto-fill band + checklist */}
        <section>
          <StepTag n={3} label="What's included & auto-fill status" />
          <div className="rounded-[10px] border border-gold-soft bg-gold-bg px-4 py-3.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold">Census auto-fill progress</div>
            <div className="mt-1 flex items-baseline gap-3">
              <div className="font-display text-[26px] font-semibold leading-none text-green">
                <em className="italic">{view.fillPct}%</em>
              </div>
              <div className="text-[11px] text-navy-3">
                {view.needHand === 0 ? (
                  <>every {isMid ? "mid-year " : ""}section auto-filled · nothing needs your hand</>
                ) : (
                  <>
                    of sections auto-filled · <b className="font-semibold text-navy-2">{view.needHand} section{view.needHand === 1 ? "" : "s"}</b>{" "}
                    still need your hand · about <b className="font-semibold text-navy-2">{view.minutes} min</b> of manual entry
                  </>
                )}
              </div>
            </div>
            <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-warn-bg">
              <div className="h-full bg-green" style={{ width: `${view.fillPct}%` }} />
              <div
                className="h-full bg-[repeating-linear-gradient(45deg,#F5E9D0,#F5E9D0_4px,#C58A2E_4px,#C58A2E_5px)]"
                style={{ width: `${100 - view.fillPct}%` }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {view.groups.map((g) => (
              <div key={g.group}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Section {g.group}</span>
                  <b className="font-display text-[10px] font-medium italic text-gold">{g.title}</b>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex flex-col gap-2">
                  {g.rows.map((r) => (
                    <ChecklistRow key={r.id} row={r} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Hand-fill — normally empty in mid-year (Lucy §6) */}
        <section>
          <StepTag n={4} label="Sections to fill by hand" />
          {handRows.length === 0 ? (
            <div className="rounded-[10px] border border-green-bg bg-green-bg px-4 py-3 text-xs font-semibold text-green">
              Nothing to hand-fill — every in-scope section auto-filled from Omnischools.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {handRows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-dashed border-paper-line bg-[repeating-linear-gradient(45deg,#FAF7F2,#FAF7F2_6px,#F0ECE2_6px,#F0ECE2_12px)] px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex size-5 items-center justify-center rounded-full bg-warn text-[10px] font-bold text-white">!</div>
                    <div className="text-xs font-bold text-navy">{r.name}</div>
                  </div>
                  <div className="mt-1 pl-7 text-[10px] italic text-navy-3">{r.meta}</div>
                  {r.captureHref && (
                    <div className="mt-1 pl-7">
                      <Link href={r.captureHref} className="text-[10px] font-semibold text-gold underline">
                        Capture it now →
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Output */}
        <section>
          <StepTag n={5} label="Output" />
          <div className="grid grid-cols-[36px_1fr] items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-terra font-display text-[11px] font-bold text-white">
              PDF
            </div>
            <div>
              <div className="text-xs font-semibold text-navy">A4 portrait · GES {isMid ? "mid-year" : "annual"} return</div>
              <div className="text-[10px] text-navy-3">
                Filename: <span className="font-mono font-semibold text-navy-2">{filename}</span>
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[11px] italic leading-snug text-navy-3">
            Generating freezes this return as a draft. Complete any hand-fill sections below, download the
            print-and-sign PDF, then sign, apply your school stamp, and submit two copies to the District
            Education Office.
          </p>
        </section>
      </div>

      {/* Foot */}
      <div className="flex items-center justify-between border-t border-border bg-surface px-7 py-4">
        <div>
          <div className="font-display text-[13px] font-semibold text-navy">
            {view.fullCount} of {view.inScopeCount} sections <em className="italic text-gold">auto-filled</em>
          </div>
          <div className="text-[10px] text-navy-3">
            {identification.schoolName} · {academicYear} {isMid ? "mid-year" : "annual"} census
          </div>
        </div>
        <CensusGenerateButton cadence={cadence} periodId={periodId} />
      </div>
    </div>
  );
}

function StepTag({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="flex size-[18px] items-center justify-center rounded-full bg-gold font-display text-[10px] font-bold text-navy">
        {n}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold">{label}</span>
    </div>
  );
}
