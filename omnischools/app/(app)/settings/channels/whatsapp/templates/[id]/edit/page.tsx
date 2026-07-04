import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { loadTemplate } from "@/lib/data/whatsapp-template";
import {
  WhatsAppTemplateComposer,
  type ComposerInitial,
} from "@/components/settings/whatsapp-template-composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit WhatsApp template" };

export default async function EditWhatsAppTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { school } = await requireSchool();
  const t = await loadTemplate(school.id, id);
  if (!t) notFound();
  // Only drafts can be edited — anything else views on the detail page.
  if (t.status !== "DRAFT") {
    redirect(`/settings/channels/whatsapp/templates/${id}`);
  }

  const initial: ComposerInitial = {
    id: t.id,
    name: t.name,
    category: t.category,
    language: t.language,
    headerType: t.headerType,
    headerText: t.headerText ?? "",
    headerFilename: t.headerFilename ?? "",
    body: t.body,
    footer: t.footer ?? "",
    buttons: t.buttons,
    sampleValues: t.sampleValues,
  };

  return (
    <div className="mx-auto max-w-page">
      <div className="text-xs uppercase tracking-wide text-navy-3">
        <Link href="/settings" className="font-semibold text-gold hover:underline">
          Settings
        </Link>{" "}
        /{" "}
        <Link
          href="/settings/channels/whatsapp/templates"
          className="font-semibold text-gold hover:underline"
        >
          WhatsApp templates
        </Link>{" "}
        / Edit
      </div>

      <div className="mb-6 mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools · WhatsApp templates
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Edit <em className="text-gold">draft</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Editing <span className="font-mono text-navy-2">{t.name}</span>. Drafts stay
          editable until you submit them for review.
        </p>
      </div>

      <WhatsAppTemplateComposer initial={initial} />
    </div>
  );
}
