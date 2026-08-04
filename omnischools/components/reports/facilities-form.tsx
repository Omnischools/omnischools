"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveFacilitiesSnapshot } from "@/lib/actions/facilities";
import type { AcademicTerm } from "@/lib/reports/academic-term";

/**
 * GOV-7 · manual capture of ONE termly facilities snapshot. NATIVE inputs only — no picker libs (R383,
 * no CSV import). Upserts on (school, term), so re-submitting a term corrects it. Core fields (classrooms,
 * all WASH, presence booleans) are required; the optional detail is nullable. `pctGood` / latrine total
 * are worked out on read, never entered.
 */

const inputCls =
  "mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none";
const labelCls = "block";
const capCls = "text-xs font-semibold uppercase tracking-wide text-navy-3";

const WATER = ["BOREHOLE", "PIPE", "WELL", "NONE"];
const POWER = ["GRID", "SOLAR", "GENERATOR", "NONE"];
const LATRINE = ["WC", "KVIP", "PIT", "NONE"];

export function FacilitiesForm({
  terms,
  defaultPeriodId,
}: {
  terms: AcademicTerm[];
  defaultPeriodId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const numReq = (k: string) => Number(fd.get(k) ?? 0);
    const numOpt = (k: string) => {
      const v = fd.get(k);
      return v == null || v === "" ? null : Number(v);
    };
    const strOpt = (k: string) => {
      const v = fd.get(k);
      return v && String(v).trim() ? String(v).trim() : null;
    };
    const enumOpt = (k: string) => {
      const v = fd.get(k);
      return v && v !== "" ? String(v) : null;
    };
    const bool = (k: string) => fd.get(k) === "on";

    setBusy(true);
    setError(null);
    setDone(null);
    const res = await saveFacilitiesSnapshot({
      periodId: String(fd.get("periodId") ?? ""),
      classroomsTotal: numReq("classroomsTotal"),
      classroomsGood: numReq("classroomsGood"),
      classroomsRepair: numReq("classroomsRepair"),
      waterSource: String(fd.get("waterSource") ?? ""),
      electricitySource: String(fd.get("electricitySource") ?? ""),
      latrinesBoys: numReq("latrinesBoys"),
      latrinesGirls: numReq("latrinesGirls"),
      latrinesStaff: numReq("latrinesStaff"),
      latrineType: String(fd.get("latrineType") ?? ""),
      handwashing: bool("handwashing"),
      hasLibrary: bool("hasLibrary"),
      hasIctLab: bool("hasIctLab"),
      internet: bool("internet"),
      hasKitchen: bool("hasKitchen"),
      gsfpParticipating: bool("gsfpParticipating"),
      libraryBookCount: numOpt("libraryBookCount"),
      libraryStaffFte: numOpt("libraryStaffFte"),
      computersTotal: numOpt("computersTotal"),
      computersWorking: numOpt("computersWorking"),
      internetType: strOpt("internetType"),
      mealsServedLastTerm: numOpt("mealsServedLastTerm"),
      pupilsFedDailyAvg: numOpt("pupilsFedDailyAvg"),
      catererName: strOpt("catererName"),
      textbookAvailability: enumOpt("textbookAvailability"),
      studentDesksUsable: numOpt("studentDesksUsable"),
      studentDesksBroken: numOpt("studentDesksBroken"),
      teacherDesks: numOpt("teacherDesks"),
      chalkboards: numOpt("chalkboards"),
      whiteboards: numOpt("whiteboards"),
      projectors: numOpt("projectors"),
      note: strOpt("note"),
    });
    setBusy(false);
    if (res.ok) {
      setDone("Snapshot saved for the selected term.");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-navy">Capture a snapshot</h2>
        <p className="text-sm text-navy-3">
          A once-a-term census of the school&apos;s buildings and services. Re-submitting a term updates
          it. The percentage of sound classrooms and total latrines are worked out for you.
        </p>
      </div>

      {/* Term */}
      <label className={labelCls}>
        <span className={capCls}>Term</span>
        <select name="periodId" required defaultValue={defaultPeriodId ?? ""} className={inputCls}>
          {terms.length === 0 && <option value="">No term configured</option>}
          {terms.map((t) => (
            <option key={t.periodId} value={t.periodId}>
              {t.label} · {t.academicYear}
            </option>
          ))}
        </select>
      </label>

      {/* Classrooms (required) */}
      <Fieldset title="Classrooms">
        <NumField name="classroomsTotal" label="Total classrooms" required />
        <NumField name="classroomsGood" label="In good condition" required />
        <NumField name="classroomsRepair" label="Needing repair" required />
      </Fieldset>

      {/* WASH (required) */}
      <Fieldset title="Water, sanitation & power">
        <SelectField name="waterSource" label="Water source" options={WATER} required />
        <SelectField name="electricitySource" label="Electricity" options={POWER} required />
        <SelectField name="latrineType" label="Latrine type" options={LATRINE} required />
        <NumField name="latrinesBoys" label="Latrines · boys" required />
        <NumField name="latrinesGirls" label="Latrines · girls" required />
        <NumField name="latrinesStaff" label="Latrines · staff" required />
        <CheckField name="handwashing" label="Handwashing facility present" />
      </Fieldset>

      {/* Presence (required booleans) */}
      <Fieldset title="Facilities present">
        <CheckField name="hasLibrary" label="Library" />
        <CheckField name="hasIctLab" label="ICT lab" />
        <CheckField name="internet" label="Internet" />
        <CheckField name="hasKitchen" label="Kitchen" />
        <CheckField name="gsfpParticipating" label="GSFP (school feeding)" />
      </Fieldset>

      {/* Optional detail */}
      <Fieldset title="Library & ICT detail (optional)">
        <NumField name="libraryBookCount" label="Library books" />
        <NumField name="libraryStaffFte" label="Library staff (FTE)" step="0.1" />
        <NumField name="computersTotal" label="Computers · total" />
        <NumField name="computersWorking" label="Computers · working" />
        <TextField name="internetType" label="Internet type" placeholder="e.g. Fibre, 4G" />
      </Fieldset>

      <Fieldset title="Feeding & textbooks (optional)">
        <NumField name="mealsServedLastTerm" label="Meals served last term" />
        <NumField name="pupilsFedDailyAvg" label="Pupils fed daily (avg)" />
        <TextField name="catererName" label="Caterer name" placeholder="Caterer" />
        <SelectField
          name="textbookAvailability"
          label="Textbook availability"
          options={["ADEQUATE", "INADEQUATE"]}
          placeholder="Not recorded"
        />
      </Fieldset>

      <Fieldset title="Furniture & boards (optional)">
        <NumField name="studentDesksUsable" label="Student desks · usable" />
        <NumField name="studentDesksBroken" label="Student desks · broken" />
        <NumField name="teacherDesks" label="Teacher desks" />
        <NumField name="chalkboards" label="Chalkboards" />
        <NumField name="whiteboards" label="Whiteboards" />
        <NumField name="projectors" label="Projectors" />
      </Fieldset>

      <label className={labelCls}>
        <span className={capCls}>Note (optional)</span>
        <input
          type="text"
          name="note"
          maxLength={500}
          placeholder="e.g. New block under construction"
          className={inputCls}
        />
      </label>

      {done && <p className="rounded-md bg-green-bg px-4 py-3 text-sm font-medium text-green">{done}</p>}
      {error && <p className="text-sm text-terra">{error}</p>}

      <button
        type="submit"
        disabled={busy || terms.length === 0}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save snapshot"}
      </button>
    </form>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-border pt-4">
      <legend className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function NumField({
  name,
  label,
  required,
  step,
}: {
  name: string;
  label: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className={labelCls}>
      <span className={capCls}>{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        step={step}
        required={required}
        inputMode="decimal"
        className={inputCls}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  required,
  placeholder,
}: {
  name: string;
  label: string;
  options: string[];
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className={labelCls}>
      <span className={capCls}>{label}</span>
      <select name={name} required={required} defaultValue="" className={inputCls}>
        <option value="">{placeholder ?? "Select…"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.charAt(0) + o.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <label className={labelCls}>
      <span className={capCls}>{label}</span>
      <input type="text" name={name} maxLength={120} placeholder={placeholder} className={inputCls} />
    </label>
  );
}

function CheckField({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm text-navy">
      <input
        type="checkbox"
        name={name}
        className="h-4 w-4 rounded border-border-2 text-gold focus:ring-gold"
      />
      {label}
    </label>
  );
}
