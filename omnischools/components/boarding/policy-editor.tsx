"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBoardingSettings } from "@/lib/actions/boarding-config";
import { fieldClass } from "@/components/ui/fields";
import type { BoardingSettingsValues } from "@/lib/boarding/config";

type Card = "exeat" | "visiting" | "inspection";

export function PolicyEditor({
  settings,
  nextVisitingLabel,
  canEdit,
}: {
  settings: BoardingSettingsValues;
  nextVisitingLabel: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BoardingSettingsValues>(settings);
  const [editing, setEditing] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof BoardingSettingsValues>(k: K, v: BoardingSettingsValues[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function cancel() {
    setForm(settings);
    setEditing(null);
    setError(null);
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateBoardingSettings(form);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
      <PolicyCard
        title="Exeat"
        em="policy"
        pill={`${form.exeatScheduledPerTerm} PER TERM`}
        card="exeat"
        editing={editing}
        canEdit={canEdit}
        pending={pending}
        error={error}
        onEdit={() => setEditing("exeat")}
        onCancel={cancel}
        onSave={save}
      >
        {editing === "exeat" ? (
          <>
            <NumField label="Scheduled exeats / term" value={form.exeatScheduledPerTerm} onChange={(v) => set("exeatScheduledPerTerm", v)} />
            <TxtField label="Return-by time" value={form.exeatReturnBy} onChange={(v) => set("exeatReturnBy", v)} />
            <TxtField label="Dress code returning" value={form.exeatDressCode} onChange={(v) => set("exeatDressCode", v)} />
            <BoolField label="Fee-owing student must collect fees" value={form.exeatFeeOwingMustCollect} onChange={(v) => set("exeatFeeOwingMustCollect", v)} />
            <TxtField label="Special exeats" value={form.exeatSpecialApprover} onChange={(v) => set("exeatSpecialApprover", v)} />
            <BoolField label="Parent-initiated allowed" value={form.exeatParentInitiated} onChange={(v) => set("exeatParentInitiated", v)} />
            <TxtField label="Exeat card" value={form.exeatCardSigner} onChange={(v) => set("exeatCardSigner", v)} />
          </>
        ) : (
          <>
            <Line l="Scheduled exeats / term" v={String(form.exeatScheduledPerTerm)} em />
            <Line l="Return-by time" v={form.exeatReturnBy} mono />
            <Line l="Dress code returning" v={form.exeatDressCode} />
            <Line l="Fee-owing student rule" v={form.exeatFeeOwingMustCollect ? "Must collect fees" : "No collection required"} />
            <Line l="Special exeats" v={form.exeatSpecialApprover} />
            <Line l="Parent-initiated" v={form.exeatParentInitiated ? "Allowed · in writing" : "Not allowed"} />
            <Line l="Exeat card" v={form.exeatCardSigner} />
          </>
        )}
      </PolicyCard>

      <PolicyCard
        title="Visiting"
        em="day"
        pill="2ND SUN"
        card="visiting"
        editing={editing}
        canEdit={canEdit}
        pending={pending}
        error={error}
        onEdit={() => setEditing("visiting")}
        onCancel={cancel}
        onSave={save}
      >
        {editing === "visiting" ? (
          <>
            <TxtField label="Cadence" value={form.visitingCadence} onChange={(v) => set("visitingCadence", v)} />
            <TxtField label="Visiting hours — start" value={form.visitingHoursStart} onChange={(v) => set("visitingHoursStart", v)} />
            <TxtField label="Visiting hours — end" value={form.visitingHoursEnd} onChange={(v) => set("visitingHoursEnd", v)} />
            <TxtField label="Lunch served" value={form.visitingLunchTime} onChange={(v) => set("visitingLunchTime", v)} />
            <TxtField label="Dormitories" value={form.visitingDormitoriesRule} onChange={(v) => set("visitingDormitoriesRule", v)} />
            <TxtField label="Approved visitors only" value={form.visitingApprovedVisitors} onChange={(v) => set("visitingApprovedVisitors", v)} />
            <TxtField label="Visitors' book" value={form.visitingBookOwner} onChange={(v) => set("visitingBookOwner", v)} />
          </>
        ) : (
          <>
            <Line l="Cadence" v={form.visitingCadence} />
            <Line l="Visiting hours" v={`${form.visitingHoursStart} — ${form.visitingHoursEnd}`} mono />
            <Line l="Lunch served" v={form.visitingLunchTime} mono />
            <Line l="Dormitories" v={form.visitingDormitoriesRule} />
            <Line l="Approved visitors only" v={form.visitingApprovedVisitors} />
            <Line l="Visitors' book" v={form.visitingBookOwner} />
            <Line l="Next visiting" v={nextVisitingLabel ?? "none scheduled"} em />
          </>
        )}
      </PolicyCard>

      <PolicyCard
        title="Inspection"
        em="cadence"
        pill="2 BEATS"
        card="inspection"
        editing={editing}
        canEdit={canEdit}
        pending={pending}
        error={error}
        onEdit={() => setEditing("inspection")}
        onCancel={cancel}
        onSave={save}
      >
        {editing === "inspection" ? (
          <>
            <TxtField label="Daily inspection — start" value={form.inspectionDailyStart} onChange={(v) => set("inspectionDailyStart", v)} />
            <TxtField label="Daily inspection — end" value={form.inspectionDailyEnd} onChange={(v) => set("inspectionDailyEnd", v)} />
            <TxtField label="Daily scope" value={form.inspectionDailyScope} onChange={(v) => set("inspectionDailyScope", v)} />
            <TxtField label="Weekly inspection" value={form.inspectionWeekly} onChange={(v) => set("inspectionWeekly", v)} />
            <TxtField label="Weekly scope" value={form.inspectionWeeklyScope} onChange={(v) => set("inspectionWeeklyScope", v)} />
            <TxtField label="Mid-week scrubbing" value={form.inspectionScrubbing} onChange={(v) => set("inspectionScrubbing", v)} />
            <TxtField label="Washing days" value={form.inspectionWashingDays} onChange={(v) => set("inspectionWashingDays", v)} />
            <TxtField label="Inspector" value={form.inspectionInspector} onChange={(v) => set("inspectionInspector", v)} />
          </>
        ) : (
          <>
            <Line l="Daily inspection" v={`${form.inspectionDailyStart} — ${form.inspectionDailyEnd}`} mono />
            <Line l="Daily scope" v={form.inspectionDailyScope} />
            <Line l="Weekly inspection" v={form.inspectionWeekly} />
            <Line l="Weekly scope" v={form.inspectionWeeklyScope} />
            <Line l="Mid-week scrubbing" v={form.inspectionScrubbing} />
            <Line l="Washing days" v={form.inspectionWashingDays} />
            <Line l="Inspector" v={form.inspectionInspector} />
          </>
        )}
      </PolicyCard>
    </div>
  );
}

function PolicyCard({
  title,
  em,
  pill,
  card,
  editing,
  canEdit,
  pending,
  error,
  onEdit,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  em: string;
  pill: string;
  card: Card;
  editing: Card | null;
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const isEditing = editing === card;
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3.5 flex items-start justify-between border-b border-dashed border-border pb-3">
        <h4 className="font-display text-[17px] font-semibold text-navy">
          {title} <em className="italic text-gold">{em}</em>
        </h4>
        <span className="rounded-pill bg-gold-bg px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-gold">
          {pill}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
      {isEditing && error && <p className="mt-2 text-xs font-semibold text-terra">{error}</p>}
      {canEdit && (
        <div className="mt-4 flex justify-end gap-2">
          {isEditing ? (
            <>
              <button
                onClick={onCancel}
                disabled={pending}
                className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={pending}
                className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={onEdit}
              disabled={editing !== null}
              className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-40"
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Line({ l, v, mono, em }: { l: string; v: string; mono?: boolean; em?: boolean }) {
  return (
    <div className="flex justify-between border-b border-dashed border-border py-1.5 text-[11px] last:border-none">
      <span className="font-medium text-navy-3">{l}</span>
      <span
        className={`font-semibold text-navy ${mono ? "font-mono text-[11px]" : "font-display"} ${
          em ? "italic text-gold" : ""
        }`}
      >
        {v}
      </span>
    </div>
  );
}

function TxtField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px]">
      <span className="mb-0.5 block font-medium text-navy-3">{label}</span>
      <input className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-[11px]">
      <span className="mb-0.5 block font-medium text-navy-3">{label}</span>
      <input
        type="number"
        min={0}
        max={99}
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function BoolField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 py-1 text-[11px] font-medium text-navy-2">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-navy" />
      {label}
    </label>
  );
}
