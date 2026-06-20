"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addBookEntry, deleteBookEntry } from "@/lib/actions/books";

type Kind = "INCOME" | "EXPENSE";
type Cat = { id: string; name: string };
type Entry = {
  id: string;
  entryDate: string;
  category: string | null;
  description: string | null;
  party: string | null;
  method: string | null;
  reference: string | null;
  amount: string;
};

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-[11px] font-semibold text-navy-2";
const METHODS = ["Cash", "MTN MoMo", "Telecel Cash", "AirtelTigo Money", "Bank transfer", "Cheque"];

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function BookEntries({
  kind,
  categories,
  entries,
}: {
  kind: Kind;
  categories: Cat[];
  entries: Entry[];
}) {
  const router = useRouter();
  const income = kind === "INCOME";
  const partyLabel = income ? "Source" : "Payee";
  const todayDefault = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(todayDefault);
  const [categoryId, setCategoryId] = useState("");
  const [party, setParty] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const total = entries.reduce((s, e) => s + Number(e.amount), 0);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addBookEntry({
      kind,
      entryDate: date,
      categoryId,
      party,
      method,
      reference,
      amount,
      description,
    });
    setBusy(false);
    if (res.ok) {
      setParty("");
      setReference("");
      setAmount("");
      setDescription("");
      router.refresh();
    } else setError(res.error ?? "Could not save.");
  }

  async function remove(id: string) {
    setBusy(true);
    await deleteBookEntry({ id });
    setBusy(false);
    setConfirmId(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Total */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className={`font-display text-3xl font-semibold ${income ? "text-green" : "text-terra"}`}>
          {ghs(total)}
        </div>
        <div className="mt-1 text-sm text-navy-3">
          Total {income ? "income" : "expenses"} · {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </div>
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-display text-base font-medium text-navy">
          Record {income ? "income" : "an expense"}
        </h2>
        <datalist id="book-methods">
          {METHODS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={fieldClass}>
              <option value="">— choose —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{partyLabel}</label>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder={income ? "Who paid" : "Paid to"}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Method</label>
            <input list="book-methods" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Cash" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{income ? "Reference" : "Receipt #"}</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Amount (GHS)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`${fieldClass} text-right font-mono`}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>
              Note <span className="font-medium text-navy-3">— optional</span>
            </label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={add}
            disabled={busy || !amount}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : income ? "Add income" : "Add expense"}
          </button>
          {error && <span className="text-sm text-terra">{error}</span>}
        </div>
      </div>

      {/* Entries table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 font-semibold">{partyLabel} / note</th>
              <th className="px-4 py-2.5 font-semibold">Method</th>
              <th className="px-4 py-2.5 font-semibold">{income ? "Ref" : "Receipt"}</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-navy-3">
                  No {income ? "income" : "expenses"} recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="align-top hover:bg-bg">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-navy-2">
                    {fmtDate(e.entryDate)}
                  </td>
                  <td className="px-4 py-2.5 text-navy-2">{e.category ?? "—"}</td>
                  <td className="px-4 py-2.5 text-navy-2">
                    {e.party || e.description || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-navy-3">{e.method ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-navy-3">
                    {e.reference ?? "—"}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${income ? "text-green" : "text-terra"}`}>
                    {ghs(Number(e.amount))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {confirmId === e.id ? (
                      <>
                        <button
                          onClick={() => remove(e.id)}
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
                        onClick={() => setConfirmId(e.id)}
                        className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
