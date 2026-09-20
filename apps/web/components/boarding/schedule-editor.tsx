"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertScheduleTemplate } from "@/lib/actions/boarding-config";
import { fieldClass } from "@/components/ui/fields";
import type { BoardingDayType, ScheduleBlock, ScheduleTemplate } from "@/lib/boarding/config";

const DAY_TABS: { key: BoardingDayType; label: string }[] = [
  { key: "WEEKDAY", label: "Weekday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
  { key: "VISITING_SUNDAY", label: "Visiting Sunday" },
];

/** Parse the leading "HH:MM" of a range into minutes-since-midnight, or null. */
function startMinutes(range: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(range.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Does the viewed day type match today (client clock)? Governs whether `.now` shows. */
function dayMatchesToday(dayType: BoardingDayType, dow: number): boolean {
  if (dayType === "WEEKDAY") return dow >= 1 && dow <= 5;
  if (dayType === "SATURDAY") return dow === 6;
  return dow === 0; // SUNDAY + VISITING_SUNDAY both fall on Sunday
}

export function ScheduleEditor({
  templates,
  canEdit,
}: {
  templates: ScheduleTemplate[];
  canEdit: boolean;
}) {
  const [day, setDay] = useState<BoardingDayType>("WEEKDAY");
  const [form3, setForm3] = useState(false);
  const formScope = day === "WEEKDAY" && form3 ? "FORM_3" : "ALL";

  const current = useMemo(
    () => templates.find((t) => t.dayType === day && t.formScope === formScope) ?? null,
    [templates, day, formScope],
  );
  // Whether a WEEKDAY/FORM_3 variant exists at all (drives the toggle's enabled state).
  const hasForm3 = templates.some((t) => t.dayType === "WEEKDAY" && t.formScope === "FORM_3");

  // Client-only clock (avoids SSR hydration mismatch): the current activity row.
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [dow, setDow] = useState<number | null>(null);
  useEffect(() => {
    const d = new Date();
    setNowMin(d.getHours() * 60 + d.getMinutes());
    setDow(d.getDay());
  }, []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {DAY_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setDay(t.key);
              if (t.key !== "WEEKDAY") setForm3(false);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              day === t.key
                ? "bg-navy text-bg"
                : "border border-border-2 bg-surface text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
        {day === "WEEKDAY" && (
          <label className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-navy-2">
            <input
              type="checkbox"
              checked={form3}
              disabled={!hasForm3}
              onChange={(e) => setForm3(e.target.checked)}
              className="h-4 w-4 accent-gold"
            />
            Form 3 WASSCE variant {hasForm3 ? "" : "· none configured"}
          </label>
        )}
      </div>

      {current == null ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No {DAY_TABS.find((t) => t.key === day)?.label} rhythm configured
          {formScope === "FORM_3" ? " for Form 3" : ""} yet.
        </div>
      ) : (
        <ScheduleView
          key={`${day}/${formScope}`}
          template={current}
          canEdit={canEdit}
          nowMin={dow != null && dayMatchesToday(day, dow) ? nowMin : null}
        />
      )}
    </div>
  );
}

function ScheduleView({
  template,
  canEdit,
  nowMin,
}: {
  template: ScheduleTemplate;
  canEdit: boolean;
  nowMin: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(template.activities);
  const [error, setError] = useState<string | null>(null);

  // Which activity row is "now": the last activity whose start ≤ now and now < the next activity start.
  const nowIndex = useMemo(() => {
    if (nowMin == null) return -1;
    let candidate = -1;
    for (let i = 0; i < template.activities.length; i++) {
      const b = template.activities[i];
      if (b.kind !== "activity") continue;
      const s = startMinutes(b.range);
      if (s != null && s <= nowMin) candidate = i;
      else if (s != null && s > nowMin) break;
    }
    return candidate;
  }, [template.activities, nowMin]);

  function update(i: number, patch: Partial<Extract<ScheduleBlock, { kind: "activity" }>> & { label?: string }) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? ({ ...b, ...patch } as ScheduleBlock) : b)));
  }
  function remove(i: number) {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
  }
  function addActivity() {
    setBlocks((bs) => [...bs, { kind: "activity", range: "00:00 — 00:00", duration: "", activity: "New activity", who: "House" }]);
  }
  function addSection() {
    setBlocks((bs) => [...bs, { kind: "section", label: "New section" }]);
  }
  function cancel() {
    setBlocks(template.activities);
    setEditing(false);
    setError(null);
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const res = await upsertScheduleTemplate({
        dayType: template.dayType,
        formScope: template.formScope,
        activities: blocks,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save the schedule.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={addActivity} className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy">
            + Activity
          </button>
          <button onClick={addSection} className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy">
            + Section
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={cancel} disabled={pending} className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50">
              {pending ? "Saving…" : "Save rhythm"}
            </button>
          </div>
        </div>
        {error && <p className="mb-2 text-xs font-semibold text-terra">{error}</p>}
        <div className="flex flex-col gap-1.5">
          {blocks.map((b, i) =>
            b.kind === "section" ? (
              <div key={i} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Section</span>
                <input className={`${fieldClass} py-1`} value={b.label} onChange={(e) => update(i, { label: e.target.value })} />
                <RemoveBtn onClick={() => remove(i)} />
              </div>
            ) : (
              <div key={i} className="grid grid-cols-[110px_1fr_1fr_100px_auto] items-center gap-2">
                <input className={`${fieldClass} py-1 font-mono text-[11px]`} value={b.range} onChange={(e) => update(i, { range: e.target.value })} />
                <input className={`${fieldClass} py-1`} value={b.activity} onChange={(e) => update(i, { activity: e.target.value })} />
                <input className={`${fieldClass} py-1`} value={b.note ?? ""} placeholder="detail (optional)" onChange={(e) => update(i, { note: e.target.value || undefined })} />
                <input className={`${fieldClass} py-1 text-[11px]`} value={b.who} onChange={(e) => update(i, { who: e.target.value })} />
                <RemoveBtn onClick={() => remove(i)} />
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {canEdit && (
        <div className="flex justify-end border-b border-border bg-bg px-4 py-2">
          <button onClick={() => setEditing(true)} className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy">
            Edit rhythm
          </button>
        </div>
      )}
      {template.activities.map((b, i) =>
        b.kind === "section" ? (
          <div key={i} className="bg-bg px-5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            {b.label}
          </div>
        ) : (
          <div
            key={i}
            className={`grid grid-cols-[120px_90px_1fr_100px] items-center gap-3.5 border-b border-border px-5 py-2.5 text-xs last:border-none ${
              i === nowIndex ? "border-l-[3px] border-l-gold bg-gold-bg pl-[17px]" : ""
            }`}
          >
            <div className="font-mono text-[12px] font-semibold text-navy-2">{b.range}</div>
            <div className="font-mono text-[10px] text-navy-3">{b.duration ?? ""}</div>
            <div className="font-display text-[13px] font-semibold text-navy">
              {b.activity}
              {b.note ? <em className="italic text-gold"> {b.note}</em> : null}
            </div>
            <div className={`text-right text-[10px] font-semibold uppercase tracking-[0.04em] ${i === nowIndex ? "text-gold" : "text-navy-3"}`}>
              {b.who}
              {i === nowIndex ? <span className="ml-2 rounded-pill bg-gold px-1.5 py-0.5 text-[8px] text-navy">NOW</span> : null}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md border border-border-2 bg-surface px-2 py-1 text-[11px] font-semibold text-terra" title="Remove row">
      ✕
    </button>
  );
}
