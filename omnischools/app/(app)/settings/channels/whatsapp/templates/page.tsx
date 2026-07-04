import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { whatsappTemplates } from "@/db/schema";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  categoryLabel,
  languageLabel,
  type TemplateStatus,
} from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp templates" };

function formatWhen(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function WhatsAppTemplatesPage() {
  const { school } = await requireSchool();

  const templates = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: whatsappTemplates.id,
        name: whatsappTemplates.name,
        category: whatsappTemplates.category,
        language: whatsappTemplates.language,
        status: whatsappTemplates.status,
        updatedAt: whatsappTemplates.updatedAt,
      })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.schoolId, school.id))
      .orderBy(desc(whatsappTemplates.updatedAt)),
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="text-xs uppercase tracking-wide text-navy-3">
        <Link href="/settings" className="font-semibold text-gold hover:underline">
          Settings
        </Link>{" "}
        / WhatsApp templates
      </div>

      {/* Header — black & gold hero */}
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Omnischools · WhatsApp templates
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            Message <em className="text-gold">templates</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            WhatsApp Business requires every outbound message to use a Meta-approved
            template. Compose here; we submit on the school&apos;s behalf.
          </p>
        </div>
        <Link
          href="/settings/channels/whatsapp/templates/new"
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
        >
          + New template
        </Link>
      </div>

      {/* Honest status note */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-gold-soft bg-gold-bg p-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold font-display text-xs font-bold text-surface">
          i
        </span>
        <p className="text-[13px] leading-relaxed text-navy-2">
          WhatsApp delivery isn&apos;t wired yet — templates are composed and their approval
          lifecycle tracked; sending goes live when the WhatsApp Business API is connected.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center">
          <p className="text-sm text-navy-3">
            No templates yet. Compose your first fee reminder, welcome or exam notice.
          </p>
          <Link
            href="/settings/channels/whatsapp/templates/new"
            className="mt-4 inline-block rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            + New template
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {/* header row */}
          <div className="hidden grid-cols-[1.6fr_1fr_1fr_0.9fr_1fr] gap-3 border-b border-border bg-bg px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-navy-3 sm:grid">
            <div>Name</div>
            <div>Category</div>
            <div>Language</div>
            <div>Status</div>
            <div>Updated</div>
          </div>
          <ul>
            {templates.map((t) => (
              <li key={t.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/settings/channels/whatsapp/templates/${t.id}`}
                  className="grid grid-cols-1 gap-2 px-5 py-3.5 transition-colors hover:bg-bg sm:grid-cols-[1.6fr_1fr_1fr_0.9fr_1fr] sm:items-center sm:gap-3"
                >
                  <div className="font-mono text-[13px] font-semibold text-navy">
                    {t.name}
                  </div>
                  <div className="text-[13px] text-navy-2">
                    {categoryLabel(t.category)}
                  </div>
                  <div className="text-[13px] text-navy-2">
                    {languageLabel(t.language)}
                  </div>
                  <div>
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        STATUS_BADGE[t.status as TemplateStatus] ?? STATUS_BADGE.DRAFT
                      }`}
                    >
                      {STATUS_LABEL[t.status as TemplateStatus] ?? t.status}
                    </span>
                  </div>
                  <div className="text-[12px] text-navy-3">{formatWhen(t.updatedAt)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
