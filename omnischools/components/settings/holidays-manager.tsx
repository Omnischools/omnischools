"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSchoolHoliday, deleteSchoolHoliday } from "@/lib/actions/calendar";

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

type Holiday = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  kind: string;
};

const KINDS = [
  { v: "PUBLIC", l: "Public holiday" },
  { v: "BREAK", l: "Break" },
  { v: "EVENT", l: "School event" },
  { v: "EXAM", l: "Exam week" },
];
const KIND_TONE: Record<string, string> = {
  PUBLIC: "bg-terra-bg text-terra",
  BREAK: "bg-warn-bg text-warn",
  EVENT: "bg-gold-bg text-navy",
  EXAM: "bg-navy text-bg",
};
const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

export function HolidaysManager({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [kind, setKind] = useState("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="mb-1 font-display text-base font-semibold text-navy">
        Holidays &amp; closures
      </h2>
      <p className="mb-4 text-xs text-navy-3">
        Weekends are already excluded. Add public holidays, breaks, events and exam
        weeks so the school-day counter and trends are accurate.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-end">
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
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={`${fieldClass} w-full`}
          >
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
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      {holidays.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 bg-bg p-4 text-center text-sm text-navy-3">
          No holidays added yet.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <span className="text-sm font-medium text-navy">{h.name}</span>
                <span className="ml-2 text-xs text-navy-3">
                  {fmt(h.startsOn)}
                  {h.endsOn !== h.startsOn ? ` – ${fmt(h.endsOn)}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${KIND_TONE[h.kind] ?? "bg-bg text-navy-3"}`}
                >
                  {KINDS.find((k) => k.v === h.kind)?.l ?? h.kind}
                </span>
                <button
                  onClick={() => remove(h.id)}
                  className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
