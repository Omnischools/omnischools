"use client";
/**
 * PTA minutes drafting client editor (SHS module 4.7 / INCR-53) — the Secretary's structured-capture view,
 * the Chair's adopt block, and the read-only ADOPTED render, diverging by minute `status` + the viewer's
 * office. Ports the surface's drafting layout (preamble tape · classify-as-you-go agenda · action + resolution
 * sub-forms · validator side-panel · distribution card), reframed to MANUAL classification (R449 — NO NLP /
 * auto-extract) and with PDF preview / SMS / fee-category OMITTED (R458 / INCR-54).
 *
 * Every control is a convenience over the server gate: the actions re-check the Secretary/Chair identity, the
 * two clock gates and the 🔴 R451 immutability fence, so a disabled control is not the boundary. No-alpha token
 * care ([[no-alpha-token-opacity]]): the navy foot/adopt bars use text-gold-soft + bg-white/5 / border-white/10
 * (white is a real colour), never a slash-opacity on a raw-hex token.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  PtaMinutesView,
  MinutesAgendaItemView,
  MinutesActionView,
  MinutesResolutionView,
} from "@/lib/pta/minutes-data";
import {
  createDraftMinutes,
  saveAgendaItem,
  upsertActionItem,
  upsertResolution,
  submitForReview,
  returnToDraft,
  adoptMinutes,
  markDistributed,
} from "@/lib/actions/pta-minutes";

export interface OwnerOption {
  userId: string;
  name: string;
  roleLabel: string;
}

type Classification = "DISCUSSION" | "ACTION" | "RESOLUTION";

// ── status chrome ────────────────────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PtaMinutesView["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: "Draft", cls: "border-gold bg-gold-bg text-gold" },
    CHAIR_REVIEW: { label: "With the Chair", cls: "border-navy bg-bg text-navy" },
    ADOPTED: { label: "Adopted · locked", cls: "border-green bg-green-bg text-green" },
  };
  const s = map[status ?? "DRAFT"] ?? map.DRAFT;
  return (
    <span className={`rounded-pill border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ── the entry point ──────────────────────────────────────────────────────────────────────────────────

export function MinutesDraft({ view, ownerOptions }: { view: PtaMinutesView; ownerOptions: OwnerOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (pending) return;
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };

  const { preamble, status } = view;
  const editable = status === "DRAFT" && view.canDraft;
  const adopted = status === "ADOPTED";

  // ── no draft yet — the dual-purpose route's start state ──
  if (view.minutesId === null) {
    return (
      <div className="pb-24">
        <MinutesHeader view={view} />
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          {!view.meetingEnded ? (
            <p className="text-[14px] italic text-navy-3">
              Minutes open once the meeting has ended. Come back after {preamble.timeLabel.split("—")[1]?.trim() || "the close"}.
            </p>
          ) : !view.canDraft ? (
            <p className="text-[14px] italic text-navy-3">
              Only the PTA&rsquo;s Secretary (or an admin) can draft these minutes.
            </p>
          ) : (
            <>
              <h3 className="font-display text-xl font-semibold text-navy">Start the minutes</h3>
              <p className="mx-auto mt-2 max-w-md text-[13px] text-navy-3">
                We&rsquo;ll seed one entry per agenda item from the register. You classify each as a discussion,
                an action, or a resolution by hand — the structure does the rest.
              </p>
              <button
                type="button"
                onClick={() => run(() => createDraftMinutes({ meetingId: view.meetingId }))}
                disabled={pending}
                className="mt-5 rounded-md border border-navy bg-navy px-5 py-2.5 text-[13px] font-bold text-bg hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Starting…" : "Start drafting"}
              </button>
            </>
          )}
          {error && <p className="mt-3 text-[12px] text-terra">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <MinutesHeader view={view} />

      {adopted && (
        <div className="mb-6 rounded-2xl border border-green bg-green-bg p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-green">Adopted · immutable</div>
          <p className="mt-1 text-[13px] text-navy-2">
            These minutes were adopted{view.adoptedByName ? ` by ${view.adoptedByName}` : ""}
            {view.adoptedAt ? ` on ${new Date(view.adoptedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : ""}.
            They are now a permanent record — <b className="font-semibold text-navy">corrections happen only by a future amending minute</b>, never by editing this one.
          </p>
        </div>
      )}

      {view.belowQuorum && !adopted && (
        <div className="mb-6 rounded-2xl border border-warn bg-warn-bg p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-warn">Below quorum</div>
          <p className="mt-1 text-[13px] text-navy-2">
            The Secretary hasn&rsquo;t recorded quorum as <em className="not-italic text-warn">met</em> on the register.
            Discussion and action items still minute normally, but <b className="font-semibold text-navy">resolutions are
            disabled</b> until quorum is confirmed.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        {/* main column */}
        <div className="space-y-5">
          <Preamble view={view} />

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-end justify-between border-b border-border pb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Classify each item · by hand</div>
                <h3 className="font-display text-lg font-semibold text-navy">Agenda, item by item</h3>
              </div>
              <span className="text-[11px] font-semibold text-navy-3">
                {view.validator.classifiedCount} / {view.validator.totalItems} classified
              </span>
            </div>
            {view.agendaItems.length === 0 ? (
              <p className="text-[13px] italic text-navy-3">No agenda items were seeded for this meeting.</p>
            ) : (
              <div className="space-y-3">
                {view.agendaItems.map((item) => (
                  <AgendaItemEditor
                    key={item.id}
                    item={item}
                    editable={editable}
                    belowQuorum={view.belowQuorum}
                    generalTier={view.tierType === "GENERAL"}
                    ownerOptions={ownerOptions}
                    pending={pending}
                    run={run}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* side column */}
        <div className="space-y-5">
          <ValidatorPanel view={view} />
          {adopted && <DistributionCard view={view} pending={pending} run={run} />}
        </div>
      </div>

      {error && <p className="mt-4 text-[12px] text-terra">{error}</p>}

      <FootBar view={view} pending={pending} run={run} />
    </div>
  );
}

// ── header ───────────────────────────────────────────────────────────────────────────────────────────

function MinutesHeader({ view }: { view: PtaMinutesView }) {
  const { preamble } = view;
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          <a href={`/senior/pta/meetings/${view.meetingId}`} className="hover:text-navy">PTA · Meetings</a> · {preamble.tierLabel} · Minutes
        </div>
        <StatusPill status={view.status} />
      </div>
      <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
        {preamble.label} <em className="italic text-gold">· {preamble.dateLabel}</em>
      </h1>
      <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
      <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
        {preamble.meetingType} · {preamble.timeLabel}
        {preamble.location ? ` · ${preamble.location}` : ""}. Classify each agenda item as a discussion, an action,
        or a resolution — actions get an owner, resolutions capture the vote.
      </p>
    </header>
  );
}

// ── preamble (read-only "Locked from register", R454) ────────────────────────────────────────────────

function TapeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-dashed border-border py-1.5 text-[13px] leading-relaxed text-navy-2 last:border-b-0">
      <b className="font-semibold text-navy">{label}</b> {children}
    </div>
  );
}

