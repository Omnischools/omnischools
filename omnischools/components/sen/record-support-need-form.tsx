"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordSupportNeed } from "@/lib/actions/sen";
import type { SenCandidateStudent } from "@/lib/sen/register-data";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";

/**
 * GOV-10 · the "Record support need" form — THE CONSENT ENFORCEMENT POINT (R410). Consent state drives the
 * shape: GRANTED unlocks the full detail (and requires the consent date); PENDING records category ONLY (the
 * child still counts in the de-identified census, no detail). The server action re-enforces this and the DB
 * CHECK is the final backstop — the UI just makes the boundary legible.
 */

const inputCls =
  "mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none";
const capCls = "text-[11px] font-semibold uppercase tracking-wide text-navy-3";

export function RecordSupportNeedForm({ candidates }: { candidates: SenCandidateStudent[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState<"GRANTED" | "PENDING">("GRANTED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const strOpt = (k: string) => {
      const v = fd.get(k);
      return v && String(v).trim() ? String(v).trim() : null;
    };
    const granted = consent === "GRANTED";
    const accommodations = granted
      ? (strOpt("accommodations") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

    setBusy(true);
    setError(null);
    const res = await recordSupportNeed({
      studentId: String(fd.get("studentId") ?? ""),
      category: String(fd.get("category") ?? ""),
      consentState: consent,
      severity: granted ? strOpt("severity") : null,
      supportNotes: granted ? strOpt("supportNotes") : null,
      accommodations: accommodations && accommodations.length > 0 ? accommodations : null,
      diagnosisSource: granted ? strOpt("diagnosisSource") : null,
      diagnosingClinician: granted ? strOpt("diagnosingClinician") : null,
      diagnosingInstitution: granted ? strOpt("diagnosingInstitution") : null,
      diagnosisYear: granted && strOpt("diagnosisYear") ? Number(fd.get("diagnosisYear")) : null,
      consentOnFileAt: granted ? strOpt("consentOnFileAt") : null,
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        title={candidates.length === 0 ? "Every active student already has a record" : undefined}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        + Record support need
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg font-semibold text-navy">Record a support need</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-navy-3 hover:text-navy"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={capCls}>Student</span>
          <select name="studentId" required defaultValue="" className={inputCls}>
            <option value="" disabled>
              Select a student…
            </option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.className ? ` — ${s.className}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={capCls}>Support category</span>
          <select name="category" required defaultValue="" className={inputCls}>
            <option value="" disabled>
              Select a category…
            </option>
            {SEN_CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {SEN_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="rounded-lg border border-border bg-bg p-3">
        <span className={capCls}>Parental consent</span>
        <div className="mt-2 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-navy-2">
            <input
              type="radio"
              name="consent"
              className="mt-0.5"
              checked={consent === "GRANTED"}
              onChange={() => setConsent("GRANTED")}
            />
            <span>
              <b className="text-navy">Consent is on file.</b> Record the full support detail below.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-navy-2">
            <input
              type="radio"
              name="consent"
              className="mt-0.5"
              checked={consent === "PENDING"}
              onChange={() => setConsent("PENDING")}
            />
            <span>
              <b className="text-navy">Consent pending.</b> Record the <b>category only</b> — no support
              detail is stored, and the child is still counted in the de-identified census.
            </span>
          </label>
        </div>
      </fieldset>

      {consent === "GRANTED" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={capCls}>Severity (optional)</span>
              <select name="severity" defaultValue="" className={inputCls}>
                <option value="">Not set</option>
                <option value="MILD">Mild</option>
                <option value="MODERATE">Moderate</option>
                <option value="SEVERE">Severe</option>
              </select>
            </label>
            <label className="block">
              <span className={capCls}>Date consent filed</span>
              <input type="date" name="consentOnFileAt" required className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={capCls}>Support notes (optional)</span>
            <textarea
              name="supportNotes"
              rows={2}
              maxLength={500}
              placeholder="Plain-English description of the support need"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={capCls}>Accommodations (optional, comma-separated)</span>
            <input
              type="text"
              name="accommodations"
              placeholder="Front-row seating, Larger print, Extra exam time"
              className={inputCls}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={capCls}>Determination</span>
              <select name="diagnosisSource" defaultValue="" className={inputCls}>
                <option value="">Not set</option>
                <option value="CLINICAL_DIAGNOSIS">Clinical diagnosis</option>
                <option value="SCHOOL_OBSERVED">School-observed</option>
              </select>
            </label>
            <label className="block">
              <span className={capCls}>Clinician (optional)</span>
              <input type="text" name="diagnosingClinician" className={inputCls} />
            </label>
            <label className="block">
              <span className={capCls}>Year (optional)</span>
              <input type="number" name="diagnosisYear" min={1950} max={2100} className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={capCls}>Institution (optional)</span>
            <input type="text" name="diagnosingInstitution" className={inputCls} />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-terra">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save record"}
        </button>
      </div>
    </form>
  );
}
