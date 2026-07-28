import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_CONFIG_READ_ROLES, VLC_PASTORAL_READ_ROLES, hasAnyRole } from "@/lib/access";
import { canWriteSession, canAccessPastoralFlag } from "@/lib/vlc/authz";
import { getVlcSession } from "@/lib/vlc/session-data";
import { getPastoralFlags } from "@/lib/vlc/pastoral-data";
import { SectionHead } from "@/components/vlc/chrome";
import { OpenSessionForm, SessionAttendanceGrid } from "@/components/vlc/session-register";
import { PastoralFlagPanel } from "@/components/vlc/pastoral-flag";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `/senior/vlc/sessions/[classId]/[date]` — the VLC live-session register (SHS module 4.5 / INCR-42a):
 * the derived 5-phase clock, the facilitator strip, the value focus banner, the two PG-led small groups,
 * the P/L/A attendance grid and the phase agenda. READ = VLC_CONFIG_READ_ROLES (operational, SHOWN);
 * WRITE = the class's own Form Master ONLY (FM-only, owner d) — `canWriteSession`. Everything DERIVES.
 *
 * INCR-42b lights the CONFIDENTIAL pastoral-flag callout (between the agenda and the foot-bar) for the two
 * gated viewers ONLY — own-class FM / Dean (`canAccessPastoralFlag`, NARROWER than the page). A non-gated
 * viewer (HM / ADMIN / other-class FM) gets a register byte-identical to 42a: the reader is never called and
 * the callout + gated lede clause + gated foot-stat are absent (no "flag exists" leak). The reflection meter,
 * PG points, and the INCR-43 case-note/queue/escalate buttons stay omitted-not-faked.
 */
