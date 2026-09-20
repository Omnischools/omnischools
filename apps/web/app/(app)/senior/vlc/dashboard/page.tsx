import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchoolRole } from "@/lib/auth/server";
import {
  VLC_DASHBOARD_READ_ROLES,
  VLC_PASTORAL_READ_ROLES,
  VLC_PARAGRAPH_READ_ROLES,
  hasAnyRole,
} from "@/lib/access";
import { getVlcDashboard } from "@/lib/vlc/dashboard-data";
import { SectionHead, SumCard } from "@/components/vlc/chrome";

export const dynamic = "force-dynamic";

/**
 * 🔴 INCR-44 — `/senior/vlc/dashboard` — the VLC school-wide METADATA rollup (SHS module 4.5), for the
 * Dean of Students + Headmaster + ADMIN (VLC_DASHBOARD_READ_ROLES; FM excluded — its oversight is per-class).
 * COUNTS / AGGREGATES ONLY: NO confidential CONTENT, NO per-student flag identity, NO journal/note/case body.
 *
 * The per-student flag cards + severity + bereavement/violence narratives + the per-value pattern narrative +
 * "Export term report" + the reflection-submission leaderboard are OMIT-NOT-FAKE (R346/R350) — absent for
 * EVERY role incl. Dean; the surviving flag data is COUNTS only. The two confidential drill-in affordances
 * are role-gated (R349): the leaver-reference roster renders only for VLC_PARAGRAPH_READ_ROLES (FM/Dean/HM)
 * and the pastoral-casework entry only for VLC_PASTORAL_READ_ROLES (FM/Dean) — so an ADMIN viewer sees the
 * metadata tiers with NO drill-in, NO names, NO roster. Every destination re-enforces its own gate.
 */