function Preamble({ view }: { view: PtaMinutesView }) {
  const p = view.preamble;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Auto-filled from the register</div>
          <h3 className="font-display text-lg font-semibold text-navy">Preamble · who, when, where</h3>
        </div>
        <span className="rounded-pill bg-green-bg px-2.5 py-1 text-[10px] font-bold text-green">● Locked from register</span>
      </div>
      <TapeRow label="Meeting:">{p.label} · {p.meetingType}{p.periodLabel ? ` · ${p.periodLabel}` : ""}</TapeRow>
      <TapeRow label="Date:">{p.dateLabel} · {p.timeLabel}</TapeRow>
      {p.location && <TapeRow label="Venue:">{p.location}</TapeRow>}
      <TapeRow label="Chair:">{p.chairName ?? <span className="italic text-navy-3">not recorded</span>}</TapeRow>
      <TapeRow label="Secretary:">{p.secretaryName ?? <span className="italic text-navy-3">not recorded</span>}</TapeRow>
      <TapeRow label="Attendance:">
        {p.parentsPresent} parents present{p.parentsLate ? `, ${p.parentsLate} late` : ""} · {p.parentsAbsent} absent · {p.teacherPresent} of {p.teacherTotal} teachers present
      </TapeRow>
      <TapeRow label="Quorum:">
        {p.quorumMet === true ? (
          <em className="not-italic text-green">Met</em>
        ) : p.quorumMet === false ? (
          <em className="not-italic text-terra">Not met</em>
        ) : (
          <em className="not-italic text-navy-3">Not recorded</em>
        )}
        {p.quorumPct != null ? ` — ${p.quorumPct}% of parents present` : ""} · {p.quorumRule}
      </TapeRow>
    </div>
  );
}

