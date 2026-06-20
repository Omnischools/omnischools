"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addBookCategory,
  renameBookCategory,
  setBookCategoryActive,
  seedDefaultBookCategories,
} from "@/lib/actions/books";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/field-options";

type Cat = { id: string; name: string; kind: "INCOME" | "EXPENSE"; active: boolean };
const inputClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

function Row({ c }: { c: Cat }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await renameBookCategory({ id: c.id, name });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
  }
  async function toggle() {
    setBusy(true);
    await setBookCategoryActive({ id: c.id, active: !c.active });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      {editing ? (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <button
            onClick={save}
            disabled={busy}
            className="text-xs font-semibold text-green disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setName(c.name);
            }}
            className="text-xs font-semibold text-navy-3"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span
            className={`flex-1 text-sm ${c.active ? "text-navy" : "text-navy-3 line-through"}`}
          >
            {c.name}
          </span>
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="text-xs font-semibold text-navy-3 transition-colors hover:text-gold"
          >
            Edit
          </button>
          <button
            onClick={toggle}
            disabled={busy}
            className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
          >
            {c.active ? "Archive" : "Restore"}
          </button>
        </>
      )}
    </div>
  );
}

function AddRow({ kind, listId }: { kind: "INCOME" | "EXPENSE"; listId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await addBookCategory({ name, kind });
    setBusy(false);
    if (res.ok) {
      setName("");
      router.refresh();
    } else setError(res.error ?? "Could not add.");
  }

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
      <input
        list={listId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        placeholder={kind === "INCOME" ? "e.g. Sports levy" : "e.g. Generator fuel"}
        className={inputClass}
      />
      <button
        onClick={add}
        disabled={busy}
        className="shrink-0 rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-gold-bg disabled:opacity-50"
      >
        Add
      </button>
      {error && <span className="text-xs text-terra">{error}</span>}
    </div>
  );
}

export function ChartOfAccounts({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const income = categories.filter((c) => c.kind === "INCOME");
  const expense = categories.filter((c) => c.kind === "EXPENSE");

  async function seed() {
    setSeeding(true);
    await seedDefaultBookCategories();
    setSeeding(false);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <datalist id="dl-income">
        {INCOME_CATEGORIES.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="dl-expense">
        {EXPENSE_CATEGORIES.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      {categories.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-2 bg-bg p-5">
          <div>
            <div className="font-display text-base font-medium text-navy">
              No categories yet
            </div>
            <p className="text-[12px] text-navy-3">
              Load the GES-typical income &amp; expense set, then tweak — or add your own
              below.
            </p>
          </div>
          <button
            onClick={seed}
            disabled={seeding}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {seeding ? "Loading…" : "Load default categories"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-medium text-green">
            Income categories <span className="text-navy-3">· {income.length}</span>
          </h2>
          <div className="mt-2 divide-y divide-border">
            {income.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
          <AddRow kind="INCOME" listId="dl-income" />
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-medium text-terra">
            Expense categories <span className="text-navy-3">· {expense.length}</span>
          </h2>
          <div className="mt-2 divide-y divide-border">
            {expense.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
          <AddRow kind="EXPENSE" listId="dl-expense" />
        </div>
      </div>
    </div>
  );
}
