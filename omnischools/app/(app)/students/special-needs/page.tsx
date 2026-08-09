import { requireSchoolRole } from "@/lib/auth/server";
import { SEN_REGISTER_ROLES } from "@/lib/access";
import { getSenRegister, getSenCandidateStudents } from "@/lib/sen/register-data";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";
import { EnableSenButton } from "@/components/sen/enable-sen-button";
import { RecordSupportNeedForm } from "@/components/sen/record-support-need-form";
import { SenRegisterTable } from "@/components/sen/sen-register-table";

/**
 * GOV-10 · the CONFIDENTIAL SEN register surface — admin-only (`SEN_REGISTER_ROLES`: ADMIN / HEADMASTER;
 * R411). Opt-in: until the school enables it, the register is empty and the annual census §5 stays a
 * hand-fill (R413). Once records exist, the de-identified 12-cell aggregate auto-fills §5 — no names exported.
 * The privacy notice is the FIRST thing rendered, setting the boundary before any data.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Special needs register" };

const capCls = "text-[9px] font-bold uppercase tracking-wide text-navy-3";

export default async function SpecialNeedsPage() {
  const { school } = await requireSchoolRole(SEN_REGISTER_ROLES);
  const [view, candidates] = await Promise.all([
    getSenRegister(school.id),
    getSenCandidateStudents(school.id),
  ]);

  const pctOfEnrolment =
    view.totalEnrolment > 0 ? Math.round((100 * view.totalWithNeeds) / view.totalEnrolment) : 0;

  return (
    <div className="mx-auto max-w-page space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Students / <span className="text-gold">Special needs</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-medium text-navy">
              Special <em className="italic text-gold">needs register</em>
            </h1>
            <p className="mt-1 max-w-[740px] text-sm text-navy-3">
              Tracks students who need additional support · feeds the GES annual census special-needs
              section · <b className="text-navy-2">admin-only access</b> · parents must consent before
              recording
            </p>
          </div>
          {view.adopted && (
            <a
              href="/api/sen/census-export"
              download
              className="shrink-0 rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-gold-bg"
            >
              Export anonymised stats →
            </a>
          )}
        </div>
      </div>

      {/* Privacy banner — always first, sets the boundary before any data */}
      <div className="grid grid-cols-[28px_1fr] items-start gap-3.5 rounded-xl border border-gold-soft bg-gold-bg px-4 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold font-display text-[13px] font-bold text-navy">
          !
        </div>
        <div className="text-xs leading-relaxed text-navy-2">
          <div className="font-display text-[13px] font-semibold text-navy">
            Treated as <em className="italic text-gold">sensitive personal data</em>
          </div>
          Records here are visible only to <b className="text-navy">school administrators</b>, not
          teachers. Parents must <b className="text-navy">provide written consent</b> before a record is
          created. Categories describe <b className="text-navy">support needs</b>, not medical diagnoses.
          Schools that prefer not to record at student level can still complete the GES census section{" "}
          <b className="text-navy">by hand</b> — this module is opt-in.
        </div>
      </div>

      {!view.adopted ? (
        /* Honest not-adopted state — the census §5 stays a hand-fill until the school opts in (R413) */
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <h2 className="font-display text-xl font-semibold text-navy">
            The SEN register isn&apos;t enabled yet
          </h2>
          <p className="mx-auto mt-2 max-w-[540px] text-sm text-navy-3">
            Enabling it lets you record students who need additional support and auto-fills the
            special-needs section (12 cells) of the GES annual census. Until then, that section stays a
            hand-fill. This module is opt-in — enabling it does not disclose anything to teachers or
            parents.
          </p>
          <div className="mt-5 flex justify-center">
            <EnableSenButton />
          </div>
        </div>
      ) : (
        <>
          {/* Hero row */}
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div className="rounded-2xl bg-navy px-6 py-5 text-bg">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gold-soft">
                Students with recorded support needs
              </div>
              <div className="mt-1 font-display text-4xl font-semibold text-gold">
                {view.totalWithNeeds} <span className="text-2xl text-gold-soft">of {view.totalEnrolment}</span>
              </div>
              <div className="mt-3 text-xs text-gold-soft">
                {pctOfEnrolment}% of enrolment · {view.gender.male} boys, {view.gender.female} girls ·{" "}
                {view.formalCount} with formal diagnosis, {view.observedCount} observed/pending
              </div>
            </div>

            <HeroTile label="By gender">
              <div className="font-display text-xl font-semibold text-navy">
                {view.gender.male} boys · {view.gender.female} girls
              </div>
              <div className="mt-1 text-[11px] text-navy-3">
                {view.byLevel.length > 0
                  ? view.byLevel.map((l) => `${l.level}: ${l.count}`).join(" · ")
                  : "No year-group breakdown yet"}
              </div>
            </HeroTile>

            <HeroTile label="Largest category">
              {view.largestCategory ? (
                <>
                  <div className="font-display text-xl font-semibold text-navy">
                    {SEN_CATEGORY_LABEL[view.largestCategory.category]}
                  </div>
                  <div className="mt-1 text-[11px] text-navy-3">
                    {view.largestCategory.count} student{view.largestCategory.count === 1 ? "" : "s"}
                  </div>
                </>
              ) : (
                <div className="text-sm text-navy-3">None recorded yet</div>
              )}
            </HeroTile>

            <HeroTile label="Pending consent">
              <div className="font-display text-xl font-semibold text-navy">
                {view.pendingCount} famil{view.pendingCount === 1 ? "y" : "ies"}
              </div>
              <div className="mt-1 text-[11px] text-navy-3">
                In the census aggregate <b className="text-navy-2">without student detail</b>
              </div>
            </HeroTile>
          </div>

          {/* Census preview — the 12-cell auto-fill (true zeros, never em-dashes) */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-bg font-display text-[13px] font-bold text-green">
                G
              </div>
              <div>
                <div className="font-display text-[15px] font-semibold text-navy">
                  Auto-fills the GES annual census <em className="italic text-gold">special-needs</em>{" "}
                  section
                </div>
                <div className="text-[11px] text-navy-3">
                  12 cells · counts by category × sex · <b className="text-navy-2">no names exported</b>
                </div>
              </div>
              <div className="ml-auto rounded-pill bg-green-bg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-green">
                ✓ Auto · 12 of 12 cells
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {SEN_CATEGORY_ORDER.flatMap((c) => [
                <CensusCell key={`${c}-b`} label={`${SEN_CATEGORY_LABEL[c]} · boys`} value={view.census.byCategory[c].male} />,
                <CensusCell key={`${c}-g`} label={`${SEN_CATEGORY_LABEL[c]} · girls`} value={view.census.byCategory[c].female} />,
              ])}
            </div>
          </div>

          {/* Record support need — the consent enforcement point */}
          <RecordSupportNeedForm candidates={candidates} />

          {/* Student register (GRANTED records) */}
          <div className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-navy">Student register</h2>
            {view.records.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-navy-3">
                {view.pendingCount > 0
                  ? `${view.pendingCount} pending-consent record${view.pendingCount === 1 ? "" : "s"} counted in the census — no detail is shown until consent is on file.`
                  : "No support needs recorded yet. The census special-needs section will report a captured zero."}
              </div>
            ) : (
              <SenRegisterTable records={view.records} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HeroTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={capCls}>{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CensusCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2">
      <div className="text-[8px] font-bold uppercase tracking-wide text-navy-3">{label}</div>
      <div className="font-mono text-sm font-bold text-navy">{value}</div>
    </div>
  );
}
