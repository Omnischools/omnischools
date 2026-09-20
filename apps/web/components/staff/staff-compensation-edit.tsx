"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStaffCompensation } from "@/lib/actions/staff";
import { Modal } from "@/components/ui/modal";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type StaffCompensationInitial = {
  salaryStatus: string; // SCHOOL_PAID | GES_PAID | ALLOWANCE
  monthlyAmount: string;
  payMethod: string; // BANK | CASH | MOMO
  payCadence: string; // MONTHLY | TERMLY
  ssnitDeduction: string;
  payeDeduction: string;
  effectiveFrom: string;
  notes: string;
};

/** A blank record for staff with no compensation captured yet. */
export const EMPTY_COMPENSATION: StaffCompensationInitial = {
  salaryStatus: "SCHOOL_PAID",
  monthlyAmount: "",
  payMethod: "BANK",
  payCadence: "MONTHLY",
  ssnitDeduction: "",
  payeDeduction: "",
  effectiveFrom: "",
  notes: "",
};

const SALARY_STATUS = [
  { code: "SCHOOL_PAID", label: "School-paid" },
  { code: "GES_PAID", label: "GES-paid" },
  { code: "ALLOWANCE", label: "Allowance-only" },
] as const;

const PAY_METHOD = [
  { code: "BANK", label: "Bank" },
  { code: "CASH", label: "Cash" },
  { code: "MOMO", label: "MoMo" },
] as const;

const PAY_CADENCE = [
  { code: "MONTHLY", label: "Monthly" },
  { code: "TERMLY", label: "Termly" },
] as const;

/**
 * Edit (or first-time set) the compensation record for one staff member. Mirrors
 * staff-profile-edit: a single button that opens a Modal of token-safe inputs,
 * pre-filled from `initial`. Saves via saveStaffCompensation then refreshes.
 */
export function StaffCompensationEdit({
  userId,
  initial,
  hasRecord,
  variant = "primary",
}: {
  userId: string;
  initial: StaffCompensationInitial;
  hasRecord: boolean;
  /** "primary" = navy fill (profile section); "secondary" = outline. */
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<StaffCompensationInitial>(initial);

  function set<K extends keyof StaffCompensationInitial>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    setOpen(false);
    setError(null);
    setForm(initial);
  }

  const net = useMemo(() => {
    const monthly = Number(form.monthlyAmount) || 0;
    const ssnit = Number(form.ssnitDeduction) || 0;
    const paye = Number(form.payeDeduction) || 0;
    return monthly - ssnit - paye;
  }, [form.monthlyAmount, form.ssnitDeduction, form.payeDeduction]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveStaffCompensation({
        userId,
        salaryStatus: form.salaryStatus,
        monthlyAmount: Number(form.monthlyAmount) || 0,
        payMethod: form.payMethod,
        payCadence: form.payCadence,
        ssnitDeduction: Number(form.ssnitDeduction) || 0,
        payeDeduction: Number(form.payeDeduction) || 0,
        effectiveFrom: form.effectiveFrom,
        notes: form.notes,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save the compensation record.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const buttonClass =
    variant === "primary"
      ? "rounded-md bg-navy px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      : "rounded-md border border-border-2 px-3.5 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg";

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClass}>
        {hasRecord ? "Edit compensation" : "Set compensation"}
      </button>

      <Modal open={open} onClose={close} title="Staff compensation">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="max-h-[70vh] space-y-5 overflow-y-auto pr-0.5"
        >
          {/* Status & pay */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Salary &amp; pay
            </legend>
            <div>
              <label className={labelClass}>Salary status</label>
              <select
                value={form.salaryStatus}
                onChange={(e) => set("salaryStatus", e.target.value)}
                className={fieldClass}
              >
                {SALARY_STATUS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Monthly amount (GHS)</label>
              <input
                value={form.monthlyAmount}
                onChange={(e) => set("monthlyAmount", e.target.value)}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Pay method</label>
                <select
                  value={form.payMethod}
                  onChange={(e) => set("payMethod", e.target.value)}
                  className={fieldClass}
                >
                  {PAY_METHOD.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Pay cadence</label>
                <select
                  value={form.payCadence}
                  onChange={(e) => set("payCadence", e.target.value)}
                  className={fieldClass}
                >
                  {PAY_CADENCE.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          {/* Deductions */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Deductions
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>SSNIT deduction</label>
                <input
                  value={form.ssnitDeduction}
                  onChange={(e) => set("ssnitDeduction", e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>PAYE deduction</label>
                <input
                  value={form.payeDeduction}
                  onChange={(e) => set("payeDeduction", e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>
            </div>
            {/* Computed net */}
            <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3.5 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
                Net (monthly − SSNIT − PAYE)
              </span>
              <span className="font-mono text-sm font-semibold text-navy">{ghs(net)}</span>
            </div>
          </fieldset>

          {/* Effective & notes */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Effective &amp; notes
            </legend>
            <div>
              <label className={labelClass}>Effective from</label>
              <input
                value={form.effectiveFrom}
                onChange={(e) => set("effectiveFrom", e.target.value)}
                type="date"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Notes <span className="font-medium text-navy-3">— optional</span>
              </label>
              <input
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. step on GES scale, allowance basis"
                className={fieldClass}
              />
            </div>
          </fieldset>

          {error && <p className="text-sm text-terra">{error}</p>}

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save compensation"}
            </button>
            <button
              type="button"
              onClick={close}
              className="text-sm font-semibold text-navy-2 hover:text-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
