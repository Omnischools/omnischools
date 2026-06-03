"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GH_REGIONS,
  OWNERSHIPS,
  ONBOARD_PRODUCTS,
  PRODUCT_LABELS,
  type OnboardInput,
  type OnboardResult,
} from "@/lib/onboarding";
import { onboardSchool } from "@/lib/actions/onboarding";

const STEPS = ["School", "Product", "Headmaster", "Admin", "Confirm"];

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

type Form = Partial<OnboardInput>;

function academicYearLabel(now = new Date()): string {
  const y = now.getFullYear();
  const start = now.getMonth() >= 8 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>({ product: "BASIC", ownership: "PUBLIC" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Extract<OnboardResult, { ok: true }> | null>(null);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const stepValid = (): string | null => {
    if (step === 0) {
      if (!form.schoolName) return "Enter the school name.";
      if (!form.gesCode) return "Enter the GES code.";
      if (!form.region) return "Choose a region.";
      if (!form.district) return "Enter the district.";
    }
    if (step === 2) {
      if (!form.headmasterName) return "Enter the headmaster's name.";
      if (!form.headmasterPhone) return "Enter the headmaster's phone.";
    }
    if (step === 3) {
      if (!form.adminName) return "Enter the admin's name.";
      if (!form.adminPhone) return "Enter the admin's phone.";
    }
    return null;
  };

  const next = () => {
    const err = stepValid();
    if (err) return setError(err);
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await onboardSchool(form);
    setSubmitting(false);
    if (res.ok) setResult(res);
    else setError(res.error);
  }

  if (result) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-9 text-center shadow-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-bg font-display text-xl text-green">
          ✓
        </div>
        <h2 className="mb-2 font-display text-3xl font-semibold text-navy">
          {form.schoolName} is{" "}
          <em className="not-italic text-gold [font-style:italic]">live.</em>
        </h2>
        <p className="mx-auto mb-6 max-w-[420px] text-sm text-navy-2">
          Academic year <b className="text-navy">{result.academicYear}</b> configured with{" "}
          {result.periodsCreated > 0
            ? `${result.periodsCreated} ${form.product === "SENIOR" ? "semesters" : "terms"}`
            : "its period structure"}
          . A welcome SMS is on its way to your admin number.
        </p>
        <p className="mb-7 font-mono text-xs text-navy-3">
          school id · {result.schoolId}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="text-bg rounded-md bg-navy px-6 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep"
          >
            Go to sign in
          </Link>
          <Link
            href="/"
            className="border-border-2 hover:bg-bg rounded-md border px-6 py-3 text-sm font-semibold text-navy transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-7 shadow-md md:p-9">
      {/* stepper */}
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                i < step && "bg-green text-white",
                i === step && "text-bg bg-navy",
                i > step && "bg-gold-bg text-navy-3",
              )}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "hidden text-xs font-semibold sm:inline",
                i === step ? "text-navy" : "text-navy-3",
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {/* steps */}
      {step === 0 && (
        <div className="space-y-[18px]">
          <h2 className="font-display text-2xl font-semibold text-navy">
            School details
          </h2>
          <div>
            <label className={labelClass}>School name</label>
            <input
              className={fieldClass}
              value={form.schoolName ?? ""}
              onChange={(e) => set("schoolName", e.target.value)}
              placeholder="e.g. Asankrangwa Senior High School"
            />
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>GES code</label>
              <input
                className={fieldClass}
                value={form.gesCode ?? ""}
                onChange={(e) => set("gesCode", e.target.value)}
                placeholder="e.g. WR-WAW-014"
              />
            </div>
            <div>
              <label className={labelClass}>Ownership</label>
              <select
                className={fieldClass}
                value={form.ownership}
                onChange={(e) => set("ownership", e.target.value)}
              >
                {OWNERSHIPS.map((o) => (
                  <option key={o} value={o}>
                    {o.charAt(0) + o.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Region</label>
              <select
                className={fieldClass}
                value={form.region ?? ""}
                onChange={(e) => set("region", e.target.value)}
              >
                <option value="" disabled>
                  Choose a region
                </option>
                {GH_REGIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>District</label>
              <input
                className={fieldClass}
                value={form.district ?? ""}
                onChange={(e) => set("district", e.target.value)}
                placeholder="e.g. Wassa Amenfi West"
              />
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-[18px]">
          <h2 className="font-display text-2xl font-semibold text-navy">
            Which product?
          </h2>
          <p className="text-sm text-navy-2">
            This sets your default academic calendar — Basic uses 3 terms, Senior uses 2
            semesters (the GES standard).
          </p>
          <div className="space-y-3">
            {ONBOARD_PRODUCTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set("product", p)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-5 py-4 text-left transition-colors",
                  form.product === p
                    ? "border-gold bg-gold-bg"
                    : "bg-bg border-border hover:border-gold-soft",
                )}
              >
                <span className="font-display text-base font-semibold text-navy">
                  {PRODUCT_LABELS[p]}
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    form.product === p
                      ? "border-gold bg-gold text-navy"
                      : "border-border-2",
                  )}
                >
                  {form.product === p && "✓"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-[18px]">
          <h2 className="font-display text-2xl font-semibold text-navy">Headmaster</h2>
          <div>
            <label className={labelClass}>Full name</label>
            <input
              className={fieldClass}
              value={form.headmasterName ?? ""}
              onChange={(e) => set("headmasterName", e.target.value)}
              placeholder="e.g. V. Yanney"
            />
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Phone (Ghana)</label>
              <input
                className={fieldClass}
                value={form.headmasterPhone ?? ""}
                onChange={(e) => set("headmasterPhone", e.target.value)}
                placeholder="024 000 0000"
              />
            </div>
            <div>
              <label className={labelClass}>
                Email <span className="font-medium text-navy-3">— optional</span>
              </label>
              <input
                className={fieldClass}
                type="email"
                value={form.headmasterEmail ?? ""}
                onChange={(e) => set("headmasterEmail", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-[18px]">
          <h2 className="font-display text-2xl font-semibold text-navy">
            Initial admin user
          </h2>
          <p className="text-sm text-navy-2">
            This person signs in first and sets up the rest of the school. They&apos;ll
            get the ADMIN role.
          </p>
          <div>
            <label className={labelClass}>Full name</label>
            <input
              className={fieldClass}
              value={form.adminName ?? ""}
              onChange={(e) => set("adminName", e.target.value)}
              placeholder="e.g. School Office"
            />
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Phone (Ghana)</label>
              <input
                className={fieldClass}
                value={form.adminPhone ?? ""}
                onChange={(e) => set("adminPhone", e.target.value)}
                placeholder="024 000 0000"
              />
            </div>
            <div>
              <label className={labelClass}>
                Email <span className="font-medium text-navy-3">— optional</span>
              </label>
              <input
                className={fieldClass}
                type="email"
                value={form.adminEmail ?? ""}
                onChange={(e) => set("adminEmail", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold text-navy">
            Confirm &amp; create
          </h2>
          <dl className="bg-bg divide-y divide-border rounded-xl border border-border">
            {[
              ["School", `${form.schoolName} · ${form.gesCode}`],
              ["Location", `${form.district}, ${form.region} Region`],
              ["Product", PRODUCT_LABELS[form.product ?? "BASIC"]],
              ["Ownership", form.ownership],
              ["Headmaster", `${form.headmasterName} · ${form.headmasterPhone}`],
              ["Admin", `${form.adminName} · ${form.adminPhone}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="font-semibold text-navy-3">{k}</dt>
                <dd className="text-right text-navy">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-xl border border-gold-soft bg-gold-bg p-4 text-sm text-navy-2">
            We&apos;ll create the school, its product subscription, the admin &amp;
            headmaster users, and seed the{" "}
            <b className="text-navy">{academicYearLabel()}</b> calendar (
            {form.product === "SENIOR" ? "2 semesters" : "3 terms"} per the GES standard).
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-terra">{error}</p>}

      {/* controls */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={step === 0 || submitting}
          className="hover:bg-bg rounded-md px-4 py-2.5 text-sm font-semibold text-navy-2 transition-colors disabled:opacity-0"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="text-bg rounded-md bg-navy px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-navy-deep"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-gold px-6 py-2.5 text-sm font-semibold text-navy transition-colors hover:brightness-95 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create school"}
          </button>
        )}
      </div>
    </div>
  );
}
