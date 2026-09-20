import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { loadTemplate } from "@/lib/data/whatsapp-template";
import {
  buildTimeline,
  categoryLabel,
  languageLabel,
  buttonTypeLabel,
} from "@/lib/whatsapp-templates";
import { WhatsAppTemplatePreview } from "@/components/settings/whatsapp-template-preview";
import {
  DraftActions,
  RejectedActions,
  ResolveActions,
  StatusHeaderActions,
} from "@/components/settings/whatsapp-template-actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Status hero copy + gradient wash + icon per state. */
const HERO: Record<
  string,
  {
    wash: string;
    border: string;
    iconClass: string;
    icon: string;
    label: string;
    titleLead: string;
    accent: string;
    accentClass: string;
  }
> = {
  DRAFT: {
    wash: "bg-bg",
    border: "border-border-2",
    iconClass: "bg-border-2 text-navy-3",
    icon: "•",
    label: "Draft",
    titleLead: "Draft ·",
    accent: "not yet submitted",
    accentClass: "text-gold",
  },
  PENDING: {
    wash: "bg-gradient-to-b from-gold-bg to-surface",
    border: "border-gold-soft",
    iconClass: "bg-gold text-navy",
    icon: "⋯",
    label: "Pending",
    titleLead: "Pending",
    accent: "Meta review",
    accentClass: "text-gold",
  },
  APPROVED: {
    wash: "bg-gradient-to-b from-green-bg to-surface",
    border: "border-green-bg",
    iconClass: "bg-green text-white",
    icon: "✓",
    label: "Approved",
    titleLead: "Approved &",
    accent: "ready to send",
    accentClass: "text-green",
  },
  REJECTED: {
    wash: "bg-gradient-to-b from-terra-bg to-surface",
    border: "border-terra-bg",
    iconClass: "bg-terra text-white",
    icon: "×",
    label: "Rejected",
    titleLead: "Rejected by",
    accent: "Meta",
    accentClass: "text-terra",
  },
  ARCHIVED: {
    wash: "bg-bg",
    border: "border-border-2",
    iconClass: "bg-border-2 text-navy-3",
    icon: "▢",
    label: "Archived",
    titleLead: "Archived ·",
    accent: "no longer active",
    accentClass: "text-navy-3",
  },
};

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { school } = await requireSchool();
  const t = await loadTemplate(school.id, id);
  if (!t) notFound();

  const hero = HERO[t.status] ?? HERO.DRAFT;
  const timeline = buildTimeline(t);
  const variables = Object.keys(t.sampleValues);

  // State-specific Meta key/value column. Cost/queue values are static estimates —
  // Meta-derived, wired when the Business API is connected.
  const metaRows: { k: string; v: string }[] =
    t.status === "APPROVED"
      ? [
          { k: "Submitted", v: fmt(t.submittedAt) },
          { k: "Approved", v: fmt(t.decidedAt) },
          { k: "Category", v: categoryLabel(t.category) },
          { k: "Cost per use", v: "~GHS 0.18" },
        ]
      : t.status === "PENDING"
        ? [
            { k: "Submitted", v: fmt(t.submittedAt) },
            { k: "Last update", v: fmt(t.updatedAt) },
            { k: "Category", v: categoryLabel(t.category) },
            { k: "Position in queue", v: "~24–48 hours" },
          ]
        : t.status === "REJECTED"
          ? [
              { k: "Submitted", v: fmt(t.submittedAt) },
              { k: "Rejected", v: fmt(t.decidedAt) },
              { k: "Category submitted", v: categoryLabel(t.category) },
              { k: "Suggested", v: "Marketing" },
            ]
          : [
              { k: "Category", v: categoryLabel(t.category) },
              { k: "Language", v: languageLabel(t.language) },
              { k: "Last update", v: fmt(t.updatedAt) },
            ];

  const heroCtx =
    t.status === "APPROVED" ? (
      <>
        Meta approved this template. It can now be used in announcements and automated
        workflows once WhatsApp delivery is connected.
      </>
    ) : t.status === "PENDING" ? (
      <>
        Submitted to Meta; auto-checks passed and the template is in the manual review
        queue. <b className="font-semibold text-navy">Document headers and multiple buttons</b>{" "}
        trigger manual review — expect a decision within 24-48 hours. Omnischools will notify
        you when the status changes.
      </>
    ) : t.status === "REJECTED" ? (
      <>
        <b className="font-semibold text-navy">Reason:</b>{" "}
        {t.rejectionReason
          ? `“${t.rejectionReason}”`
          : "Meta declined this template. Review the feedback, then edit and resubmit as a new version."}{" "}
        You can edit and resubmit as a new version.
      </>
    ) : t.status === "ARCHIVED" ? (
      <>This template has been archived. It stays in the audit trail but no longer appears in the active picker.</>
    ) : (
      <>Finish composing, then submit for Meta review.</>
    );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-4 text-xs uppercase tracking-[0.12em] text-navy-3">
        <Link href="/settings" className="font-semibold text-gold hover:underline">
          Settings
        </Link>{" "}
        / Channels / WhatsApp /{" "}
        <Link
          href="/settings/channels/whatsapp/templates"
          className="text-gold hover:underline"
        >
          Templates
        </Link>{" "}
        / <span className="font-mono normal-case">{t.name}</span>
      </div>

      {/* Main head — status title + persistent header actions */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.015em] text-navy">
          Template <em className="italic text-gold">status</em>
        </h1>
        {t.status !== "DRAFT" && t.status !== "ARCHIVED" && (
          <StatusHeaderActions id={t.id} />
        )}
      </div>

      {/* Status hero */}
      <div
        className={`mb-[22px] grid items-center gap-[22px] rounded-xl border px-7 py-6 md:grid-cols-[auto_1fr_auto] ${hero.wash} ${hero.border}`}
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full font-display text-[26px] font-bold ${hero.iconClass}`}
        >
          {hero.icon}
        </span>
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
            {t.name}
          </div>
          <h2 className="font-display text-[26px] font-medium tracking-[-0.015em] text-navy">
            {hero.titleLead}{" "}
            <em className={`italic ${hero.accentClass}`}>{hero.accent}</em>
          </h2>
          <p className="mt-2 max-w-[520px] text-[13px] leading-normal text-navy-2">
            {heroCtx}
          </p>
        </div>
        <div className="text-[11px] text-navy-3 md:text-right">
          {metaRows.map((r) => (
            <div key={r.k} className="mb-1">
              {r.k}
              <br />
              <b className="mt-px block font-display text-xs font-semibold text-navy">
                {r.v}
              </b>
            </div>
          ))}
        </div>
      </div>

      {/* Draft actions live under the hero (Edit / Submit / Delete) */}
      {t.status === "DRAFT" && (
        <div className="mb-[22px] flex flex-wrap items-center gap-3">
          <Link
            href={`/settings/channels/whatsapp/templates/${t.id}/edit`}
            className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-[13px] font-semibold text-navy transition-colors hover:border-gold"
          >
            Edit
          </Link>
          <DraftActions id={t.id} />
        </div>
      )}
      {t.status === "PENDING" && (
        <div className="mb-[22px] flex flex-wrap items-center gap-3">
          <ResolveActions id={t.id} />
        </div>
      )}

      {/* 5-step pipeline timeline */}
      <div className="mb-[22px] flex items-stretch rounded-xl border border-border bg-surface px-[22px] py-[18px]">
        {timeline.map((step, i) => (
          <div
            key={i}
            className="relative flex flex-1 flex-col items-center gap-2 px-3 py-1"
          >
            {/* connector line to the previous step — greens once the prior step is done */}
            {i > 0 && (
              <span
                className={`absolute left-[-50%] right-1/2 top-4 h-0.5 ${
                  timeline[i - 1].state === "done" ? "bg-green" : "bg-border"
                }`}
              />
            )}
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 font-display text-[13px] font-bold ${
                step.state === "done"
                  ? "border-green bg-green text-white"
                  : step.state === "current"
                    ? step.tone === "terra"
                      ? "border-terra bg-terra text-white"
                      : "border-gold bg-gold text-navy shadow-[0_0_0_4px_var(--gold-bg)]"
                    : "border-border bg-surface text-navy-3"
              }`}
            >
              {step.marker}
            </span>
            <span
              className={`text-center font-display text-xs font-semibold tracking-[-0.005em] ${
                step.state === "current" && step.tone !== "terra"
                  ? "text-gold"
                  : "text-navy"
              }`}
            >
              {step.name}
            </span>
            <span
              className={`text-center text-[10px] ${
                step.state === "current" && step.tone !== "terra"
                  ? "font-semibold text-gold"
                  : "text-navy-3"
              }`}
            >
              {step.when}
            </span>
          </div>
        ))}
      </div>

      {/* REJECTED dual-path action card */}
      {t.status === "REJECTED" && (
        <div className="mb-[22px]">
          <RejectedActions id={t.id} />
        </div>
      )}

      {/* Read-only composed view + preview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
              Body
            </div>
            <p className="whitespace-pre-wrap text-sm text-navy">{t.body}</p>
            {t.footer && (
              <p className="mt-3 border-t border-border pt-3 text-xs text-navy-3">
                {t.footer}
              </p>
            )}
          </div>

          {variables.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
                Variables &amp; sample values
              </div>
              <div className="space-y-1.5">
                {variables.map((v) => (
                  <div key={v} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-gold">{v}</span>
                    <span className="text-navy-3">→</span>
                    <span className="text-navy">{t.sampleValues[v] || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {t.buttons.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
                Buttons
              </div>
              <div className="space-y-1.5">
                {t.buttons.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-[11px] font-medium text-navy-2">
                      {buttonTypeLabel(b.type)}
                    </span>
                    <span className="font-medium text-navy">{b.label}</span>
                    {b.value && (
                      <span className="font-mono text-xs text-navy-3">{b.value}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-3">
            Preview
          </div>
          <WhatsAppTemplatePreview t={t} schoolName={school.name} />
        </div>
      </div>
    </div>
  );
}
