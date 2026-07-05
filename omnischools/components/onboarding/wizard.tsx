"use client";
/**
 * Slim two-step onboarding wizard — ① School type → ② School identity (+ owner).
 * Everything else (calendar, classes, subjects, grade scale, fees) is auto-seeded by
 * the `onboardSchool` action from tier defaults; the full multi-step version lives in
 * `full-wizard.tsx` (kept for the super-admin tenant-setup portal).
 */
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GH_REGIONS,
  OWNERSHIPS,
  SCHOOL_TYPE_CARDS,
  SENIOR_TRACKS,
  cardById,
  cardForSubtype,
  type CardId,
  type OnboardInput,
  type OnboardResult,
  type SchoolSubtype,
} from "@/lib/onboarding";
import { onboardSchool } from "@/lib/actions/onboarding";

type Form = Partial<OnboardInput> & { subtype?: SchoolSubtype };

const labelCls = "flex items-center gap-1.5 text-xs font-semibold text-navy";
const helpCls = "text-[11px] leading-snug text-navy-3";
const inputCls = (filled: boolean) =>
  cn(
    "w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold",
    filled ? "border-gold-soft bg-gold-bg" : "border-border-2",
  );

export function OnboardingWizard({ initialType }: { initialType?: CardId }) {
  // A pricing plan may pre-select the type → seed subtype/product/schoolType from it and
  // start on the identity step. The "Change" link on that step can still reveal step ①.
  const preset = initialType ? cardById(initialType) : null;
  const [form, setForm] = useState<Form>(() =>
    preset
      ? {
          ownership: "PUBLIC",
          subtype: preset.defaultSubtype,
          product: preset.product,
          schoolType: preset.schoolType,
        }
      : { ownership: "PUBLIC" },
  );
  const [step, setStep] = useState<"type" | "identity">(preset ? "identity" : "type");
  const [phase, setPhase] = useState<"form" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Extract<OnboardResult, { ok: true }> | null>(null);

  const set = (k: keyof Form, v: string) => setForm((prev) => ({ ...prev, [k]: v }));
  const f = (k: keyof Form) => (form[k] as string) ?? "";

  const card = form.subtype ? cardForSubtype(form.subtype) : null;

  const pickCard = (id: CardId) => {
    const c = cardById(id);
    setForm((prev) => ({
      ...prev,
      subtype: c.defaultSubtype,
      product: c.product,
      schoolType: c.schoolType,
    }));
    setError(null);
  };
  const setSeniorTrack = (t: SchoolSubtype) => {
    setForm((prev) => ({ ...prev, subtype: t }));
    setError(null);
  };

  const goToIdentity = () => {
    if (!form.subtype) return setError("Choose a school type.");
    setError(null);
    setStep("identity");
  };
  const backToType = () => {
    setError(null);
    setStep("type");
  };

  const identityError = (): string | null => {
    if (!form.schoolName) return "Enter the school name.";
    if (!form.gesCode) return "Enter the GES code.";
    if (!form.region) return "Choose a region.";
    if (!form.district) return "Enter the district.";
    if (!form.ownership) return "Choose an ownership type.";
    if (!form.adminName) return "Enter your full name.";
    if (!form.adminPhone) return "Enter your phone number.";
    if (!form.termsAccepted)
      return "Please accept the Terms & Privacy Policy to continue.";
    return null;
  };

  async function launch() {
    const err = identityError();
    if (err) return setError(err);
    setSubmitting(true);
    setError(null);
    const res = await onboardSchool(form);
    setSubmitting(false);
    if (res.ok) {
      setResult(res);
      setPhase("done");
    } else setError(res.error);
  }

  const schoolInitial = (form.schoolName?.trim()?.[0] ?? "S").toUpperCase();

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
          <Link
            href="/"
            className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy transition-colors hover:bg-bg"
          >
            Exit
          </Link>
        </div>
      </div>

      {/* Content panel */}
      <div className="bg-surface">
        {phase !== "done" && (
          <div className="border-b border-border px-6 py-3 text-xs font-semibold text-navy-3 md:px-10">
            {step === "type" ? "Step 1 of 2 · School type" : "Step 2 of 2 · School identity"}
          </div>
        )}

        <div className="px-6 py-7 md:px-10">
          {phase === "done" && result ? (
            <DonePanel result={result} schoolName={form.schoolName ?? "Your school"} />
          ) : step === "type" ? (
            <TypeStep
              form={form}
              selectedCard={card}
              pickCard={pickCard}
              setSeniorTrack={setSeniorTrack}
            />
          ) : (
            <IdentityStep
              form={form}
              f={f}
              set={set}
              setForm={setForm}
              card={card}
              onChangeType={backToType}
            />
          )}

          {error && <p className="mt-4 text-sm text-terra">{error}</p>}
        </div>

        {/* Footer controls */}
        {phase !== "done" && (
          <div className="flex items-center gap-3.5 border-t border-border bg-bg px-6 py-4 md:px-10">
            <div className="hidden text-[11px] text-navy-3 sm:block">
              {step === "type" ? (
                <>
                  <b className="text-navy">Pick your school type</b> · this configures your
                  classes, subjects and grade scale
                </>
              ) : (
                <>
                  <b className="text-navy">Almost there</b> · launch creates your school and
                  admin login
                </>
              )}
            </div>
            <div className="ml-auto flex gap-2.5">
              {step === "identity" && !preset && (
                <button
                  onClick={backToType}
                  disabled={submitting}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold text-navy-3 transition-colors hover:text-navy disabled:opacity-60"
                >
                  ← Back
                </button>
              )}
              {step === "type" ? (
                <button
                  onClick={goToIdentity}
                  className="rounded-lg bg-navy px-6 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep"
                >
                  Continue →
                </button>
              ) : (
                <button
                  onClick={launch}
                  disabled={submitting}
                  className="rounded-lg bg-gold px-6 py-2.5 text-sm font-bold text-navy transition-colors hover:brightness-95 disabled:opacity-60"
                >
                  {submitting ? "Launching…" : "Launch school →"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- helpers */

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

/* ------------------------------------------------------------- step ① · type */

function TypeStep({
  form,
  selectedCard,
  pickCard,
  setSeniorTrack,
}: {
  form: Form;
  selectedCard: ReturnType<typeof cardForSubtype> | null;
  pickCard: (id: CardId) => void;
  setSeniorTrack: (t: SchoolSubtype) => void;
}) {
  return (
    <div>
      <Head
        pill="Step 1 of 2 · School type"
        title="What kind of"
        em="school are you?"
        lede="This sets up the right academic structure — Basic schools are class-based; Senior schools are programme-based. We pre-configure your classes, subjects and grade scale from your answer; you can refine everything later."
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
              <p className="mt-1.5 text-[11px] leading-snug text-navy-3">{c.desc}</p>
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
        surfaces show class-based or programme-based structure. Changing it later needs a
        Headmaster + GES code re-verification.
      </div>
    </div>
  );
}

/* --------------------------------------------------------- step ② · identity */

function IdentityStep({
  form,
  f,
  set,
  setForm,
  card,
  onChangeType,
}: {
  form: Form;
  f: (k: keyof Form) => string;
  set: (k: keyof Form, v: string) => void;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  card: ReturnType<typeof cardForSubtype> | null;
  onChangeType: () => void;
}) {
  return (
    <div>
      {/* When the type was pre-picked (pricing plan or step ①), show a summary chip. */}
      {card && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-gold-soft bg-gold-bg px-4 py-2.5 text-[12px]">
          <span className="font-semibold uppercase tracking-[0.06em] text-navy-3">
            School type
          </span>
          <span className="text-navy-3">·</span>
          <b className="text-navy">
            {card.name}
            {form.subtype === "SHTS" ? " (SHTS)" : form.subtype === "SHS" ? " (SHS)" : ""}
          </b>
          <button
            type="button"
            onClick={onChangeType}
            className="ml-auto text-[12px] font-semibold text-gold hover:underline"
          >
            Change
          </button>
        </div>
      )}

      <Head
        pill="Step 2 of 2 · School identity"
        title="Tell us about"
        em="your school."
        lede="The basics — name, official codes, and where you sit on the Ghana education map — plus your own details, so you can sign in. Everything else is pre-configured; you finish setup from a checklist after signing in."
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

        {/* Your details — the account owner → becomes the ADMIN who signs in first. */}
        <div className="pt-2">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
            Your details · you sign in first
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-navy-3">
            You become the school administrator. You sign in with your phone number and are
            guided through the rest of setup. Email is optional.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Full name" req>
              <input
                className={inputCls(!!f("adminName"))}
                value={f("adminName")}
                onChange={(e) => set("adminName", e.target.value)}
                placeholder="Mr K. Owusu-Frempong"
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

        {/* Terms & Privacy */}
        <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-4">
          <input
            type="checkbox"
            checked={!!form.termsAccepted}
            onChange={(e) => setForm((p) => ({ ...p, termsAccepted: e.target.checked }))}
            className="mt-0.5 h-4 w-4 accent-gold"
          />
          <span className="text-[13px] leading-relaxed text-navy-2">
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="font-semibold text-gold hover:underline">
              Terms
            </Link>{" "}
            &amp;{" "}
            <Link href="/privacy" target="_blank" className="font-semibold text-gold hover:underline">
              Privacy Policy
            </Link>
            . <span className="text-terra">*</span>
          </span>
        </label>
      </div>
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
            🎉
          </div>
          <div>
            <h3 className="font-display text-2xl font-medium text-navy">
              <b className="font-medium text-navy">{schoolName}</b> is{" "}
              <em className="not-italic text-gold [font-style:italic]">set up.</em>
            </h3>
            <p className="mt-1.5 max-w-[540px] text-[13px] leading-relaxed text-navy-2">
              Academic year <b className="text-navy">{result.academicYear}</b>
              {result.periodsCreated > 0 ? ` with ${result.periodsCreated} periods` : ""} is
              seeded, along with your classes, subjects and grade scale. Sign in with your{" "}
              <b className="text-navy">phone number</b> — we&apos;ll guide you through the rest
              from a checklist.
            </p>
          </div>
          <Link
            href="/login"
            className="rounded-lg bg-gold px-6 py-3.5 text-sm font-bold text-navy transition-colors hover:brightness-95"
          >
            Sign in →
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 font-display text-base font-medium text-navy">
          What&apos;s next · from your checklist
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {[
            ["First", "Confirm your calendar", "Set exact term dates and holidays — we've pre-filled the GES calendar."],
            ["Second", "Add your staff", "Invite teachers and staff; each gets a link to set a password."],
            ["Third", "Admit your students", "Enter or import your student list from Admissions."],
            ["Then", "Set your fees", "Fee lines and payment channels are pre-seeded — tune them in Billing."],
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

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link
          href="/login"
          className="rounded-lg border border-border-2 bg-surface px-5 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-bg"
        >
          Go to sign in
        </Link>
        <p className="font-mono text-[11px] text-navy-3">school id · {result.schoolId}</p>
      </div>
    </div>
  );
}
