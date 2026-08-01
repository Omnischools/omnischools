"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import {
  assignPtaOfficer,
  editPtaOfficer,
  endPtaOfficer,
  searchPtaOfficerCandidates,
  type OfficerCandidate,
} from "@/lib/actions/pta-officers";
import type { AssignablePta } from "@/lib/pta/officers-data";
import type { OfficeRow, OfficersMatrix, PtaCard } from "@/lib/pta/officers";
import { fieldClass } from "./shared";

/**
 * The PTA officer matrix (SHS module 4.7 / INCR-51, surface 02). The client shell: the multi-hat
 * spotlight (omitted when nobody holds ≥2 offices), the General PTA card (elected roles + the appended
 * ex-officio Headmaster), the House + Form tier sections (collapsible instances), the informational
 * Emergency card, and the assign / edit / end dialogs. All data arrives pre-formatted from the server;
 * every mutation routes through a tenant-scoped, audited, admin-gated server action.
 *
 * No-alpha discipline ([[no-alpha-token-opacity]]): every tint is a SOLID brand token or a `-bg` tint;
 * no slash-opacity on a raw-hex token. Vacancies are derived red (terra); ex-officio rows are read-only.
 */

// The assignment-basis select: 3 human labels → 2 stored values (R423).
const BASIS_OPTIONS = [
  { label: "Elected at PTA meeting (default)", value: "ELECTED" as const },
  { label: "Appointed — Form Master / interim", value: "APPOINTED" as const },
  { label: "Appointed — General PTA Chair (rare)", value: "APPOINTED" as const },
];

type AssignPrefill = { ptaId: string; label: string; offices: string[]; office?: string };

