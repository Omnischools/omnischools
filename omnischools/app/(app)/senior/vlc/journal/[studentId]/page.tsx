import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_PASTORAL_READ_ROLES } from "@/lib/access";
import { canWritePastoralFlag } from "@/lib/vlc/authz";
import { getStudentCasework, type CaseworkStreamItem } from "@/lib/vlc/pastoral-data";
import { SectionHead, SumCard } from "@/components/vlc/chrome";
import { CaseworkComposer, CaseEditor } from "@/components/vlc/casework";

export const dynamic = "force-dynamic";

/**
 * 🔴 INCR-43a — `/senior/vlc/journal/[studentId]` — the CONFIDENTIAL per-student casework document (SHS
 * module 4.5). The WHOLE page is behind the pastoral gate (tighter than the shared register): READ =
 * WRITE = own-class FM + Dean of Students ONLY.
 *
 * Gate sequence: `requireSchoolRole(VLC_PASTORAL_READ_ROLES)` (ADMIN + HEADMASTER never reach the role
 * arm) → `getStudentCasework` resolves the student's class teacher and re-checks `canAccessPastoralFlag`
 * (own-class identity OR Dean); a non-gated viewer (other-class FM / PG / student / parent) gets `null`
 * → **`notFound()`** — nothing, no stub, no "a case exists" leak. Past the gate every metric DERIVES; the
 * write affordances re-check `canWritePastoralFlag` server-side on submit.
 *
 * OMIT-NOT-FAKE (INCR-43b + owner #6): NO character-paragraph card, NO "auto-drafted / auto-generated"
 * framing, NO student self-view, NO Peer-Guide UI, NO content analytics / engagement score. The page ends
 * at the four casework sections + their append / edit affordances.
 */
