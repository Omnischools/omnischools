import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import {
  WhatsAppTemplateComposer,
  type ComposerInitial,
} from "@/components/settings/whatsapp-template-composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "New WhatsApp template" };

const EMPTY: ComposerInitial = {
  name: "",
  category: "UTILITY",
  language: "en_GH",
  headerType: "NONE",
  headerText: "",
  headerFilename: "",
  body: "",
  footer: "",
  buttons: [],
  sampleValues: {},
};

export default async function NewWhatsAppTemplatePage() {
  // Gate on school membership; the composer's actions re-check write access.
  await requireSchool();

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
        / New
      </div>

      <div className="mb-6 mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools · WhatsApp templates
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          New <em className="text-gold">template</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Compose the message, add any variables, and preview it as it will land in a
          parent&apos;s WhatsApp. Save a draft, then submit for approval.
        </p>
      </div>

      <WhatsAppTemplateComposer initial={EMPTY} />
    </div>
  );
}
