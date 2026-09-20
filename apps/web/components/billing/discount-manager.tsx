"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDiscount, deleteDiscount, approveDiscount } from "@/lib/actions/billing";

const ghs = (n: number) => `GHS ${n.toFixed(2)}`;
const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const ordinal = (n: number) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

type Tier = { rank: number; value: number };
type DiscountRow = {
  id: string;
  name: string;
  kind: string;
  value: number;
  appliesToCategoryName: string | null;
  durationLabel: string | null;
  requiresApproval: boolean;
  approved: boolean;
  stackable: boolean;
  isTiered: boolean;
  appliedCount: number;
  tiers: Tier[];
};
type Category = { id: string; name: string };

const fmtValue = (kind: string, value: number) =>
  kind === "PERCENT" ? `${value}%` : ghs(value);

export function DiscountManager({
  discounts,
  categories,
}: {
  discounts: DiscountRow[];
  categories: Category[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("FIXED");
  const [value, setValue] = useState("");
  const [appliesTo, setAppliesTo] = useState("");
  const [duration, setDuration] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [stackable, setStackable] = useState(true);
  const [isTiered, setIsTiered] = useState(false);
  const [tiers, setTiers] = useState<{ rank: number; value: string }[]>([
    { rank: 1, value: "" },
    { rank: 2, value: "" },
    { rank: 3, value: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setValue("");
    setAppliesTo("");
    setDuration("");
    setRequiresApproval(false);
    setStackable(true);
    setIsTiered(false);
    setTiers([
      { rank: 1, value: "" },
      { rank: 2, value: "" },
      { rank: 3, value: "" },
    ]);
  }

  async function add() {
    setSaving(true);
    setError(null);
    const res = await createDiscount({
      name,
      kind,
      value: isTiered ? 0 : value,
      appliesToCategoryId: appliesTo || null,
      durationLabel: duration || null,
      requiresApproval,
      stackable,
      isTiered,
      tiers: isTiered
        ? tiers
            .filter((t) => t.value !== "")
            .map((t) => ({ rank: t.rank, value: t.value }))
        : undefined,
    });
    setSaving(false);
    if (res.ok) {
      reset();
      router.refresh();
    } else setError(res.error ?? "Could not create.");
  }

  async function remove(id: string) {
    setSaving(true);
    await deleteDiscount({ id });
    setSaving(false);
    router.refresh();
  }

  async function approve(id: string) {
    setSaving(true);
    await approveDiscount({ id });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-navy-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Sibling discount"
              className={fieldClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-navy-2">
              Applies to
            </label>
            <select
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              className={fieldClass}
            >
              <option value="">Whole invoice</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-navy-2">Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={fieldClass}
            >
              <option value="FIXED">Fixed (GHS)</option>
              <option value="PERCENT">Percent (%)</option>
            </select>
          </div>
          {!isTiered && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-navy-2">Value</label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type="number"
                min={0}
                step="0.01"
                placeholder="50"
                className={`${fieldClass} w-24`}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-navy-2">
              Duration <span className="font-normal text-navy-3">— optional</span>
            </label>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 1 term"
              className={`${fieldClass} w-28`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-navy-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isTiered}
              onChange={(e) => setIsTiered(e.target.checked)}
              className="h-4 w-4 accent-navy"
            />
            Sibling-rank tiers
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
              className="h-4 w-4 accent-navy"
            />
            Can stack with other discounts
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="h-4 w-4 accent-navy"
            />
            Requires head approval
          </label>
        </div>

        {isTiered && (
          <div className="rounded-lg border border-border-2 bg-bg p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-3">
              Value per sibling rank ({kind === "PERCENT" ? "%" : "GHS"})
            </div>
            <div className="flex flex-wrap gap-2">
              {tiers.map((t, i) => (
                <div key={t.rank} className="flex items-center gap-1.5">
                  <span className="w-16 text-xs text-navy-3">{ordinal(t.rank)} child</span>
                  <input
                    value={t.value}
                    onChange={(e) =>
                      setTiers((prev) =>
                        prev.map((p, j) =>
                          j === i ? { ...p, value: e.target.value } : p,
                        ),
                      )
                    }
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    className={`${fieldClass} w-20`}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setTiers((prev) => [
                    ...prev,
                    { rank: prev.length + 1, value: "" },
                  ])
                }
                className="text-xs font-semibold text-gold hover:underline"
              >
                + add rank
              </button>
            </div>
          </div>
        )}

        <div>
          <button
            onClick={add}
            disabled={saving || !name}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            Add discount
          </button>
        </div>
        {error && <p className="text-sm text-terra">{error}</p>}
      </div>

      {discounts.length > 0 && (
        <div className="mt-4 divide-y divide-border border-t border-border">
          {discounts.map((d) => (
            <div key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="font-medium text-navy">{d.name}</div>
                <div className="mt-0.5 text-sm text-navy-2">
                  {d.isTiered
                    ? d.tiers
                        .sort((a, b) => a.rank - b.rank)
                        .map((t) => `${ordinal(t.rank)} ${fmtValue(d.kind, t.value)}`)
                        .join(" · ")
                    : fmtValue(d.kind, d.value)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge>{d.appliesToCategoryName ?? "Whole invoice"}</Badge>
                  {d.isTiered && <Badge>Sibling tiers</Badge>}
                  {d.durationLabel && <Badge>{d.durationLabel}</Badge>}
                  <Badge>{d.stackable ? "Stacks" : "Exclusive"}</Badge>
                  {d.requiresApproval &&
                    (d.approved ? (
                      <Badge tone="green">Approved</Badge>
                    ) : (
                      <Badge tone="warn">Needs approval</Badge>
                    ))}
                  <Badge tone="muted">Applied {d.appliedCount}×</Badge>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {d.requiresApproval && !d.approved && (
                  <button
                    onClick={() => approve(d.id)}
                    disabled={saving}
                    className="text-xs font-semibold text-green transition-colors hover:underline disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                <button
                  onClick={() => remove(d.id)}
                  disabled={saving}
                  className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "green" | "warn" | "muted";
}) {
  const cls =
    tone === "green"
      ? "bg-green-bg text-green"
      : tone === "warn"
        ? "bg-warn-bg text-warn"
        : tone === "muted"
          ? "bg-bg text-navy-3"
          : "bg-gold-bg text-navy";
  return <span className={`rounded-pill px-2 py-0.5 font-medium ${cls}`}>{children}</span>;
}
