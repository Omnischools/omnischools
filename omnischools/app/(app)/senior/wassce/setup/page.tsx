import { Fragment } from "react";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadWassceSetup, type WassceMatrixCard } from "@/lib/wassce/setup-data";
import { WassceRosterTable } from "@/components/senior/wassce-roster-table";
import {
  PROGRAMME_TRACKS,
  WASSCE_GRADING_BANDS,
  AGGREGATE_RANGE_LABEL,
  SC_FORMS,
  GES_POLICY_ANCHORS,
  WAEC_FEE_PER_CANDIDATE,
  formatGhs,
  waecPolicyAnchors,
} from "@/lib/wassce/constants";
import { MATCH_EXPLAINER_STEPS } from "@/lib/wassce/university-match";
import type { ExamWindowView } from "@/lib/wassce/exam-window";

export const dynamic = "force-dynamic";

/**
 * WASSCE setup / registration — the READ-ONLY, frozen F3-2026 cohort surface (SHS module 4.3 /
 * INCR-15 · surface `schoolup-wassce-setup.html` §1 programmes/subjects · §4 the 240-candidate
 * roster · §5 policy anchors). §2 (mock cycle) + §3 (uni targets) are OUT (INCR-16/17).
 *
 * READ-ONLY (Kofi AC-B): the surface exposes NO mutating server action and every write-looking
 * control (Edit · F2 cohort, + Late registration, freeze toggle, nav-out to unbuilt targets) is
 * rendered INERT. Export/Print/Audit are read stubs (disabled in INCR-15). No projection anywhere
 * (AC-G): no WASSCE tier/prediction is computed here. Every count/rate/amount on the page DERIVES from
 * a reader field or a documented policy constant — no hardcoded persona, count, amount, or date.
 */
