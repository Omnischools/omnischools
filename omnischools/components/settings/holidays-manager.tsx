"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addSchoolHoliday, deleteSchoolHoliday } from "@/lib/actions/calendar";

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

type Holiday = { id: string; name: string; startsOn: string; endsOn: string; kind: string };

const KINDS = [
  { v: "PUBLIC", l: "Public holiday" },
  { v: "BREAK", l: "School-set" },
  { v: "EVENT", l: "School event" },
  { v: "EXAM", l: "Exam week" },
];
const KIND_TONE: Record<string, string> = {
  PUBLIC: "border border-border-2 bg-bg text-navy-2",
  BREAK: "bg-gold-bg text-gold",
  EVENT: "bg-gold-bg text-gold",
  EXAM: "bg-gold text-navy",
};
const kindLabel = (k: string) => KINDS.find((x) => x.v === k)?.l ?? k;

const MON = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
const D = (iso: string) => Number(iso.slice(8, 10));
function dateCol(s: string, e: string) {
  if (s === e) return `${D(s)} ${MON(s)}`;
  if (MON(s) === MON(e)) return `${D(s)}—${D(e)} ${MON(s)}`;
  return `${D(s)} ${MON(s)} — ${D(e)} ${MON(e)}`;
}

/** Display name with the last word in italic gold (surface `.h-name em`). */
function HolidayName({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return <>{name}</>;
  return (
    <>
      {parts.slice(0, -1).join(" ")} <em className="text-gold">{parts.at(-1)}</em>
    </>
  );
}

export function HolidaysManager({ holidays, termLabel }: { holidays: Holiday[]; termLabel?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [kind, setKind] = useState("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const startAdd = (k: string) => {
    setKind(k);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    formRef.current?.querySelector("input")?.focus();
  };

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addSchoolHoliday({ name, startsOn, endsOn: endsOn || startsOn, kind });
    setBusy(false);
    if (res.ok) {
      setName("");
      setStartsOn("");
      setEndsOn("");
      setKind("PUBLIC");
      router.refresh();
    } else setError(res.error ?? "Could not add.");
  }

  async function remove(id: string) {
    await deleteSchoolHoliday({ id });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {/* Calendar actions */}
      <div className="flex flex-wrap items-center gap-2">
        <CalBtn onClick={() => startAdd("PUBLIC")}>+ Add holiday</CalBtn>
        <CalBtn onClick={() => startAdd("EVENT")}>+ Add school event</CalBtn>
        <CalBtn onClick={() => startAdd("EXAM")}>+ Add exam week</CalBtn>
        <span
          title="Coming soon — GES public-holiday import"
          className="ml-auto cursor-default rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-[11px] font-semibold text-navy-3 opacity-60"
        >
          ↓ Import GES public holidays
        </span>
      </div>

      {/* Add form */}
      <div
        ref={formRef}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-end"
      >
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Founders' Day"
            className={`${fieldClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>From</label>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={`${fieldClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className={`${fieldClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${fieldClass} w-full`}>
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {k.l}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={add}
          disabled={busy || !name || !startsOn}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}

      {/* List */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-navy-2">
            <b className="font-semibold text-navy">
              {holidays.length} holiday{holidays.length === 1 ? "" : "s"} &amp; events
            </b>
            {termLabel ? ` in ${termLabel}` : ""}
          </span>
          <span className="text-[10px] italic text-navy-3">Sorted by date</span>
        </div>
        {holidays.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-2 bg-bg p-4 text-center text-sm text-navy-3">
            No holidays added yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="grid grid-cols-[88px_1fr_auto_auto] items-center gap-3 py-2.5"
              >
                <span className="font-mono text-[11px] font-bold uppercase text-navy-2">
                  {dateCol(h.startsOn, h.endsOn)}
                </span>
                <span className="font-display text-[13px] font-semibold text-navy">
                  <HolidayName name={h.name} />
                </span>
                <span
                  className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase ${KIND_TONE[h.kind] ?? "bg-bg text-navy-3"}`}
                >
                  {kindLabel(h.kind)}
                </span>
                <button
                  onClick={() => remove(h.id)}
                  aria-label={`Delete ${h.name}`}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-bg text-navy-3 transition-colors hover:text-terra"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CalBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-navy hover:border-gold"
    >
      {children}
    </button>
  );
}
