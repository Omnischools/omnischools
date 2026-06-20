"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GH_REGIONS,
  OWNERSHIPS,
  SCHOOL_TYPE_CARDS,
  SENIOR_TRACKS,
  PERIOD_CHOICES,
  GRADE_SCALE_PRESETS,
  SHS_PROGRAMMES,
  WASSCE_CORE_SUBJECTS,
  BILLING_CADENCES,
  PAYMENT_METHODS,
  DEFAULT_PAYMENT_METHODS,
  currentAcademicYearLabel,
  defaultGradePreset,
  defaultClasses,
  defaultSubjects,
  defaultFees,
  hasClassWing,
  hasSeniorWing,
  cardForSubtype,
  cardById,
  type FeeItem,
  type CardId,
  type GradeRow,
  type OnboardInput,
  type OnboardResult,
  type SchoolSubtype,
} from "@/lib/onboarding";
import { DEFAULT_FEE_ITEMS } from "@/lib/field-options";
import { onboardSchool } from "@/lib/actions/onboarding";

type Form = Partial<OnboardInput> & { subtype?: SchoolSubtype };

const DRAFT_KEY = "omnischools:onboarding-draft";

type StepDef = { key: string; title: string; sub: string; shsOnly?: boolean };
const ALL_STEPS: StepDef[] = [
  { key: "identity", title: "School identity", sub: "Name, GES code, CSSPS code, district" },
  { key: "type", title: "School type", sub: "Branch point · determines steps 4–8" },
  { key: "calendar", title: "Academic calendar", sub: "Terms, holidays, week numbering" },
  {
    key: "structure",
    title: "Academic structure",
    sub: "Classes / programmes · adapts to type",
  },
  { key: "staff", title: "Staff & roles", sub: "Headmaster, senior staff, role grants" },
  { key: "billing", title: "Billing & payments", sub: "Fee structure, MoMo, Free SHS" },
  {
    key: "residency",
    title: "Residency & boarding",
    sub: "Day, mixed, or boarding · house system",
    shsOnly: true,
  },
  {
    key: "waec",
    title: "WAEC centre & WASSCE",
    sub: "Centre code, programmes offered",
    shsOnly: true,
  },
];

const labelCls = "flex items-center gap-1.5 text-xs font-semibold text-navy";
const helpCls = "text-[11px] leading-snug text-navy-3";
const inputCls = (filled: boolean) =>
  cn(
    "w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold",
    filled ? "border-gold-soft bg-gold-bg" : "border-border-2",
  );

