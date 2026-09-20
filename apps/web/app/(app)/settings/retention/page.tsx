import { eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools } from "@/db/schema";
import { RetentionForm } from "@/components/settings/retention-form";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retention policy" };

export default async function RetentionPage() {
  const { school } = await requireSchool();
  const [row] = await withSchool(school.id, (tx) =>
    tx
      .select({
        recordRetentionMonths: schools.recordRetentionMonths,
        auditRetentionMonths: schools.auditRetentionMonths,
      })
      .from(schools)
      .where(eq(schools.id, school.id)),
  );

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Retention <em className="not-italic text-gold [font-style:italic]">policy.</em>
        </h1>
        <p className="text-sm text-navy-3">
          How long records and audit history are kept. Set your policy to match GES and data-
          protection expectations.
        </p>
      </div>
      <RetentionForm
        initial={{
          recordRetentionMonths: row?.recordRetentionMonths ?? null,
          auditRetentionMonths: row?.auditRetentionMonths ?? null,
        }}
      />
    </div>
  );
}