export function OfficerMatrix({
  matrix,
  assignablePtas,
}: {
  matrix: OfficersMatrix;
  assignablePtas: AssignablePta[];
}) {
  const [assign, setAssign] = useState<AssignPrefill | null>(null);
  const [ending, setEnding] = useState<{ officerId: string; office: string; holder: string } | null>(null);
  const [editing, setEditing] = useState<{ officerId: string; row: OfficeRow } | null>(null);

  const openAssign = (card: PtaCard, office?: string) =>
    setAssign({ ptaId: card.id, label: card.label, offices: card.assignableOffices, office });

  return (
    <div className="pb-20">
      {/* ── Hero ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          PTA · Officers
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-medium leading-tight text-navy">
              Officer <em className="italic text-gold">assignments</em>
            </h1>
            <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
            <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
              Every role at every tier — who holds it, since when, until when.{" "}
              <b className="font-semibold text-navy-2">Vacancies are red.</b> Terms ending within 30 days
              are flagged. Teacher ex-officio roles (Headmaster on the General PTA, the Form Master /
              Housemaster as Secretary) are auto-populated and read-only.
            </p>
          </div>
          {assignablePtas.length > 0 && (
            <button
              onClick={() => {
                const first = assignablePtas[0];
                setAssign({ ptaId: first.id, label: first.label, offices: first.offices });
              }}
              className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-bg hover:bg-navy-deep"
            >
              + Assign officer
            </button>
          )}
        </div>
      </header>

      {/* ── Multi-hat spotlight (omitted entirely when nobody holds ≥2 offices) ── */}
      {matrix.multiHat.length > 0 && <MultiHatCard matrix={matrix} />}

      {/* ── General PTA ── */}
      {matrix.general && (
        <GeneralCard
          card={matrix.general}
          onAssign={(office) => openAssign(matrix.general!, office)}
          onEnd={(row) => setEnding({ officerId: row.officerId!, office: row.office, holder: row.holderName ?? "" })}
          onEdit={(row) => setEditing({ officerId: row.officerId!, row })}
        />
      )}

      {/* ── House PTAs ── */}
      {matrix.houses.length > 0 && (
        <TierSection
          title="House PTA officers"
          initials="HP"
          accent="gold"
          totals={matrix.totals.houses}
          cards={matrix.houses}
          onAssign={openAssign}
          onEnd={(row) => setEnding({ officerId: row.officerId!, office: row.office, holder: row.holderName ?? "" })}
          onEdit={(row) => setEditing({ officerId: row.officerId!, row })}
        />
      )}

      {/* ── Form PTAs ── */}
      {matrix.forms.length > 0 && (
        <TierSection
          title="Form PTA officers"
          initials="FP"
          accent="navy"
          totals={matrix.totals.forms}
          cards={matrix.forms}
          onAssign={openAssign}
          onEnd={(row) => setEnding({ officerId: row.officerId!, office: row.office, holder: row.holderName ?? "" })}
          onEdit={(row) => setEditing({ officerId: row.officerId!, row })}
        />
      )}

      {matrix.general === null && matrix.houses.length === 0 && matrix.forms.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface px-7 py-8 text-center text-sm text-navy-3">
          No active PTAs yet. Configure the tiers and run <b className="text-navy-2">Generate</b> on the
          Setup tab, then assign officers here.
        </div>
      )}

      {/* ── Emergency (informational only — no standing officers, R414) ── */}
      <EmergencyCard />

      {/* ── Dialogs ── */}
      {assign && (
        <AssignDrawer
          prefill={assign}
          assignablePtas={assignablePtas}
          onClose={() => setAssign(null)}
        />
      )}
      {ending && <EndDialog {...ending} onClose={() => setEnding(null)} />}
      {editing && <EditDialog officerId={editing.officerId} row={editing.row} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Multi-hat spotlight ─────────────────────────────────────────────────────────────────────────
function MultiHatCard({ matrix }: { matrix: OfficersMatrix }) {
  const person = matrix.multiHat[0];
  const initials = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <div className="mb-8 grid grid-cols-[auto_1fr] items-center gap-6 rounded-2xl border border-gold-soft bg-gold-bg px-7 py-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold font-display text-2xl font-bold text-navy">
          {initials || "—"}
        </div>
        <div className="text-center font-display text-[13px] font-semibold leading-tight text-navy">
          {person.name}
          <span className="mt-0.5 block font-sans text-[10px] font-medium text-navy-3">
            {person.personType} · {person.hats.length} active PTA roles
          </span>
        </div>
      </div>
      <div>
        <h4 className="mb-2.5 font-display text-lg font-medium text-navy">
          One person, <em className="italic text-gold">{person.hats.length} concurrent roles</em>
        </h4>
        <div className="mb-2.5 flex flex-wrap gap-2.5">
          {person.hats.map((h, i) => (
            <span
              key={i}
              className="rounded-pill border border-gold-soft bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy-2"
            >
              {h.label}
            </span>
          ))}
        </div>
        <p className="text-[12px] italic leading-relaxed text-navy-2">
          Concurrent assignments across tiers, all tracked — no double-counting on attendance registers.
          {matrix.multiHat.length > 1 && (
            <b className="not-italic text-navy"> +{matrix.multiHat.length - 1} more multi-hat officer(s).</b>
          )}
        </p>
      </div>
    </div>
  );
}

// ── General PTA card ────────────────────────────────────────────────────────────────────────────
function GeneralCard({
  card,
  onAssign,
  onEnd,
  onEdit,
}: {
  card: PtaCard;
  onAssign: (office: string) => void;
  onEnd: (row: OfficeRow) => void;
  onEdit: (row: OfficeRow) => void;
}) {
  return (
    <div className="mb-7 overflow-hidden rounded-2xl border-[1.5px] border-green bg-surface">
      <div className="flex items-center gap-4 border-b border-green bg-green-bg px-6 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green font-display text-lg font-bold text-bg">
          GP
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold text-navy">
            General PTA <em className="italic text-green">Executive</em>
          </h3>
          <div className="text-[12px] text-navy-2">
            <b className="font-bold text-navy">{card.total}</b> elected roles · Headmaster ex-officio ·{" "}
            <b className="font-bold text-navy">
              {card.filled}/{card.total} filled
            </b>
          </div>
        </div>
      </div>
      <div className="divide-y divide-border">
        {card.rows.map((row, i) => (
          <OfficeRowLine key={`${row.office}-${i}`} row={row} badge={i + 1} onAssign={onAssign} onEnd={onEnd} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

// ── Tier section (House / Form) ───────────────────────────────────────────────────────────────────
function TierSection({
  title,
  initials,
  accent,
  totals,
  cards,
  onAssign,
  onEnd,
  onEdit,
}: {
  title: string;
  initials: string;
  accent: "gold" | "navy";
  totals: { filled: number; total: number };
  cards: PtaCard[];
  onAssign: (card: PtaCard, office?: string) => void;
  onEnd: (row: OfficeRow) => void;
  onEdit: (row: OfficeRow) => void;
}) {
  const iconClass = accent === "gold" ? "bg-gold text-navy" : "bg-navy text-bg";
  const headBg = accent === "gold" ? "bg-gold-bg" : "bg-bg";
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border-[1.5px] border-border bg-surface">
      <div className={cn("flex items-center gap-4 border-b border-border px-6 py-4", headBg)}>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl font-display text-base font-bold", iconClass)}>
          {initials}
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-navy">{title}</h3>
          <div className="text-[11px] text-navy-3">
            {cards.length} PTA{cards.length === 1 ? "" : "s"} · Secretary is ex-officio (Form Master /
            Housemaster)
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-display text-lg font-semibold text-navy">
            <em className="italic text-gold">{totals.filled}</em> / {totals.total} filled
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
            {totals.total - totals.filled} vacan{totals.total - totals.filled === 1 ? "cy" : "cies"}
          </div>
        </div>
      </div>
      <div className="divide-y divide-border">
        {cards.map((card) => (
          <InstanceRow key={card.id} card={card} onAssign={onAssign} onEnd={onEnd} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

function InstanceRow({
  card,
  onAssign,
  onEnd,
  onEdit,
}: {
  card: PtaCard;
  onAssign: (card: PtaCard, office?: string) => void;
  onEnd: (row: OfficeRow) => void;
  onEdit: (row: OfficeRow) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[minmax(160px,220px)_1fr_auto] items-center gap-4 px-6 py-3.5 text-left hover:bg-bg"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 font-display text-[14px] font-semibold text-navy">
          {card.label}
          {card.scopeBadge && (
            <span className="rounded-pill border border-border bg-bg px-2 py-0.5 text-[9px] font-bold tracking-[0.04em] text-navy-3">
              {card.scopeBadge}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {card.rows.map((row, i) => (
            <MiniChip key={`${row.office}-${i}`} row={row} />
          ))}
        </div>
        <span className={cn("text-lg text-navy-3 transition-transform", open && "rotate-90")}>›</span>
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border bg-bg/40">
          {card.rows.map((row, i) => (
            <OfficeRowLine
              key={`${row.office}-${i}`}
              row={row}
              onAssign={(office) => onAssign(card, office)}
              onEnd={onEnd}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MiniChip({ row }: { row: OfficeRow }) {
  const vacant = row.kind === "VACANT" || row.kind === "EX_OFFICIO_VACANT";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px]",
        vacant ? "border-terra bg-terra-bg text-terra" : "border-border bg-bg text-navy",
      )}
    >
      <span className={cn("text-[9px] font-bold uppercase tracking-[0.06em]", vacant ? "text-terra" : "text-navy-3")}>
        {row.office}
      </span>
      <span className={cn("font-semibold", vacant && "italic")}>
        {vacant ? "vacant" : row.holderName}
        {row.kind === "EX_OFFICIO" && " · ex-officio"}
      </span>
    </span>
  );
}

// ── One office line (in a card body) ──────────────────────────────────────────────────────────────
function OfficeRowLine({
  row,
  badge,
  onAssign,
  onEnd,
  onEdit,
}: {
  row: OfficeRow;
  badge?: number;
  onAssign: (office: string) => void;
  onEnd: (row: OfficeRow) => void;
  onEdit: (row: OfficeRow) => void;
}) {
  const vacant = row.kind === "VACANT";
  const exVacant = row.kind === "EX_OFFICIO_VACANT" || (row.kind === "APPENDED_EX" && !row.holderName);
  const exOfficio = row.kind === "EX_OFFICIO" || row.kind === "APPENDED_EX";
  return (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-4 px-6 py-3.5", vacant && "bg-terra-bg")}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[12px] font-bold",
            exOfficio ? "bg-gold text-navy" : vacant ? "bg-terra text-bg" : "bg-green text-bg",
          )}
        >
          {exOfficio ? "EX" : (badge ?? "•")}
        </div>
        <div className="min-w-0">
          <div className="font-display text-[14px] font-semibold text-navy">
            {row.office}
            {exOfficio && <em className="ml-1 not-italic text-[11px] italic text-gold">(ex-officio)</em>}
          </div>
          {vacant ? (
            <div className="text-[11px] italic text-terra">
              {row.vacantSince
                ? `Vacant since ${row.vacantSince}${row.vacantReason ? ` · ${row.vacantReason}` : ""}`
                : "Vacant — awaiting election"}
              {row.previousHolder && (
                <span className="not-italic text-navy-3"> · previously {row.previousHolder}</span>
              )}
            </div>
          ) : exVacant ? (
            <div className="text-[11px] italic text-navy-3">
              No {row.office === "Headmaster" ? "Headmaster in post" : "Form Master / Housemaster assigned"} —
              derives automatically once set.
            </div>
          ) : (
            <div className="text-[11px] text-navy-3">
              {row.holderName}
              {row.personType && (
                <span className="ml-1.5 rounded-pill bg-gold-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-gold">
                  {row.personType}
                </span>
              )}
              {row.otherHatCount > 0 && (
                <b className="ml-1.5 font-semibold text-navy-2"> +{row.otherHatCount} other PTA role{row.otherHatCount === 1 ? "" : "s"}</b>
              )}
              {row.termLabel && (
                <span className={cn("ml-1.5 font-mono", row.termEndingSoon ? "font-semibold text-warn" : "text-navy-3")}>
                  · {row.termLabel}
                  {row.termEndingSoon && " · ending <30d"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        {exOfficio || exVacant ? (
          <span className="text-[11px] italic text-navy-3">Read-only · derived</span>
        ) : vacant ? (
          <button
            onClick={() => onAssign(row.office)}
            className="rounded-md border-none bg-terra px-3 py-1.5 text-[11px] font-bold text-bg hover:opacity-90"
          >
            + Assign
          </button>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onEdit(row)}
              className="rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-navy-2 hover:bg-gold-bg"
            >
              Edit
            </button>
            <button
              onClick={() => onEnd(row)}
              className="rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-terra hover:bg-terra-bg"
            >
              End
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Emergency (informational only) ────────────────────────────────────────────────────────────────
function EmergencyCard() {
  return (
    <div className="mt-6 rounded-2xl border-[1.5px] border-terra bg-terra-bg px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-terra font-display text-base font-bold text-bg">
          EP
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-navy">
            Emergency PTA <em className="italic text-terra">· no standing officers</em>
          </h3>
          <div className="text-[11px] text-navy-3">On-demand tier · no elections</div>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-navy-2">
        <b className="font-semibold text-navy">Emergency PTAs don&apos;t have standing officers.</b> When
        convened, the General PTA Chair (or Headmaster) presides and the General PTA Secretary takes
        minutes — the executive is always the General PTA executive. The matrix tracks no separate
        Emergency-tier roles; the tier exists to track meetings and resolutions, not officers.
      </p>
    </div>
  );
}

// ── Assign drawer ─────────────────────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().slice(0, 10);

function addYears(iso: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[1]) + years}-${m[2]}-${m[3]}` : iso;
}

function AssignDrawer({
  prefill,
  assignablePtas,
  onClose,
}: {
  prefill: AssignPrefill;
  assignablePtas: AssignablePta[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const locked = !!prefill.office; // opened from a specific vacancy → PTA + office fixed
  const [ptaId, setPtaId] = useState(prefill.ptaId);
  const selectedPta = assignablePtas.find((p) => p.id === ptaId) ?? { id: prefill.ptaId, label: prefill.label, offices: prefill.offices, tierType: "GENERAL" as const };
  const [office, setOffice] = useState(prefill.office ?? prefill.offices[0] ?? "");

  const [basisIdx, setBasisIdx] = useState(0);
  const basis = BASIS_OPTIONS[basisIdx].value;
  const [termStart, setTermStart] = useState(todayISO());
  const [termEnd, setTermEnd] = useState(addYears(todayISO(), 2)); // manual override for APPOINTED
  const [electionRef, setElectionRef] = useState("");

  // person picker
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficerCandidate[]>([]);
  const [searching, startSearch] = useTransition();
  const [picked, setPicked] = useState<{ userId: string; name: string } | null>(null);
  const [external, setExternal] = useState(""); // free-text external holder
  const [useExternal, setUseExternal] = useState(false);

  function runSearch(q: string) {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) return setResults([]);
    startSearch(async () => setResults(await searchPtaOfficerCandidates({ ptaId, query: q })));
  }

  const holderReady = useExternal ? external.trim() !== "" : picked !== null;
  const ready = office !== "" && electionRef.trim() !== "" && holderReady && !pending;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await assignPtaOfficer({
        ptaId,
        office,
        personUserId: useExternal ? null : picked?.userId ?? null,
        externalName: useExternal ? external.trim() : null,
        assignmentBasis: basis,
        electionRef,
        termStart,
        termEnd: basis === "APPOINTED" ? termEnd : null,
      });
      if (!res.ok) return setError(res.error ?? "Could not assign the officer.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Assign · ${selectedPta.label}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DrawerField label="PTA">
            {locked ? (
              <input className={cn(fieldClass, "w-full")} value={selectedPta.label} disabled />
            ) : (
              <select
                className={cn(fieldClass, "w-full")}
                value={ptaId}
                onChange={(e) => {
                  setPtaId(e.target.value);
                  const p = assignablePtas.find((x) => x.id === e.target.value);
                  setOffice(p?.offices[0] ?? "");
                }}
              >
                {assignablePtas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </DrawerField>
          <DrawerField label="Office">
            {locked ? (
              <input className={cn(fieldClass, "w-full")} value={office} disabled />
            ) : (
              <select className={cn(fieldClass, "w-full")} value={office} onChange={(e) => setOffice(e.target.value)}>
                {selectedPta.offices.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
          </DrawerField>
        </div>

        {/* Person picker */}
        <DrawerField label={useExternal ? "External holder (free text)" : "Search parent or staff"}>
          {useExternal ? (
            <input
              className={cn(fieldClass, "w-full")}
              value={external}
              placeholder="e.g. Mr Kofi Annan · BOG member"
              onChange={(e) => setExternal(e.target.value)}
            />
          ) : (
            <>
              <input
                className={cn(fieldClass, "w-full")}
                value={query}
                placeholder="Type a name (parents of this PTA's scope first, then staff)"
                onChange={(e) => runSearch(e.target.value)}
              />
              {searching && <p className="mt-1 text-[11px] italic text-navy-3">Searching…</p>}
              {results.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {results.map((c) => (
                    <button
                      key={c.userId}
                      onClick={() => setPicked({ userId: c.userId, name: c.name })}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left",
                        picked?.userId === c.userId ? "border-gold bg-gold-bg" : "border-border bg-bg hover:bg-gold-bg",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-navy">{c.name}</div>
                        <div className="text-[11px] text-navy-3">
                          {c.context}
                          {c.existingHats > 0 && (
                            <span className="ml-1.5 italic text-gold">· already holds {c.existingHats} PTA role{c.existingHats === 1 ? "" : "s"}</span>
                          )}
                        </div>
                      </div>
                      {picked?.userId === c.userId && <span className="text-[11px] font-bold text-gold">✓</span>}
                    </button>
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="mt-1 text-[11px] italic text-navy-3">No matches. Use an external name instead.</p>
              )}
            </>
          )}
          <button
            onClick={() => {
              setUseExternal((v) => !v);
              setPicked(null);
              setExternal("");
            }}
            className="mt-2 text-[11px] font-semibold text-gold hover:underline"
          >
            {useExternal ? "← Search a parent or staff member instead" : "Holder isn't a parent/staff → enter an external name"}
          </button>
        </DrawerField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DrawerField label="Assignment basis">
            <select className={cn(fieldClass, "w-full")} value={basisIdx} onChange={(e) => setBasisIdx(Number(e.target.value))}>
              {BASIS_OPTIONS.map((o, i) => (
                <option key={i} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          </DrawerField>
          <DrawerField label="Term start">
            <input
              type="date"
              className={cn(fieldClass, "w-full")}
              value={termStart}
              onChange={(e) => {
                setTermStart(e.target.value);
                setTermEnd(addYears(e.target.value, 2));
              }}
            />
          </DrawerField>
        </div>

        <DrawerField
          label="Term end"
          hint={basis === "ELECTED" ? "Auto-set from the tier's configured term length on save" : "Manual override for interim appointments"}
        >
          {basis === "ELECTED" ? (
            // The stored term_end is derived server-side from the tier's configurable officer_term_years
            // (coalesce 2); don't preview a specific date here — it would drift for a school that changed it.
            <input className={cn(fieldClass, "w-full")} value="Auto-set from PTA config on save" disabled />
          ) : (
            <input type="date" className={cn(fieldClass, "w-full")} value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
          )}
        </DrawerField>

        <DrawerField label="Election / appointment reference" hint="Mandatory — how this person got the role (audit)">
          <input
            className={cn(fieldClass, "w-full")}
            value={electionRef}
            placeholder="e.g. Form PTA meeting · 14 May 2026 · minute 3.2"
            onChange={(e) => setElectionRef(e.target.value)}
          />
        </DrawerField>

        <p className="text-[11px] italic text-navy-3">
          Audit-logged. SMS notification to the officer is deferred until messaging is provisioned.
        </p>

        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy-2 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!ready} className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-bg hover:bg-navy-deep disabled:opacity-50">
            {pending ? "Assigning…" : "Assign officer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── End dialog ────────────────────────────────────────────────────────────────────────────────────
function EndDialog({
  officerId,
  office,
  holder,
  onClose,
}: {
  officerId: string;
  office: string;
  holder: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await endPtaOfficer({ officerId, endReason: reason });
      if (!res.ok) return setError(res.error ?? "Could not end the appointment.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={`End · ${office}`}>
      <div className="space-y-4">
        <p className="text-[13px] text-navy-2">
          End <b className="font-semibold text-navy">{holder}</b>&apos;s term as {office}. The record is
          retained as history; the office becomes vacant.
        </p>
        <DrawerField label="Reason (mandatory)" hint="e.g. resigned · relocated · child completed school">
          <input className={cn(fieldClass, "w-full")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for ending the appointment" />
        </DrawerField>
        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy-2 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={pending || reason.trim() === ""} className="rounded-md bg-terra px-4 py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-50">
            {pending ? "Ending…" : "End appointment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────────────────────────
function EditDialog({ officerId, row, onClose }: { officerId: string; row: OfficeRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState<"ELECTED" | "APPOINTED">(row.assignmentBasis ?? "ELECTED");
  const [termStart, setTermStart] = useState(row.termStartISO ?? todayISO());
  const [termEnd, setTermEnd] = useState(row.termEndISO ?? "");
  const [electionRef, setElectionRef] = useState(row.electionRef ?? "");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await editPtaOfficer({
        officerId,
        assignmentBasis: basis,
        electionRef,
        termStart,
        termEnd: termEnd || null,
      });
      if (!res.ok) return setError(res.error ?? "Could not save the changes.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Edit · ${row.office}`}>
      <div className="space-y-4">
        <p className="text-[13px] text-navy-2">
          Editing <b className="font-semibold text-navy">{row.holderName}</b>&apos;s term. To change the
          holder, end this appointment and assign a new one.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DrawerField label="Term start">
            <input type="date" className={cn(fieldClass, "w-full")} value={termStart} onChange={(e) => setTermStart(e.target.value)} />
          </DrawerField>
          <DrawerField label="Term end" hint="Blank = holdover until re-elected">
            <input type="date" className={cn(fieldClass, "w-full")} value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
          </DrawerField>
        </div>
        <DrawerField label="Assignment basis">
          <select className={cn(fieldClass, "w-full")} value={basis} onChange={(e) => setBasis(e.target.value as "ELECTED" | "APPOINTED")}>
            <option value="ELECTED">Elected</option>
            <option value="APPOINTED">Appointed</option>
          </select>
        </DrawerField>
        <DrawerField label="Election / appointment reference">
          <input className={cn(fieldClass, "w-full")} value={electionRef} onChange={(e) => setElectionRef(e.target.value)} />
        </DrawerField>
        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy-2 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={pending || electionRef.trim() === ""} className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-bg hover:bg-navy-deep disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DrawerField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11px] italic text-navy-3">{hint}</p>}
    </div>
  );
}
