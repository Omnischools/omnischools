import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { getChronicPlan } from "@/lib/sickbay/chronic-reads";
import type { ChronicPlanEntryView, ChronicPlanView, RoundColumn } from "@/lib/sickbay/chronic-copy";
import {
  CONDITION_PILL,
  DORM_CARD_FOOT,
  DORM_CARD_LABEL,
  DORM_CARD_SUB,
  H1_PASTORAL_EM,
  H1_PASTORAL_LEAD,
  H1_PLAN_EM,
  H1_PLAN_LEAD,
  NO_MEDICATION,
  PASTORAL_BODY,
  PASTORAL_EYEBROW,
  PASTORAL_TITLE_EM,
  PASTORAL_TITLE_LEAD,
  PRN_COLUMN,
  ROUND_TIMING_LEAD,
  ROUND_TIMING_TAIL,
  STATUS_PILL,
  conditionLabel,
  planVersionMeta,
  statusPill,
} from "@/lib/sickbay/chronic-copy";
import { splitBold } from "@/lib/sickbay/defaults";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/chronic-register/[studentId]` — §02 (care plan) / §03 (pastoral). ONE route, two
 * layouts by `condition` (a `/pastoral/` segment would be a disclosure — M10). Opening it writes the
 * read-audit row (R121, inside the reader).
 *
 * 🔴 R118 — `notFound()` is returned INDISTINGUISHABLY for "no such student" and "no entry you may
 * see": the reader returns `null` for both, and membership of the register is itself medical
 * information (no forbidden panel, no different copy, no distinguishable timing).
 */
export default async function ChronicPlanPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const { id: userId } = await resolveActor(school.id);

  const now = new Date();
  const plan = await getChronicPlan(school.id, studentId, { userId, roles }, now);
  if (plan === null) {
    // A non-staff reader gets the restricted panel; everyone else gets a byte-identical notFound()
    // whether the student does not exist or carries no entry this reader may see (R118).
    if (roles.length === 0) return <ClinicalRestricted label="Chronic register" />;
    notFound();
  }

  const allPastoral = plan.entries.every((e) => e.hmRestricted);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ crumb ═══ */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <Link href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </Link>{" "}
        ·{" "}
        <Link href="/senior/sickbay/chronic-register" className="text-gold no-underline">
          Chronic register
        </Link>{" "}
        · {plan.studentName}
      </div>
      <h1 className="mb-6 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        {allPastoral ? H1_PASTORAL_LEAD : H1_PLAN_LEAD}
        <em className="font-normal italic text-gold">
          {allPastoral ? H1_PASTORAL_EM : H1_PLAN_EM}
        </em>
      </h1>

      {/* ═══ patient header (navy gradient) ═══ */}
      <div className="mb-6 grid grid-cols-[auto_1fr_auto] items-center gap-[18px] rounded-xl bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] p-[20px_24px]">
        <div className="grid size-[64px] place-items-center rounded-full bg-gold font-display text-[22px] font-semibold text-navy">
          {plan.initials}
        </div>
        <div>
          <div className="font-display text-[24px] font-medium leading-[1.1] tracking-[-0.018em] text-bg">
            {plan.firstName} <em className="font-normal italic text-gold">{plan.lastName}</em>
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-gold-soft">
            <span>
              <b className="font-semibold text-bg">{plan.formLabel}</b>
              {plan.ageYears !== null ? ` · age ${plan.ageYears}` : ""}
            </span>
            {plan.houseName && (
              <span>
                <b className="font-semibold text-bg">{plan.houseName}</b> House
              </span>
            )}
            {plan.guardian && (
              <span>
                {plan.guardian.relationship}{" "}
                <b className="font-semibold text-bg">{plan.guardian.name}</b> · primary contact
              </span>
            )}
          </div>
        </div>
        <div className="font-mono text-[10px] font-medium text-gold-soft">{plan.studentCode}</div>
      </div>

      {plan.entries.map((entry) =>
        entry.hmRestricted ? (
          <PastoralEntry key={entry.entryId} entry={entry} plan={plan} />
        ) : (
          <CarePlanEntry key={entry.entryId} entry={entry} plan={plan} />
        ),
      )}
    </div>
  );
}

// ============================================================================
// §02 — a physical care plan
// ============================================================================

function CarePlanEntry({ entry, plan }: { entry: ChronicPlanEntryView; plan: ChronicPlanView }) {
  const s = statusPill(entry.status);
  return (
    <section className="mb-8">
      {/* chronic-flag + version meta */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded-full px-[10px] py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${CONDITION_PILL[entry.condition]}`}
        >
          {conditionLabel(entry.condition, entry.conditionLabel)}
        </span>
        <span
          className={`inline-block rounded-full px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.04em] ${STATUS_PILL[s.tone]}`}
        >
          {s.label}
        </span>
        <span className="text-[11px] text-navy-3">
          {planVersionMeta(entry.version, entry.reviewedAt, entry.reviewedByName)}
        </span>
      </div>

      {/* plan details */}
      <div className="mb-4 rounded-[14px] border border-border bg-surface p-[20px_24px]">
        <PlanRow label="Condition" value={entry.conditionDetail} />
        <PlanRow label="Crisis triggers" value={entry.triggers} />
        <PlanRow label="Baseline status" value={entry.baselineStatus} />
        <PlanRow label="Care goals · term" value={entry.careGoals} />
        <PlanRow label="Discharge criteria" value={entry.dischargeCriteria} last />
      </div>

      {/* medication grid */}
      <MedGrid entry={entry} plan={plan} />

      {/* emergency protocol — the whole terracotta block absent when there is no protocol */}
      {entry.emergencyProtocol?.trim() && (
        <div className="mb-4 rounded-xl border-[1.5px] border-terra bg-[linear-gradient(180deg,var(--terra-bg)_0%,var(--surface)_100%)] p-[20px_24px]">
          <div className="mb-3 font-display text-[16px] font-semibold text-terra">
            Escalation <em className="font-normal italic">protocol</em>
          </div>
          {paragraphs(entry.emergencyProtocol).map((p, i) => (
            <p key={i} className="mb-2 text-[13px] leading-[1.55] text-navy-2 last:mb-0">
              {p}
            </p>
          ))}
        </div>
      )}

      {/* dorm-side card — NEVER for a mental-health plan (this branch is a physical entry, C13) */}
      <DormCard entry={entry} plan={plan} />
    </section>
  );
}