export default async function WassceSetupPage() {
  const { school } = await requireSchoolRole(WASSCE_SETUP_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  // The instant is pinned ONCE and threaded (R68) — every "today" on this page is this one value.
  const now = new Date();
  const data = await withSchool(school.id, (tx) => loadWassceSetup(tx, school.id, now));

  if (!data.cohort) {
    return (
      <div className="mx-auto max-w-page">
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No WASSCE cohort has been set up for this school yet.
        </div>
      </div>
    );
  }

  const { counts, cohort, targets: t, examWindow: ew } = data;
  const examYear = cohort.examYear;
  // Confirmed rate derives from the real counts — never a hardcoded percentage.
  const confirmedPct =
    counts.candidates > 0 ? Math.round((counts.confirmed / counts.candidates) * 1000) / 10 : 0;

  return (
    <div className="mx-auto max-w-page space-y-10">
      {/* ================= §1 — Programmes · subjects · electives ================= */}
      <section id="programmes">
        <SectionHead
          crumb={<>WASSCE · Setup · Programmes &amp; subjects</>}
          titlePre={`WASSCE ${examYear} `}
          titleEm="configuration."
          lede={
            <>
              <b className="text-navy-2">
                {counts.candidates} F3 candidates across {counts.programmes} programmes.
              </b>{" "}
              {ew ? <>{ledeSchedule(ew)} </> : null}
              Setup is frozen for this cohort — changes apply to the F2 batch tracking toward WASSCE{" "}
              {examYear + 1}.
            </>
          }
          actions={[
            { label: "Export setup", kind: "read" },
            { label: "Audit history", kind: "read" },
            { label: "Edit · F2 cohort", kind: "write" },
          ]}
        />

        {/* §1.2 Live-exam banner — every date DERIVES from wassce_papers + the request instant (R90).
            The surface drew `Tue 13 May` / `Today (Wed 14 May)`: both weekdays are wrong for their own
            dates, and a drawn "today" is stale the next morning. Omitted entirely with no dated paper. */}
        {ew && (
          <div
            className="mb-5 grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl px-5 py-4 text-bg"
            style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-2))" }}
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-lg bg-gold font-display text-lg font-semibold text-navy">
              W
            </span>
            <div>
              <div className="font-display text-xl font-medium">
                WASSCE {examYear} is <em className="italic text-gold">{bannerState(ew)}</em>
                {ew.dayIndex != null
                  ? ` · Day ${ew.dayIndex} of the exam window`
                  : ` · ${ew.startLabel} → ${ew.endLabel}`}
              </div>
              <div className="mt-1 text-[12px] text-gold-soft">
                {beforeWindow(ew) ? "Starts" : "Started"}{" "}
                <b className="text-bg">
                  {ew.startLabel} · {ew.startPapers}
                </b>
                . {todaySentence(ew)} Ghana returns to the international May–June calendar after 5
                years of Ghana-only WASSCE following the 2020 COVID disruption.
              </div>
            </div>
            <div className="text-right">
              <InertButton label="Open live tracker" kind="nav" gold />
              <div className="mt-1 font-mono text-[11px] text-gold-soft">
                {ew.dayIndex != null
                  ? `Day ${ew.dayIndex} of ${ew.windowDays} · ends ${ew.endLabel}`
                  : `${ew.windowDays} days · ${ew.startLabel} → ${ew.endLabel}`}
              </div>
            </div>
          </div>
        )}

        {/* §1.3 Stat strip — all counts derive from the reader. */}
        <div className="mb-5 grid gap-3.5 md:grid-cols-4">
          <StatTile
            live
            label="F3 cohort"
            value={String(counts.candidates)}
            unit="candidates"
            trend={
              <>
                <b className="text-navy-2">{counts.confirmed} confirmed</b> · {counts.flagged} flagged
                today
              </>
            }
          />
          <StatTile
            label="Programmes"
            value={String(counts.programmes)}
            unit="tracks"
            trend={<>{data.programmeNames.join(" · ")}</>}
          />
          <StatTile
            label="Subjects offered"
            value={String(counts.subjectsTotal)}
            unit="total"
            trend={
              <>
                <b className="text-navy-2">{counts.subjectsCore} core</b> · {counts.subjectsElective}{" "}
                electives
              </>
            }
          />
        </div>

        {/* §1.4 Programme matrix — CORE spine. */}
        <div className="mb-5 grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {data.matrix.map((card) => (
            <ProgrammeCard key={card.programmeKey} card={card} />
          ))}
        </div>

        {/* §1.5 WASSCE grading card — WAEC constant, single source with §5.2. */}
        <div className="mb-5 rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-navy">
              WASSCE <em className="italic text-gold">grading</em> · how the aggregate works
            </h3>
            <span className="text-[10px] uppercase tracking-wide text-navy-3">
              WAEC · 9-grade scale
            </span>
          </div>
          <div className="mb-3.5 grid grid-cols-9 gap-1.5">
            {WASSCE_GRADING_BANDS.map((g) => (
              <div
                key={g.grade}
                className={`rounded-md p-2 text-center ${g.bgClass} ${g.textClass} ${g.opacity ?? ""}`}
              >
                <div className="font-display text-base font-semibold">{g.grade}</div>
                <div className="text-[9px] uppercase tracking-wide">{g.caption}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-2 text-[12px] leading-relaxed text-navy-2">
            <b className="text-navy">Aggregate</b> = best 3 cores + best 3 electives ={" "}
            <span className="rounded-full bg-bg px-2 py-0.5 font-mono font-bold">
              {AGGREGATE_RANGE_LABEL}
            </span>
            . Universities use this for admission. <b className="text-navy">A1–C6 are credit passes</b>{" "}
            and count toward tertiary admission; <b className="text-navy">D7–F9 do not.</b> University
            cut-offs typically run <span className="font-mono font-semibold">6–24</span> with the most
            competitive programmes (Medicine, Pharmacy, Engineering) at{" "}
            <span className="font-mono font-semibold">6–12</span>.
          </div>
        </div>

        {/* §1.6 Cross-module strip — GENERIC feature explainers (no per-cohort persona/data wired). */}
        <div className="grid gap-3.5 md:grid-cols-3">
          <XmodCard
            label="Cross-module · Classes"
            titlePre="Programme → "
            titleEm="class"
            titlePost=" mapping"
            body={
              <>
                Each F3 student belongs to one programme via their class assignment. That class →
                programme join carries forward into WASSCE registration.
              </>
            }
          />
          <XmodCard
            label="Cross-module · Teachers"
            titlePre="Subject teacher "
            titleEm="roster"
            titlePost=" locked"
            body={
              <>
                Each subject has one or more F3 teachers. The subject-view surface keys off this
                roster — readiness data flows back to each teacher.
              </>
            }
          />
          <XmodCard
            label="Cross-module · Billing"
            titlePre="WAEC exam "
            titleEm="fee"
            titlePost=" reconciliation"
            body={
              <>
                WAEC charges per student per paper.{" "}
                <b className="text-bg">{formatGhs(WAEC_FEE_PER_CANDIDATE)} per candidate</b> for{" "}
                {examYear}. Free SHS covers core fees; private add-ons (re-sits, extra electives) flow
                into billing as individual line items. {counts.flagged} students flagged below.
              </>
            }
          />
        </div>
      </section>

      {/* ================= §3 — University target system · per-student tagging (INCR-17b) ============ */}
      <section id="university-targets">
        <SectionHead
          crumb={<>WASSCE · Setup · University targets</>}
          titlePre="University "
          titleEm="target system."
          lede={
            <>
              Every F3 student tags <b className="text-navy-2">up to three target programmes</b> after
              Mock 1 (revised after Mock 2). The system stores the WAEC cut-off for each programme and
              matches it against the student&apos;s projected aggregate.{" "}
              <b className="text-navy-2">The Dean runs a guidance interview</b> with every student whose
              Mock 2 aggregate exceeds their lowest target&apos;s cut-off.
            </>
          }
          actions={[]}
        />

        {/* §3.2 tier-band strip — the cohort's projected-AGGREGATE distribution (NOT the match tiers) */}
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {t.bands.map((b, i) => (
            <div
              key={b.key}
              className={`rounded-lg border p-4 ${i === 0 ? "border-gold" : "border-border-2 bg-surface"}`}
              style={
                i === 0
                  ? { background: "linear-gradient(135deg, var(--gold-bg), var(--surface))" }
                  : undefined
              }
            >
              <span
                className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${i === 0 ? "bg-gold text-navy" : "bg-bg text-navy"}`}
              >
                {b.range}
              </span>
              <div className="mt-1.5 font-display text-[15px] font-medium text-navy">
                Tier <em className="italic text-gold">{b.name.replace("Tier ", "")}</em>
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-navy-3">
                {b.copy}{" "}
                <b className="text-navy-2">
                  {b.studentCount} student{b.studentCount === 1 ? "" : "s"}
                </b>{" "}
                in this band.
              </div>
            </div>
          ))}
        </div>

        {/* §3.3 top destinations — first-choice tally, all figures derived */}
        <div className="mb-5 rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-navy">
              Top <em className="italic text-gold">destinations</em> · how the cohort is targeting
            </h3>
            <span className="text-[10px] uppercase tracking-wide text-navy-3">
              First-choice university (most popular)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[11px]">
              <thead>
                <tr className="bg-bg text-[9px] uppercase tracking-[0.14em] text-navy-3">
                  <th className="p-2 text-left font-bold">University</th>
                  <th className="p-2 text-right font-bold">Median cut-off</th>
                  <th className="p-2 text-right font-bold">Students targeting</th>
                  <th className="p-2 text-right font-bold">% F3</th>
                </tr>
              </thead>
              <tbody>
                {t.destinations.map((d) => (
                  <tr key={d.universityId} className="border-b border-border">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-navy text-[10px] font-bold text-gold">
                          {d.initials}
                        </span>
                        <span>
                          <b className="text-navy-2">{d.name}</b>
                          <span className="block text-[10px] text-navy-3">{d.locationLabel}</span>
                        </span>
                      </div>
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-navy-2">
                      {d.medianCutOffLabel}
                      <span className="block font-body text-[10px] font-normal text-navy-3">
                        {d.rangeLabel}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-navy-2">
                      {d.studentsTargeting}
                    </td>
                    <td className="p-2 text-right font-mono text-navy-3">{d.sharePctLabel}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-navy bg-bg">
                  <td className="p-2 italic text-navy-3">No first-choice tagged yet</td>
                  <td className="p-2 text-right text-terra">
                    flag
                    <span className="block text-[10px] text-terra">Dean follow-up</span>
                  </td>
                  <td className="p-2 text-right font-mono font-bold text-terra">{t.untaggedCount}</td>
                  <td className="p-2 text-right font-mono text-navy-3">{t.untaggedSharePctLabel}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            className="mt-3.5 rounded-lg border-l-[3px] border-warn bg-warn-bg px-3.5 py-3 text-[11px] leading-relaxed text-navy-2"
          >
            <b>
              {t.untaggedCount === 1
                ? "1 student has not tagged a first-choice university"
                : `${t.untaggedCount} students have not tagged a first-choice university`}
            </b>{" "}
            in this cohort. The Dean meets each individually before the guidance deadline — untagged is a{" "}
            <b>worklist, not a fault</b>: some F3 students legitimately have not decided, and the
            interview surfaces that earlier than a parent SMS would.
          </div>
        </div>

        <div className="grid gap-3.5 lg:grid-cols-2">
          {/* §3.4 how the match works — 5-step explainer */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-navy">
                How the <em className="italic text-gold">match</em> works
              </h3>
              <span className="text-[10px] uppercase tracking-wide text-navy-3">
                Per student × per programme
              </span>
            </div>
            <div className="flex flex-col gap-2.5 text-[12px] leading-relaxed text-navy-2">
              {MATCH_EXPLAINER_STEPS.map((step, i) => (
                <div key={step.heading} className="grid grid-cols-[30px_1fr] items-start gap-3">
                  <span className="font-display text-lg font-semibold italic text-gold">{i + 1}.</span>
                  <div>
                    <b className="text-navy">{step.heading}</b> {step.body}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* §3.5 cut-off table — the seeded published SNAPSHOT, read-only to schools */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-navy">
                Cut-off <em className="italic text-gold">table</em>
              </h3>
              <span className="text-[10px] uppercase tracking-wide text-navy-3">
                Snapshot {t.referenceYears} · {t.cutOffRows.length} referenced programmes
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[380px] border-collapse text-[11px]">
                <thead>
                  <tr className="bg-bg text-[9px] uppercase tracking-[0.14em] text-navy-3">
                    <th className="p-2 text-left font-bold">University</th>
                    <th className="p-2 text-left font-bold">Programme</th>
                    <th className="p-2 text-right font-bold">Cut-off</th>
                  </tr>
                </thead>
                <tbody>
                  {t.cutOffRows.map((r) => (
                    <tr
                      key={r.programmeId}
                      className={`border-b border-border ${r.targeted ? "bg-gold-bg" : ""}`}
                    >
                      <td className="p-2 font-semibold text-navy-2">{r.universityShortName}</td>
                      <td className="p-2 text-navy-2">{r.programmeName}</td>
                      <td className={`p-2 text-right font-mono font-bold ${r.cutOffClass}`}>
                        {r.cutOffLabel}
                      </td>
                    </tr>
                  ))}
                  {t.cutOffRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-navy-3">
                        No cut-off reference has been loaded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-lg bg-bg px-3 py-2.5 text-[10px] leading-relaxed text-navy-3">
              Each figure is a <b>published snapshot stamped with its reference year</b> — a recorded
              reference, not a live feed. Universities sometimes adjust cut-offs after WASSCE results come
              in if the applicant pool changes. The figures here are <b>indicative, not guarantees</b>. Cut-off colour is difficulty-coded and
              deliberately inverted: terra = the hardest (lowest) cut-offs, green = the easiest.
            </div>
          </div>
        </div>
      </section>

      {/* ================= §4 — WASSCE registration · the 240 ================= */}
      <section id="registration">
        <SectionHead
          crumb={<>WASSCE · Setup · Registration roster</>}
          titlePre={`WASSCE ${examYear} `}
          titleEm="roster."
          lede={
            <>
              <b className="text-navy-2">{counts.candidates} candidates registered</b> with WAEC.
              Centre code <span className="font-mono font-bold text-navy">{data.centreCode}</span>.
              Index numbers issued. {counts.flagged} students flagged today — {counts.medicalFlags} on a
              medical special-consideration (SC-12) process, {counts.nhisFlags} with NHIS-card issues
              affecting the WAEC fee reconciliation.
            </>
          }
          actions={[
            { label: "WAEC export", kind: "read" },
            { label: "Print roster", kind: "read" },
            { label: "+ Late registration", kind: "write" },
          ]}
        />

        {/* §4.2 Medical special-consideration banner — the LIVE, non-DRAFT SC-12 fact (R227), DERIVED
            from waec_special_consideration (never hardcoded). WAEC workflow ONLY: name, index, SC-12
            status, WAEC ref, make-up, filed DATE — never any clinical field, since ADMIN + VHA
            (non-clinical roles) read this surface. A DRAFT auto-suggest is excluded upstream (it stays
            the exams officer's private worklist), and with no live SC-12 the banner is omitted entirely
            rather than drawn empty (R90: derive, never redraw). */}
        {data.sc12Banner.length > 0 && (
          <div
            className="mb-5 grid grid-cols-[auto_1fr] items-start gap-4 rounded-xl border border-warn px-5 py-4"
            style={{ background: "linear-gradient(135deg, var(--warn-bg), var(--surface))" }}
          >
            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-warn font-display text-lg font-bold text-bg">
              !
            </span>
            <div>
              <div className="font-display text-[15px] font-medium text-navy">
                {data.sc12Banner.length === 1
                  ? "One candidate"
                  : `${data.sc12Banner.length} candidates`}{" "}
                on a WAEC <em className="italic text-gold">special consideration</em> · SC-12
              </div>
              <ul className="mt-1.5 space-y-1.5 text-[12px] text-navy-2">
                {data.sc12Banner.map((s) => (
                  <li key={s.indexNumber}>
                    <b className="text-navy">
                      {s.candidateName} · index {s.indexNumber}
                    </b>{" "}
                    — {s.statusLabel}
                    {s.waecRef ? (
                      <>
                        {" "}
                        · WAEC ref <span className="font-mono">{s.waecRef}</span>
                      </>
                    ) : null}
                    {s.makeUpLabel ? <> · make-up {s.makeUpLabel}</> : null}
                    {s.filedDateLabel ? <> · filed {s.filedDateLabel}</> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* §4.3 Roster stat tiles — derive from real rows; fee tile = count × GES anchor. */}
        <div className="mb-5 grid gap-3.5 md:grid-cols-4">
          <RosterTile
            ok
            label="Confirmed"
            value={String(counts.confirmed)}
            sub={`of ${counts.candidates}`}
            trend={`${confirmedPct}% of the cohort · index numbers issued`}
          />
          <RosterTile
            flag
            label="Flagged today"
            value={String(counts.flagged)}
            trend={`${counts.medicalFlags} medical · ${counts.nhisFlags} NHIS / fee admin`}
          />
          <RosterTile
            label="Accommodations"
            value={String(counts.accommodations)}
            trend={data.accommodationBreakdown}
          />
          <RosterTile
            mono
            label="Total fees"
            value={data.totalFeesLabel}
            trend="Free SHS covers core registration fees"
          />
        </div>

        {/* §4.4 + §4.5 filter/sort strip + roster table (client view-state; no writes). */}
        <WassceRosterTable rows={data.roster} />

        {/* §4.6 Cross-module strip — GENERIC explainers for cross-module integrations (target modules unbuilt). */}
        <div className="mt-5 grid gap-3.5 md:grid-cols-3">
          <XmodCard
            label="Cross-module · Sickbay"
            titlePre="Auto-suggested "
            titleEm="SC-12"
            titlePost=" from sickbay"
            body={
              <>
                A sickbay referral or admission of a live candidate auto-suggests a{" "}
                <b className="text-bg">DRAFT WAEC SC-12</b> for the exams officer to review and file.
                The draft carries the candidate and form only — never any clinical detail — and stays
                off the parent portal until the school files it.
              </>
            }
          />
          <XmodCard
            label="Cross-module · VLC"
            titlePre="Pastoral "
            titleEm="flag"
            titlePost=" cross-reference"
            body={
              <>
                A candidate&apos;s pastoral flag is visible to the Dean only · no exam exemption granted
                (a VLC pastoral case is about the support, not the standards). They sit the same papers
                as everyone else; the Dean checks in privately.
              </>
            }
          />
          <XmodCard
            label="Cross-module · Billing"
            titlePre=""
            titleEm={`${counts.flagged} flags`}
            titlePost=" resolved or active"
            body={
              <>
                Per Free SHS policy, no candidate can be denied WASSCE for fee reasons — where a fee gap
                arises the bursar reconciles with the GES district office, and the school carries the gap
                if the district doesn&apos;t.
              </>
            }
          />
        </div>
      </section>

      {/* ================= §5 — Policy & schema anchors / frozen state ================= */}
      <section id="anchors">
        <SectionHead
          crumb={<>WASSCE · Setup · Policy anchors</>}
          titlePre="Policy "
          titleEm="anchors."
          lede={
            <>
              What the WASSCE module is built on. Three regulators (WAEC, GES, MoE), one cohort, one
              set of rules. The anchors below are referenced in every readiness statement.
            </>
          }
          actions={[
            { label: "Export anchors", kind: "read" },
            { label: "Audit history", kind: "read" },
          ]}
        />

        <AnchorCard
          titleEm="WAEC"
          titlePost=" policy anchors"
          meta="West African Examinations Council · 1952"
          items={waecPolicyAnchors(data.centreCode)}
        />
        <div className="h-3.5" />
        <AnchorCard
          titleEm="GES"
          titlePost=" operational anchors"
          meta="Ghana Education Service · school authority"
          items={GES_POLICY_ANCHORS}
        />

        {/* §5.4 Save-bar — THE freeze signal. Binds to cohort.setup_frozen_at. */}
        <div
          className="mt-5 grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border-[1.5px] border-gold px-5 py-4"
          style={{ background: "linear-gradient(135deg, var(--gold-bg), var(--surface))" }}
        >
          <div>
            <div className="font-display text-base font-medium text-navy">
              Setup is <em className="italic text-gold">frozen</em> for this cohort
            </div>
            <div className="mt-1 text-[12px] text-navy-3">
              {counts.candidates} candidates registered with WAEC · {counts.programmes} programmes
              locked.{" "}
              <b className="text-navy">WASSCE {examYear} is in progress.</b> No further setup changes
              possible until WAEC results arrive in August.
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <InertButton label="View change log" kind="read" />
            <InertButton label="Open cohort readiness" kind="nav" />
          </div>
        </div>
      </section>

      {/* SC-form reference (WAEC constant, shared with §4.5 accommodation notes) — quiet footnote. */}
      <p className="text-[11px] text-navy-3">
        WAEC special-consideration forms ·{" "}
        {SC_FORMS.map((f, i) => (
          <span key={f.code}>
            {i > 0 && " · "}
            <b className="text-navy-2">{f.code}</b> ({f.scope})
          </span>
        ))}{" "}
        · GES Free-SHS registration {formatGhs(WAEC_FEE_PER_CANDIDATE)} per candidate.
      </p>
    </div>
  );
}

/* --------------------- §1.2 derived schedule copy (no drawn dates) --------------------- */

/** Today is before the first paper — the whole banner has to speak in the future tense. */
function beforeWindow(ew: ExamWindowView): boolean {
  return ew.dayIndex == null && ew.nextPaper != null;
}

/** The one gold em in the banner headline — the window's state, never the mockup's fixed "live". */
function bannerState(ew: ExamWindowView): string {
  if (ew.todayPapers.length) return "live";
  if (ew.dayIndex != null) return "under way";
  return beforeWindow(ew) ? "still to come" : "complete";
}

/** The §1 lede's schedule clause. Every date is the timetable's; nothing here is authored. */
function ledeSchedule(ew: ExamWindowView): string {
  if (beforeWindow(ew)) return `Writing starts ${ew.startLabel} with ${ew.startPapers}.`;
  if (ew.dayIndex == null) return `Writing ran ${ew.startLabel} → ${ew.endLabel}.`;
  const head = `Writing started ${ew.startLabel} with ${ew.startPapers};`;
  if (ew.todayPapers.length) {
    return `${head} ${ew.todayPapers.map((p) => p.name).join(" + ")} today.`;
  }
  return ew.nextPaper
    ? `${head} next is ${ew.nextPaper.name} on ${ew.nextPaper.label}.`
    : `${head} writing ends ${ew.endLabel}.`;
}

/**
 * The banner sub-line's middle clause. `Today (…)` carries the REQUEST's civil date, and a day with
 * no paper says so rather than repeating yesterday's — the two halves of the shipped defect.
 */
function todaySentence(ew: ExamWindowView) {
  if (ew.todayPapers.length) {
    return (
      <>
        Today ({ew.todayLabel}){" "}
        {ew.todayPapers.map((p, i) => (
          <Fragment key={p.name}>
            {i > 0 ? " + " : ""}
            <b className="text-bg">
              {p.name} {p.window}
            </b>
          </Fragment>
        ))}
        .
      </>
    );
  }
  if (ew.nextPaper) {
    return (
      <>
        No paper today ({ew.todayLabel}) — next is{" "}
        <b className="text-bg">
          {ew.nextPaper.name} · {ew.nextPaper.label}
        </b>{" "}
        ({ew.nextPaper.inDays === 1 ? "tomorrow" : `in ${ew.nextPaper.inDays} days`}).
      </>
    );
  }
  return (
    <>
      Writing ended <b className="text-bg">{ew.endLabel}</b>.
    </>
  );
}

/* ------------------------------- presentational ------------------------------- */

type ActionKind = "read" | "write" | "nav";

/** Section header: crumb → gold-em h1 → lede → inert action buttons. */
function SectionHead({
  crumb,
  titlePre,
  titleEm,
  lede,
  actions,
}: {
  crumb: React.ReactNode;
  titlePre: string;
  titleEm: string;
  lede: React.ReactNode;
  actions: { label: string; kind: ActionKind }[];
}) {
  return (
    <div className="mb-5 border-b border-border pb-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">{crumb}</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium text-navy">
            {titlePre}
            <em className="italic text-gold">{titleEm}</em>
          </h1>
          <p className="mt-2 max-w-3xl text-[13px] text-navy-3">{lede}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <InertButton key={a.label} label={a.label} kind={a.kind} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Every action on this surface is INERT in INCR-15 (read-only). WRITE controls (Edit · F2, + Late
 * registration, freeze toggle) and NAV-outs to unbuilt targets are disabled with a frozen/unbuilt
 * affordance; READ stubs (export/print/audit) are disabled pending their own increment. No control
 * triggers a mutation — there is no mutating server action to trigger (AC-B).
 */
function InertButton({
  label,
  kind,
  gold,
}: {
  label: string;
  kind: ActionKind;
  gold?: boolean;
}) {
  const title =
    kind === "write"
      ? "Setup is frozen for this cohort — read-only in INCR-15"
      : kind === "nav"
        ? "Target surface not built yet"
        : "Export / audit — read stub (INCR-15)";
  const base =
    "cursor-not-allowed rounded-md px-4 py-2 text-[12px] font-semibold opacity-60";
  const style = gold
    ? "bg-gold text-navy"
    : kind === "write" || kind === "nav"
      ? "bg-navy text-bg"
      : "border border-border-2 bg-surface text-navy";
  return (
    <button type="button" disabled aria-disabled title={title} className={`${base} ${style}`}>
      {label}
    </button>
  );
}

function StatTile({
  live,
  label,
  value,
  unit,
  trend,
}: {
  live?: boolean;
  label: string;
  value: string;
  unit: string;
  trend: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${live ? "border-gold" : "border-border bg-surface"}`}
      style={
        live ? { background: "linear-gradient(135deg, var(--gold-bg), var(--surface))" } : undefined
      }
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">{label}</div>
      <div className="mt-1 font-display text-[28px] font-medium leading-none">
        <em className={`not-italic ${live ? "text-gold" : "text-navy"}`}>{value}</em>
        <span className="ml-1.5 font-body text-[13px] text-navy-3">{unit}</span>
      </div>
      <div className="mt-1.5 text-[10px] text-navy-3">{trend}</div>
    </div>
  );
}

function RosterTile({
  ok,
  flag,
  mono,
  label,
  value,
  sub,
  trend,
}: {
  ok?: boolean;
  flag?: boolean;
  mono?: boolean;
  label: string;
  value: string;
  sub?: string;
  trend: string;
}) {
  const border = ok ? "border-green" : flag ? "border-warn" : "border-border";
  const valColor = ok ? "text-green" : flag ? "text-warn" : "text-navy";
  const grad = ok
    ? "linear-gradient(135deg, var(--green-bg), var(--surface))"
    : flag
      ? "linear-gradient(135deg, var(--warn-bg), var(--surface))"
      : undefined;
  return (
    <div
      className={`rounded-lg border p-4 ${border} ${grad ? "" : "bg-surface"}`}
      style={grad ? { background: grad } : undefined}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-[26px] font-medium leading-none ${valColor} ${mono ? "font-mono text-[22px]" : ""}`}>
        {value}
        {sub && <span className="ml-1.5 text-[13px] font-medium text-navy-3">{sub}</span>}
      </div>
      <div className="mt-1.5 text-[10px] text-navy-3">{trend}</div>
    </div>
  );
}

function ProgrammeCard({ card }: { card: WassceMatrixCard }) {
  const t = PROGRAMME_TRACKS[card.programmeKey];
  return (
    <div
      className="rounded-xl border border-border bg-surface p-4"
      style={{ borderTop: `3px solid ${t.color}` }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-display text-[15px] font-semibold text-navy">
          {t.namePre}
          <em className="italic text-gold">{t.nameEm}</em>
        </div>
        <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[11px] font-bold text-navy">
          {card.candidateCount}
        </span>
      </div>

      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        Core (mandatory · all)
      </div>
      <div className="mb-3 space-y-1">
        {card.cores.map((name) => (
          <div key={name} className="flex items-center justify-between gap-2 text-[12px] text-navy-2">
            <span>
              <b className="text-navy">{name}</b>
            </span>
            <span className="rounded-full bg-navy px-1.5 py-0.5 text-[8px] font-bold uppercase text-bg">
              Core
            </span>
          </div>
        ))}
      </div>

      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        {t.electivesLabel}
      </div>
      <div className="space-y-1">
        {card.electives.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2 text-[12px] text-navy-2">
            <span>
              <b className="text-navy">{e.name}</b>
              {e.tag === "Alt" && t.optSuffix ? ` ${t.optSuffix}` : ""}
            </span>
            {e.tag === "Elec" ? (
              <span className="rounded-full bg-gold-bg px-1.5 py-0.5 text-[8px] font-bold uppercase text-gold">
                Elec
              </span>
            ) : (
              <span className="rounded-full border border-border bg-bg px-1.5 py-0.5 text-[8px] font-bold uppercase text-navy-3">
                Alt
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function XmodCard({
  label,
  titlePre,
  titleEm,
  titlePost,
  body,
}: {
  label: string;
  titlePre: string;
  titleEm: string;
  titlePost: string;
  body: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4 text-bg"
      style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-2))" }}
    >
      <div className="text-[9px] font-bold uppercase tracking-wide text-gold">{label}</div>
      <div className="mt-1 font-display text-[14px] font-medium">
        {titlePre}
        <em className="italic text-gold">{titleEm}</em>
        {titlePost}
      </div>
      <div className="mt-1.5 text-[11px] text-gold-soft">{body}</div>
    </div>
  );
}

function AnchorCard({
  titleEm,
  titlePost,
  meta,
  items,
}: {
  titleEm: string;
  titlePost: string;
  meta: string;
  items: { heading: string; body: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-navy">
          <em className="italic text-gold">{titleEm}</em>
          {titlePost}
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-navy-3">{meta}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((it) => (
          <div key={it.heading} className="text-[12px] leading-relaxed">
            <div className="mb-1 font-display text-[14px] font-semibold text-navy">{it.heading}</div>
            <div className="text-navy-2">{it.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