// ── per-item editor ──────────────────────────────────────────────────────────────────────────────────

const CHIP_TONE: Record<Classification, string> = {
  DISCUSSION: "bg-navy text-bg border-navy",
  ACTION: "bg-warn text-bg border-warn",
  RESOLUTION: "bg-green text-bg border-green",
};

function AgendaItemEditor({
  item,
  editable,
  belowQuorum,
  generalTier,
  ownerOptions,
  pending,
  run,
}: {
  item: MinutesAgendaItemView;
  editable: boolean;
  belowQuorum: boolean;
  generalTier: boolean;
  ownerOptions: OwnerOption[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [narrative, setNarrative] = useState(item.narrative ?? "");
  const dirty = narrative.trim() !== (item.narrative ?? "").trim();

  const classify = (c: Classification) => {
    if (!editable) return;
    if (c === "RESOLUTION" && belowQuorum) return;
    if (item.classification === c) return;
    run(() => saveAgendaItem({ agendaItemId: item.id, classification: c }));
  };

  return (
    <div className={`rounded-xl border p-4 ${item.classification ? "border-border bg-bg" : "border-warn bg-warn-bg"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-navy text-[11px] font-bold text-bg">{item.seqNo}</span>
        <span className="font-display text-[15px] font-semibold text-navy">{item.title}</span>
        {!item.classification && <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.06em] text-warn">● Not yet classified</span>}
      </div>

      {editable ? (
        <textarea
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          onBlur={() => dirty && run(() => saveAgendaItem({ agendaItemId: item.id, narrative }))}
          placeholder="Type the minutes for this item…"
          className={`w-full resize-y rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed text-navy-2 ${narrative ? "border-border bg-surface" : "border-border bg-bg"}`}
          rows={3}
        />
      ) : (
        <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-navy-2">
          {item.narrative || <span className="italic text-navy-3">No narrative recorded.</span>}
        </p>
      )}

      {/* classify chips (single-select; RESOLUTION disabled below quorum) */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        {(["DISCUSSION", "ACTION", "RESOLUTION"] as const).map((c) => {
          const selected = item.classification === c;
          const disabled = !editable || (c === "RESOLUTION" && belowQuorum);
          return (
            <button
              key={c}
              type="button"
              onClick={() => classify(c)}
              disabled={disabled || pending}
              title={c === "RESOLUTION" && belowQuorum ? "Confirm quorum on the register to enable resolutions" : undefined}
              className={`rounded-pill border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${
                selected ? CHIP_TONE[c] : "border-border bg-surface text-navy-3"
              } ${disabled ? "cursor-not-allowed opacity-50" : "hover:brightness-95"}`}
            >
              {c}
            </button>
          );
        })}
      </div>

      {item.classification === "ACTION" && (
        <ActionForm item={item} action={item.action} editable={editable} ownerOptions={ownerOptions} pending={pending} run={run} />
      )}
      {item.classification === "RESOLUTION" && (
        <ResolutionForm item={item} resolution={item.resolution} editable={editable} generalTier={generalTier} pending={pending} run={run} />
      )}
    </div>
  );
}

// ── action sub-form (owner XOR external + deadline) ─────────────────────────────────────────────────

function ActionForm({
  item,
  action,
  editable,
  ownerOptions,
  pending,
  run,
}: {
  item: MinutesAgendaItemView;
  action: MinutesActionView | null;
  editable: boolean;
  ownerOptions: OwnerOption[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [desc, setDesc] = useState(action?.description ?? "");
  const [mode, setMode] = useState<"person" | "external">(action?.externalName ? "external" : "person");
  const [userId, setUserId] = useState(action?.ownerUserId ?? ownerOptions[0]?.userId ?? "");
  const [external, setExternal] = useState(action?.externalName ?? "");
  const [deadline, setDeadline] = useState(action?.deadlineISO ?? "");

  const save = () =>
    run(() =>
      upsertActionItem({
        agendaItemId: item.id,
        description: desc.trim(),
        personUserId: mode === "person" ? userId || null : null,
        externalName: mode === "external" ? external.trim() || null : null,
        deadline: deadline || null,
      }),
    );

  if (!editable) {
    return (
      <div className="mt-3 rounded-lg border-l-[3px] border-l-warn bg-surface px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-warn">Action item</div>
        {action ? (
          <div className="mt-1 text-[13px] text-navy-2">
            <b className="text-navy">{action.description}</b> — {action.ownerName ?? "unassigned"} · {action.deadlineLabel}
          </div>
        ) : (
          <div className="mt-1 text-[13px] italic text-navy-3">No action recorded yet.</div>
        )}
      </div>
    );
  }

  const canSave = desc.trim() && (mode === "person" ? !!userId : !!external.trim());

  return (
    <div className="mt-3 space-y-2 rounded-lg border-l-[3px] border-l-warn bg-surface p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-warn">Action · someone owns it</div>
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What is the action?"
        maxLength={2000}
        className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border-2 text-[11px] font-semibold">
          <button type="button" onClick={() => setMode("person")} className={`px-3 py-1.5 ${mode === "person" ? "bg-navy text-bg" : "bg-surface text-navy-3"}`}>In-app person</button>
          <button type="button" onClick={() => setMode("external")} className={`px-3 py-1.5 ${mode === "external" ? "bg-navy text-bg" : "bg-surface text-navy-3"}`}>External name</button>
        </div>
        {mode === "person" ? (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="min-w-[180px] flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy">
            {ownerOptions.length === 0 && <option value="">No staff found</option>}
            {ownerOptions.map((o) => (
              <option key={o.userId} value={o.userId}>{o.name} · {o.roleLabel}</option>
            ))}
          </select>
        ) : (
          <input value={external} onChange={(e) => setExternal(e.target.value)} placeholder="e.g. Mrs O. Sarpong (Treasurer)" maxLength={200} className="min-w-[180px] flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-navy-3">Deadline</label>
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="rounded-md border border-border-2 bg-bg px-3 py-1.5 text-[12px] text-navy" />
        <span className="text-[11px] italic text-navy-3">Leave blank for Ongoing (advisory).</span>
        <button
          type="button"
          onClick={save}
          disabled={pending || !canSave}
          className="ml-auto rounded-md border border-warn bg-warn px-4 py-1.5 text-[12px] font-bold text-bg disabled:opacity-50"
        >
          {action ? "Update action" : "Save action"}
        </button>
      </div>
    </div>
  );
}

// ── resolution sub-form (text + 3 votes + binding + live Result) ─────────────────────────────────────

function ResolutionForm({
  item,
  resolution,
  editable,
  generalTier,
  pending,
  run,
}: {
  item: MinutesAgendaItemView;
  resolution: MinutesResolutionView | null;
  editable: boolean;
  generalTier: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [text, setText] = useState(resolution?.resolutionText ?? "");
  const [vFor, setVFor] = useState(String(resolution?.votesFor ?? 0));
  const [vAgainst, setVAgainst] = useState(String(resolution?.votesAgainst ?? 0));
  const [vAbstain, setVAbstain] = useState(String(resolution?.votesAbstain ?? 0));
  const [binding, setBinding] = useState(resolution ? resolution.binding : generalTier);

  const nFor = Number(vFor) || 0;
  const nAgainst = Number(vAgainst) || 0;
  const passed = nFor > nAgainst;
  const displayNo = resolution?.resolutionNo ?? resolution?.provisionalNo;

  if (!editable) {
    return (
      <div className="mt-3 rounded-lg border-[1.5px] border-green bg-green-bg p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[11px] uppercase tracking-[0.1em] text-green">
              Resolution {displayNo}{resolution && !resolution.resolutionNo ? " · provisional" : ""}
            </div>
          </div>
          {resolution?.binding && <span className="rounded-pill bg-green px-2.5 py-1 text-[9px] font-bold text-bg">● BINDING</span>}
        </div>
        <p className="mt-2 rounded border-l-[3px] border-l-green bg-surface px-3 py-2 text-[13px] leading-relaxed text-navy-2">
          {resolution?.resolutionText ?? <span className="italic text-navy-3">No resolution recorded yet.</span>}
        </p>
        {resolution && (
          <div className="mt-3 grid grid-cols-4 gap-2 border-t border-green pt-2 text-center">
            <Vote lab="For" val={resolution.votesFor} tone="text-green" />
            <Vote lab="Against" val={resolution.votesAgainst} tone="text-terra" />
            <Vote lab="Abstain" val={resolution.votesAbstain} tone="text-navy-3" />
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Result</div>
              <div className={`font-display text-sm font-semibold italic ${resolution.outcome === "PASSED" ? "text-green" : "text-terra"}`}>
                {resolution.outcome === "PASSED" ? "PASSED" : "NOT PASSED"}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const canSave = text.trim().length > 0;

  return (
    <div className="mt-3 space-y-2 rounded-lg border-[1.5px] border-green bg-green-bg p-4">
      <div className="flex items-center justify-between">
        <div className="font-display text-[11px] uppercase tracking-[0.1em] text-green">
          Resolution {displayNo} · <span className="text-navy-3">provisional until adoption</span>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={binding} onChange={(e) => setBinding(e.target.checked)} className="accent-green" />
          Binding
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="RESOLVED THAT…"
        rows={3}
        className="w-full resize-y rounded-md border border-green bg-surface px-3 py-2 text-[13px] leading-relaxed text-navy-2"
      />
      <div className="grid grid-cols-4 gap-2">
        <VoteInput lab="In favour" value={vFor} set={setVFor} />
        <VoteInput lab="Against" value={vAgainst} set={setVAgainst} />
        <VoteInput lab="Abstain" value={vAbstain} set={setVAbstain} />
        <div className="grid place-items-center rounded-md border border-green bg-surface">
          <div className="text-center">
            <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Result</div>
            <div className={`font-display text-sm font-semibold italic ${passed ? "text-green" : "text-terra"}`}>{passed ? "PASSED" : "NOT PASSED"}</div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => run(() => upsertResolution({ agendaItemId: item.id, resolutionText: text.trim(), votesFor: nFor, votesAgainst: nAgainst, votesAbstain: Number(vAbstain) || 0, binding }))}
          disabled={pending || !canSave}
          className="rounded-md border border-green bg-green px-4 py-1.5 text-[12px] font-bold text-bg disabled:opacity-50"
        >
          {resolution ? "Update resolution" : "Save resolution"}
        </button>
      </div>
    </div>
  );
}

function Vote({ lab, val, tone }: { lab: string; val: number; tone: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{lab}</div>
      <div className={`font-display text-lg font-semibold ${tone}`}>{val}</div>
    </div>
  );
}

function VoteInput({ lab, value, set }: { lab: string; value: string; set: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{lab}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="w-full rounded-md border border-green bg-surface px-2 py-1.5 text-center font-display text-lg font-semibold text-navy"
      />
    </label>
  );
}

// ── validator side-panel (R455; deadline row advisory) ───────────────────────────────────────────────

function ValidatorPanel({ view }: { view: PtaMinutesView }) {
  const v = view.validator;
  const rows: { label: string; ok: boolean; detail: string; advisory?: boolean }[] = [
    { label: "All items classified", ok: v.allClassified, detail: `${v.classifiedCount} / ${v.totalItems}` },
    { label: "Action items have owners", ok: v.everyActionOwned, detail: `${v.actionsOwned} / ${v.totalActions}` },
    { label: "Action deadlines set", ok: v.actionsWithDeadline === v.totalActions, detail: `${v.actionsWithDeadline} / ${v.totalActions} · advisory`, advisory: true },
    { label: "Resolutions have vote counts", ok: v.everyResolutionVoted, detail: `${v.resolutionsVoted} / ${v.totalResolutions}` },
    { label: "Quorum confirmed for resolutions", ok: v.quorumOkForResolutions, detail: v.quorumMet === true ? "Met" : v.totalResolutions === 0 ? "n/a" : "Not confirmed" },
  ];
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Validation before submit</div>
      <h4 className="mb-2 font-display text-[15px] font-semibold text-navy">R455 checks</h4>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between border-b border-border py-1.5 text-[12px] last:border-b-0">
          <span className="text-navy-2">{r.label}</span>
          <b className={`font-bold ${r.advisory ? "text-navy-3" : r.ok ? "text-green" : "text-warn"}`}>
            {r.advisory ? r.detail : r.ok ? `✓ ${r.detail}` : r.detail}
          </b>
        </div>
      ))}
    </div>
  );
}

// ── distribution card (adopted; channels DEFERRED, only distributed_at) ──────────────────────────────

function DistributionCard({
  view,
  pending,
  run,
}: {
  view: PtaMinutesView;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const channels = ["SMS summary", "PDF minutes link", "Email full minutes", "General PTA notification", "GES district returns"];
  const done = !!view.distributedAt;
  return (
    <div className="rounded-2xl border border-gold-soft bg-gold-bg p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Distribution</div>
      <h4 className="mb-2 font-display text-[15px] font-semibold text-navy">Channels · coming with SMS</h4>
      <p className="mb-3 text-[11px] italic text-navy-3">
        Automated SMS / PDF / email channels are deferred. For now, record when the minutes were shared.
      </p>
      <div className="mb-3 space-y-1.5">
        {channels.map((c) => (
          <div key={c} className="flex items-center justify-between border-b border-gold-soft py-1.5 text-[12px] last:border-b-0">
            <span className="font-semibold text-navy-3">{c}</span>
            <span className="h-5 w-9 rounded-pill bg-border-2 opacity-60" title="Deferred" />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => run(() => markDistributed({ minutesId: view.minutesId! }))}
        disabled={pending || done}
        className="w-full rounded-md border border-navy bg-navy px-4 py-2 text-[12px] font-bold text-bg disabled:opacity-60"
      >
        {done ? `Distributed ${new Date(view.distributedAt!).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "Mark as distributed"}
      </button>
    </div>
  );
}

// ── foot bar (submit / adopt / return) — navy, no-alpha discipline ───────────────────────────────────

function FootBar({
  view,
  pending,
  run,
}: {
  view: PtaMinutesView;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { status, minutesId } = view;
  if (!minutesId || status === "ADOPTED") return null;

  const canSubmit = status === "DRAFT" && view.canDraft;
  const inReview = status === "CHAIR_REVIEW";
  const adoptReady = inReview && view.canAdopt && view.writeLocked;

  return (
    <div className="mt-6 rounded-2xl border border-navy bg-navy p-5 text-bg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl text-[12px] leading-relaxed text-gold-soft">
          {status === "DRAFT" ? (
            view.validator.canSubmit ? (
              <b className="font-semibold text-bg">Everything checks out — submit to the Chair for review.</b>
            ) : (
              <>Complete the validator checks on the right, then submit for Chair review. {view.validator.blocker}</>
            )
          ) : (
            <>
              With the Chair for review.{" "}
              {view.canAdopt
                ? view.writeLocked
                  ? "Adopt to freeze these minutes — resolutions get their permanent numbers."
                  : `The register hasn't locked yet — you can adopt after it settles (${view.lockLabel}).`
                : "The Chair adopts these minutes; the Secretary can no longer edit them."}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit && (
            <button
              type="button"
              onClick={() => run(() => submitForReview({ minutesId }))}
              disabled={pending || !view.validator.canSubmit}
              className="rounded-md bg-gold px-5 py-2.5 text-[13px] font-bold text-navy hover:brightness-105 disabled:opacity-50"
            >
              Submit for Chair review →
            </button>
          )}
          {inReview && view.canAdopt && (
            <>
              <button
                type="button"
                onClick={() => run(() => returnToDraft({ minutesId }))}
                disabled={pending}
                className="rounded-md border border-white/20 bg-white/5 px-4 py-2.5 text-[12px] font-semibold text-bg hover:bg-white/10 disabled:opacity-60"
              >
                Return to Secretary
              </button>
              <button
                type="button"
                onClick={() => run(() => adoptMinutes({ minutesId }))}
                disabled={pending || !adoptReady}
                title={!view.writeLocked ? `Adopt after the register locks (${view.lockLabel})` : undefined}
                className="rounded-md bg-gold px-5 py-2.5 text-[13px] font-bold text-navy hover:brightness-105 disabled:opacity-50"
              >
                Adopt minutes
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
