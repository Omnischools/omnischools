"use client";
/**
 * Sickbay setup §04 (SHS module 4.4 / INCR-25a) — referral hospitals. Ported from
 * `schoolup-sickbay-setup.html` §04 (706–852) via docs/senior/sickbay-referral-surface-map.md §S4.
 *
 * Client component: PLAIN SERIALIZABLE props only — the `HospitalView` type from `@/lib/sickbay/hospitals`,
 * never a `*-reads` module (the reader lives behind `import "server-only"`). Write affordances render only
 * when `canWrite` (SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER], R18) — the MATRON reads every row and
 * sees no CTA; every server action re-checks the gate, so a hand-crafted POST is refused too.
 *
 * Mode-independent (R198): a REFERRAL_ONLY school configures these too — nothing here is mode-gated.
 *
 * Token discipline (repo memory `no-alpha-token-opacity`): every fill is a solid token or a dedicated
 * `-bg` tint — zero slash-opacity (`bg-gold/60` renders NOTHING on a raw-hex token and `next build`
 * passes anyway).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHospital, editHospital, setHospitalActive } from "@/lib/actions/sickbay-hospital";
import { formatDistanceKm, type HospitalView } from "@/lib/sickbay/hospitals";

type ActionResult = { ok: boolean; error?: string };

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";
const BTN_PRIMARY =
  "rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50";
const BTN_GHOST =
  "rounded-md border border-border-2 bg-surface px-3.5 py-[7px] text-[11px] font-semibold text-navy";
const ADD_LINK =
  "inline-flex items-center gap-2 rounded-lg border border-dashed border-gold px-3.5 py-2.5 text-[11px] font-semibold text-gold";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  };
  return { run, pending, error, setError };
}

export function HospitalsConsole({
  canWrite,
  hospitals,
}: {
  canWrite: boolean;
  hospitals: HospitalView[];
}) {
  const { run, pending, error, setError } = useRun();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section id="hospitals" className="scroll-mt-24 px-6 pb-10 md:px-9">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-7">
        <div>
          <h2 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            Where serious cases <em className="font-normal italic text-gold">go</em>
          </h2>
          <p className="mt-1 max-w-[760px] text-[13px] leading-[1.6] text-navy-3">
            When the sickbay can&apos;t, the hospital does · the{" "}
            <b className="font-semibold text-navy-2">primary referral</b> plus the hospitals that cover
            specialised cases and after-hours · NHIS acceptance tracked because{" "}
            <b className="font-semibold text-navy-2">parent cost matters</b>
          </p>
        </div>
        {canWrite && !adding && !editingId && (
          <button type="button" className={ADD_LINK} onClick={() => setAdding(true)}>
            <Plus /> Add hospital
          </button>
        )}
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      {hospitals.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-4 text-[13px] text-navy-3">
          No referral hospitals configured yet.
          {canWrite
            ? " Add the district hospital every serious case routes to."
            : " An Administrator or the Headmaster sets these up."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-2">
          {hospitals.map((h) =>
            editingId === h.id ? (
              <HospitalForm
                key={h.id}
                initial={h}
                pending={pending}
                onCancel={() => {
                  setError(null);
                  setEditingId(null);
                }}
                onSubmit={(v) => run(() => editHospital({ ...v, id: h.id }), () => setEditingId(null))}
              />
            ) : (
              <HospitalCard
                key={h.id}
                h={h}
                canWrite={canWrite}
                pending={pending}
                onEdit={() => {
                  setError(null);
                  setEditingId(h.id);
                }}
                onToggleActive={() => run(() => setHospitalActive({ id: h.id, active: !h.active }))}
              />
            ),
          )}
        </div>
      )}

      {canWrite && adding && (
        <div className="mt-3 max-w-[560px]">
          <HospitalForm
            pending={pending}
            onCancel={() => {
              setError(null);
              setAdding(false);
            }}
            onSubmit={(v) => run(() => createHospital(v), () => setAdding(false))}
          />
        </div>
      )}
    </section>
  );
}

function HospitalCard({
  h,
  canWrite,
  pending,
  onEdit,
  onToggleActive,
}: {
  h: HospitalView;
  canWrite: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const distance = formatDistanceKm(h.distanceKm);
  return (
    <div
      className={`rounded-[14px] border bg-surface p-[16px_18px] ${
        h.isPrimary ? "border-[1.5px] border-gold" : "border-border"
      } ${h.active ? "" : "opacity-60"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div
          className={`font-display text-[16px] font-semibold tracking-[-0.005em] ${
            h.isPrimary ? "text-gold" : "text-navy"
          }`}
        >
          {h.name}
        </div>
        {distance && <div className="font-mono text-[11px] text-navy-3">{distance}</div>}
      </div>

      {h.services && <div className="mt-1.5 text-[12px] leading-[1.55] text-navy-2">{h.services}</div>}
      {h.notes && <div className="mt-1 text-[11px] italic leading-[1.5] text-navy-3">{h.notes}</div>}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {/* Derived pills first (from the flags), then the school's free-text tags. */}
        {h.isPrimary && <Chip tone="gold">Primary referral</Chip>}
        {h.acceptsNhis ? <Chip tone="green">NHIS accepted</Chip> : <Chip tone="terra">Private · cost</Chip>}
        {!h.active && <Chip tone="muted">Retired</Chip>}
        {h.tags.map((t) => (
          <Chip key={t} tone="muted">
            {t}
          </Chip>
        ))}
      </div>

      {canWrite && (
        <div className="mt-3 flex gap-3">
          <button type="button" className="text-[10px] font-semibold text-gold" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            className="text-[10px] font-semibold text-navy-3 disabled:opacity-50"
            onClick={onToggleActive}
          >
            {h.active ? "Retire" : "Restore"}
          </button>
        </div>
      )}
    </div>
  );
}