function academicYearLabel(now = new Date()): string {
  const y = now.getFullYear();
  const start = now.getMonth() >= 8 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export function OnboardingWizard() {
  const [form, setForm] = useState<Form>({ ownership: "PUBLIC" });
  const [phase, setPhase] = useState<"steps" | "review" | "done">("steps");
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<Extract<OnboardResult, { ok: true }> | null>(null);
  const hydrated = useRef(false);

  // Restore an in-progress draft (autosave / "continue later").
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { form?: Form; stepIdx?: number };
        if (d.form) setForm(d.form);
        if (typeof d.stepIdx === "number") setStepIdx(d.stepIdx);
      }
    } catch {
      /* ignore corrupt draft */
    }
    hydrated.current = true;
  }, []);

  // Persist the draft whenever it changes (after initial hydration). Never write the
  // empty initial form — that would clobber a saved draft on mount, before the restore
  // effect's state has committed (and again under StrictMode's double-invoked effects).
  useEffect(() => {
    if (!hydrated.current) return;
    const untouched = !form.schoolName && !form.subtype && stepIdx === 0;
    if (untouched) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, stepIdx }));
    } catch {
      /* storage full / unavailable */
    }
  }, [form, stepIdx]);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const card = form.subtype ? cardForSubtype(form.subtype) : null;
  const isShs = card ? card.steps === 8 : false;
  const visible = ALL_STEPS.filter((s) => !s.shsOnly || isShs);
  const total = visible.length;
  const current = visible[stepIdx];

  const stepValid = (): string | null => {
    if (!current) return null;
    if (current.key === "identity") {
      if (!form.schoolName) return "Enter the school name.";
      if (!form.gesCode) return "Enter the GES code.";
      if (!form.region) return "Choose a region.";
      if (!form.district) return "Enter the district.";
    }
    if (current.key === "type" && !form.subtype) return "Choose a school type.";
    if (current.key === "staff") {
      if (!form.headmasterName) return "Enter the headmaster's name.";
      if (!form.headmasterPhone) return "Enter the headmaster's phone.";
      if (!form.adminName) return "Enter the admin's name.";
      if (!form.adminPhone) return "Enter the admin's phone.";
    }
    if (current.key === "billing" && !form.termsAccepted) {
      return "Please accept the Terms & Privacy Policy to continue.";
    }
    return null;
  };

  const next = () => {
    const err = stepValid();
    if (err) return setError(err);
    setError(null);
    if (stepIdx >= total - 1) setPhase("review");
    else setStepIdx((s) => s + 1);
  };
  const back = () => {
    setError(null);
    if (phase === "review") return setPhase("steps");
    setStepIdx((s) => Math.max(s - 1, 0));
  };
  const jumpTo = (key: string) => {
    const i = visible.findIndex((s) => s.key === key);
    if (i >= 0) {
      setPhase("steps");
      setStepIdx(i);
      setError(null);
    }
  };

  const pickCard = (id: CardId) => {
    const c = cardById(id);
    setForm((f) => ({ ...f, subtype: c.defaultSubtype, product: c.product }));
    setSaved(false);
    // Leaving the SHS branch shouldn't strand us on a now-hidden step.
    if (c.steps === 6 && stepIdx > 5) setStepIdx(5);
  };
  const setSeniorTrack = (t: SchoolSubtype) => {
    setForm((f) => ({ ...f, subtype: t }));
    setSaved(false);
  };

  const saveForLater = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, stepIdx }));
      setSaved(true);
    } catch {
      /* ignore */
    }
  };

  async function launch() {
    setSubmitting(true);
    setError(null);
    const res = await onboardSchool(form);
    setSubmitting(false);
    if (res.ok) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setResult(res);
      setPhase("done");
    } else setError(res.error);
  }

  const schoolInitial = (form.schoolName?.trim()?.[0] ?? "S").toUpperCase();
  const periodWord = card?.product === "SENIOR" ? "2 semesters" : "3 terms";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg shadow-md">
      {/* Top bar */}
      <div className="flex items-center gap-4 border-b border-border bg-surface px-5 py-3.5 md:px-7">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-gold font-display text-lg font-semibold text-navy">
            {schoolInitial}
          </div>
          <div>
            <div className="font-display text-base font-medium text-navy">
              Omnischools <em className="not-italic text-gold [font-style:italic]">onboarding</em>
            </div>
            <div className="text-[11px] text-navy-3">
              Setting up
              {form.schoolName ? (
                <>
                  {" · "}
                  <b className="text-navy">{form.schoolName}</b>
                </>
              ) : (
                " your school"
              )}
            </div>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {phase !== "done" && (
            <button
              onClick={saveForLater}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-navy-3 transition-colors hover:text-navy"
            >
              {saved ? "Saved ✓" : "Save & continue later"}
            </button>
          )}
          <Link
            href="/"
            className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy transition-colors hover:bg-bg"
          >
            Exit
          </Link>
        </div>
      </div>

      <div className="md:grid md:grid-cols-[280px_1fr]">
        {/* Vertical step nav */}
        <nav className="hidden border-r border-border bg-bg py-6 md:block">
          <div className="mb-4 border-b border-border px-6 pb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              {phase === "done" ? "Setup complete" : "Setup progress"}
            </div>
            <div
              className={cn(
                "font-display text-base font-medium",
                phase === "done" ? "text-green" : "text-navy",
              )}
            >
              {phase === "done" || phase === "review"
                ? `${total} of ${total} ${phase === "done" ? "done" : "complete"}`
                : `Step ${stepIdx + 1} of ${total}`}
              {phase === "steps" && !isShs && (
                <span className="font-normal text-navy-3"> · or 8 for SHS</span>
              )}
              {phase === "steps" && isShs && (
                <span className="font-normal text-gold"> · SHS path</span>
              )}
            </div>
            {phase === "steps" && (
              <div className="mt-1.5 text-[11px] text-navy-3">
                <b className="text-navy">
                  {stepIdx} of {total}
                </b>{" "}
                complete
              </div>
            )}
          </div>

          <ol className="px-0">
            {ALL_STEPS.map((s, ai) => {
              const greyed = !!s.shsOnly && !isShs;
              const visIdx = visible.findIndex((v) => v.key === s.key);
              const done =
                !greyed && (phase !== "steps" ? visIdx >= 0 : visIdx >= 0 && visIdx < stepIdx);
              const active = phase === "steps" && !greyed && visIdx === stepIdx;
              return (
                <li
                  key={s.key}
                  onClick={() => !greyed && done && jumpTo(s.key)}
                  className={cn(
                    "relative grid grid-cols-[40px_1fr] gap-3 px-6 py-3.5",
                    greyed ? "opacity-45" : done ? "cursor-pointer" : "",
                  )}
                >
                  {ai < ALL_STEPS.length - 1 && (
                    <span
                      className={cn(
                        "absolute left-[39px] top-9 -bottom-3.5 z-0 w-0.5",
                        done ? "bg-green" : active ? "bg-gold" : "bg-border",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 font-display text-[11px] font-semibold",
                      done
                        ? "border-green bg-green text-surface"
                        : active
                          ? "border-gold bg-gold text-navy shadow-[0_0_0_4px_rgba(200,151,91,0.18)]"
                          : "border-border-2 bg-surface text-navy-3",
                      greyed && "border-dashed",
                    )}
                  >
                    {done ? "✓" : ai + 1}
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-navy">
                      {s.title}
                      {s.shsOnly && (
                        <span className="rounded-full bg-green-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-green">
                          SHS
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-navy-3">
                      {s.sub}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-3.5 border-t border-border px-6 pt-4 text-[11px] leading-relaxed text-navy-3">
            Steps 7–8 are conditional on school type. Basic schools finish at step 6.
          </div>
        </nav>

        {/* Content panel */}
        <div className="bg-surface">
          {/* Mobile step indicator */}
          {phase === "steps" && (
            <div className="border-b border-border px-6 py-3 text-xs font-semibold text-navy-3 md:hidden">
              Step {stepIdx + 1} of {total}
              {!isShs && <span className="font-normal"> · or 8 for SHS</span>}
            </div>
          )}

          <div className="px-6 py-7 md:px-10">
            {phase === "done" && result ? (
              <DonePanel result={result} schoolName={form.schoolName ?? "Your school"} />
            ) : phase === "review" ? (
              <ReviewPanel
                form={form}
                isShs={isShs}
                periodWord={periodWord}
                onEdit={jumpTo}
              />
            ) : (
              <StepBody
                stepKey={current?.key ?? "identity"}
                form={form}
                set={set}
                setForm={setForm}
                pickCard={pickCard}
                setSeniorTrack={setSeniorTrack}
                isShs={isShs}
                stepNo={stepIdx + 1}
                total={total}
              />
            )}

            {error && <p className="mt-4 text-sm text-terra">{error}</p>}
          </div>

          {/* Footer controls */}
          {phase !== "done" && (
            <div className="flex items-center gap-3.5 border-t border-border bg-bg px-6 py-4 md:px-10">
              <div className="hidden text-[11px] text-navy-3 sm:block">
                {phase === "review" ? (
                  <>
                    <b className="text-navy">All steps reviewed</b> · launch initialises your
                    dashboard
                  </>
                ) : (
                  <>
                    <b className="text-navy">
                      {stepIdx} of {total} complete
                    </b>{" "}
                    · entries saved automatically
                  </>
                )}
              </div>
              <div className="ml-auto flex gap-2.5">
                <button
                  onClick={back}
                  disabled={(phase === "steps" && stepIdx === 0) || submitting}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold text-navy-3 transition-colors hover:text-navy disabled:opacity-0"
                >
                  ← Back
                </button>
                {phase === "review" ? (
                  <button
                    onClick={launch}
                    disabled={submitting}
                    className="rounded-lg bg-gold px-6 py-2.5 text-sm font-bold text-navy transition-colors hover:brightness-95 disabled:opacity-60"
                  >
                    {submitting ? "Launching…" : "Launch school →"}
                  </button>
                ) : (
                  <button
                    onClick={next}
                    className="rounded-lg bg-navy px-6 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep"
                  >
                    Save &amp; continue →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- step bodies */

function Head({ pill, title, em, lede }: { pill: string; title: string; em?: string; lede: string }) {
  return (
    <div className="mb-7 border-b border-border pb-5">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{pill}</div>
      <h2 className="font-display text-[26px] font-medium leading-tight text-navy">
        {title} {em && <em className="not-italic text-gold [font-style:italic]">{em}</em>}
      </h2>
      <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-navy-3">{lede}</p>
    </div>
  );
}

function Field({
  label,
  req,
  help,
  children,
}: {
  label: string;
  req?: boolean;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={labelCls}>
        {label}
        {req && <span className="text-terra">*</span>}
      </div>
      {children}
      {help && <div className={helpCls}>{help}</div>}
    </div>
  );
}

function InterimNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-2 bg-bg p-6">
      <div className="font-display text-base font-medium text-navy">{title}</div>
      <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-navy-3">{body}</p>
      <div className="mt-3 inline-block rounded-full bg-gold-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-gold">
        Configured after launch
      </div>
    </div>
  );
}

/** Editable chip list — removable tags + an add input. Used for classes & subjects. */
function ChipEditor({
  title,
  hint,
  items,
  onAdd,
  onRemove,
  value,
  setValue,
  placeholder,
}: {
  title: string;
  hint: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  value: string;
  setValue: (v: string) => void;
  placeholder: string;
}) {
  const commit = () => {
    onAdd(value);
    setValue("");
  };
  return (
    <div className="rounded-xl border border-border bg-bg p-5">
      <div className="font-display text-base font-medium text-navy">
        {title} <span className="text-navy-3">· {items.length}</span>
      </div>
      <p className="mb-3 mt-0.5 text-[12px] text-navy-3">{hint}</p>
      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span
              key={`${it}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-2 bg-surface py-1 pl-3 pr-1.5 text-[12px] font-medium text-navy"
            >
              {it}
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${it}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-navy-3 transition-colors hover:bg-terra-bg hover:text-terra"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          className={inputCls(false)}
        />
        <button
          type="button"
          onClick={commit}
          className="shrink-0 rounded-lg border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-gold-bg"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function StepBody({
  stepKey,
  form,
  set,
  setForm,
  pickCard,
  setSeniorTrack,
  isShs,
  stepNo,
  total,
}: {
  stepKey: string;
  form: Form;
  set: (k: keyof Form, v: string) => void;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  pickCard: (id: CardId) => void;
  setSeniorTrack: (t: SchoolSubtype) => void;
  isShs: boolean;
  stepNo: number;
  total: number;
}) {
  const f = (k: keyof Form) => (form[k] as string) ?? "";
  const selectedCard = form.subtype ? cardForSubtype(form.subtype) : null;
  const [newClass, setNewClass] = useState("");
  const [newSubject, setNewSubject] = useState("");

  if (stepKey === "identity") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · School identity`}
          title="Tell us about"
          em="your school."
          lede="The basics — name, official codes, and where you sit on the Ghana education map. These are one-time identifiers; changing them later needs Headmaster + GES re-verification."
        />
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="School name" req help="Official name as registered with GES.">
              <input
                className={inputCls(!!f("schoolName"))}
                value={f("schoolName")}
                onChange={(e) => set("schoolName", e.target.value)}
                placeholder="e.g. St. Theresa's Senior High School"
              />
            </Field>
            <Field label="Short name / alias" help="Used in app navigation & SMS sign-off.">
              <input
                className={inputCls(!!f("shortName"))}
                value={f("shortName")}
                onChange={(e) => set("shortName", e.target.value)}
                placeholder="St. Theresa's"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="GES school code" req help={<>From EMIS. Format <b className="text-navy-2">RG-DIST-NNN</b>.</>}>
              <input
                className={cn(inputCls(!!f("gesCode")), "font-mono")}
                value={f("gesCode")}
                onChange={(e) => set("gesCode", e.target.value)}
                placeholder="BR-SUN-018"
              />
            </Field>
            <Field label="CSSPS school code" help="SHS / TVI only · hm.cssps.gov.gh">
              <input
                className={cn(inputCls(!!f("csspsCode")), "font-mono")}
                value={f("csspsCode")}
                onChange={(e) => set("csspsCode", e.target.value)}
                placeholder="ST-0741"
              />
            </Field>
            <Field label="Year founded">
              <input
                className={inputCls(!!f("yearFounded"))}
                value={f("yearFounded")}
                onChange={(e) => set("yearFounded", e.target.value)}
                placeholder="1965"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Ownership" req help="Public schools are Free SHS eligible.">
              <select
                className={inputCls(true)}
                value={form.ownership ?? "PUBLIC"}
                onChange={(e) => set("ownership", e.target.value)}
              >
                {OWNERSHIPS.map((o) => (
                  <option key={o} value={o}>
                    {o.charAt(0) + o.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Region" req>
              <select
                className={inputCls(!!f("region"))}
                value={f("region")}
                onChange={(e) => set("region", e.target.value)}
              >
                <option value="" disabled>
                  Choose a region
                </option>
                {GH_REGIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="District" req>
              <input
                className={inputCls(!!f("district"))}
                value={f("district")}
                onChange={(e) => set("district", e.target.value)}
                placeholder="Sunyani Municipal"
              />
            </Field>
          </div>
          <Field
            label="School address (postal + GPS)"
            help="Postal address for official correspondence; GPS Ghana Post code for navigation."
          >
            <input
              className={inputCls(!!f("address"))}
              value={f("address")}
              onChange={(e) => set("address", e.target.value)}
              placeholder="P.O. Box 18, Sunyani · GA-077-0418"
            />
          </Field>
        </div>
      </div>
    );
  }

  if (stepKey === "type") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · School type — the branch point`}
          title="What kind of"
          em="school are you?"
          lede="This is the only step that changes what steps 4–8 look like. Basic & JHS finish at step 6; SHS, SHTS and Multi-tier add residency + WAEC (8 steps)."
        />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {SCHOOL_TYPE_CARDS.map((c) => {
            const selected = selectedCard?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCard(c.id)}
                className={cn(
                  "relative rounded-[10px] border-2 p-5 text-left transition-colors",
                  selected
                    ? "border-gold bg-gradient-to-br from-gold-bg to-surface"
                    : "border-border-2 bg-surface hover:border-gold-soft",
                )}
              >
                {selected && (
                  <span className="absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-xs font-bold text-navy">
                    ✓
                  </span>
                )}
                <div className="font-display text-base font-medium text-navy">{c.name}</div>
                <p className="mb-2.5 mt-1.5 text-[11px] leading-snug text-navy-3">{c.desc}</p>
                <div
                  className={cn(
                    "border-t border-border pt-2 text-[10px] font-semibold uppercase tracking-[0.08em]",
                    c.steps === 8 ? "text-green" : "text-navy-3",
                  )}
                >
                  <b className={c.steps === 8 ? "text-green" : "text-navy"}>{c.steps} steps</b>
                  {c.steps === 8 ? " · residency + WAEC" : " · finishes at billing"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Senior sub-track — SHS vs SHTS (recorded now; SHTS curriculum is built in the Senior release) */}
        {selectedCard?.id === "SENIOR" && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
              Senior track
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SENIOR_TRACKS.map((t) => {
                const on = form.subtype === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSeniorTrack(t.key)}
                    className={cn(
                      "rounded-lg border-2 p-4 text-left transition-colors",
                      on
                        ? "border-gold bg-gold-bg"
                        : "border-border-2 bg-surface hover:border-gold-soft",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full border-2",
                          on ? "border-gold bg-gold" : "border-border-2",
                        )}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-navy" />}
                      </span>
                      <span className="text-sm font-semibold text-navy">{t.label}</span>
                    </div>
                    <p className="mt-1.5 pl-6 text-[11px] leading-snug text-navy-3">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-r-lg border-l-[3px] border-gold bg-gold-bg px-4 py-3.5 text-[12px] leading-relaxed text-navy-2">
          <b className="text-navy">Why this matters:</b> your answer determines whether later
          surfaces show class-based or programme-based structure, and whether residency &amp; WAEC
          setup appear. Changing it later needs a Headmaster + GES code re-verification.
        </div>
      </div>
    );
  }

  if (stepKey === "calendar") {
    const choice =
      PERIOD_CHOICES.find((c) => c.periodType === form.periodType) ??
      PERIOD_CHOICES[isShs ? 1 : 0];
    const ay = form.academicYear ?? currentAcademicYearLabel();
    const terms =
      form.terms ?? choice.names.map((n) => ({ label: n, startsOn: "", endsOn: "" }));
    const grades = form.gradeScale ?? GRADE_SCALE_PRESETS[defaultGradePreset(form.subtype)];

    const setTerm = (i: number, patch: Partial<(typeof terms)[number]>) =>
      setForm((prev) => {
        const base = prev.terms ?? terms;
        const nextTerms = base.map((t, j) => (j === i ? { ...t, ...patch } : t));
        return { ...prev, terms: nextTerms };
      });
    const pickPeriod = (key: string) => {
      const c = PERIOD_CHOICES.find((p) => p.key === key) ?? PERIOD_CHOICES[0];
      setForm((prev) => ({
        ...prev,
        periodType: c.periodType,
        periodCount: c.count,
        terms: c.names.map((n) => ({ label: n, startsOn: "", endsOn: "" })),
      }));
    };
    const setGrade = (i: number, patch: Partial<GradeRow>) =>
      setForm((prev) => {
        const base = prev.gradeScale ?? grades;
        const next = base.map((g, j) => (j === i ? { ...g, ...patch } : g));
        return { ...prev, gradeScale: next };
      });
    const applyPreset = (key: "BASIC" | "WASSCE") =>
      setForm((prev) => ({
        ...prev,
        gradeScale: GRADE_SCALE_PRESETS[key].map((g) => ({ ...g })),
      }));

    const badgeTone = (i: number, n: number) =>
      i === 0
        ? "bg-green-bg text-green"
        : i >= n - 1
          ? "bg-terra-bg text-terra"
          : "bg-gold-bg text-gold";

    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Academic calendar`}
          title="Set up your academic"
          em="year."
          lede="Tell us when your school year runs and how you grade. Sensible GES defaults are pre-filled — adjust what you need; you can refine it later in Settings."
        />

        {/* School year & terms */}
        <div className="rounded-xl border border-border bg-bg p-5">
          <div className="font-display text-base font-medium text-navy">
            School year &amp; terms
          </div>
          <p className="mb-3 mt-0.5 text-[12px] text-navy-3">
            Most Basic and JHS schools run three terms; Senior schools often run two
            semesters.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Academic year">
              <input
                className={inputCls(true)}
                value={ay}
                onChange={(e) => set("academicYear", e.target.value)}
                placeholder="2026/27"
              />
            </Field>
            <Field label="Number of periods">
              <select className={inputCls(true)} value={choice.key} onChange={(e) => pickPeriod(e.target.value)}>
                {PERIOD_CHOICES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 space-y-2">
            {terms.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="text-[13px] font-semibold text-navy">{t.label}</div>
                <input
                  type="date"
                  value={t.startsOn ?? ""}
                  onChange={(e) => setTerm(i, { startsOn: e.target.value })}
                  className={cn(inputCls(!!t.startsOn), "px-2.5 py-1.5 text-[12px]")}
                />
                <input
                  type="date"
                  value={t.endsOn ?? ""}
                  onChange={(e) => setTerm(i, { endsOn: e.target.value })}
                  className={cn(inputCls(!!t.endsOn), "px-2.5 py-1.5 text-[12px]")}
                />
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-navy-3">
            Leave dates blank to keep the GES calendar — you can set exact dates later.
          </p>
        </div>

        {/* Grade scale */}
        <div className="mt-4 rounded-xl border border-border bg-bg p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="font-display text-base font-medium text-navy">Grade scale</div>
              <p className="mt-0.5 text-[12px] text-navy-3">
                How scores map to grades — used in the gradebook, report cards and the parent
                app.
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => applyPreset("BASIC")}
                className="rounded-md border border-border-2 px-2.5 py-1 text-navy-2 transition-colors hover:bg-surface"
              >
                A–F
              </button>
              <button
                type="button"
                onClick={() => applyPreset("WASSCE")}
                className="rounded-md border border-border-2 px-2.5 py-1 text-navy-2 transition-colors hover:bg-surface"
              >
                WASSCE A1–F9
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {grades.map((g, i) => (
              <div
                key={i}
                className="grid grid-cols-[44px_1fr_auto_72px] items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div
                  className={cn(
                    "flex h-7 items-center justify-center rounded-md font-display text-[13px] font-semibold",
                    badgeTone(i, grades.length),
                  )}
                >
                  {g.grade}
                </div>
                <input
                  value={g.label ?? ""}
                  onChange={(e) => setGrade(i, { label: e.target.value })}
                  className={cn(inputCls(!!g.label), "px-2.5 py-1.5 text-[12px]")}
                  placeholder="Description"
                />
                <div className="text-[11px] text-navy-3">
                  {i >= grades.length - 1 ? "below" : "from"}
                </div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={i >= grades.length - 1 ? grades[i - 1]?.minScore ?? g.minScore : g.minScore}
                  disabled={i >= grades.length - 1}
                  onChange={(e) => setGrade(i, { minScore: Number(e.target.value) })}
                  className={cn(
                    inputCls(true),
                    "px-2.5 py-1.5 text-center text-[12px]",
                    i >= grades.length - 1 && "opacity-60",
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (stepKey === "structure") {
    const showClasses = hasClassWing(form.subtype);
    const showProgrammes = hasSeniorWing(form.subtype);
    const classList = form.classes ?? defaultClasses(form.subtype);
    const subjectList = form.subjects ?? defaultSubjects(form.subtype);
    const listFor = (key: "classes" | "subjects") =>
      key === "classes" ? classList : subjectList;

    const addItem = (key: "classes" | "subjects", val: string) => {
      const v = val.trim();
      if (!v) return;
      setForm((prev) => {
        const base = (prev[key] as string[] | undefined) ?? listFor(key);
        if (base.some((x) => x.toLowerCase() === v.toLowerCase())) return prev;
        return { ...prev, [key]: [...base, v] };
      });
    };
    const removeItem = (key: "classes" | "subjects", idx: number) =>
      setForm((prev) => {
        const base = (prev[key] as string[] | undefined) ?? listFor(key);
        return { ...prev, [key]: base.filter((_, i) => i !== idx) };
      });

    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Academic structure`}
          title="Your classes"
          em={showProgrammes && !showClasses ? "& programmes." : "& subjects."}
          lede={
            showProgrammes && !showClasses
              ? "Senior schools are programme-based — Science, Business, General Arts, Home Econ — over four universal WASSCE cores. Confirm the cores now; the full programme matrix is built in the Senior release."
              : "Build your class list and the subjects you teach. We've pre-filled the GES defaults — add or remove to match your school."
          }
        />

        {showClasses && (
          <ChipEditor
            title="Classes"
            hint="Forms / classes students belong to. Attendance and the timetable hang off these."
            items={classList}
            onAdd={(v) => addItem("classes", v)}
            onRemove={(i) => removeItem("classes", i)}
            value={newClass}
            setValue={setNewClass}
            placeholder="e.g. JHS 1"
          />
        )}

        <div className={showClasses ? "mt-4" : ""}>
          <ChipEditor
            title={showProgrammes && !showClasses ? "Core subjects" : "Subjects"}
            hint={
              showProgrammes && !showClasses
                ? "The four universal WASSCE cores. Programme electives are added with the programme builder in the Senior release."
                : "Subjects taught across the school. These feed the gradebook and report cards."
            }
            items={subjectList}
            onAdd={(v) => addItem("subjects", v)}
            onRemove={(i) => removeItem("subjects", i)}
            value={newSubject}
            setValue={setNewSubject}
            placeholder="e.g. Twi"
          />
        </div>

        {showProgrammes && (
          <div className="mt-4 rounded-xl border border-border bg-bg p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-display text-base font-medium text-navy">
                Programmes <span className="text-navy-3">· preview</span>
              </div>
              <span className="rounded-full bg-gold-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-gold">
                Senior release
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-navy-3">
              The WASSCE programme matrix (electives per programme) is built after launch.
              Here&apos;s what your Senior wing will offer:
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SHS_PROGRAMMES.map((p) => (
                <div key={p.name} className="rounded-lg border border-border bg-surface p-3">
                  <div className="font-display text-[13px] font-semibold text-navy">
                    {p.name}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.electives.map((e) => (
                      <span
                        key={e}
                        className="rounded-full border border-gold-soft bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-navy-3">
              Cores ({WASSCE_CORE_SUBJECTS.length}) apply to every programme · electives shown
              are GES defaults you&apos;ll confirm later.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (stepKey === "staff") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Staff & roles`}
          title="Who runs"
          em="the school?"
          lede="Two people to start: the Headmaster, and the admin who signs in first and sets up the rest. Both log in with their phone number; email is optional. You can bulk-add the rest of your staff after launch."
        />
        <div className="space-y-6">
          <div>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
              Headmaster
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Full name" req>
                <input
                  className={inputCls(!!f("headmasterName"))}
                  value={f("headmasterName")}
                  onChange={(e) => set("headmasterName", e.target.value)}
                  placeholder="Mr K. Owusu-Frempong"
                />
              </Field>
              <Field label="Phone (login)" req>
                <input
                  className={inputCls(!!f("headmasterPhone"))}
                  value={f("headmasterPhone")}
                  onChange={(e) => set("headmasterPhone", e.target.value)}
                  placeholder="024 000 0000"
                />
              </Field>
              <Field label="Email — optional">
                <input
                  className={inputCls(!!f("headmasterEmail"))}
                  type="email"
                  value={f("headmasterEmail")}
                  onChange={(e) => set("headmasterEmail", e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
              Admin (first sign-in)
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Full name" req>
                <input
                  className={inputCls(!!f("adminName"))}
                  value={f("adminName")}
                  onChange={(e) => set("adminName", e.target.value)}
                  placeholder="School Office"
                />
              </Field>
              <Field label="Phone (login)" req>
                <input
                  className={inputCls(!!f("adminPhone"))}
                  value={f("adminPhone")}
                  onChange={(e) => set("adminPhone", e.target.value)}
                  placeholder="024 000 0000"
                />
              </Field>
              <Field label="Email — optional">
                <input
                  className={inputCls(!!f("adminEmail"))}
                  type="email"
                  value={f("adminEmail")}
                  onChange={(e) => set("adminEmail", e.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stepKey === "billing") {
    const fees = form.fees ?? defaultFees(form.subtype, form.ownership);
    const cadence = form.billingCadence ?? "TERM";
    const methods = form.paymentMethods ?? DEFAULT_PAYMENT_METHODS;

    const setFees = (next: FeeItem[]) => setForm((p) => ({ ...p, fees: next }));
    const updateFee = (i: number, patch: Partial<FeeItem>) =>
      setFees(fees.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    const addFee = () => setFees([...fees, { item: "", amount: 0 }]);
    const removeFee = (i: number) => setFees(fees.filter((_, idx) => idx !== i));
    const toggleMethod = (code: string) =>
      setForm((p) => {
        const cur = p.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
        return {
          ...p,
          paymentMethods: cur.includes(code)
            ? cur.filter((m) => m !== code)
            : [...cur, code],
        };
      });

    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Billing & payments`}
          title="Fees &"
          em="payments."
          lede="Set your fee lines, how you bill, and which payment channels you accept. Public Senior schools default to Free SHS (tuition GHS 0). You can refine all of this in Billing after launch."
        />
        <datalist id="fee-items">
          {DEFAULT_FEE_ITEMS.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>

        {/* Fee lines */}
        <div className="rounded-xl border border-border bg-bg p-5">
          <div className="font-display text-base font-medium text-navy">Fee structure</div>
          <p className="mb-3 mt-0.5 text-[12px] text-navy-3">
            One default structure for {academicYearLabel()}. Amounts in GHS — leave 0 to fill
            later.
          </p>
          <div className="space-y-2">
            {fees.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  list="fee-items"
                  value={row.item}
                  onChange={(e) => updateFee(i, { item: e.target.value })}
                  placeholder="Fee item"
                  className={cn(inputCls(!!row.item), "flex-1")}
                />
                <div className="relative w-36 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-navy-3">
                    GHS
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={row.amount || ""}
                    onChange={(e) => updateFee(i, { amount: Number(e.target.value) })}
                    placeholder="0.00"
                    className={cn(inputCls(!!row.amount), "pl-11 text-right font-mono")}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeFee(i)}
                  aria-label="Remove fee"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-navy-3 transition-colors hover:bg-terra-bg hover:text-terra"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addFee}
            className="mt-3 text-[13px] font-semibold text-gold hover:underline"
          >
            + Add fee line
          </button>
        </div>

        {/* Cadence */}
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
            How do you bill?
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BILLING_CADENCES.map((c) => {
              const on = cadence === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => set("billingCadence", c.key)}
                  className={cn(
                    "rounded-lg border-2 p-4 text-left transition-colors",
                    on
                      ? "border-gold bg-gold-bg"
                      : "border-border-2 bg-surface hover:border-gold-soft",
                  )}
                >
                  <div className="text-sm font-semibold text-navy">{c.label}</div>
                  <p className="mt-1 text-[11px] leading-snug text-navy-3">{c.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment methods */}
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
            Payment channels you accept
          </div>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => {
              const on = methods.includes(m.code);
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => toggleMethod(m.code)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
                    on
                      ? "border-gold bg-gold-bg text-navy"
                      : "border-border-2 bg-surface text-navy-3 hover:border-gold-soft",
                  )}
                >
                  {on ? "✓ " : ""}
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Terms & Privacy */}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-4">
          <input
            type="checkbox"
            checked={!!form.termsAccepted}
            onChange={(e) =>
              setForm((p) => ({ ...p, termsAccepted: e.target.checked }))
            }
            className="mt-0.5 h-4 w-4 accent-gold"
          />
          <span className="text-[13px] leading-relaxed text-navy-2">
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="font-semibold text-gold hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="font-semibold text-gold hover:underline"
            >
              Privacy Policy
            </Link>
            . <span className="text-terra">*</span>
          </span>
        </label>
      </div>
    );
  }

  if (stepKey === "residency") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Residency & boarding · SHS only`}
          title="How do students"
          em="live on campus?"
          lede="Day, mixed or boarding — and an optional house system. This activates the Boarding and Sickbay modules. Captured here in a later release."
        />
        <InterimNote
          title="Residency model & houses"
          body="The residency picker (day / mixed / boarding), house system and visiting-day cadence are added here in the SHS setup release. Onboarding completes without them for now."
        />
      </div>
    );
  }

  if (stepKey === "waec") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · WAEC centre & WASSCE · SHS only`}
          title="Connect to"
          em="WAEC."
          lede="Your WAEC centre code unlocks the WASSCE module — registration, results and timetable sync. Captured here in a later release."
        />
        <InterimNote
          title="WAEC centre & WASSCE programmes"
          body="The centre code, regional office and first-cohort year are added here in the SHS setup release. Onboarding completes without them for now."
        />
      </div>
    );
  }

  return null;
}

/* --------------------------------------------------------------------- review */

function ReviewPanel({
  form,
  isShs,
  periodWord,
  onEdit,
}: {
  form: Form;
  isShs: boolean;
  periodWord: string;
  onEdit: (key: string) => void;
}) {
  const card = form.subtype ? cardForSubtype(form.subtype) : null;
  const calChoice =
    PERIOD_CHOICES.find((c) => c.periodType === form.periodType) ??
    PERIOD_CHOICES[isShs ? 1 : 0];
  const datedCount = (form.terms ?? []).filter((t) => t.startsOn && t.endsOn).length;
  const grades = form.gradeScale ?? GRADE_SCALE_PRESETS[defaultGradePreset(form.subtype)];
  const classCount = (form.classes ?? defaultClasses(form.subtype)).length;
  const subjectCount = (form.subjects ?? defaultSubjects(form.subtype)).length;
  const feeList = form.fees ?? defaultFees(form.subtype, form.ownership);
  const feeTotal = feeList.reduce((s, fee) => s + (fee.amount || 0), 0);
  const methodCount = (form.paymentMethods ?? DEFAULT_PAYMENT_METHODS).length;
  const cards: { step: string; key: string; rows: [string, string][] }[] = [
    {
      step: "School identity",
      key: "identity",
      rows: [
        ["Name", form.schoolName ?? "—"],
        ["GES code", form.gesCode ?? "—"],
        ["CSSPS code", form.csspsCode || "—"],
        ["Region · District", `${form.region ?? "—"} · ${form.district ?? "—"}`],
        ["Ownership", form.ownership ?? "—"],
      ],
    },
    {
      step: "School type",
      key: "type",
      rows: [
        [
          "Type",
          card
            ? `${card.name}${
                form.subtype === "SHTS" ? " (SHTS)" : form.subtype === "SHS" ? " (SHS)" : ""
              } · ${card.steps}-step path`
            : "—",
        ],
        ["Tier", card?.product ?? "—"],
      ],
    },
    {
      step: "Academic calendar",
      key: "calendar",
      rows: [
        ["Year", form.academicYear || academicYearLabel()],
        [
          "Structure",
          `${calChoice.label}${datedCount > 0 ? ` · ${datedCount} dated` : " · GES default"}`,
        ],
        ["Grade scale", `${grades.length} grades (${grades.map((g) => g.grade).join(", ")})`],
      ],
    },
    {
      step: "Academic structure",
      key: "structure",
      rows: [
        ["Classes", classCount > 0 ? `${classCount} classes` : "Programme-based"],
        ["Subjects", `${subjectCount} subjects`],
        ...(hasSeniorWing(form.subtype)
          ? ([["Programmes", `${SHS_PROGRAMMES.length} (Senior release)`]] as [
              string,
              string,
            ][])
          : []),
      ],
    },
    {
      step: "Staff & roles",
      key: "staff",
      rows: [
        ["Headmaster", `${form.headmasterName ?? "—"} · ${form.headmasterPhone ?? "—"}`],
        ["Admin", `${form.adminName ?? "—"} · ${form.adminPhone ?? "—"}`],
      ],
    },
    {
      step: "Billing & payments",
      key: "billing",
      rows: [
        ["Fees", `${feeList.length} lines · GHS ${feeTotal.toFixed(2)}`],
        ["Billing", (form.billingCadence ?? "TERM") === "TERM" ? "Per term" : "Monthly"],
        ["Channels", `${methodCount} accepted`],
        ["Terms", form.termsAccepted ? "Accepted ✓" : "Not accepted"],
      ],
    },
  ];

  return (
    <div>
      <div className="mb-6 rounded-xl border-2 border-green bg-gradient-to-br from-green-bg to-surface px-6 py-5">
        <div className="grid grid-cols-[auto_1fr] items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green font-display text-2xl font-semibold text-surface">
            ✓
          </div>
          <div>
            <h3 className="font-display text-xl font-medium text-navy">
              Ready to <em className="not-italic text-gold [font-style:italic]">launch.</em>
            </h3>
            <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-navy-2">
              Review the summary below — edit any step if needed. Launching creates your school,
              its admin &amp; headmaster logins, and seeds the {periodWord} {academicYearLabel()}{" "}
              calendar.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.key} className="rounded-lg border border-border bg-bg p-4">
            <div className="mb-2 flex items-baseline justify-between border-b border-border pb-2">
              <div className="font-display text-sm font-semibold text-navy">{c.step}</div>
              <button
                onClick={() => onEdit(c.key)}
                className="text-[11px] font-semibold text-gold hover:underline"
              >
                Edit →
              </button>
            </div>
            {c.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2.5 py-1 text-[12px]">
                <div className="text-navy-3">{k}</div>
                <div className="font-semibold text-navy">{v}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {isShs && (
        <div className="mt-4 rounded-lg border border-gold-soft bg-gold-bg px-4 py-3 text-[12px] leading-relaxed text-navy-2">
          Residency and WAEC setup (steps 7–8) will be captured in the SHS setup release — your
          school launches as an SHS and those settings open afterwards.
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- done */

function DonePanel({
  result,
  schoolName,
}: {
  result: Extract<OnboardResult, { ok: true }>;
  schoolName: string;
}) {
  return (
    <div>
      <div className="rounded-xl border-2 border-green bg-gradient-to-br from-green-bg to-surface px-7 py-7">
        <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[auto_1fr_auto]">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green font-display text-2xl font-semibold text-surface">
            ✓
          </div>
          <div>
            <h3 className="font-display text-2xl font-medium text-navy">
              You&apos;re <em className="not-italic text-gold [font-style:italic]">set up.</em>{" "}
              Welcome to Omnischools.
            </h3>
            <p className="mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-navy-2">
              <b className="text-navy">{schoolName}</b> is configured. Academic year{" "}
              <b className="text-navy">{result.academicYear}</b>{" "}
              {result.periodsCreated > 0
                ? `with ${result.periodsCreated} periods`
                : "is set"}{" "}
              and a welcome SMS is on its way to your admin number.
            </p>
          </div>
          <Link
            href="/login"
            className="rounded-lg bg-gold px-6 py-3.5 text-sm font-bold text-navy transition-colors hover:brightness-95"
          >
            Go to sign in →
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 font-display text-base font-medium text-navy">
          Next steps · suggested order
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {[
            ["First · this week", "Admit your students", "Enter or import your student list from Admissions or Students."],
            ["Second · this week", "Invite your staff", "Bulk-add teachers and staff; each gets an invite to set a password."],
            ["Third · before term", "Build your timetable", "The timetable reads your classes, subjects and staff from setup."],
            ["Anytime · ongoing", "Customise settings", "Holidays, grading scale, fee categories and more in Settings."],
          ].map(([tag, title, body]) => (
            <div key={title} className="rounded-lg border border-border bg-bg px-5 py-4">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                {tag}
              </div>
              <div className="font-display text-sm font-semibold text-navy">{title}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-navy-3">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 font-mono text-[11px] text-navy-3">school id · {result.schoolId}</p>
    </div>
  );
}
