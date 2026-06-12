"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateInvoicesForClass, deleteFeeStructure } from "@/lib/actions/billing";

const ghs = (n: number) => `GH₵ ${n.toFixed(2)}`;

type Structure = {
  id: string;
  name: string;
  level: string | null;
  academicYear: string;
  items: { description: string; amount: number }[];
  total: number;
};
type ClassOpt = { id: string; name: string };
type DiscountOpt = { id: string; name: string; kind: string; value: number };

export function FeeStructureCard({
  structure,
  classes,
  discounts,
}: {
  structure: Structure;
  classes: ClassOpt[];
  discounts: DiscountOpt[];
}) {
  const router = useRouter();
  const [classId, setClassId] = useState("");
  const [discountId, setDiscountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!classId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await generateInvoicesForClass({
      structureId: structure.id,
      classId,
      discountId: discountId || null,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(
        `Created ${res.created} invoice${res.created === 1 ? "" : "s"}${res.skipped ? `, skipped ${res.skipped} already billed` : ""}.`,
      );
      router.refresh();
    } else setError(res.error ?? "Could not generate.");
  }

  async function remove() {
    if (!confirm(`Delete fee structure “${structure.name}”?`)) return;
    setBusy(true);
    const res = await deleteFeeStructure({ id: structure.id });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not delete.");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-navy">
            {structure.name}
          </h3>
          <p className="text-xs text-navy-3">
            {structure.level ? `${structure.level} · ` : ""}
            {structure.academicYear}
          </p>
        </div>
        <button
          onClick={remove}
          disabled={busy}
          className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      <ul className="mt-3 space-y-1 border-y border-border py-3 text-sm">
        {structure.items.map((it, i) => (
          <li key={i} className="flex justify-between">
            <span className="text-navy-2">{it.description}</span>
            <span className="font-mono text-xs text-navy-3">{ghs(it.amount)}</span>
          </li>
        ))}
        <li className="flex justify-between pt-1 font-medium">
          <span className="text-navy">Total</span>
          <span className="text-navy">{ghs(structure.total)}</span>
        </li>
      </ul>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-semibold text-navy-2">
          Generate invoices for a class
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
          >
            <option value="">Choose class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {discounts.length > 0 && (
            <select
              value={discountId}
              onChange={(e) => setDiscountId(e.target.value)}
              className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">No discount</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.kind === "PERCENT" ? `${d.value}%` : ghs(d.value)})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={generate}
            disabled={busy || !classId}
            className="rounded-md bg-navy px-3.5 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Working…" : "Generate"}
          </button>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-green">{msg}</p>}
        {error && <p className="mt-2 text-xs text-terra">{error}</p>}
      </div>
    </div>
  );
}
