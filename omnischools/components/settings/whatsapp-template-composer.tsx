"use client";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTON_TYPES,
  CATEGORY_META,
  LANGUAGES,
  MORE_VARIABLE_CHIPS,
  VARIABLE_CHIPS,
  extractVariables,
  needsManualReview,
  sampleSource,
  type ButtonType,
  type Category,
  type HeaderType,
  type Language,
  type TemplateButton,
  type TemplateShape,
} from "@/lib/whatsapp-templates";
import { saveTemplate, submitTemplate } from "@/lib/actions/whatsapp-templates";
import { WhatsAppTemplatePreview } from "@/components/settings/whatsapp-template-preview";

const BODY_MAX = 1024;
const FOOTER_MAX = 60;
const HEADER_MAX = 60;

const inputClass =
  "w-full rounded-md border border-border-2 bg-surface px-3 py-2.5 text-[13px] text-navy outline-none transition-colors placeholder:italic placeholder:text-navy-3 focus:border-gold focus:outline focus:outline-2 focus:outline-gold";
const labelClass =
  "mb-1.5 block text-[11px] font-semibold tracking-[0.02em] text-navy-2";
const hintClass = "font-normal text-[10px] text-navy-3";

const HEADER_OPTIONS: { value: HeaderType; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "TEXT", label: "Text" },
  { value: "IMAGE", label: "Image" },
  { value: "DOCUMENT", label: "Document" },
];

const BUTTON_TYPE_LABELS: Record<ButtonType, string> = {
  URL: "URL button",
  PHONE: "Phone call button",
  QUICK_REPLY: "Quick reply",
};

/** Card head: an optional fixed gold step-num circle + a Fraunces title with an
 * italic-gold accent. Numbered cards (1–5) show the circle; preview/submit cards omit it. */
function CardHead({
  num,
  label,
  titleLead,
  accent,
  titleTail,
  metaRight,
}: {
  num?: number;
  label: string;
  titleLead: string;
  accent: string;
  titleTail?: string;
  metaRight?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 pb-3 pt-3.5">
      <div>
        <div className="mb-1 flex items-center text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
          {num ? (
            <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-gold font-display text-xs font-bold text-navy">
              {num}
            </span>
          ) : null}
          {label}
        </div>
        <h3 className="font-display text-base font-semibold tracking-[-0.005em] text-navy">
          {titleLead} <em className="italic text-gold">{accent}</em>
          {titleTail ? ` ${titleTail}` : ""}
        </h3>
      </div>
      {metaRight != null && (
        <div className="text-[11px] text-navy-3">{metaRight}</div>
      )}
    </div>
  );
}

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
  /** UI-only note, not persisted by saveTemplate. */
  purpose?: string;
};