export default async function VlcSessionRegisterPage({
  params,
}: {
  params: Promise<{ classId: string; date: string }>;
}) {
  const { classId, date } = await params;
  if (!DATE.test(date)) notFound();

  const { school, user } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const view = await getVlcSession(school.id, classId, date);
  if (!view) notFound();

  const canWrite = canWriteSession({
    roles: user.roles,
    userId: user.id,
    classTeacherUserId: view.classTeacherUserId,
  });

  // 🔴 The CONFIDENTIAL pastoral gate — NARROWER than the page (own-class FM / Dean, owner b+c). A
  // non-gated viewer (HM / ADMIN / other-class FM / PG / parent) fails this, so the flag reader is NEVER
  // called and the callout + gated lede clause + gated foot-stat are ABSENT from their tree (no "flag
  // exists" leak) — their register stays byte-identical to 42a.
  const canSeeFlags =
    hasAnyRole(user.roles, VLC_PASTORAL_READ_ROLES) &&
    canAccessPastoralFlag({
      roles: user.roles,
      userId: user.id,
      classTeacherUserId: view.classTeacherUserId,
    });

  // ── not-yet-held: the register hasn't been opened for this class × date ──
  if (!view.held) {
    return (
      <div className="pb-20">
        <Crumb>VLC · Session register</Crumb>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {view.className} <em className="italic text-gold">· {view.dateLabel}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Not held yet
          </div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-navy-3">
            No VLC session has been recorded for this class on {view.dateLabel}. The whole class attends a
            single Wednesday session — {view.clock.totalMin} minutes across five phases.
          </p>
          <div className="mt-5">
            {canWrite ? (
              <OpenSessionForm classId={classId} date={date} templates={view.templates} />
            ) : (
              <p className="text-[13px] italic text-navy-3">
                Only the class Form Master can open this session.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { focus, clock, summary } = view;
  const canEdit = canWrite && !view.locked;

  // Fetch confidential flags ONLY past the gate — a non-gated viewer never fetches a row (defense in depth
  // over RLS). The own-class WHERE in the reader is the intra-tenant boundary.
  const flags = canSeeFlags
    ? await getPastoralFlags(school.id, { roles: user.roles, userId: user.id }, classId)
    : [];
  const showFlags = canSeeFlags && flags.length > 0;

  return (
    <div className="pb-24">
      {/* ── head-row ── */}
      <header className="mb-8">
        <Crumb>
          VLC{view.weekLabel ? ` · ${view.weekLabel}` : ""} · Value {focus.ordinal} {focus.nameEn} · Session{" "}
          {focus.slot}
        </Crumb>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {view.className} <em className="italic text-gold">· {view.dateLabel}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {summary.present} of {summary.enrolled} present · {clock.phasesComplete} of {clock.windows.length}{" "}
          phases complete
          {view.locked ? " · auto-locked" : ` · ${clock.remainingMin} min remaining`}
          {/* gated lede clause — present only for a gated viewer with ≥1 flag; absent (42a) otherwise */}
          {showFlags ? ` · ${flags.length} pastoral flag${flags.length > 1 ? "s" : ""} raised` : ""}.
          {canWrite && view.locked && (
            <span className="ml-1 italic text-navy-3">
              This session has auto-locked — the register is read-only.
            </span>
          )}
          {!canWrite && (
            <span className="ml-1 italic text-navy-3">You have read-only access to this surface.</span>
          )}
        </p>
      </header>

      {/* ── facilitator strip ── */}
      <section className="mb-8 rounded-2xl border border-border bg-bg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Facilitating today
            </span>
            {view.facilitators.length === 0 && (
              <span className="text-[12px] text-navy-3">Form Master not assigned</span>
            )}
            {view.facilitators.map((f, i) => {
              const ring =
                f.kind === "fm"
                  ? "border-gold bg-gold-bg"
                  : f.kind === "pg-boy"
                    ? "border-navy bg-surface"
                    : "border-terra bg-surface";
              return (
                <div
                  key={`${f.kind}-${i}`}
                  className={`flex items-center gap-2 rounded-pill border px-2.5 py-1.5 ${ring}`}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-navy font-display text-[11px] font-semibold text-bg">
                    {f.initials}
                  </span>
                  <span className="leading-tight">
                    <span className="block text-[12px] font-semibold text-navy">{f.name}</span>
                    <span className="block text-[10px] text-navy-3">{f.roleLabel}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <span className="text-[11px] text-navy-3">Whole class attends</span>
        </div>
      </section>

      {/* ── lifecycle bar (derived clock) ── */}
      <section className="mb-8">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          Session lifecycle · {clock.windows.length} phases · {clock.totalMin} min
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {clock.windows.map((w, i) => {
            const tone =
              w.state === "active"
                ? "border-l-gold bg-gold-bg"
                : w.state === "done"
                  ? "border-l-green bg-surface"
                  : "border-l-border-2 bg-surface";
            return (
              <div key={w.field} className={`rounded-lg border border-border border-l-[3px] p-3 ${tone}`}>
                <div className="font-display text-lg font-semibold italic text-gold">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="text-[12px] font-semibold text-navy">
                  {w.name}
                  {w.state === "active" && <span className="ml-1 text-[10px] text-gold">· LIVE</span>}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-navy-3">{w.windowLabel}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── focus banner (F0 value / template) — navy ground, SOLID text-gold-soft (no-alpha trap) ── */}
      <section className="mb-10 rounded-2xl border border-navy bg-navy p-6 text-bg">
        <div className="flex flex-wrap items-start gap-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-gold bg-gradient-to-b from-navy to-navy-2">
            <span className="font-display text-2xl font-semibold text-gold">
              {String(focus.ordinal).padStart(2, "0")}
            </span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-gold-soft">Value</span>
          </div>
          <div className="min-w-[240px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
              Today&rsquo;s value · {focus.slotLabel}
            </div>
            <h3 className="mt-1 font-display text-2xl font-semibold text-bg">
              {focus.nameEn}
              {focus.nameTwi ? <em className="italic text-gold"> · {focus.nameTwi}</em> : null} ·{" "}
              {focus.title}
            </h3>
            {focus.prompt && (
              <p className="mt-3 rounded-lg border border-gold-soft bg-navy-2 p-3 text-[13px] leading-relaxed text-gold-soft">
                <b className="font-semibold text-gold-soft">Today&rsquo;s question:</b>{" "}
                <em className="italic text-gold">&ldquo;{focus.prompt}&rdquo;</em>
                {focus.pairing ? <span className="text-gold-soft"> · {focus.pairing}</span> : null}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
              Time elapsed
            </div>
            <div className="mt-1 font-mono text-sm text-gold">
              {clock.elapsedMin} min · {clock.remainingMin} to go
            </div>
          </div>
        </div>
      </section>

      {/* ── small groups (derived, ephemeral — no project brief per R314) ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="Two PG-led conversations"
          meta="FM walks between · monitors energy · doesn't intervene unless asked"
        >
          Small groups <em className="italic text-gold">· two PG-led conversations</em>
        </SectionHead>
        {view.groups.length === 0 ? (
          <p className="text-[13px] text-navy-3">
            No Peer Guides are assigned to this class this semester — the class runs as a single group.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {view.groups.map((g) => (
              <div key={g.label} className="rounded-xl border border-border bg-surface p-4">
                <div
                  className={`inline-flex items-center gap-2 rounded-pill border px-2.5 py-1 ${
                    g.rep === "boy" ? "border-navy bg-bg" : "border-terra bg-bg"
                  }`}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-navy font-display text-[10px] font-semibold text-bg">
                    {g.leadInitials}
                  </span>
                  <span className="text-[12px] font-semibold text-navy">
                    {g.label} <em className="italic text-gold">· led by {g.leadName}</em>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
                  {g.members.map((m) => (
                    <span
                      key={m.studentId}
                      className={`text-[11px] ${
                        m.status === "absent"
                          ? "text-terra"
                          : m.status === "late"
                            ? "text-warn"
                            : "text-navy-3"
                      }`}
                    >
                      {m.name}
                      {m.status === "absent" ? " (absent)" : m.status === "late" ? " (late)" : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── attendance P/L/A grid (42a core) ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow={`Class attendance · ${summary.present} of ${summary.enrolled} present`}
          meta="PGs marked first (gold) · present-by-default · auto-locks at close"
        >
          Attendance <em className="italic text-gold">· P / L / A</em>
        </SectionHead>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <SessionAttendanceGrid sessionId={view.sessionId} cells={view.cells} canEdit={canEdit} />
        </div>
      </section>

      {/* ── agenda timeline (F0 phase copy; Reflection reworded, welfare clauses omitted) ── */}
      <section className="mb-10">
        <SectionHead eyebrow="Session agenda · running by phase" meta="Auto-advances by the phase clock">
          The <em className="italic text-gold">rhythm</em> · {clock.windows.length} phases ×{" "}
          {clock.totalMin} min
        </SectionHead>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {clock.windows.map((w, i) => {
            const what =
              w.field === "reflectionMin"
                ? `Silent reflection · students write privately · ${w.min} minutes`
                : w.description;
            const pill =
              w.state === "active"
                ? "bg-gold-bg text-gold"
                : w.state === "done"
                  ? "bg-green-bg text-green"
                  : "bg-bg text-navy-3";
            return (
              <div
                key={w.field}
                className="grid grid-cols-[64px_1fr_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[64px_120px_1fr_auto]"
              >
                <div className="font-mono text-[11px] text-navy-3">{w.windowLabel}</div>
                <div className="text-[12px] font-semibold text-navy">
                  {String(i + 1).padStart(2, "0")}. {w.name}
                </div>
                <div className="col-span-1 text-[12px] leading-snug text-navy-2 max-sm:col-span-3">
                  {what}
                </div>
                <span
                  className={`rounded-pill px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${pill}`}
                >
                  {w.state} · {w.min} min
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── pastoral flag callout (INCR-42b) — GATED: own-class FM / Dean ONLY. A non-gated viewer never
             reaches this branch (canSeeFlags false), so the callout is absent from their tree entirely. ── */}
      {canSeeFlags && (
        <PastoralFlagPanel
          flags={flags}
          roster={view.cells.map((c) => ({ studentId: c.studentId, name: c.name }))}
          sessionId={view.sessionId}
        />
      )}

      {/* ── foot-bar (persistent session stats — derived; navy ground, SOLID text-gold-soft) ── */}
      <section className="rounded-2xl border border-navy bg-navy p-5 text-bg">
        <div
          className={`grid grid-cols-1 gap-4 ${
            showFlags
              ? "sm:grid-cols-4 lg:grid-cols-[repeat(4,1fr)_auto]"
              : "sm:grid-cols-3 lg:grid-cols-[repeat(3,1fr)_auto]"
          }`}
        >
          <FootStat lab="Attendance" val={`${summary.present} / ${summary.enrolled}`}>
            {summary.presentPct}% present · {summary.late} late · {summary.absent} absent
          </FootStat>
          <FootStat lab="Phases complete" val={`${clock.phasesComplete} / ${clock.windows.length}`}>
            {clock.activeIndex >= 0
              ? `${clock.windows[clock.activeIndex].name} · ${clock.elapsedMin} min in`
              : view.locked
                ? "Session closed"
                : "Not started"}
          </FootStat>
          <FootStat lab="Time remaining" val={view.locked ? "closed" : `${clock.remainingMin} min`}>
            {view.locked ? `Auto-locked at ${clock.closeLabel}` : `Closes ${clock.closeLabel}`}
          </FootStat>
          {/* gated 4th stat — present only for a gated viewer with ≥1 flag; absent (3-stat 42a) otherwise */}
          {showFlags && (
            <FootStat lab="Pastoral flags" val={`${flags.length} raised`}>
              FM check-in queued · FM + Dean only
            </FootStat>
          )}
          <div className="flex items-end">
            <span className="rounded-md border border-gold px-3.5 py-2 text-xs font-bold text-gold">
              {view.locked ? `Locked · ${clock.closeLabel}` : `Auto-locks ${clock.closeLabel}`}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Crumb({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">{children}</div>
  );
}

function FootStat({ lab, val, children }: { lab: string; val: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft">{lab}</div>
      <div className="mt-1 font-display text-2xl font-semibold leading-none text-gold">{val}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-gold-soft">{children}</div>
    </div>
  );
}
