import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { getDisciplineBoard, type DeboardCard, type BondCard, type LedgerGroup } from "@/lib/boarding/discipline-data";
import type { DeboardinizationRung, DeboardinizationSeverity } from "@/lib/boarding/deboardinization-ladder";
import { HeaderActions, BondSignButtons, DeboardActions } from "@/components/boarding/discipline-console";

export const dynamic = "force-dynamic";

// Per-rung chip colour + count label (surface 07 verbatim). Rung 5 uses the non-canonical terra-deep.
const RUNG_STYLE: Record<DeboardinizationSeverity, { chip: string; countLabel: string }> = {
  NOTE: { chip: "bg-navy-3 text-bg", countLabel: "Open" },
  WARNING: { chip: "bg-warn text-navy", countLabel: "Open" },
  BOND: { chip: "bg-gold text-navy", countLabel: "Active" },
  SUSPENSION: { chip: "bg-terra text-bg", countLabel: "In effect" },
  DEBOARDINIZATION: { chip: "bg-terra-deep text-bg", countLabel: "Active" },
};
const ROMAN = ["i", "ii", "iii", "iv", "v"];

export default async function BoardingDisciplinePage() {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const board = await getDisciplineBoard(school.id, roles, userId);

  return (
    <div className="mx-auto max-w-page pb-20">
      <div className="mb-5">
        <Link href="/senior/boarding" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy">
          ← Boarding · Houses
        </Link>
      </div>

      {/* Header */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">Boarding · Surface 07</div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Boarding <em className="italic text-gold">discipline</em> &amp; deboardinization.
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          The disciplinary ledger that sits alongside boarding operations. <b className="text-navy-2">Five rungs from
          informal note to deboardinization</b>, each with prescribed counter-actions, all signed by named staff, all
          append-only. Deboardinization — removal from the boarding roll — requires three co-signs and is reversible
          only by the Board. {school.name} · {board.periodLabel} · {board.todayLabel}.
        </p>
      </header>

      {!board.hasScope ? (
        <EmptyState title="No Houses you can open" body="You are not assigned as Housemaster to any House with boarders, or this school has no boarding Houses configured." />
      ) : (
        <>
          {/* Head row + actions */}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-bg px-5 py-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">Boarding · discipline &amp; deboardinization</div>
              <h2 className="mt-0.5 font-display text-2xl font-medium text-navy">
                Discipline <em className="italic text-gold">ledger</em> · {board.periodLabel}
              </h2>
              <div className="mt-1 max-w-2xl text-[13px] text-navy-3">
                {board.activeCount} open infraction{board.activeCount === 1 ? "" : "s"} across your Houses; {board.summary.deboardinized} student
                {board.summary.deboardinized === 1 ? "" : "s"} currently off the boarding roll. Append-only — corrections supersede, nothing is deleted.
              </div>
            </div>
            <HeaderActions boarders={board.boarderOptions} />
          </div>

          {/* Summary strip — 4 derived + card-5 PENALTY = STUB display */}
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SumCard lab="Open this semester" big={String(board.summary.openThisSemester)} sub="Across your Houses · all severities" />
            <SumCard lab="Bonds active" big={String(board.summary.bondsActive)} sub="Signed and in force this semester" tone="warn" />
            <SumCard lab="Deboardinized" big={String(board.summary.deboardinized)} sub="Off the boarding roll · day status" tone="terra" />
            <SumCard lab="Co-signs pending" big={String(board.summary.coSignsPending)} sub="Bond + deboard signatures awaited" tone="gold" />
            {/* Featured navy PENALTY card — STUB. Alpha-on-hex trap: literal rgba, never slash-opacity a raw hex. */}
            <div className="rounded-xl border border-navy bg-navy p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[rgba(232,212,184,0.7)]">Penalty fees</div>
              <div className="mt-1 font-display text-[26px] font-semibold leading-none text-bg">
                <em className="not-italic text-gold">GHS</em> {board.summary.penaltyTotal.replace("GHS ", "")}
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-[rgba(232,212,184,0.6)]">
                {board.summary.penaltyCount} row{board.summary.penaltyCount === 1 ? "" : "s"} · <b className="text-gold">display only — billing not yet wired</b>
              </div>
            </div>
          </div>

          {/* The five-rung ladder — from the frozen getDeboardinizationLadder constant + derived count column */}
          <Section title="The five-rung" em="ladder" meta="SCHEMA-LOCKED · READ-ONLY · FROM THE FROZEN CONSTANT">
            <div className="overflow-hidden rounded-xl border border-border bg-bg">
              {board.ladder.map((rung, i) => (
                <LadderRow key={rung.stage} rung={rung} roman={ROMAN[i]} count={board.ladderCounts[rung.severity]} last={i === board.ladder.length - 1} />
              ))}
            </div>
            {board.escalation.message && (
              <div className="mt-3 rounded-lg border border-gold bg-gold-bg px-4 py-2.5 text-[12px] text-navy-2">
                <b className="text-navy">Auto-escalation prompt:</b> {board.escalation.message}. The HM logs the rung — nothing is auto-written.
              </div>
            )}
          </Section>

          {/* Active cases · grouped by severity (append-only) */}
          <Section title="Active cases ·" em="grouped by severity" meta={`${board.activeCount} ACTIVE · ${board.todayLabel}`}>
            {board.groups.length === 0 ? (
              <EmptyState title="No active cases" body="No open infractions in your Houses this semester." />
            ) : (
              <div className="flex flex-col gap-5">
                {board.groups.map((g) => (
                  <LedgerGroupView key={g.severity} g={g} />
                ))}
              </div>
            )}
          </Section>

          {/* Currently deboardinized */}
          {board.deboardCards.length > 0 && (
            <Section title="Currently" em="deboardinized" meta={`${board.summary.deboardinized} OFF ROLL · DRAFTS EXCLUDED FROM THE COUNT`}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {board.deboardCards.map((c) => (
                  <DeboardCardView key={c.recordId} c={c} canManageBoard={board.canManageBoard} />
                ))}
              </div>
            </Section>
          )}

          {/* Bond artefact(s) in flight — the signing room */}
          {board.bonds.length > 0 && (
            <Section title="Bond" em="artefact in flight" meta="SERIF STANDARD FORM · THREE INDEPENDENT SIGNATURE SLOTS">
              <div className="flex flex-col gap-4">
                {board.bonds.map((b) => (
                  <BondArtefactView key={b.bondId} b={b} />
                ))}
              </div>
            </Section>
          )}

          {/* Penalty invoices — STUB (billing not yet wired) */}
          <Section title="Penalty" em="invoices · cross-module to billing" meta="3× BOARDING FEE PER UNAUTHORISED DAY · DISPLAY ONLY">
            <div className="rounded-xl border border-warn bg-warn-bg px-4 py-2.5 text-[12px] text-navy-2">
              <b className="text-warn">Penalty pending — billing not yet wired.</b> The 3× figure is displayed from stored
              snapshots; no invoice is written and <span className="font-mono">fee_penalty_invoice_id</span> stays NULL (owner follow-up).
            </div>
            {board.penaltyRows.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
                <div className="grid grid-cols-[110px_180px_1fr_120px_150px_100px] gap-3 border-b border-border bg-bg px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                  <div>Invoice</div>
                  <div>Student</div>
                  <div>Calculation</div>
                  <div>Amount</div>
                  <div>Status</div>
                  <div />
                </div>
                {board.penaltyRows.map((p) => (
                  <div key={p.ref} className="grid grid-cols-[110px_180px_1fr_120px_150px_100px] items-center gap-3 border-b border-border px-4 py-3 text-[12px] last:border-b-0">
                    <div className="font-mono text-[11px] text-navy-2">{p.ref}</div>
                    <div>
                      <div className="font-semibold text-navy">{p.studentName}</div>
                      <div className="text-[10px] text-navy-3">{p.studentSub}</div>
                    </div>
                    <div className="text-[11px] leading-snug text-navy-3">{p.calcLine}</div>
                    <div className="font-display text-[16px] font-semibold text-navy">
                      <em className="text-[13px] not-italic text-gold">GHS</em> {p.amountLabel.replace("GHS ", "")}
                    </div>
                    <div>
                      <span className="rounded-pill bg-warn-bg px-2 py-0.5 text-[9px] font-bold uppercase text-warn">{p.statusLabel}</span>
                    </div>
                    {/* "View in billing" is inert (billing not yet wired). */}
                    <div className="text-right text-[10px] font-bold uppercase tracking-[0.06em] text-navy-3" title="Billing not yet wired (owner follow-up).">
                      ↳ View in billing
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Pastoral protection cross-reference — STUB, rendered only when a boarder is flagged */}
          {board.pastoral && (
            <Section title="Pastoral" em="protection · cross-reference" meta="FROM VLC · 1 STUDENT FLAGGED">
              <div className="flex items-start gap-4 rounded-xl border border-green bg-green-bg p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green font-display italic text-bg">§</div>
                <div>
                  <h4 className="font-display text-base font-semibold text-green">
                    {board.pastoral.studentName} · {board.pastoral.studentSub} · {board.pastoral.house} House
                  </h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-navy-2">
                    Active pastoral case with the Dean. <b className="text-navy">Any disciplinary action is routed to the Dean before
                    it reaches the ledger.</b> This student does not accumulate boarding-discipline points the way a peer would — the
                    ladder pauses where pastoral cases run.
                  </p>
                  <span className="mt-2 inline-block rounded-pill border border-green bg-surface px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-green">
                    ↳ Dean-routed (VLC 4.5 stub — no working pastoral system behind this yet)
                  </span>
                </div>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational
// ---------------------------------------------------------------------------

function LadderRow({ rung, roman, count, last }: { rung: DeboardinizationRung; roman: string; count: number; last: boolean }) {
  const style = RUNG_STYLE[rung.severity];
  return (
    <div className={`grid grid-cols-[64px_1fr_110px] items-stretch ${last ? "" : "border-b border-border"}`}>
      <div className={`flex items-center justify-center font-display text-xl font-medium italic ${style.chip}`}>{roman}</div>
      <div className="bg-surface px-5 py-3.5">
        <div className="font-display text-[15px] font-semibold text-navy">{rung.name}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-navy-3">{rung.description}</div>
        {rung.coSignCount > 0 && (
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.06em] text-gold">
            Co-sign × {rung.coSignCount} · {rung.coSignRoles.join(" + ")}
            {rung.severity === "BOND" ? " + student" : ""}
          </div>
        )}
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">{rung.penaltyLabel}</div>
      </div>
      <div className="flex flex-col items-center justify-center border-l border-border bg-surface">
        <div className="font-display text-2xl font-semibold text-navy">{count}</div>
        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">{style.countLabel}</div>
      </div>
    </div>
  );
}

function LedgerGroupView({ g }: { g: LedgerGroup }) {
  const badge =
    g.severity === "NOTE" ? "bg-navy-3 text-bg" : g.severity === "WARNING" ? "bg-warn text-navy" : g.severity === "BOND" ? "bg-gold text-navy" : "bg-terra text-bg";
  return (
    <div>
      <div className="flex items-center gap-3 rounded-t-lg border border-b-0 border-border bg-bg px-4 py-2.5">
        <span className={`rounded-pill px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${badge}`}>
          {g.roman} · {g.severity.charAt(0) + g.severity.slice(1).toLowerCase()}
        </span>
        <span className="font-display text-[15px] font-semibold text-navy">{g.rungName}</span>
        <span className="text-[11px] font-semibold text-navy-3">{g.shown} of {g.count} shown</span>
      </div>
      <div className="overflow-hidden rounded-b-lg border border-border">
        {g.rows.map((r) => (
          <div key={r.infractionId} className={`grid grid-cols-[180px_100px_110px_1fr_120px] items-center gap-3 border-b border-border px-4 py-3 text-[13px] last:border-b-0 ${r.active ? "bg-gold-bg" : "bg-surface"}`}>
            <div>
              <div className="font-semibold text-navy">{r.studentName}{r.active ? " ★" : ""}</div>
              <div className="text-[11px] text-navy-3">{r.studentSub}</div>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">{r.house}</div>
            <div className="font-mono text-[11px] text-navy-2">{r.dateLabel}</div>
            <div className="text-[12px] leading-snug text-navy-2">{r.offence}</div>
            <div className="text-[11px] text-navy-3">{r.loggedBy}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeboardCardView({ c, canManageBoard }: { c: DeboardCard; canManageBoard: boolean }) {
  const signed = {
    hm: c.coSigns[0].signed,
    seniorHm: c.coSigns[1].signed,
    headmaster: c.coSigns[2].signed,
  };
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${c.status === "REVIEW" ? "border-2 border-terra shadow-[0_0_0_4px_var(--terra-bg)]" : c.status === "DRAFT" ? "border-warn" : "border-terra"}`}>
      <div className={`flex items-center justify-between px-4 py-2.5 text-bg ${c.status === "REVIEW" ? "bg-terra" : c.status === "DRAFT" ? "bg-warn" : "bg-terra-deep"}`}>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{c.statusLabel}</span>
        <span className="font-mono text-[10px] opacity-80">{c.ref}</span>
      </div>
      <div className="p-4">
        <div className="font-display text-[19px] font-semibold text-navy">{c.studentName}</div>
        <div className="mt-0.5 text-[11px] text-navy-3">{c.studentSub}</div>
        <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-terra">{c.effectiveLabel}</div>
        <div className="mt-1.5 border-b border-border pb-3 text-[12px] leading-snug text-navy-2">{c.offence}</div>
        <div className="flex justify-between py-1 text-[11px]">
          <span className="text-navy-3">Days off roll</span>
          <span className="font-semibold text-navy-2">{c.daysOffRoll}</span>
        </div>
        <div className="flex justify-between py-1 text-[11px]">
          <span className="text-navy-3">Penalty invoice</span>
          <span className="font-semibold text-warn">{c.penaltyInvoiceLabel}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border pt-3">
          {c.coSigns.map((cs) => (
            <div key={cs.slot} className={`rounded border px-1 py-1.5 text-center text-[9px] ${cs.signed ? "border-green bg-green-bg" : "border-border bg-bg"}`}>
              <div className={`font-bold uppercase tracking-[0.1em] ${cs.signed ? "text-green" : "text-navy-3"}`}>{cs.roleLabel}</div>
              <div className="mt-0.5 text-[10px] font-semibold text-navy-2">{cs.signed ? cs.name : "pending"}</div>
            </div>
          ))}
        </div>
        {c.review && (
          <div className="mt-3 rounded-md border border-terra bg-terra-bg px-3 py-2.5 text-[11px] leading-snug text-terra-deep">
            <b>{c.review.label}</b> · {c.review.motion}
          </div>
        )}
        <DeboardActions recordId={c.recordId} status={c.status} signed={signed} canManageBoard={canManageBoard} />
      </div>
    </div>
  );
}

function BondArtefactView({ b }: { b: BondCard }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gold bg-surface">
      <div className="flex items-center justify-between border-b border-gold bg-gold-bg px-5 py-3.5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-display text-lg font-semibold italic text-navy">B</div>
          <div>
            <div className="font-display text-[17px] font-semibold text-navy">Bond of good behaviour</div>
            <div className="mt-0.5 text-[11px] text-navy-3">{b.ref} · {b.studentName} · {b.house} House</div>
          </div>
        </div>
        <span className="rounded-pill bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-navy">{b.statusLabel}</span>
      </div>
      <div className="grid grid-cols-1 gap-8 p-6 lg:grid-cols-[1fr_300px]">
        <div className="font-display text-[14px] leading-relaxed text-navy-2">
          <div className="mb-3.5 font-display text-[11px] font-semibold uppercase italic tracking-[0.16em] text-gold">— Bond text (standard form) —</div>
          <p>
            I, <b className="text-navy">{b.studentName}</b>, {b.bondText}
          </p>
          <p className="mt-3.5 border-t border-dashed border-border pt-3.5 font-sans text-[11px] leading-relaxed text-navy-3">
            <b className="text-navy">Note · pastoral cross-reference clear.</b> No active pastoral case on this student record.
            Bond proceeds at standard escalation. Filed under {b.house} House · {b.ref}.
          </p>
        </div>
        <div>
          <div className="flex flex-col gap-3">
            {b.slots.map((s, i) => (
              <div key={i} className={`rounded-md border px-3 py-2.5 ${s.signed ? "border-green bg-green-bg" : "border-border bg-bg"}`}>
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{s.roleLabel}</div>
                <div className="mt-0.5 text-[12px] font-semibold text-navy-2">{s.name}</div>
                <div className={`mt-2 border-b pb-1 text-[10px] font-semibold uppercase italic tracking-[0.08em] ${s.signed ? "border-green text-green" : "border-navy-3 text-navy-3"}`}>
                  {s.signed ? `signed ${s.whenLabel ?? ""}` : "awaiting signature"}
                </div>
              </div>
            ))}
          </div>
          <BondSignButtons bondId={b.bondId} signed={{ student: b.slots[0].signed, hm: b.slots[1].signed, seniorHm: b.slots[2].signed }} />
        </div>
      </div>
    </div>
  );
}

function SumCard({ lab, big, sub, tone }: { lab: string; big: string; sub: string; tone?: "warn" | "terra" | "gold" }) {
  const border = tone === "warn" ? "border-warn bg-warn-bg" : tone === "terra" ? "border-terra bg-terra-bg" : tone === "gold" ? "border-gold bg-gold-bg" : "border-border bg-surface";
  const labColor = tone === "warn" ? "text-warn" : tone === "terra" ? "text-terra" : tone === "gold" ? "text-gold" : "text-navy-3";
  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${labColor}`}>{lab}</div>
      <div className="mt-1 font-display text-[26px] font-semibold leading-none text-navy">{big}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-navy-3">{sub}</div>
    </div>
  );
}

function Section({ title, em, meta, children }: { title: string; em: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <h3 className="font-display text-xl font-semibold text-navy">
          {title} <em className="italic text-gold">{em}</em>
        </h3>
        {meta && <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-navy-3">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-navy-3">{body}</p>
    </div>
  );
}