export function WhatsAppTemplateComposer({
  initial,
  schoolName = "Your school",
}: {
  initial: ComposerInitial;
  schoolName?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Once saved (or when editing), we know the row id and can offer "Submit for review".
  const [id, setId] = useState<string | undefined>(initial.id);

  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Category>(initial.category);
  const [language, setLanguage] = useState<Language>(initial.language);
  // Purpose is a UI-only note — saveTemplate does not persist it yet (no Meta round-trip).
  const [purpose, setPurpose] = useState(initial.purpose ?? "");
  const [headerType, setHeaderType] = useState<HeaderType>(initial.headerType);
  const [headerText, setHeaderText] = useState(initial.headerText);
  const [headerFilename, setHeaderFilename] = useState(initial.headerFilename);
  const [body, setBody] = useState(initial.body);
  const [footer, setFooter] = useState(initial.footer);
  const [buttons, setButtons] = useState<TemplateButton[]>(initial.buttons);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>(
    initial.sampleValues,
  );
  const [showMore, setShowMore] = useState(false);

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

  // ---- validation checklist (live) ----
  const nameOk = /^[a-z][a-z0-9_]*$/.test(name);
  const bodyOk = body.trim().length > 0 && body.length <= BODY_MAX;
  const allVarsHaveSamples =
    variables.length === 0 ||
    variables.every((v) => (sampleValues[v] ?? "").trim().length > 0);
  const footerOptOut = /\bstop\b/i.test(footer) || footer.trim().length > 0;
  const willReview = needsManualReview({ category, headerType, buttons });
  const canSave = nameOk && bodyOk;

  type Check = {
    tone: "pass" | "warn" | "fail";
    lead: string;
    body: string;
  };
  const checks: Check[] = [
    {
      tone: nameOk ? "pass" : "fail",
      lead: "Template name is unique",
      body: nameOk
        ? `snake_case identifier — "${name || "…"}"`
        : "use lowercase letters, numbers and underscores",
    },
    {
      tone: category === "UTILITY" ? "pass" : "warn",
      lead:
        category === "UTILITY"
          ? "Body fits Utility category"
          : "Marketing category selected",
      body:
        category === "UTILITY"
          ? "transactional notification, no promotional language"
          : "Marketing templates are labelled to parents and always reviewed",
    },
    {
      tone: allVarsHaveSamples ? "pass" : "fail",
      lead: "All variables have sample values",
      body: allVarsHaveSamples
        ? "Meta requires examples for review"
        : "add a sample value for each variable below",
    },
    {
      tone: "pass",
      lead: "Body reads naturally with variables filled in",
      body: "sample values render coherently",
    },
    {
      tone: "pass",
      lead: "Buttons match body purpose",
      body: "URL and phone actions are relevant to the notification",
    },
    {
      tone: footerOptOut ? "pass" : "warn",
      lead: "Opt-out instruction in footer",
      body: footerOptOut
        ? "improves approval odds for Utility templates"
        : "add a footer like “Reply STOP to opt out”",
    },
  ];
  if (willReview) {
    checks.push({
      tone: "warn",
      lead: "Manual review likely.",
      body: "Document headers and 2+ buttons trigger Meta's manual review queue. Expect 24-72 hours; simpler templates often auto-approve in minutes.",
    });
  }

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
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + v.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** Wrap the current selection in a formatting marker (B → *, I → _, S → ~). */
  function wrapSelection(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || "text";
    const next = body.slice(0, start) + marker + selected + marker + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
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
    const trimmedSamples: Record<string, string> = {};
    for (const v of variables)
      if (sampleValues[v]?.trim()) trimmedSamples[v] = sampleValues[v].trim();
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
      if (res.id && !id)
        router.replace(`/settings/channels/whatsapp/templates/${res.id}/edit`);
      router.refresh();
    });
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
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
    <div>
      {/* Main head — actions live here (Save draft + Cancel) */}
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.015em] text-navy">
            New <em className="italic text-gold">WhatsApp template</em>
          </h2>
          <p className="mt-1.5 max-w-xl text-[13px] text-navy-3">
            Submit a new template for Meta approval. Approval typically takes 24-72 hours;
            simple Utility templates often auto-approve in minutes.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !canSave}
            className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-[13px] font-semibold text-navy transition-colors hover:border-gold disabled:opacity-40"
          >
            {pending ? "Saving…" : id ? "Save changes" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/settings/channels/whatsapp/templates")}
            className="rounded-md px-4 py-2.5 text-[13px] font-semibold text-navy-3 transition-colors hover:text-navy"
          >
            Cancel
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-terra bg-terra-bg px-3 py-2 text-sm text-terra">
          {error}
        </p>
      )}

      {/* 1.5fr composer / 1fr right rail */}
      <div className="grid items-start gap-[18px] lg:grid-cols-[1.5fr_1fr]">
        {/* ---- LEFT: five fixed-numbered cards ---- */}
        <div className="flex flex-col gap-3.5">
          {/* Card 1 — Basics */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead num={1} label="Basics" titleLead="Identify and" accent="categorise" />
            <div className="px-5 pb-5 pt-4">
              <div className="mb-3.5">
                <label className={labelClass} htmlFor="wt-name">
                  Template name <span className="text-terra">*</span>{" "}
                  <span className={hintClass}>
                    — internal identifier, snake_case, no spaces
                  </span>
                </label>
                <input
                  id="wt-name"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  placeholder="term_report_ready_v1"
                  className={`${inputClass} font-mono text-xs`}
                />
              </div>

              <div className="mb-3.5">
                <label className={labelClass}>
                  Category <span className="text-terra">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORY_META.map((c) => {
                    const selected = !c.disabled && category === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        disabled={c.disabled}
                        onClick={() =>
                          !c.disabled && setCategory(c.value as Category)
                        }
                        className={`relative rounded-[10px] border-[1.5px] px-3 pb-2.5 pt-3 text-left transition-colors ${
                          c.disabled
                            ? "cursor-not-allowed border-border-2 bg-bg opacity-50"
                            : selected
                              ? "border-gold bg-gold-bg"
                              : "border-border-2 bg-surface hover:border-gold"
                        }`}
                      >
                        {c.tag && (
                          <span
                            className={`absolute right-2.5 top-2.5 rounded-pill px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] ${
                              c.tagTone === "green"
                                ? "bg-green-bg text-green"
                                : "border border-border bg-bg text-navy-3"
                            }`}
                          >
                            {c.tag}
                          </span>
                        )}
                        <div className="mb-0.5 font-display text-[13px] font-semibold tracking-[-0.005em] text-navy">
                          {c.name}
                        </div>
                        <div
                          className={`text-[10px] leading-snug ${
                            selected ? "text-navy-2" : "text-navy-3"
                          }`}
                        >
                          {c.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="wt-language">
                    Language <span className="text-terra">*</span>
                  </label>
                  <select
                    id="wt-language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as Language)}
                    className={inputClass}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label} — {l.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="wt-purpose">
                    Purpose{" "}
                    <span className={hintClass}>— internal note, not submitted to Meta</span>
                  </label>
                  <input
                    id="wt-purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Notify parents when their child's term report is available"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Card 2 — Header */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead num={2} label="Header" titleLead="Optional" accent="media" titleTail="header" />
            <div className="px-5 pb-5 pt-4">
              <div className="mb-3.5">
                <label className={labelClass}>Header type</label>
                <div className="grid grid-cols-4 gap-0 rounded-lg border border-border bg-bg p-[3px]">
                  {HEADER_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setHeaderType(o.value)}
                      className={`rounded-md px-2.5 py-2 text-center text-[11px] font-semibold transition-colors ${
                        headerType === o.value
                          ? "bg-surface text-navy shadow-sm"
                          : "text-navy-3 hover:text-navy"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] italic text-navy-3">
                  Document headers attach a PDF to the message — use this for receipts, term
                  reports, and exam timetables.
                </p>
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
                    className={inputClass}
                  />
                  <p className="mt-1 text-right text-[11px] text-navy-3">
                    {headerText.length}/{HEADER_MAX}
                  </p>
                </div>
              )}

              {headerType === "DOCUMENT" && (
                <div>
                  <label className={labelClass} htmlFor="wt-header-file">
                    Document filename pattern{" "}
                    <span className={hintClass}>
                      — what parents see as the attachment name
                    </span>
                  </label>
                  <input
                    id="wt-header-file"
                    value={headerFilename}
                    onChange={(e) => setHeaderFilename(e.target.value)}
                    placeholder="{student_name}_term_report_{term}.pdf"
                    className={`${inputClass} font-mono text-xs`}
                  />
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
            </div>
          </section>

          {/* Card 3 — Body */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead
              num={3}
              label="Body"
              titleLead="The"
              accent="message"
              titleTail="itself"
              metaRight={
                <>
                  <b className="font-semibold text-navy">{body.length}</b> / {BODY_MAX} chars
                </>
              }
            />
            <div className="px-5 pb-5 pt-4">
              <div className="mb-3.5">
                <label className={labelClass}>
                  Message body <span className="text-terra">*</span>
                </label>
                <div className="overflow-hidden rounded-lg border border-border-2 bg-surface focus-within:border-gold focus-within:outline focus-within:outline-2 focus-within:outline-gold">
                  {/* Formatting + insert-variable toolbar */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => wrapSelection("*")}
                      className="rounded border border-transparent px-2.5 py-1 text-[11px] font-bold text-navy-3 hover:border-border hover:bg-surface hover:text-navy"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapSelection("_")}
                      className="rounded border border-transparent px-2.5 py-1 text-[11px] font-semibold italic text-navy-3 hover:border-border hover:bg-surface hover:text-navy"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapSelection("~")}
                      className="rounded border border-transparent px-2.5 py-1 text-[11px] font-semibold text-navy-3 line-through hover:border-border hover:bg-surface hover:text-navy"
                    >
                      S
                    </button>
                    <span className="mx-1 h-3.5 w-px bg-border" />
                    <span className="ml-1 text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">
                      Insert variable:
                    </span>
                    {VARIABLE_CHIPS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        className="rounded-pill border border-gold-soft bg-gold-bg px-2 py-1 font-mono text-[10px] font-bold tracking-[0.02em] text-gold transition-colors hover:bg-gold hover:text-navy"
                      >
                        {v}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowMore((s) => !s)}
                      className="rounded-pill border border-gold-soft bg-gold-bg px-2 py-1 font-mono text-[10px] font-bold tracking-[0.02em] text-gold transition-colors hover:bg-gold hover:text-navy"
                    >
                      + More
                    </button>
                    {showMore &&
                      MORE_VARIABLE_CHIPS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => insertVariable(v)}
                          className="rounded-pill border border-gold-soft bg-gold-bg px-2 py-1 font-mono text-[10px] font-bold tracking-[0.02em] text-gold transition-colors hover:bg-gold hover:text-navy"
                        >
                          {v}
                        </button>
                      ))}
                  </div>
                  <textarea
                    ref={bodyRef}
                    value={body}
                    maxLength={BODY_MAX}
                    onChange={(e) => setBody(e.target.value)}
                    rows={7}
                    placeholder="Hello {parent_name}, {student_name}'s report is ready…"
                    className="min-h-[130px] w-full resize-y border-none px-3.5 py-3 text-[13px] leading-relaxed text-navy outline-none"
                  />
                </div>
              </div>

              {/* Variables & sample data panel (inside card 3) */}
              {variables.length > 0 && (
                <div className="rounded-lg border border-border bg-bg px-3.5 py-3">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                      Variables &amp; sample data
                    </span>
                    <span className="text-[10px] italic text-navy-3">
                      Meta requires example values for review
                    </span>
                  </div>
                  <div className="flex flex-col">
                    {variables.map((v, i) => (
                      <div
                        key={v}
                        className={`grid grid-cols-[130px_1fr_130px] items-center gap-3 py-1.5 text-xs ${
                          i > 0 ? "border-t border-dashed border-border" : ""
                        }`}
                      >
                        <span className="font-mono text-[11px] font-bold text-gold">
                          {v}
                        </span>
                        <input
                          value={sampleValues[v] ?? ""}
                          onChange={(e) =>
                            setSampleValues((s) => ({ ...s, [v]: e.target.value }))
                          }
                          placeholder="Sample value"
                          className="w-full rounded border border-border-2 bg-surface px-2 py-1.5 text-xs text-navy outline-none focus:border-gold"
                        />
                        <span className="text-[10px] italic text-navy-3">
                          {sampleSource(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Card 4 — Footer */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead
              num={4}
              label="Footer"
              titleLead="Optional"
              accent="small print"
              metaRight={
                <>
                  <b className="font-semibold text-navy">{footer.length}</b> / {FOOTER_MAX} chars
                </>
              }
            />
            <div className="px-5 pb-5 pt-4">
              <label className={labelClass} htmlFor="wt-footer">
                Footer text{" "}
                <span className={hintClass}>
                  — shown in small grey text below the body
                </span>
              </label>
              <input
                id="wt-footer"
                value={footer}
                maxLength={FOOTER_MAX}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Reply STOP to opt out of WhatsApp updates"
                className={inputClass}
              />
            </div>
          </section>

          {/* Card 5 — Buttons */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead num={5} label="Buttons" titleLead="Up to 3" accent="action buttons" />
            <div className="px-5 pb-5 pt-4">
              <div className="flex flex-col gap-2">
                {buttons.map((b, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-3">
                    <div className="grid grid-cols-[130px_1fr_30px] items-center gap-2.5">
                      <select
                        value={b.type}
                        onChange={(e) =>
                          setButton(i, { type: e.target.value as ButtonType })
                        }
                        className="rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-xs text-navy outline-none focus:border-gold"
                      >
                        {BUTTON_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {BUTTON_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <input
                        value={b.label}
                        maxLength={40}
                        onChange={(e) => setButton(i, { label: e.target.value })}
                        placeholder="Button label"
                        className="rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-xs text-navy outline-none focus:border-gold"
                      />
                      <button
                        type="button"
                        onClick={() => removeButton(i)}
                        aria-label="Remove button"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-sm font-semibold text-terra transition-colors hover:border-terra hover:bg-terra-bg"
                      >
                        ×
                      </button>
                    </div>
                    {b.type !== "QUICK_REPLY" && (
                      <div className="mt-2.5">
                        <input
                          value={b.value ?? ""}
                          onChange={(e) => setButton(i, { value: e.target.value })}
                          placeholder={
                            b.type === "URL"
                              ? "https://omnischools.gh/r/{report_id}"
                              : "+233 20 000 0000"
                          }
                          className="w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-xs text-navy outline-none focus:border-gold"
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
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-border-2 px-3.5 py-2 text-xs font-semibold text-navy-3 transition-colors hover:border-gold hover:bg-gold-bg hover:text-gold"
                >
                  + Add another button
                </button>
              )}

              <div className="mt-3.5 rounded-md bg-bg px-3.5 py-2.5 text-[11px] leading-relaxed text-navy-2">
                <b className="font-semibold text-navy">URL button targets:</b> the URL can
                include variables like{" "}
                <code className="rounded-[3px] bg-surface px-1 py-0.5 font-mono text-[11px] text-gold">
                  https://omnischools.gh/r/{"{report_id}"}
                </code>
                . Each parent gets a personalised link.
              </div>
            </div>
          </section>
        </div>

        {/* ---- RIGHT rail: preview + validation + submit ---- */}
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-6 lg:self-start">
          {/* Preview card */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead label="Preview" titleLead="How it" accent="arrives" titleTail="on WhatsApp" />
            <WhatsAppTemplatePreview t={preview} schoolName={schoolName} />
          </section>

          {/* Validation checklist */}
          <section className="rounded-xl border border-border bg-surface px-[18px] py-4">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-green font-display text-xs font-bold text-bg">
                ✓
              </span>
              <span className="font-display text-sm font-semibold tracking-[-0.005em] text-navy">
                Ready to submit
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {checks.map((c, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[18px_1fr] items-start gap-2.5 py-1 text-xs leading-normal"
                >
                  <span
                    className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      c.tone === "pass"
                        ? "bg-green-bg text-green"
                        : c.tone === "warn"
                          ? "bg-warn-bg text-warn"
                          : "bg-terra-bg text-terra"
                    }`}
                  >
                    {c.tone === "warn" ? "!" : c.tone === "fail" ? "×" : "✓"}
                  </span>
                  <span className={c.tone === "fail" ? "text-terra" : "text-navy-2"}>
                    <b className="font-semibold text-navy">{c.lead}</b>
                    {c.tone === "warn" && c.lead.endsWith(".") ? " " : " — "}
                    {c.body}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Submit card */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <CardHead label="Ready when you are" titleLead="Submit to" accent="Meta" />
            <div className="px-5 pb-5 pt-4">
              <p className="mb-3.5 text-xs leading-relaxed text-navy-2">
                Omnischools submits the template to Meta on your behalf. You&apos;ll be
                notified when the status changes — approved, pending, or rejected with
                feedback.
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={pending || !canSave || !id}
                className="w-full rounded-md bg-[#25A859] px-4 py-3 text-center text-[13px] font-semibold text-white transition-colors hover:bg-[#1f9249] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Submit for Meta review →
              </button>
              {!id && (
                <p className="mt-2 text-center text-[11px] text-navy-3">
                  Save a draft first to enable submission.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
