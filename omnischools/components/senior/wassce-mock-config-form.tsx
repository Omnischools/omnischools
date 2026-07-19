"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleMock, updateMock } from "@/lib/actions/wassce-mocks";

/**
 * Setup §2 mock-config write UI (INCR-16, admin-only — the page already role-gates to WASSCE_SETUP_ROLES).
 * Two flows: SCHEDULE a new mock for a cohort ("Schedule Mock 2027 · F2"), and EDIT an UNLOCKED mock.
 * A locked mock (marking complete) is never offered for edit — and the server re-checks (AC3). CLIENT
 * component: it imports only the two server actions, no db.
 */

type CohortOpt = { id: string; label: string };
type EditableMock = {
  id: string;
  label: string; // "F2 · 2027 — Mock 1"
  name: string;
  mockNumber: number;
  isPredictor: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

const field =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy focus:border-gold focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3";

export function WassceMockConfigForm({
  cohorts,
  editableMocks,
}: {
  cohorts: CohortOpt[];
  editableMocks: EditableMock[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // schedule state
  const [cohortId, setCohortId] = useState(cohorts[cohorts.length - 1]?.id ?? "");
  const [name, setName] = useState("Mock 1");
  const [mockNumber, setMockNumber] = useState("1");
  const [isPredictor, setIsPredictor] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // edit state
  const [editId, setEditId] = useState("");
  const active = editableMocks.find((m) => m.id === editId) ?? null;
  const [eName, setEName] = useState("");
  const [eNumber, setENumber] = useState("");
  const [ePredictor, setEPredictor] = useState(false);
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");

  function onPickEdit(id: string) {
    setEditId(id);
    const m = editableMocks.find((x) => x.id === id);
    setEName(m?.name ?? "");
    setENumber(m ? String(m.mockNumber) : "");
    setEPredictor(m?.isPredictor ?? false);
    setEStart(m?.scheduledStart ?? "");
    setEEnd(m?.scheduledEnd ?? "");
  }

  function submitSchedule() {
    setMsg(null);
    startTransition(async () => {
      const res = await scheduleMock({
        cohortId,
        name,
        mockNumber,
        isPredictor,
        scheduledStart: start,
        scheduledEnd: end,
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Mock scheduled." });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  function submitEdit() {
    if (!editId) return;
    setMsg(null);
    startTransition(async () => {
      const res = await updateMock({
        mockId: editId,
        name: eName,
        mockNumber: eNumber,
        isPredictor: ePredictor,
        scheduledStart: eStart,
        scheduledEnd: eEnd,
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Mock updated." });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {msg && (
        <div
          className={`md:col-span-2 rounded-md px-3 py-2 text-[12px] ${
            msg.kind === "ok" ? "bg-green-bg text-green" : "bg-terra-bg text-terra"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Schedule a mock */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-[15px] font-medium text-navy">
          Schedule a <em className="italic text-gold">mock</em>
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>Cohort</label>
            <select className={field} value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>Name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Mock number</label>
            <input
              type="number"
              min={1}
              className={field}
              value={mockNumber}
              onChange={(e) => setMockNumber(e.target.value)}
            />
          </div>
          <label className="flex items-end gap-2 pb-1.5 text-[12px] text-navy-2">
            <input type="checkbox" checked={isPredictor} onChange={(e) => setIsPredictor(e.target.checked)} />
            Predictor mock
          </label>
          <div>
            <label className={label}>Window start</label>
            <input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Window end</label>
            <input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          disabled={pending || !cohortId}
          onClick={submitSchedule}
          className="mt-3 rounded-md bg-navy px-4 py-2 text-[12px] font-semibold text-bg disabled:opacity-60"
        >
          Schedule mock
        </button>
      </div>

      {/* Edit an unlocked mock */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-[15px] font-medium text-navy">
          Edit an <em className="italic text-gold">unlocked</em> mock
        </h3>
        {editableMocks.length === 0 ? (
          <p className="text-[12px] text-navy-3">
            Every mock is marked complete — locked and read-only. Nothing to edit.
          </p>
        ) : (
          <>
            <div className="mb-3">
              <label className={label}>Mock</label>
              <select className={field} value={editId} onChange={(e) => onPickEdit(e.target.value)}>
                <option value="">Select an unlocked mock…</option>
                {editableMocks.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {active && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={label}>Name</label>
                  <input className={field} value={eName} onChange={(e) => setEName(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Mock number</label>
                  <input
                    type="number"
                    min={1}
                    className={field}
                    value={eNumber}
                    onChange={(e) => setENumber(e.target.value)}
                  />
                </div>
                <label className="flex items-end gap-2 pb-1.5 text-[12px] text-navy-2">
                  <input type="checkbox" checked={ePredictor} onChange={(e) => setEPredictor(e.target.checked)} />
                  Predictor mock
                </label>
                <div>
                  <label className={label}>Window start</label>
                  <input type="date" className={field} value={eStart} onChange={(e) => setEStart(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Window end</label>
                  <input type="date" className={field} value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={submitEdit}
                  className="col-span-2 mt-1 rounded-md bg-navy px-4 py-2 text-[12px] font-semibold text-bg disabled:opacity-60"
                >
                  Save changes
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
