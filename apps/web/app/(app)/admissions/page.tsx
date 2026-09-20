import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { admissionApplications } from "@/db/schema";
import { AdmissionActions } from "@/components/admissions/admission-actions";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: "bg-warn-bg text-warn",
  UNDER_REVIEW: "bg-gold-bg text-navy",
  ACCEPTED: "bg-green-bg text-green",
  REJECTED: "bg-terra-bg text-terra",
  WAITLISTED: "bg-bg text-navy-3",
};

export default async function AdmissionsPage() {
  const { school } = await requireSchool();
  const apps = await withSchool(school.id, (tx) =>
    tx
      .select()
      .from(admissionApplications)
      .where(eq(admissionApplications.schoolId, school.id))
      .orderBy(desc(admissionApplications.submittedAt))
      .limit(200),
  );

  const pending = apps.filter(
    (a) => a.status === "SUBMITTED" || a.status === "UNDER_REVIEW",
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools · Admissions
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Every applicant, <em className="text-gold">reviewed</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          {pending.length} awaiting review · {apps.length} total · public link:{" "}
          <Link
            href={`/apply/${encodeURIComponent(school.gesCode)}`}
            className="font-mono text-gold hover:underline"
          >
            /apply/{school.gesCode}
          </Link>
        </p>
      </div>

      {apps.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-5 w-5" />}
          title="No applications yet."
          body="Share your school's public application link with prospective parents."
          primary={{
            label: `Open /apply/${school.gesCode} →`,
            href: `/apply/${encodeURIComponent(school.gesCode)}`,
          }}
        />
      ) : (
        <div className="space-y-2">
          {apps.map((a) => {
            const decided = !(a.status === "SUBMITTED" || a.status === "UNDER_REVIEW");
            return (
              <div
                key={a.id}
                className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-navy">
                    {a.applicantLastName}, {a.applicantFirstName}{" "}
                    {a.applicantOtherNames ?? ""}
                    <span className="ml-2 text-xs text-navy-3">
                      {a.desiredClassLabel ? `→ ${a.desiredClassLabel}` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-navy-3">
                    Guardian {a.guardianName} ·{" "}
                    <span className="font-mono">{a.guardianPhone}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[a.status]}`}
                  >
                    {a.status.charAt(0) +
                      a.status.slice(1).toLowerCase().replace("_", " ")}
                  </span>
                  <AdmissionActions applicationId={a.id} decided={decided} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