function MedGrid({ entry, plan }: { entry: ChronicPlanEntryView; plan: ChronicPlanView }) {
  if (entry.meds.length === 0) {
    return (
      <div className="mb-4 rounded-[14px] border border-border bg-surface p-[20px_24px]">
        <div className="mb-2 font-display text-[16px] font-semibold text-navy">
          Daily <em className="font-normal italic text-gold">medication schedule</em>
        </div>
        <p className="text-[12px] italic text-navy-3">{NO_MEDICATION}</p>
      </div>
    );
  }
  const cols: RoundColumn[] = plan.roundColumns;
  const drugs = [...new Set(entry.meds.map((m) => m.drugName))];
  return (
    <div className="mb-4 overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="border-b border-border p-[16px_24px] font-display text-[16px] font-semibold text-navy">
        Daily <em className="font-normal italic text-gold">medication schedule</em>
      </div>
      <div
        className="grid text-[12px]"
        style={{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr) 1fr` }}
      >
        {/* header */}
        <div className="border-b border-r border-border bg-bg p-[12px_14px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
          Medication
        </div>
        {cols.map((c) => (
          <div
            key={c.slotId}
            className="border-b border-r border-border bg-bg p-[12px_14px] text-center font-mono text-[11px] text-navy-2"
          >
            {c.time}
            <span className="mt-[2px] block font-sans text-[9px] uppercase tracking-[0.12em] text-navy-3">
              {c.label}
            </span>
          </div>
        ))}
        <div className="border-b border-border bg-bg p-[12px_14px] text-center font-mono text-[11px] text-navy-2">
          {PRN_COLUMN.head}
          <span className="mt-[2px] block font-sans text-[9px] uppercase tracking-[0.12em] text-navy-3">
            {PRN_COLUMN.label}
          </span>
        </div>
        {/* rows */}
        {drugs.map((drug) => {
          const scheduled = entry.meds.filter((m) => m.drugName === drug && !m.isPrn);
          const prn = entry.meds.find((m) => m.drugName === drug && m.isPrn);
          const note = entry.meds.find((m) => m.drugName === drug)?.note ?? null;
          return (
            <MedRow
              key={drug}
              drug={drug}
              note={note}
              cols={cols}
              doseAt={(slotId) => scheduled.find((m) => m.slotId === slotId)?.doseLabel ?? null}
              prnDose={prn?.doseLabel ?? null}
            />
          );
        })}
      </div>
      {plan.anchorDescription && (
        <div className="border-t border-dashed border-border-2 p-[14px_24px] text-[12px] leading-[1.55] text-navy-2">
          <b className="font-semibold text-navy">{ROUND_TIMING_LEAD}</b>
          {plan.anchorDescription} {ROUND_TIMING_TAIL}
        </div>
      )}
    </div>
  );
}

function MedRow({
  drug,
  note,
  cols,
  doseAt,
  prnDose,
}: {
  drug: string;
  note: string | null;
  cols: RoundColumn[];
  doseAt: (slotId: string) => string | null;
  prnDose: string | null;
}) {
  return (
    <>
      <div className="border-b border-r border-border p-[12px_14px]">
        <b className="font-display font-semibold text-navy">{drug}</b>
        {note && <span className="mt-[2px] block text-[11px] text-navy-3">{note}</span>}
      </div>
      {cols.map((c) => {
        const dose = doseAt(c.slotId);
        return (
          <div
            key={c.slotId}
            className="border-b border-r border-border p-[12px_14px] text-center font-mono font-semibold text-navy"
          >
            {/* A `—` on a SCHEDULE grid means "not given at this round" — the fact, not a false zero
                (the deliberate deviation from the vitals grid, stated in the PR). */}
            {dose ?? <span className="font-sans font-normal italic text-navy-3">—</span>}
          </div>
        );
      })}
      <div className="border-b border-border bg-gold-bg p-[12px_14px] text-center font-mono font-semibold text-navy">
        {prnDose ? (
          <>
            <span className="block text-[8px] font-bold uppercase tracking-[0.1em] text-gold">
              PRN
            </span>
            {prnDose}
          </>
        ) : (
          <span className="font-sans font-normal italic text-navy-3">—</span>
        )}
      </div>
    </>
  );
}

function DormCard({ entry, plan }: { entry: ChronicPlanEntryView; plan: ChronicPlanView }) {
  const triggerLabels = entry.triggers?.trim() ? entry.triggers.trim() : null;
  return (
    <div className="relative mb-4 rounded-xl border-[1.5px] border-dashed border-gold bg-surface p-[18px_22px]">
      <span className="absolute -top-[9px] left-[18px] bg-bg px-[10px] text-[9px] font-bold tracking-[0.18em] text-gold">
        {DORM_CARD_LABEL}
      </span>
      <div className="font-display text-[16px] font-semibold text-navy">
        {plan.firstName} <em className="font-normal italic text-gold">{plan.lastName}</em>
        {plan.houseName ? ` · ${plan.houseName} House` : ""}
      </div>
      <div className="mb-3 text-[11px] text-navy-3">
        <Bold text={DORM_CARD_SUB} />
      </div>
      <AcRow label="Condition" value={conditionLabel(entry.condition, entry.conditionLabel)} />
      <AcRow label="Triggers" value={triggerLabels} />
      <AcRow label="Red flags" value={entry.redFlags} />
      <AcRow label="Action" value={entry.firstAction} />
      {plan.guardian && (
        <AcRow label="Parent" value={plan.guardian.name} />
      )}
      {plan.matronName && plan.matronPhone && (
        <AcRow label="Matron" value={`${plan.matronName} · ${plan.matronPhone}`} />
      )}
      <p className="mt-3 border-t border-border pt-3 text-[11px] leading-[1.5] text-navy-3">
        <Bold text={DORM_CARD_FOOT} />
      </p>
    </div>
  );
}

// ============================================================================
// §03 — a mental-health plan, told honestly (NO dorm card, NO med grid)
// ============================================================================

function PastoralEntry({ entry, plan }: { entry: ChronicPlanEntryView; plan: ChronicPlanView }) {
  void plan;
  const nextVisit = entry.externalNextVisitAt
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
        .format(entry.externalNextVisitAt)
        .replace(",", "")
    : null;
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded-full px-[10px] py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${CONDITION_PILL[entry.condition]}`}
        >
          {conditionLabel(entry.condition, entry.conditionLabel)}
        </span>
        <span className="text-[11px] text-navy-3">
          {planVersionMeta(entry.version, entry.reviewedAt, entry.reviewedByName)}
          {entry.coReviewerNote ? ` + ${entry.coReviewerNote}` : ""}
        </span>
      </div>

      {/* pastoral block — frozen editorial + the plan's own external-care narrative */}
      <div className="mb-4 rounded-[14px] border border-border bg-surface p-[24px_28px]">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
          {PASTORAL_EYEBROW}
        </div>
        <div className="mb-2 font-display text-[16px] font-semibold text-navy">
          {PASTORAL_TITLE_LEAD}
          <em className="font-normal italic text-gold">{PASTORAL_TITLE_EM}</em>
        </div>
        <p className="text-[13px] leading-[1.55] text-navy-2">{PASTORAL_BODY}</p>

        <div className="mt-4 grid gap-[14px] rounded-[10px] border border-border bg-bg p-[14px_18px] sm:grid-cols-3">
          <Handoff label="Clinical home" value={entry.externalClinicalHome} />
          <Handoff label="Pastoral home" value={entry.externalPastoralHome} />
          <Handoff
            label="Sickbay role"
            value={entry.referralManaged ? "Monitoring only · referral-managed" : null}
          />
        </div>
      </div>

      {/* plan rows — tier-5 content, in full to a scoped reader (MATRON) */}
      <div className="mb-4 rounded-[14px] border border-border bg-surface p-[20px_24px]">
        <PlanRow label="Condition" value={entry.conditionDetail} />
        <PlanRow label="Sickbay monitoring" value={entry.triggers} />
        <PlanRow
          label="External cadence"
          value={
            entry.externalCareCadence || nextVisit
              ? [entry.externalCareCadence, nextVisit ? `next visit ${nextVisit}` : null]
                  .filter(Boolean)
                  .join(" · ")
              : null
          }
        />
        <PlanRow label="Red flags · escalation" value={entry.redFlags} last />
      </div>
    </section>
  );
}

// ============================================================================
// shared bits
// ============================================================================

/** One `.plan-row` — ABSENT entirely when there is no value (a row with an empty value is broken). */
function PlanRow({ label, value, last }: { label: string; value: string | null; last?: boolean }) {
  if (!value?.trim()) return null;
  return (
    <div
      className={`grid grid-cols-[160px_1fr] items-start gap-[18px] py-3 ${last ? "" : "border-b border-border"}`}
    >
      <div className="pt-[2px] text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
        {label}
      </div>
      <div className="whitespace-pre-line text-[13px] leading-[1.55] text-navy-2">{value}</div>
    </div>
  );
}

function AcRow({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-[14px] border-b border-border py-[9px] last:border-b-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className="text-[12px] text-navy-2">{value}</div>
    </div>
  );
}

function Handoff({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className="mt-[3px] text-[12px] font-semibold text-navy-2">{value}</div>
    </div>
  );
}

/** Split a stored paragraph field on blank lines (R97 — never a prose parser for the numbering). */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function Bold({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-navy">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
