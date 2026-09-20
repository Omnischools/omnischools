"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { submitLead } from "@/lib/actions/marketing";

const ROLES = [
  "Head of school / Headmaster",
  "Proprietor / Owner",
  "Administrator / Bursar",
  "GES district / regional officer",
  "Other",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-bg mt-2 inline-flex w-full items-center justify-center rounded-md bg-navy px-5 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
    >
      {pending ? "Sending…" : "Request a demo"}
    </button>
  );
}

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold tracking-[0.02em] text-navy-2";

export function ContactSection({
  eyebrow = "See it in action",
  heading = "Book a 30-minute demo.",
  intro,
}: {
  eyebrow?: string;
  heading?: string;
  intro?: string;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setError(null);
    const res = await submitLead({
      name: formData.get("name"),
      role: formData.get("role"),
      organisation: formData.get("organisation"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      message: formData.get("message"),
      source: "demo_form",
    });
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  return (
    <section id="demo" className="bg-bg px-6 py-24 md:px-8">
      <div className="mx-auto grid max-w-[1100px] items-start gap-12 md:grid-cols-[1fr_1.2fr] md:gap-16">
        <div>
          <div className="mb-[18px] inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {eyebrow}
          </div>
          <h2 className="mb-4 font-display text-[clamp(30px,3.8vw,42px)] font-semibold leading-tight text-navy">
            {heading.includes("demo") ? (
              <>
                Book a 30-minute{" "}
                <em className="not-italic text-gold [font-style:italic]">demo.</em>
              </>
            ) : (
              heading
            )}
          </h2>
          <p className="mb-4 text-base leading-relaxed text-navy-2">
            {intro ??
              "We'll walk through the modules that matter for your school, answer questions on mobile money setup or data migration, and show how Omnischools handles the workflows you're stuck on today."}
          </p>
          <ul className="mt-7 space-y-2.5">
            {[
              "No sales pressure — it's a working session",
              "We come with the platform pre-loaded with your structure",
              "Migration paths from your current system, if any",
            ].map((b) => (
              <li key={b} className="flex gap-3 text-sm text-navy-2">
                <span className="font-bold text-gold">→</span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface rounded-2xl border border-border p-9 shadow-md">
          {done ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-bg font-display text-xl text-green">
                ✓
              </div>
              <h3 className="mb-2 font-display text-2xl font-semibold text-navy">
                Request received.
              </h3>
              <p className="max-w-[320px] text-sm text-navy-2">
                We&apos;ll be in touch within one working day. No spam, ever.
              </p>
            </div>
          ) : (
            <form action={action} className="space-y-[18px]">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="name">
                    Your name
                  </label>
                  <input id="name" name="name" required className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="role">
                    Your role
                  </label>
                  <select
                    id="role"
                    name="role"
                    required
                    className={fieldClass}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose one
                    </option>
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="organisation">
                  School / organisation
                </label>
                <input
                  id="organisation"
                  name="organisation"
                  required
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="phone">
                    Phone (WhatsApp ok)
                  </label>
                  <input id="phone" name="phone" type="tel" className={fieldClass} />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="message">
                  What&apos;s most useful to see?{" "}
                  <span className="font-medium text-navy-3">— optional</span>
                </label>
                <textarea
                  id="message"
                  name="message"
                  className={`${fieldClass} min-h-[90px] resize-y`}
                  placeholder="e.g. how Mobile Money reconciliation works, or migrating from our spreadsheets"
                />
              </div>
              {error && <p className="text-sm text-terra">{error}</p>}
              <SubmitButton />
              <p className="text-center text-[11.5px] text-navy-3">
                We&apos;ll be in touch within one working day. No spam, ever.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
