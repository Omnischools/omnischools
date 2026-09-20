"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/actions/boarding-config";
import { fieldClass } from "@/components/ui/fields";
import type { BoardingCalendar, CalendarEvent } from "@/lib/boarding/config";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${iso}T00:00:00`))
    .toUpperCase();

type Row =
  | { kind: "derived"; typ: string; date: string; label: string }
  | { kind: "event"; event: CalendarEvent };

export function CalendarEditor({
  calendar,
  academicYear,
  canEdit,
}: {
  calendar: BoardingCalendar;
  academicYear: string;
  canEdit: boolean;
}) {
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; event: CalendarEvent } | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows: Row[] = useMemo(() => {
    const derived: Row[] = [
      ...calendar.resumption.map((r) => ({
        kind: "derived" as const,
        typ: "RESUMPTION",
        date: r.date,
        label: `${r.periodLabel} resumption`,
      })),
      ...calendar.vacation.map((v) => ({
        kind: "derived" as const,
        typ: v.productLine === "SENIOR_F3" ? "F3 VAC" : "VACATION",
        date: v.date,
        label:
          v.productLine === "SENIOR_F3"
            ? `${v.periodLabel} · Form 3 post-WASSCE`
            : `${v.periodLabel} vacation · Forms 1 & 2`,
      })),
    ];
    const events: Row[] = calendar.events.map((e) => ({ kind: "event" as const, event: e }));
    return [...derived, ...events].sort((a, b) => rowDate(a).localeCompare(rowDate(b)));
  }, [calendar]);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] text-navy-3">
          Resumption &amp; vacation are <b className="text-navy-2">derived from the academic calendar</b>{" "}
          (read-only); visiting Sundays &amp; exeat windows are configured here.
        </p>
        {canEdit && (
          <button
            onClick={() => setDialog({ mode: "add" })}
            className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-bg"
          >
            + Add event
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {rows.map((row, i) => (
          <CalCard
            key={row.kind === "event" ? row.event.id : `d-${i}`}
            row={row}
            todayIso={todayIso}
            nextVisitingId={calendar.nextVisiting?.id ?? null}
            canEdit={canEdit}
            onEdit={(event) => setDialog({ mode: "edit", event })}
          />
        ))}
      </div>

      {dialog && (
        <EventDialog
          academicYear={academicYear}
          event={dialog.mode === "edit" ? dialog.event : null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function rowDate(r: Row): string {
  return r.kind === "event" ? r.event.date : r.date;
}

function CalCard({
  row,
  todayIso,
  nextVisitingId,
  canEdit,
  onEdit,
}: {
  row: Row;
  todayIso: string;
  nextVisitingId: string | null;
  canEdit: boolean;
  onEdit: (e: CalendarEvent) => void;
}) {
  const date = rowDate(row);
  const past = date < todayIso;
  const isEvent = row.kind === "event";
  const typ = row.kind === "derived" ? row.typ : row.event.eventType === "VISITING" ? "VISITING" : `EXEAT${row.event.sequence ? ` W${row.event.sequence}` : ""}`;
  const isNextVisiting = isEvent && row.kind === "event" && row.event.id === nextVisitingId;
  const isVac = typ === "VACATION" || typ === "F3 VAC";

  // Trap-2 safe: solid -bg tints + solid left borders, never slash-opacity on a raw-hex token.
  const tone = isNextVisiting
    ? "border-l-gold bg-gold-bg"
    : isVac
      ? "border-l-warn bg-warn-bg"
      : "border-l-green bg-bg";
  const typColor = isNextVisiting ? "text-gold" : isVac ? "text-warn" : "text-green";

  return (
    <div className={`rounded-lg border border-border border-l-[3px] px-3 py-2.5 ${tone} ${past ? "opacity-60" : ""}`}>
      <div className={`text-[9px] font-bold uppercase tracking-[0.12em] ${typColor}`}>{typ}</div>
      <div className="mt-0.5 font-mono text-[11px] font-semibold text-navy">{fmt(date)}</div>
      <div className="mt-1 text-[11px] font-semibold leading-tight text-navy-2">
        {row.kind === "derived" ? row.label : row.event.label}
      </div>
      {row.kind === "derived" ? (
        <div className="mt-1.5 text-[8px] font-bold uppercase tracking-[0.1em] text-navy-3">Derived · read-only</div>
      ) : (
        canEdit && (
          <button
            onClick={() => onEdit(row.event)}
            className="mt-1.5 text-[10px] font-semibold text-navy-3 underline hover:text-navy"
          >
            Edit
          </button>
        )
      )}
    </div>
  );
}

function EventDialog({
  academicYear,
  event,
  onClose,
}: {
  academicYear: string;
  event: CalendarEvent | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<"VISITING" | "EXEAT_WINDOW">(event?.eventType ?? "VISITING");
  const [eventDate, setEventDate] = useState(event?.date ?? "");
  const [label, setLabel] = useState(event?.label ?? "");
  const [formScope, setFormScope] = useState(event?.formScope ?? "");
  const [sequence, setSequence] = useState(event?.sequence != null ? String(event.sequence) : "");

  function submit() {
    setError(null);
    const payload = {
      academicYear,
      eventType,
      eventDate,
      label,
      formScope: formScope || null,
      sequence: sequence === "" ? null : Number(sequence),
    };
    startTransition(async () => {
      const res = event
        ? await updateCalendarEvent({ id: event.id, ...payload })
        : await createCalendarEvent(payload);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      onClose();
      router.refresh();
    });
  }
  function remove() {
    if (!event) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCalendarEvent({ id: event.id });
      if (!res.ok) {
        setError(res.error ?? "Could not remove.");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h3 className="mb-4 font-display text-lg font-semibold text-navy">
          {event ? "Edit calendar event" : "Add calendar event"}
        </h3>
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy-2">Type</span>
            <select className={fieldClass} value={eventType} onChange={(e) => setEventType(e.target.value as "VISITING" | "EXEAT_WINDOW")}>
              <option value="VISITING">Visiting Sunday</option>
              <option value="EXEAT_WINDOW">Exeat window</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy-2">Date</span>
            <input type="date" className={fieldClass} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy-2">Label</span>
            <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Visiting Sunday · Forms 1 & 2 only" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-navy-2">Form scope (optional)</span>
              <input className={fieldClass} value={formScope} onChange={(e) => setFormScope(e.target.value)} placeholder="FORMS_1_2" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-navy-2">Sequence (exeat)</span>
              <input type="number" min={1} max={20} className={fieldClass} value={sequence} onChange={(e) => setSequence(e.target.value)} placeholder="1" />
            </label>
          </div>
          {error && <p className="text-xs font-semibold text-terra">{error}</p>}
          <div className="mt-1 flex items-center justify-between">
            {event ? (
              <button onClick={remove} disabled={pending} className="rounded-md border border-terra px-3 py-2 text-xs font-semibold text-terra disabled:opacity-50">
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={onClose} disabled={pending} className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={pending} className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
