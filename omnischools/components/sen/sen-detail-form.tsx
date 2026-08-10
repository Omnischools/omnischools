"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { editSenRecord, grantSenConsent } from "@/lib/actions/sen";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";
import type { SenRecord } from "@/lib/sen/register-data";

/**
 * GOV-10b · the shared SEN detail form (R439/R440). Two modes:
 *  - "consent" — PENDING→GRANTED: records written consent (date REQUIRED) + the now-permitted detail cluster.
 *  - "edit"    — amend a GRANTED record's category/detail.
 * Both submit the confidential detail cluster; the server nulls anything not permitted and audits values-free.
 */
const inputCls =
  "mt-1 w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";
const capCls = "text-[11px] font-semibold uppercase tracking-wide text-navy-3";

type Props =
  | { mode: "consent"; recordId: string; category: string; onDone: () => void }
  | { mode: "edit"; record: SenRecord; onDone: () => void };

export function SenDetailForm(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = props.mode === "edit" ? props.record : null;
  const [category, setCategory] = useState(rec?.category ?? ""); // edit mode: drives offerable secondaries

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string): string | null => {
      const v = fd.get(k);
      return v && String(v).trim() ? String(v).trim() : null;
    };
    const accStr = str("accommodations");
    const accommodations = accStr
      ? accStr.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const detail = {
      severity: str("severity"),
      supportNotes: str("supportNotes"),
      accommodations: accommodations && accommodations.length > 0 ? accommodations : null,
      diagnosisSource: str("diagnosisSource"),
      diagnosingClinician: str("diagnosingClinician"),
      diagnosingInstitution: str("diagnosingInstitution"),
      diagnosisYear: str("diagnosisYear") ? Number(fd.get("diagnosisYear")) : null,
    };

    setBusy(true);
    setError(null);
    const secondaryCategories = [...new Set(fd.getAll("secondaryCategories").map(String))].filter(
      (c) => c !== category,
    );
    const res =
      props.mode === "consent"
        ? await grantSenConsent({ recordId: props.recordId, consentOnFileAt: str("consentOnFileAt"), ...detail })
        : await editSenRecord({
            recordId: props.record.id,
            category,
            secondaryCategories,
            consentOnFileAt: str("consentOnFileAt"),
            ...detail,
          });
    setBusy(false);
    if (res.ok) {
      props.onDone();
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-3 rounded-lg border border-border bg-bg p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {props.mode === "edit" ? (
          <label className="block">
            <span className={capCls}>Primary category</span>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              {SEN_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {SEN_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className={capCls}>Severity</span>
          <select name="severity" defaultValue={rec?.severity ?? ""} className={inputCls}>
            <option value="">Not set</option>
            <option value="MILD">Mild</option>
            <option value="MODERATE">Moderate</option>
            <option value="SEVERE">Severe</option>
          </select>
        </label>
        <label className="block">
          <span className={capCls}>Date consent filed{props.mode === "consent" ? " (required)" : ""}</span>
          <input
            type="date"
            name="consentOnFileAt"
            required={props.mode === "consent"}
            defaultValue={rec?.consentOnFileAt ?? ""}
            className={inputCls}
          />
        </label>
      </div>
      {props.mode === "edit" && category && (
        <fieldset className="rounded-lg border border-border bg-surface p-2.5">
          <span className={capCls}>Additional categories</span>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {SEN_CATEGORY_ORDER.filter((c) => c !== category).map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm text-navy-2">
                <input
                  type="checkbox"
                  name="secondaryCategories"
                  value={c}
                  defaultChecked={rec?.secondaryCategories.includes(c) ?? false}
                />
                {SEN_CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block">
        <span className={capCls}>Support notes</span>
        <textarea name="supportNotes" rows={2} maxLength={500} defaultValue={rec?.supportNotes ?? ""} className={inputCls} />
      </label>
      <label className="block">
        <span className={capCls}>Accommodations (comma-separated)</span>
        <input type="text" name="accommodations" defaultValue={rec?.accommodations.join(", ") ?? ""} className={inputCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={capCls}>Determination</span>
          <select name="diagnosisSource" defaultValue={rec?.diagnosisSource ?? ""} className={inputCls}>
            <option value="">Not set</option>
            <option value="CLINICAL_DIAGNOSIS">Clinical diagnosis</option>
            <option value="SCHOOL_OBSERVED">School-observed</option>
          </select>
        </label>
        <label className="block">
          <span className={capCls}>Clinician</span>
          <input type="text" name="diagnosingClinician" defaultValue={rec?.diagnosingClinician ?? ""} className={inputCls} />
        </label>
        <label className="block">
          <span className={capCls}>Year</span>
          <input type="number" name="diagnosisYear" min={1950} max={2100} defaultValue={rec?.diagnosisYear ?? ""} className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className={capCls}>Institution</span>
        <input type="text" name="diagnosingInstitution" defaultValue={rec?.diagnosingInstitution ?? ""} className={inputCls} />
      </label>
      {error && <p className="text-sm text-terra">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-4 py-2 text-sm font-bold text-bg hover:bg-navy-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : props.mode === "consent" ? "Record consent" : "Save changes"}
        </button>
        <button type="button" onClick={props.onDone} className="text-xs font-semibold text-navy-3 hover:text-navy">
          Cancel
        </button>
      </div>
    </form>
  );
}