export default async function VlcDashboardPage() {
  const { school, user } = await requireSchoolRole(VLC_DASHBOARD_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const view = await getVlcDashboard(school.id);
  const roles = user.roles;
  const canReachRoster = hasAnyRole(roles, VLC_PARAGRAPH_READ_ROLES); // FM/Dean/HM — ADMIN excluded
  const canReachCasework = hasAnyRole(roles, VLC_PASTORAL_READ_ROLES); // FM/Dean — ADMIN + HM excluded

  const fmtPct = (p: number | null) => (p === null ? "—" : `${p}%`);

  return (
    <div className="pb-20">
      {/* ── hero (Tier-1 lede) ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Pastoral &amp; values · VLC · School-wide dashboard
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          The view <em className="italic text-gold">across the school</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {view.classCount} {view.classCount === 1 ? "class" : "classes"} running ·{" "}
          {view.sessionsHeld} VLC {view.sessionsHeld === 1 ? "session" : "sessions"} held cumulatively
          year-to-date · {fmtPct(view.avgAttendancePct)} average attendance · {view.flags.raised} pastoral{" "}
          {view.flags.raised === 1 ? "flag" : "flags"} raised this year ({view.flags.open} currently open) ·{" "}
          {view.activePgCount} trained Peer Guides.{" "}
          <span className="italic">Not a grade for VLC, not a ranking — a rhythm-check.</span>
        </p>
      </header>

      {/* ── summary strip (Tier-1) ── */}
      <section className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SumCard label="Year progress" big={fmtPct(view.yearProgressPct)} featured>
          {view.sessionsHeldAvg} of {view.sessionsExpected} sessions held ·{" "}
          {Math.max(0, view.sessionsExpected - view.sessionsHeldAvg)} to go
        </SumCard>
        <SumCard label="Avg attendance" big={fmtPct(view.avgAttendancePct)}>
          {view.attendanceByForm.length
            ? view.attendanceByForm.map((f) => `${f.formLabel} ${f.pct}%`).join(" · ")
            : "no sessions recorded yet"}
        </SumCard>
        <SumCard label="Pastoral flags · year" big={`${view.flags.raised} raised`} terra>
          {view.flags.open} open · {view.flags.escalated} escalated · {view.flags.resolved} resolved
        </SumCard>
        <SumCard label="PG training attendance" big={fmtPct(view.trainingPct)}>
          {view.trainingsDone} {view.trainingsDone === 1 ? "training" : "trainings"} held ·{" "}
          {view.activePgCount} active Peer Guides
        </SumCard>
        {/* card 5 — the reflection-submission BARE COUNT (no leaderboard / no "class X leads" ranking) */}
        <SumCard label="Reflection submission" big={fmtPct(view.reflectionSubmissionPct)}>
          class average · a submission count, not a ranking
        </SumCard>
      </section>

      {/* ── Tier-2 per-class matrix ── */}
      <section className="mb-10">
        <SectionHead eyebrow="Per-class status" meta={`${view.classCount} classes · sorted by form, then name · 1 row per class`}>
          Class-by-class · <em className="italic text-gold">position in curriculum</em>
        </SectionHead>
        {view.classes.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">No SHS classes yet</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
              No senior (Form 1–3) classes are configured for this school yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                  <th className="px-4 py-2.5">Class</th>
                  <th className="px-4 py-2.5">Curriculum position</th>
                  <th className="px-4 py-2.5">Attendance</th>
                  <th className="px-4 py-2.5">Submission</th>
                  <th className="px-4 py-2.5">Flags</th>
                  <th className="px-4 py-2.5">Form Master / PGs</th>
                </tr>
              </thead>
              <tbody>
                {view.classes.map((c) => (
                  <tr
                    key={c.classId}
                    className={`border-b border-border last:border-b-0 ${
                      c.openFlagCount > 0 ? "bg-terra-bg" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-display text-[15px] font-semibold text-navy">{c.className}</div>
                      <div className="text-[11px] text-navy-3">
                        {c.programmeLabel ? `${c.programmeLabel} · ` : ""}
                        {c.enrolled} students
                        {c.pgVacancy && <span className="ml-1 font-semibold text-terra">· PG vacancy</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-display text-[13px] font-semibold text-navy">
                        {c.curriculumLabel ?? "—"}
                      </div>
                      <div className="font-mono text-[11px] text-navy-3">
                        {c.sessionsHeld} / {view.sessionsExpected} sessions
                      </div>
                    </td>
                    <td className="px-4 py-3 font-display text-[14px] font-semibold text-navy">
                      {fmtPct(c.attendancePct)}
                    </td>
                    <td className="px-4 py-3 font-display text-[14px] font-semibold text-navy">
                      {fmtPct(c.submissionPct)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          c.openFlagCount > 0 ? "bg-terra text-bg" : "bg-surface text-navy-3"
                        }`}
                      >
                        {c.openFlagCount === 0 ? "— 0" : `${c.openFlagCount} open`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] text-navy">{c.fmName ?? "—"}</div>
                      <div className="font-mono text-[11px] text-navy-3">PGs {c.pgFillLabel}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── curriculum coverage (navy grid — solid tokens, no alpha) ── */}
      <section className="mb-10">
        <SectionHead eyebrow="Curriculum coverage · school-wide" meta="RATE = % of classes that reached the value">
          All classes · <em className="italic text-gold">at the same value</em>
        </SectionHead>
        {view.coverage.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-navy-3">
            The values curriculum is not configured yet (VLC setup / F0).
          </div>
        ) : (
          <div className="rounded-2xl border border-navy bg-navy p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {view.coverage.map((v) => (
                <div
                  key={v.ordinal}
                  className={`rounded-lg border p-3 ${
                    v.state === "done"
                      ? "border-green bg-green-bg"
                      : v.state === "current"
                        ? "border-gold bg-gold text-navy"
                        : "border-navy-3 bg-navy-2"
                  }`}
                >
                  <div
                    className={`font-display text-[13px] font-semibold ${
                      v.state === "current" ? "text-navy" : v.state === "done" ? "text-navy" : "text-bg"
                    }`}
                  >
                    {String(v.ordinal).padStart(2, "0")} {v.nameEn}
                  </div>
                  <div
                    className={`font-mono text-[11px] ${
                      v.state === "current" ? "text-navy" : v.state === "done" ? "text-green" : "text-gold-soft"
                    }`}
                  >
                    {v.state === "upcoming" ? "—" : `${v.ratePct}%`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── confidential drill-in affordances — role-gated (R349); ADMIN sees NEITHER ── */}
      {(canReachRoster || canReachCasework) && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Go deeper</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {canReachRoster && (
              <Link
                href="/senior/vlc/reference"
                className="rounded-xl border border-border bg-bg px-4 py-3 text-[13px] font-semibold text-navy transition-colors hover:border-gold hover:bg-gold-bg"
              >
                Leaver reference roster →
              </Link>
            )}
            {canReachCasework && (
              <Link
                href="/senior/vlc/sessions"
                className="rounded-xl border border-border bg-bg px-4 py-3 text-[13px] font-semibold text-navy transition-colors hover:border-gold hover:bg-gold-bg"
              >
                Open a class register to reach pastoral casework →
              </Link>
            )}
          </div>
          <p className="mt-3 max-w-2xl text-[11px] leading-snug text-navy-3">
            This dashboard shows counts and aggregates only. Confidential per-student casework and journals
            stay behind their own gates — reached one student at a time, never rolled up here.
          </p>
        </section>
      )}
    </div>
  );
}