export default async function VlcJournalPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const { school, user } = await requireSchoolRole(VLC_PASTORAL_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  // The reader IS the gate + the sole content path: null = student not found OR the caller fails the
  // own-class fence. Either way the confidential page is `notFound()` (no existence leak).
  const view = await getStudentCasework(school.id, { roles: user.roles, userId: user.id }, studentId);
  if (!view) notFound();

  // Read gate === write gate, so anyone who reached this page can also write; still compute + re-check
  // it explicitly (the server actions re-check regardless — the action is the real boundary).
  const canWrite = canWritePastoralFlag({
    roles: user.roles,
    userId: user.id,
    classTeacherUserId: view.classTeacherUserId,
  });

  const { hero, metrics, timeline, activeCase, openableFlags, stream } = view;

  return (
    <div className="pb-24">
      <Link
        href="/senior/vlc/sessions"
        className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3 hover:text-navy"
      >
        ← VLC · Session register
      </Link>

      {/* ── student hero (confidential identity + case badge) — navy ground, SOLID text-gold-soft ── */}
      <section className="mt-2 rounded-2xl border border-navy bg-navy p-6 text-bg">
        <div className="flex flex-wrap items-start gap-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-gold bg-gradient-to-b from-navy to-navy-2 font-display text-2xl font-semibold text-gold">
            {hero.initials}
          </div>
          <div className="min-w-[240px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
              {hero.className ?? "—"}
              {hero.formLabel ? ` · ${hero.formLabel}` : ""}
            </div>
            <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-bg">
              {hero.fullName}
              {hero.age != null ? <em className="italic text-gold"> · age {hero.age}</em> : null}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gold-soft">
              {hero.fmName && <span>Form Master: {hero.fmName}</span>}
              {hero.houseName && <span>House: {hero.houseName}</span>}
              <span>
                Confidential · visible to the Form Master and Dean of Students only
              </span>
            </div>
          </div>
          {hero.hasActiveCase && (
            <div className="shrink-0 rounded-lg bg-terra px-3 py-2 text-right">
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-bg">
                Pastoral · active case
              </div>
              <div className="mt-0.5 text-[11px] text-bg">
                {metrics.notesOpen} open FM note{metrics.notesOpen === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── year overview strip — ALL DERIVED (counts + averages only; NO engagement/quality score) ── */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SumCard label="Sessions attended" big={`${metrics.sessionsAttended} / ${metrics.sessionsHeld}`}>
          {metrics.absences} absence{metrics.absences === 1 ? "" : "s"}
        </SumCard>
        <SumCard label="Reflections written" big={`${metrics.reflections}`}>
          Append-only · never edited
        </SumCard>
        <SumCard label="Avg reflection length" big={`${metrics.avgWords} words`}>
          Range {metrics.minWords}—{metrics.maxWords}
        </SumCard>
        <SumCard label="FM pastoral notes" big={`${metrics.notesOpen} open · ${metrics.notesTotal} total`} warn>
          Open derives from unresolved flags
        </SumCard>
        <SumCard label="PG observations" big={`${metrics.observations}`}>
          Recorded by the Form Master
        </SumCard>
      </section>

      {/* ── the session timeline (DERIVED from 42a sessions + 42b flags) ── */}
      <section className="mt-8">
        <SectionHead
          eyebrow={`${timeline.length} held session${timeline.length === 1 ? "" : "s"}`}
          meta="Attended · Late · Absent · Pastoral flag"
        >
          The <em className="italic text-gold">year</em> so far
        </SectionHead>
        {timeline.length === 0 ? (
          <p className="text-[13px] italic text-navy-3">No VLC sessions held for this class yet.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
            {timeline.map((c, i) => {
              const tone =
                c.state === "flag"
                  ? "border-l-terra bg-terra-bg text-terra"
                  : c.state === "absent"
                    ? "border-l-terra bg-surface text-terra"
                    : c.state === "late"
                      ? "border-l-warn bg-surface text-warn"
                      : "border-l-green bg-surface text-navy-3";
              return (
                <div
                  key={i}
                  className={`rounded-lg border border-border border-l-[3px] p-2 ${tone}`}
                  title={`${c.valueLabel} · ${c.dateLabel} · ${c.state}`}
                >
                  <div className="font-mono text-[11px] font-semibold text-navy">{c.valueLabel}</div>
                  <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.06em]">{c.state}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── the case-file summary — the terra confidential header (42b callout family) + edit affordance ── */}
      <section className="mt-8 rounded-2xl border-[1.5px] border-terra bg-terra-bg px-[22px] py-[18px]">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-terra">
          Pastoral context · FM-maintained · visible to FM + Dean only
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold text-navy">
            {activeCase ? <em className="italic text-terra">Active case</em> : "No case open"}
          </h2>
          <span className="rounded-full bg-terra px-[11px] py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-bg">
            FM + DEAN ONLY · NOT VISIBLE TO STUDENT, PARENT, OR PG
          </span>
        </div>
        {activeCase ? (
          <>
            <div className="mt-1 font-mono text-[11px] text-navy-3">
              Opened {activeCase.openedLabel} · last revised {activeCase.revisedLabel}
              {activeCase.revisedByName ? ` · ${activeCase.revisedByName}` : ""} · {metrics.notesTotal} note
              {metrics.notesTotal === 1 ? "" : "s"} · {metrics.notesOpen} open
            </div>
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-navy-2">
              {activeCase.summary}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[13px] italic text-navy-3">
            {openableFlags.length
              ? "No running summary yet. Open a case against a flag to start one."
              : "No pastoral flag on this student — a case is opened from a flag."}
          </p>
        )}
        {canWrite && <CaseEditor activeCase={activeCase} openableFlags={openableFlags} />}
      </section>

      {/* ── the journal stream (entries + FM notes + PG observations, newest-first, append-only chrome) ── */}
      <section className="mt-8">
        <SectionHead
          eyebrow={`${stream.length} entr${stream.length === 1 ? "y" : "ies"} · append-only`}
          meta="Newest first · entries cannot be edited or deleted · the FM may add notes alongside"
        >
          The <em className="italic text-gold">journal</em>
        </SectionHead>

        {canWrite && <CaseworkComposer studentId={view.studentId} />}

        {stream.length === 0 ? (
          <p className="text-[13px] italic text-navy-3">No casework recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {stream.map((item) => (
              <StreamCard key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One item in the reverse-chron stream — entry / note / observation. All append-only: no edit/delete. */
function StreamCard({ item }: { item: CaseworkStreamItem }) {
  if (item.kind === "note") {
    return (
      <div className="rounded-xl border-[1.5px] border-gold-soft border-l-[3px] border-l-gold bg-gold-bg px-[22px] py-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold">
            FM pastoral note{item.author ? ` · ${item.author}` : ""}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gold px-[10px] py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-navy">
              FM + DEAN
            </span>
            <span className="font-mono text-[11px] text-navy-3">
              {item.dateLabel} · {item.timeLabel}
            </span>
          </div>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-navy-2">{item.body}</p>
      </div>
    );
  }

  if (item.kind === "observation") {
    return (
      <div className="rounded-xl border border-border border-l-[3px] border-l-navy-3 bg-bg px-[22px] py-[18px]">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy font-display text-[11px] font-semibold text-gold">
            {(item.observedBy ?? "PG").slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1">
            <div className="text-[11px] font-bold text-navy">{item.observedBy}</div>
            <div className="text-[10px] text-navy-3">Peer Guide observation · recorded by the FM</div>
          </div>
          <span className="font-mono text-[11px] text-navy-3">
            {item.dateLabel} · {item.timeLabel}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[11px] italic leading-relaxed text-navy-2">{item.body}</p>
      </div>
    );
  }

  // entry — the reflection stream; Fraunces (font-display) body, the one place the student's voice renders.
  return (
    <div className="rounded-xl border border-border border-l-[3px] border-l-terra bg-surface px-[22px] py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-terra">
          Reflection{item.valueLabel ? ` · ${item.valueLabel}` : ""}
        </div>
        <span className="font-mono text-[11px] text-navy-3">
          {item.dateLabel} · {item.timeLabel}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap font-display text-[14px] leading-relaxed text-navy">
        {item.body}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="rounded-full bg-bg px-[10px] py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">
          Append-only · locked
        </span>
        <span className="font-mono text-[11px] text-navy-3">{item.wordCount} words</span>
      </div>
    </div>
  );
}