type HospitalValues = {
  name: string;
  distanceKm: number | null;
  services: string | null;
  notes: string | null;
  isPrimary: boolean;
  acceptsNhis: boolean;
  tags: string[];
  active: boolean;
};

function HospitalForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: HospitalView;
  pending: boolean;
  onSubmit: (v: HospitalValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [distance, setDistance] = useState(initial?.distanceKm == null ? "" : String(initial.distanceKm));
  const [services, setServices] = useState(initial?.services ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [acceptsNhis, setAcceptsNhis] = useState(initial?.acceptsNhis ?? false);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Field label="Hospital name">
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Distance (km)">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            className={`${FIELD} font-mono`}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </Field>
        <Field label="Services (e.g. OPD · in-patient · X-ray)">
          <input className={FIELD} value={services} onChange={(e) => setServices(e.target.value)} />
        </Field>
        <Field label="Notes (e.g. 24h emergency · visiting doctor here)">
          <input className={FIELD} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Tags (comma-separated, e.g. After-hours backup, surgery)">
          <input className={FIELD} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          Primary referral
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={acceptsNhis} onChange={(e) => setAcceptsNhis(e.target.checked)} />
          Accepts NHIS
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      </div>
      {isPrimary && (
        <p className="mt-2 text-[10px] italic text-navy-3">
          Making this the primary referral clears the primary flag on any other hospital — a school has
          at most one.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={BTN_PRIMARY}
          onClick={() =>
            onSubmit({
              name,
              distanceKm: distance.trim() === "" ? null : Number(distance),
              services: services.trim() || null,
              notes: notes.trim() || null,
              isPrimary,
              acceptsNhis,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              active,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function Chip({ tone, children }: { tone: "gold" | "green" | "terra" | "muted"; children: React.ReactNode }) {
  const cls: Record<string, string> = {
    gold: "bg-gold-bg text-gold",
    green: "bg-green-bg text-green",
    terra: "bg-terra-bg text-terra",
    muted: "border border-border bg-bg text-navy-3",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] ${cls[tone]}`}
    >
      {children}
    </span>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-terra bg-terra-bg px-4 py-2.5 text-[12px] font-semibold text-terra">
      {children}
    </div>
  );
}

function Plus() {
  return (
    <span className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[12px] font-bold text-surface">
      +
    </span>
  );
}
