"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTON_TYPES,
  CATEGORIES,
  LANGUAGES,
  VARIABLE_CHIPS,
  categoryLabel,
  extractVariables,
  needsManualReview,
  type ButtonType,
  type Category,
  type HeaderType,
  type Language,
  type TemplateButton,
  type TemplateShape,
} from "@/lib/whatsapp-templates";
import { saveTemplate, submitTemplate } from "@/lib/actions/whatsapp-templates";
import { WhatsAppTemplatePreview } from "@/components/settings/whatsapp-template-preview";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";
const cardClass = "rounded-2xl border border-border bg-surface p-5";
const cardTitleClass = "font-display text-base font-semibold text-navy";
const cardNumClass =
  "flex h-6 w-6 items-center justify-center rounded-md bg-gold-bg font-display text-xs font-semibold text-gold";

const BODY_MAX = 1024;
const FOOTER_MAX = 60;
const HEADER_MAX = 60;

const HEADER_OPTIONS: { value: HeaderType; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "TEXT", label: "Text" },
  { value: "IMAGE", label: "Image" },
  { value: "DOCUMENT", label: "Document" },
];

export type ComposerInitial = {
  id?: string;
  name: string;
  category: Category;
  language: Language;
  headerType: HeaderType;
  headerText: string;
  headerFilename: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  sampleValues: Record<string, string>;
};

