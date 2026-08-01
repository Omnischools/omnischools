"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { changePtaDues, savePtaTier } from "@/lib/actions/pta";
import type { PtaTier } from "@/lib/pta/defaults";
import {
  DUES_BASIS_OPTIONS,
  DUES_CADENCE_OPTIONS,
  PTA_ACCENT,
  TIER_UI,
  duesBasisLabel,
  duesCadenceLabel,
  fieldClass,
  ghs,
} from "./shared";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** The styled pill switch (surface `.toggle .switch`) — PLC ships bare checkboxes; this is the PTA toggle. */
function PillToggle({
  on,
  onChange,
  onLabel,
  offLabel,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className="flex items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-70"
      aria-pressed={on}
    >
      <span
        className={cn(
          "relative h-6 w-[42px] rounded-pill transition-colors",
          on ? "bg-green" : "bg-border-2",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm transition-all",
            on ? "left-[21px]" : "left-[3px]",
          )}
        />
      </span>
      <span
        className={cn(
          "text-[11px] font-bold uppercase tracking-[0.08em]",
          on ? "text-green" : "text-navy-3",
        )}
      >
        {on ? onLabel : offLabel}
      </span>
    </button>
  );
}

export function TierCard({ tier }: { tier: PtaTier }) {
  const ui = TIER_UI[tier.tierType];
  const a = PTA_ACCENT[ui.accent];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState(tier.active);
  const [frequency, setFrequency] = useState(tier.frequencyNorm);
  const [officers, setOfficers] = useState(tier.officerRoles.join(" · "));
  const [quorum, setQuorum] = useState(tier.quorumRule);
  const [initialSettings] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = { ...tier.tierSettings };
    for (const def of ui.settings) if (!(def.key in s)) s[def.key] = def.options[0];
    return s;
  });
  const [settings, setSettings] = useState<Record<string, string>>(initialSettings);

  const dirty =
    active !== tier.active ||
    frequency !== tier.frequencyNorm ||
    officers !== tier.officerRoles.join(" · ") ||
    quorum !== tier.quorumRule ||
    JSON.stringify(settings) !== JSON.stringify(initialSettings);

  function save() {
    setError(null);
    const officerRoles =
      tier.tierType === "EMERGENCY"
        ? []
        : officers
            .split("·")
            .map((s) => s.trim())
            .filter(Boolean);
    startTransition(async () => {
      const res = await savePtaTier({
        tierType: tier.tierType,
        active,
        frequencyNorm: frequency,
        officerRoles,
        quorumRule: quorum,
        tierSettings: settings,
      });
      if (!res.ok) return setError(res.error ?? "Could not save.");
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-l-4 bg-surface",
        active ? "border-border-2" : "border-border opacity-80",
        a.borderL,
      )}
    >
      {/* ── Head ── */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 border-b border-border bg-bg px-6 py-5">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-xl font-display text-xl font-semibold",
            a.icon,
          )}
        >
          {ui.iconInitials}
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
            Tier {ui.tierNo}
          </div>
          <h4 className="font-display text-xl font-semibold leading-tight text-navy">
            {ui.name} <em className="italic font-medium text-gold">· {ui.scope}</em>
          </h4>
          <p className="mt-0.5 text-[12px] leading-snug text-navy-3">{ui.desc}</p>
        </div>
        <PillToggle
          on={active}
          onChange={setActive}
          onLabel={ui.activeLabel}
          offLabel="Off"
          disabled={pending}
        />
      </div>

      {/* ── Body (collapses when the tier is off — records preserved) ── */}
      {active ? (
        <div className="px-6 py-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {ui.hasStandingConfig && (
              <>
                <Field label="Meeting frequency · norm">
                  <select
                    className={cn(fieldClass, "w-full")}
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                  >
                    {/* keep the stored value selectable even if it isn't one of the presets */}
                    {!ui.frequencyOptions.includes(frequency) && frequency && (
                      <option value={frequency}>{frequency}</option>
                    )}
                    {ui.frequencyOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default officer roles" hint={ui.officerHint}>
                  <input
                    type="text"
                    className={cn(fieldClass, "w-full")}
                    value={officers}
                    placeholder="Chair · Vice · Secretary · Treasurer"
                    onChange={(e) => setOfficers(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] italic text-navy-3">
                    Office names, separated by <b className="not-italic text-navy-2">·</b> — a data
                    list, not app roles.
                  </p>
                </Field>
              </>
            )}
            {ui.settings.map((def) => (
              <Field key={def.key} label={def.label} hint={def.hint}>
                <select
                  className={cn(fieldClass, "w-full")}
                  value={settings[def.key] ?? def.options[0]}
                  onChange={(e) => setSettings((s) => ({ ...s, [def.key]: e.target.value }))}
                >
                  {def.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            {ui.hasStandingConfig && (
              <Field label="Quorum for binding decisions" hint="Free-text · shown on the meeting register">
                <input
                  type="text"
                  className={cn(fieldClass, "w-full")}
                  value={quorum}
                  onChange={(e) => setQuorum(e.target.value)}
                />
              </Field>
            )}
          </div>

          {/* Dues block */}
          {ui.hasDues ? (
            <DuesBlock tier={tier} pending={pending} />
          ) : (
            <div className="mt-5 rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy-3">
                  {ui.name} <b className="text-navy">standing dues</b> · not typical for this tier
                </div>
                <PillToggle on={false} onChange={() => {}} onLabel="" offLabel="No standing dues" disabled />
              </div>
              <p className="mt-3 text-[12px] italic text-navy-3">
                <em className="not-italic text-navy-2">Emergency PTAs raise funds by resolution</em>,
                not standing dues. Ad-hoc levies are convened with the meeting (a later step).
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-4 text-[12px] italic text-navy-3">
          This tier is off. Existing records are preserved — toggle it on to configure, then run
          Generate.
        </div>
      )}

      {/* ── Foot (Save) ── */}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-bg px-6 py-3">
        <div className="text-[11px] text-navy-3">
          {tier.configured ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-green">
              <span className="h-1.5 w-1.5 rounded-full bg-green" /> Configured
            </span>
          ) : (
            <span className="italic">Showing defaults · not yet configured</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {error && <p className="text-xs font-semibold text-terra">{error}</p>}
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-md bg-navy px-4 py-2 text-xs font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save tier"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
        {label}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] italic text-navy-3">{hint}</p>}
    </div>
  );
}

/**
 * The dues block — forward-only (R413). It shows the CURRENT rate and, on Edit, a small form whose
 * "Apply dues change" appends a pta_dues_config_history row (mandatory reason, effective_from ≥ today).
 * Emergency never renders this (handled by the caller). Never touches invoices (INCR-54).
 */
function DuesBlock({ tier, pending: parentPending }: { tier: PtaTier; pending: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(tier.duesEnabled);
  const [amount, setAmount] = useState(tier.duesAmount != null ? String(tier.duesAmount) : "");
  const [basis, setBasis] = useState(tier.duesBasis ?? "PER_STUDENT");
  const [cadence, setCadence] = useState(tier.duesCadence ?? "PER_TERM");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [reason, setReason] = useState("");

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await changePtaDues({
        tierType: tier.tierType,
        duesEnabled: enabled,
        duesAmount: amount === "" ? null : Number(amount),
        duesBasis: enabled ? basis : null,
        duesCadence: enabled ? cadence : null,
        effectiveFrom,
        reason,
      });
      if (!res.ok) return setError(res.error ?? "Could not save the dues change.");
      setEditing(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-bg p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy-3">
          {TIER_UI[tier.tierType].name} <b className="text-navy">dues</b> · optional · forward-only
        </div>
        {!editing && (
          <button
            onClick={() => {
              setEditing(true);
              setError(null);
            }}
            disabled={parentPending}
            className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-navy-2 hover:bg-gold-bg disabled:opacity-50"
          >
            {tier.duesEnabled ? "Change dues" : "Set up dues"}
          </button>
        )}
      </div>

      {!editing ? (
        tier.duesEnabled ? (
          <div className="mt-2 font-display text-lg font-semibold text-navy">
            {ghs(tier.duesAmount)}{" "}
            <span className="text-[13px] font-normal text-navy-3">
              · {duesBasisLabel(tier.duesBasis)} · {duesCadenceLabel(tier.duesCadence)}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[12px] italic text-navy-3">
            No dues collected. Set them up here — every change is forward-only and audit-logged.
          </p>
        )
      ) : (
        <div className="mt-4 space-y-4">
          <PillToggle
            on={enabled}
            onChange={setEnabled}
            onLabel="Collecting"
            offLabel="No dues"
            disabled={pending}
          />
          {enabled && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Amount per cadence">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={cn(fieldClass, "w-full")}
                  value={amount}
                  placeholder="50.00"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Charged">
                <select
                  className={cn(fieldClass, "w-full")}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as typeof basis)}
                >
                  {DUES_BASIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cadence">
                <select
                  className={cn(fieldClass, "w-full")}
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as typeof cadence)}
                >
                  {DUES_CADENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Effective from" hint="Today or later — dues changes can't be backdated">
              <input
                type="date"
                min={todayISO()}
                className={cn(fieldClass, "w-full")}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <Field label="Reason (for audit)" hint="Mandatory — e.g. approved at the General PTA AGM">
              <input
                type="text"
                className={cn(fieldClass, "w-full")}
                value={reason}
                placeholder="Approved at General PTA AGM, minute 7.4"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={apply}
              disabled={pending || reason.trim() === ""}
              className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-bg hover:bg-navy-deep disabled:opacity-50"
            >
              {pending ? "Saving…" : "Apply dues change"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy-2 disabled:opacity-50"
            >
              Cancel
            </button>
            {error && <p className="text-xs font-semibold text-terra">{error}</p>}
          </div>
          <p className="text-[11px] italic text-navy-3">
            Forward-only · existing invoices are never re-rated · audit-logged with timestamp, admin
            and reason.
          </p>
        </div>
      )}
    </div>
  );
}
