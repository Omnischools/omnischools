"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GH_REGIONS,
  OWNERSHIPS,
  SCHOOL_TYPE_CARDS,
  cardForSubtype,
  type OnboardInput,
  type OnboardResult,
  type SchoolSubtype,
} from "@/lib/onboarding";
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

  // Persist the draft whenever it changes (after initial hydration).
  useEffect(() => {
    if (!hydrated.current) return;
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

  const pickType = (key: SchoolSubtype) => {
    const c = cardForSubtype(key);
    setForm((f) => ({ ...f, subtype: key, product: c.product }));
    setSaved(false);
    // Leaving the SHS branch shouldn't strand us on a now-hidden step.
    if (c.steps === 6 && stepIdx > 5) setStepIdx(5);
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
                pickType={pickType}
                isShs={isShs}
                periodWord={periodWord}
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

function StepBody({
  stepKey,
  form,
  set,
  pickType,
  isShs,
  periodWord,
  stepNo,
  total,
}: {
  stepKey: string;
  form: Form;
  set: (k: keyof Form, v: string) => void;
  pickType: (k: SchoolSubtype) => void;
  isShs: boolean;
  periodWord: string;
  stepNo: number;
  total: number;
}) {
  const f = (k: keyof Form) => (form[k] as string) ?? "";

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
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {SCHOOL_TYPE_CARDS.map((c) => {
            const selected = form.subtype === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => pickType(c.key)}
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
          <div className="rounded-[10px] border-2 border-dashed border-border-2 p-5 opacity-50">
            <div className="font-display text-base font-medium text-navy-3">TVET-only</div>
            <p className="mb-2.5 mt-1.5 text-[11px] leading-snug text-navy-3">
              Technical/Vocational Institution under Ghana TVET Service. Coming Q3 2026.
            </p>
            <div className="border-t border-border pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
              Not yet available
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-r-lg border-l-[3px] border-gold bg-gold-bg px-4 py-3.5 text-[12px] leading-relaxed text-navy-2">
          <b className="text-navy">Why this matters:</b> your answer determines whether later
          surfaces show class-based or programme-based structure, and whether residency &amp; WAEC
          setup appear. Changing it later needs a Headmaster + GES code re-verification.
        </div>
      </div>
    );
  }

  if (stepKey === "calendar") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Academic calendar`}
          title="Your academic"
          em="year."
          lede="Omnischools seeds the GES-standard calendar for your tier automatically. You'll be able to fine-tune term dates, holidays and week numbering once you're in."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCell label="Academic year" value={academicYearLabel()} sub="GES default" />
          <SummaryCell label="Structure" value={periodWord} sub="per the GES standard" />
          <SummaryCell label="Source" value="GES default" sub="editable in Settings" />
        </div>
        <div className="mt-4">
          <InterimNote
            title="Full calendar editor is coming next"
            body="Per-term date pickers, holidays and the grading scale arrive in the next setup release. For now the GES default is applied so you can finish onboarding."
          />
        </div>
      </div>
    );
  }

  if (stepKey === "structure") {
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Academic structure`}
          title="Your classes"
          em={isShs ? "& programmes." : "& subjects."}
          lede={
            isShs
              ? "SHS schools build a programmes matrix — Science, Business, General Arts, Home Econ — with 4 universal cores and electives per programme."
              : "Basic & JHS schools build a class list with subjects per class, loaded from the GES syllabus."
          }
        />
        <InterimNote
          title={isShs ? "Programmes, cores & electives" : "Classes & subjects"}
          body={
            isShs
              ? "The WAEC programme matrix (cores + per-programme electives) is built here in the next release. For now, set programmes up from Classes after launch."
              : "The GES class + subject builder is added here in the next release. For now, create your classes and subjects from Classes after launch."
          }
        />
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
    return (
      <div>
        <Head
          pill={`Step ${stepNo} of ${total} · Billing & payments`}
          title="Fees &"
          em="payments."
          lede="Fee structure, Mobile Money collection and (for public SHS) Free SHS handling. The full fee builder lives in Billing — set it up there once you're in."
        />
        <InterimNote
          title="Fee structure & payments"
          body="The fee-category builder, MoMo setup and Terms & Privacy acceptance are added to this step in the next release. For now you can configure fees from Billing after launch."
        />
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

function SummaryCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        {label}
      </div>
      <div className="font-display text-base font-medium text-navy">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-navy-3">{sub}</div>}
    </div>
  );
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
        ["Type", card ? `${card.name} · ${card.steps}-step path` : "—"],
        ["Tier", card?.product ?? "—"],
      ],
    },
    {
      step: "Academic calendar",
      key: "calendar",
      rows: [
        ["Year", academicYearLabel()],
        ["Structure", `${periodWord} · GES default`],
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
