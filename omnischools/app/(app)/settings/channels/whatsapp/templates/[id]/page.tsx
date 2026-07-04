import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { loadTemplate } from "@/lib/data/whatsapp-template";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  categoryLabel,
  languageLabel,
  buttonTypeLabel,
} from "@/lib/whatsapp-templates";
import { WhatsAppTemplatePreview } from "@/components/settings/whatsapp-template-preview";
import {
  DraftActions,
  ResolveActions,
  ResolvedActions,
} from "@/components/settings/whatsapp-template-actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d
    ? new Date(d).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const HERO: Record<string, { tint: string; title: string; sub: string }> = {
  DRAFT: {
    tint: "border-border-2 bg-bg",
    title: "Draft · not yet submitted",
    sub: "Finish composing, then submit for Meta review.",
  },
  PENDING: {
    tint: "border-warn-bg bg-warn-bg",
    title: "Pending Meta review",
    sub: "Submitted to Meta. Document headers or multiple buttons trigger manual review (typically 24–72h). We'll update the status when Meta responds.",
  },
  APPROVED: {
    tint: "border-green-bg bg-green-bg",
    title: "Approved & ready to send",
    sub: "Meta approved this template. It can be used once WhatsApp delivery is connected.",
  },
  REJECTED: {
    tint: "border-terra-bg bg-terra-bg",
    title: "Rejected by Meta",
    sub: "Revise and resubmit as a new version, or duplicate to start again.",
  },
};

export default async function TemplateDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { school } = await requireSchool();
  const t = await loadTemplate(school.id, params.id);
  if (!t) notFound();
  const hero = HERO[t.status] ?? HERO.DRAFT;
  const variables = Object.keys(t.sampleValues);

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-4 text-xs text-navy-3">
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
        / <span className="font-mono">{t.name}</span>
      </div>

      {/* Status hero */}
      <div className={`rounded-xl border p-6 ${hero.tint}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span
              className={`inline-block rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${STATUS_BADGE[t.status]}`}
            >
              {STATUS_LABEL[t.status]}
            </span>
            <h1 className="mt-2 font-display text-2xl font-semibold text-navy">
              {hero.title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-navy-3">{hero.sub}</p>
          </div>
          <span className="font-mono text-sm text-navy-2">{t.name}</span>
        </div>

        {t.status === "REJECTED" && t.rejectionReason && (
          <div className="mt-4 rounded-lg border border-terra bg-surface p-3 text-sm text-terra">
            <span className="font-semibold">Meta’s reason: </span>
            {t.rejectionReason}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-navy-3 sm:grid-cols-4">
          <div>
            <div className="font-semibold uppercase tracking-wide">Category</div>
            <div className="text-navy">{categoryLabel(t.category)}</div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wide">Language</div>
            <div className="text-navy">{languageLabel(t.language)}</div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wide">Submitted</div>
            <div className="text-navy">{fmt(t.submittedAt)}</div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wide">Decided</div>
            <div className="text-navy">{fmt(t.decidedAt)}</div>
          </div>
        </div>

        {/* Status-specific actions */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {t.status === "DRAFT" && (
            <>
              <Link
                href={`/settings/channels/whatsapp/templates/${t.id}/edit`}
                className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-gold"
              >
                Edit
              </Link>
              <DraftActions id={t.id} />
            </>
          )}
          {t.status === "PENDING" && <ResolveActions id={t.id} />}
          {(t.status === "APPROVED" || t.status === "REJECTED") && (
            <ResolvedActions id={t.id} />
          )}
        </div>
      </div>

      {/* Composed template + preview */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
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
                    {b.value && <span className="font-mono text-xs text-navy-3">{b.value}</span>}
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
          <WhatsAppTemplatePreview t={t} />
        </div>
      </div>
    </div>
  );
}
