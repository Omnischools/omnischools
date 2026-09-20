"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addFixedAsset, deleteFixedAsset } from "@/lib/actions/books";

type Asset = {
  id: string;
  name: string;
  acquiredOn: string | null;
  originalCost: string;
  accumulatedDepreciation: string;
  condition: string | null;
};

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-[11px] font-semibold text-navy-2";
const CONDITIONS = ["New", "Good", "Fair", "Poor"];
const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function FixedAssets({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [acquiredOn, setAcquiredOn] = useState("");
  const [cost, setCost] = useState("");
  const [dep, setDep] = useState("");
  const [condition, setCondition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const totalBookValue = assets.reduce(
    (s, a) => s + (Number(a.originalCost) - Number(a.accumulatedDepreciation)),
    0,
  );

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addFixedAsset({
      name,
      acquiredOn,
      originalCost: cost,
      accumulatedDepreciation: dep || 0,
      condition,
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setAcquiredOn("");
      setCost("");
      setDep("");
      setCondition("");
      router.refresh();
    } else setError(res.error ?? "Could not add.");
  }

  async function remove(id: string) {
    setBusy(true);
    await deleteFixedAsset({ id });
    setBusy(false);
    setConfirmId(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="font-display text-3xl font-semibold text-navy">
          {ghs(totalBookValue)}
        </div>
        <div className="mt-1 text-sm text-navy-3">
          Total book value · {assets.length} {assets.length === 1 ? "asset" : "assets"}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-display text-base font-medium text-navy">Add an asset</h2>
        <datalist id="asset-conditions">
          {CONDITIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className={labelClass}>Asset</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. School bus (Toyota Coaster)" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Acquired</label>
            <input type="date" value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Original cost (GHS)</label>
            <input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className={`${fieldClass} text-right font-mono`} />
          </div>
          <div>
            <label className={labelClass}>Depreciation to date (GHS)</label>
            <input type="number" min={0} step="0.01" value={dep} onChange={(e) => setDep(e.target.value)} placeholder="0.00" className={`${fieldClass} text-right font-mono`} />
          </div>
          <div>
            <label className={labelClass}>Condition</label>
            <input list="asset-conditions" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Good" className={fieldClass} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={add}
            disabled={busy || !name || !cost}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add asset"}
          </button>
          {error && <span className="text-sm text-terra">{error}</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Asset</th>
              <th className="px-4 py-2.5 font-semibold">Acquired</th>
              <th className="px-4 py-2.5 text-right font-semibold">Original cost</th>
              <th className="px-4 py-2.5 text-right font-semibold">Depreciation</th>
              <th className="px-4 py-2.5 text-right font-semibold">Book value</th>
              <th className="px-4 py-2.5 font-semibold">Condition</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-navy-3">
                  No assets recorded yet.
                </td>
              </tr>
            ) : (
              assets.map((a) => {
                const bv = Number(a.originalCost) - Number(a.accumulatedDepreciation);
                return (
                  <tr key={a.id} className="align-top hover:bg-bg">
                    <td className="px-4 py-2.5 font-medium text-navy">{a.name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-navy-2">
                      {fmtDate(a.acquiredOn)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-navy-2">
                      {ghs(Number(a.originalCost))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-navy-3">
                      {ghs(Number(a.accumulatedDepreciation))}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-navy">{ghs(bv)}</td>
                    <td className="px-4 py-2.5 text-navy-3">{a.condition ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {confirmId === a.id ? (
                        <>
                          <button
                            onClick={() => remove(a.id)}
                            disabled={busy}
                            className="mr-2 text-xs font-semibold text-terra disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="text-xs font-semibold text-navy-3"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmId(a.id)}
                          className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
