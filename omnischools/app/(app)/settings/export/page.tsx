import { requireSchool } from "@/lib/auth/server";
import { ExportPanel } from "@/components/settings/export-panel";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data export" };

export default async function DataExportPage() {
  await requireSchool();
  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Data <em className="not-italic text-gold [font-style:italic]">export.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Download your school&apos;s records as CSV — open them in Excel or Google Sheets.
        </p>
      </div>
      <ExportPanel />
    </div>
  );
}