export function WhatsAppTemplateComposer({ initial }: { initial: ComposerInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Once saved (or when editing), we know the row id and can offer "Submit for review".
  const [id, setId] = useState<string | undefined>(initial.id);

  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Category>(initial.category);
  const [language, setLanguage] = useState<Language>(initial.language);
  const [headerType, setHeaderType] = useState<HeaderType>(initial.headerType);
  const [headerText, setHeaderText] = useState(initial.headerText);
  const [headerFilename, setHeaderFilename] = useState(initial.headerFilename);
  const [body, setBody] = useState(initial.body);
  const [footer, setFooter] = useState(initial.footer);
  const [buttons, setButtons] = useState<TemplateButton[]>(initial.buttons);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>(
    initial.sampleValues,
  );

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const variables = useMemo(
    () => extractVariables(body, headerType === "TEXT" ? headerText : null),
    [body, headerText, headerType],
  );

  const preview: TemplateShape = {
    name,
    category,
    language,
    headerType,
    headerText: headerType === "TEXT" ? headerText : null,
    headerFilename: headerType === "DOCUMENT" ? headerFilename : null,
    body,
    footer: footer.trim() ? footer : null,
    buttons,
    sampleValues,
  };

  // ---- validation checklist ----
  const nameOk = /^[a-z][a-z0-9_]*$/.test(name);
  const bodyOk = body.trim().length > 0 && body.length <= BODY_MAX;
  const allVarsHaveSamples = variables.every((v) => (sampleValues[v] ?? "").trim().length > 0);
  const willReview = needsManualReview({ category, headerType, buttons });

  type Check = { ok: boolean; warn?: boolean; label: string };
  const checks: Check[] = [
    { ok: nameOk, label: nameOk ? "Name is snake_case" : "Name must be snake_case" },
    { ok: bodyOk, label: bodyOk ? "Body is set" : "Body can't be empty" },
    {
      ok: variables.length === 0 || allVarsHaveSamples,
      label:
        variables.length === 0
          ? "No variables to sample"
          : allVarsHaveSamples
            ? "All variables have sample values"
            : "Some variables need sample values",
    },
    {
      ok: !willReview,
      warn: willReview,
      label: willReview
        ? "Document header / 2+ buttons / Marketing → manual review"
        : "Utility · auto-approves on submit",
    },
  ];
  const canSave = nameOk && bodyOk;

  // ---- variable insertion (at cursor, else append) ----
  function insertVariable(v: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + v);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + v + body.slice(end);
    setBody(next);
    // restore caret just after the inserted token
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + v.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function setButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function addButton() {
    if (buttons.length >= 3) return;
    setButtons((bs) => [...bs, { type: "QUICK_REPLY", label: "", value: "" }]);
  }
  function removeButton(i: number) {
    setButtons((bs) => bs.filter((_, idx) => idx !== i));
  }

  function payload() {
    // Only keep sample values for variables actually referenced.
    const trimmedSamples: Record<string, string> = {};
    for (const v of variables) if (sampleValues[v]?.trim()) trimmedSamples[v] = sampleValues[v].trim();
    return {
      id,
      name,
      category,
      language,
      headerType,
      headerText: headerType === "TEXT" ? headerText : "",
      headerFilename: headerType === "DOCUMENT" ? headerFilename : "",
      body,
      footer,
      buttons: buttons
        .filter((b) => b.label.trim())
        .map((b) => ({
          type: b.type,
          label: b.label.trim(),
          value: b.type === "QUICK_REPLY" ? "" : (b.value ?? "").trim(),
        })),
      sampleValues: trimmedSamples,
    };
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await saveTemplate(payload());
      if (!res.ok) {
        setError(res.error ?? "Could not save the template.");
        return;
      }
      if (res.id) setId(res.id);
      // Stay on the page so the author can then submit; refresh server state.
      if (res.id && !id) router.replace(`/settings/channels/whatsapp/templates/${res.id}/edit`);
      router.refresh();
    });
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      // Save first (captures any edits), then submit.
      const saved = await saveTemplate(payload());
      if (!saved.ok) {
        setError(saved.error ?? "Could not save the template.");
        return;
      }
      const savedId = saved.id ?? id;
      if (savedId) setId(savedId);
      if (!savedId) {
        setError("Could not save the template.");
        return;
      }
      const res = await submitTemplate({ id: savedId });
      if (!res.ok) {
        setError(res.error ?? "Could not submit the template.");
        return;
      }
      router.push(`/settings/channels/whatsapp/templates/${savedId}`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* ---- Left: the editor cards ---- */}
      <div className="space-y-5">
        {error && (
          <p className="rounded-md border border-terra bg-terra-bg px-3 py-2 text-sm text-terra">
            {error}
          </p>
        )}

        {/* 01 · Basics */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cardNumClass}>01</span>
            <h2 className={cardTitleClass}>Basics</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="wt-name">
                Template name
              </label>
              <input
                id="wt-name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="e.g. fee_reminder"
                className={`${fieldClass} font-mono`}
              />
              <p className="mt-1 text-[11px] text-navy-3">
                Lowercase letters, numbers and underscores — e.g.{" "}
                <span className="font-mono">exam_results_ready</span>.
              </p>
            </div>

            <div>
              <label className={labelClass}>Category</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                      category === c
                        ? "border-gold bg-gold-bg text-navy"
                        : "border-border-2 bg-bg text-navy-2 hover:border-gold"
                    }`}
                  >
                    {categoryLabel(c)}
                  </button>
                ))}
                {/* Authentication — disabled: OTPs go over SMS in Ghana */}
                <div
                  aria-disabled
                  title="OTPs route via SMS in Ghana"
                  className="cursor-not-allowed rounded-lg border border-dashed border-border-2 bg-bg px-3 py-2.5 text-left text-sm font-semibold text-navy-3 opacity-60"
                >
                  Authentication
                </div>
              </div>
              {category === "MARKETING" && (
                <p className="mt-1.5 text-[11px] text-navy-3">
                  Marketing templates always go through Meta&apos;s manual review.
                </p>
              )}
              <p className="mt-1 text-[11px] text-navy-3">
                Authentication is disabled — OTPs route via SMS in Ghana.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="wt-language">
                Language
              </label>
              <select
                id="wt-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className={fieldClass}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 02 · Header */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cardNumClass}>02</span>
            <h2 className={cardTitleClass}>Header</h2>
            <span className="text-xs text-navy-3">— optional</span>
          </div>

          <div className="mb-3 inline-flex rounded-lg border border-border-2 bg-bg p-0.5">
            {HEADER_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setHeaderType(o.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  headerType === o.value
                    ? "bg-surface text-navy shadow-sm"
                    : "text-navy-3 hover:text-navy"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {headerType === "TEXT" && (
            <div>
              <label className={labelClass} htmlFor="wt-header-text">
                Header text
              </label>
              <input
                id="wt-header-text"
                value={headerText}
                maxLength={HEADER_MAX}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="e.g. Term 2 fees are due"
                className={fieldClass}
              />
              <p className="mt-1 text-right text-[11px] text-navy-3">
                {headerText.length}/{HEADER_MAX}
              </p>
            </div>
          )}

          {headerType === "DOCUMENT" && (
            <div>
              <label className={labelClass} htmlFor="wt-header-file">
                Filename pattern
              </label>
              <input
                id="wt-header-file"
                value={headerFilename}
                onChange={(e) => setHeaderFilename(e.target.value)}
                placeholder="{student_name}_report_{term}.pdf"
                className={`${fieldClass} font-mono`}
              />
              <p className="mt-1 text-[11px] text-navy-3">
                e.g. <span className="font-mono">{"{student_name}_report_{term}.pdf"}</span>
              </p>
            </div>
          )}

          {headerType === "IMAGE" && (
            <p className="text-[13px] text-navy-3">
              An image header — the actual image is chosen when the message is sent.
            </p>
          )}

          {headerType === "NONE" && (
            <p className="text-[13px] text-navy-3">No header on this template.</p>
          )}
        </section>

        {/* 03 · Body */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cardNumClass}>03</span>
            <h2 className={cardTitleClass}>Body</h2>
          </div>

          <textarea
            ref={bodyRef}
            value={body}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Hi {parent_name}, term {term} fees for {student_name} are now due…"
            className={`${fieldClass} resize-y leading-relaxed`}
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-navy-3">Tap a chip to insert a variable.</span>
            <span className="text-[11px] text-navy-3">
              {body.length}/{BODY_MAX}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {VARIABLE_CHIPS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="rounded-full border border-gold-soft bg-gold-bg px-2.5 py-1 font-mono text-[11px] font-semibold text-navy transition-colors hover:border-gold"
              >
                {v}
              </button>
            ))}
          </div>
        </section>

        {/* 04 · Sample values (only when variables are used) */}
        {variables.length > 0 && (
          <section className={cardClass}>
            <div className="mb-1 flex items-center gap-2.5">
              <span className={cardNumClass}>04</span>
              <h2 className={cardTitleClass}>Sample values</h2>
            </div>
            <p className="mb-4 text-[12px] text-navy-3">
              Meta reviews templates with example content — give each variable a realistic
              sample.
            </p>
            <div className="space-y-2.5">
              {variables.map((v) => (
                <div key={v} className="grid grid-cols-[140px_1fr] items-center gap-3">
                  <span className="font-mono text-[13px] text-navy-2">{v}</span>
                  <input
                    value={sampleValues[v] ?? ""}
                    onChange={(e) =>
                      setSampleValues((s) => ({ ...s, [v]: e.target.value }))
                    }
                    placeholder="Sample value"
                    className={fieldClass}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 05 · Footer */}
        <section className={cardClass}>
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cardNumClass}>{variables.length > 0 ? "05" : "04"}</span>
            <h2 className={cardTitleClass}>Footer</h2>
            <span className="text-xs text-navy-3">— optional</span>
          </div>
          <input
            value={footer}
            maxLength={FOOTER_MAX}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="e.g. Reply STOP to opt out"
            className={fieldClass}
          />
          <p className="mt-1 text-right text-[11px] text-navy-3">
            {footer.length}/{FOOTER_MAX}
          </p>
        </section>

        {/* 06 · Buttons */}
        <section className={cardClass}>
          <div className="mb-1 flex items-center gap-2.5">
            <span className={cardNumClass}>{variables.length > 0 ? "06" : "05"}</span>
            <h2 className={cardTitleClass}>Buttons</h2>
            <span className="text-xs text-navy-3">— up to 3, optional</span>
          </div>
          <p className="mb-4 text-[12px] text-navy-3">
            Two or more buttons sends the template to Meta&apos;s manual review.
          </p>

          <div className="space-y-3">
            {buttons.map((b, i) => (
              <div
                key={i}
                className="rounded-lg border border-border-2 bg-bg p-3"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <label className={labelClass}>Type</label>
                    <select
                      value={b.type}
                      onChange={(e) =>
                        setButton(i, { type: e.target.value as ButtonType })
                      }
                      className={fieldClass}
                    >
                      {BUTTON_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t === "URL"
                            ? "URL"
                            : t === "PHONE"
                              ? "Phone"
                              : "Quick reply"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <label className={labelClass}>Label</label>
                    <input
                      value={b.label}
                      maxLength={40}
                      onChange={(e) => setButton(i, { label: e.target.value })}
                      placeholder="e.g. Pay now"
                      className={fieldClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeButton(i)}
                    aria-label="Remove button"
                    className="mb-1 shrink-0 text-xs font-semibold text-terra hover:underline"
                  >
                    Remove
                  </button>
                </div>
                {b.type !== "QUICK_REPLY" && (
                  <div className="mt-3">
                    <label className={labelClass}>
                      {b.type === "URL" ? "URL" : "Phone number"}
                    </label>
                    <input
                      value={b.value ?? ""}
                      onChange={(e) => setButton(i, { value: e.target.value })}
                      placeholder={
                        b.type === "URL" ? "https://…" : "+233 20 000 0000"
                      }
                      className={fieldClass}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {buttons.length < 3 && (
            <button
              type="button"
              onClick={addButton}
              className="mt-3 rounded-md border border-border-2 bg-bg px-3 py-2 text-xs font-semibold text-navy-2 transition-colors hover:border-gold hover:text-navy"
            >
              + Add button
            </button>
          )}
        </section>
      </div>

      {/* ---- Right: preview + checklist + actions (sticky) ---- */}
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-3">
            Preview
          </div>
          <WhatsAppTemplatePreview t={preview} />
        </div>

        <div className={cardClass}>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-3">
            Checklist
          </div>
          <ul className="space-y-2">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-surface ${
                    c.warn ? "bg-warn" : c.ok ? "bg-green" : "bg-border-2"
                  }`}
                >
                  {c.warn ? "!" : c.ok ? "✓" : ""}
                </span>
                <span className={c.ok || c.warn ? "text-navy-2" : "text-navy-3"}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !canSave}
            className="w-full rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-gold disabled:opacity-60"
          >
            {pending ? "Saving…" : id ? "Save changes" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !canSave}
            className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            Submit for review
          </button>
          <p className="text-center text-[11px] text-navy-3">
            Submitting saves your changes, then sends the template for approval.
          </p>
        </div>
      </aside>
    </div>
  );
}
