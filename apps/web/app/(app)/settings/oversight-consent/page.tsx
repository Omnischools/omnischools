import { and, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools, users, schoolStaffOversightConsent } from "@/db/schema";
import { deriveConsentState } from "@/lib/oversight-consent";
import { OversightConsentPanel } from "@/components/settings/oversight-consent-panel";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "GES staff-record consent" };

/** `YYYY-MM-DD HH:mm`, matching the audit-log formatter — preformat server-side to avoid TZ drift. */
function when(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(
    date.getHours(),
  )}:${p(date.getMinutes())}`;
}

export default async function OversightConsentPage() {
  // Page fence (ADMIN/HEADMASTER only; no tier gate). The action re-fences independently.
  const { school } = await requireSchoolRole(["ADMIN", "HEADMASTER"]);

  const data = await withSchool(school.id, async (tx) => {
    // `ActiveSchool` doesn't carry ownership → read it here alongside the consent row.
    const [s] = await tx
      .select({ ownership: schools.ownership })
      .from(schools)
      .where(eq(schools.id, school.id));
    const [c] = await tx
      .select({
        state: schoolStaffOversightConsent.state,
        grantedByName: users.fullName,
        grantedByRole: schoolStaffOversightConsent.grantedByRole,
        grantedAt: schoolStaffOversightConsent.grantedAt,
        revokedAt: schoolStaffOversightConsent.revokedAt,
        version: schoolStaffOversightConsent.consentStatementVersion,
      })
      .from(schoolStaffOversightConsent)
      .leftJoin(users, eq(schoolStaffOversightConsent.grantedByUserId, users.id))
      .where(
        and(
          eq(schoolStaffOversightConsent.schoolId, school.id),
          eq(schoolStaffOversightConsent.scope, "NON_GES_STAFF"),
        ),
      );
    return { ownership: s?.ownership ?? "PRIVATE", consent: c ?? null };
  });

  const c = data.consent;

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          GES staff-record{" "}
          <em className="not-italic text-gold [font-style:italic]">consent.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Authorise — or withdraw — GES and the Ministry of Education to view the individual record of
          a named non-teaching or non-register staff member through Omnischools Oversight&apos;s gated,
          audit-logged path. Aggregate reporting and student records are never affected.
        </p>
      </div>
      <OversightConsentPanel
        initial={{
          schoolName: school.name,
          ownership: data.ownership,
          state: deriveConsentState(c),
          grantedByName: c?.grantedByName ?? null,
          grantedByRole: c?.grantedByRole ?? null,
          grantedAt: c?.grantedAt ? when(c.grantedAt) : null,
          revokedAt: c?.revokedAt ? when(c.revokedAt) : null,
          statementVersion: c?.version ?? null,
        }}
      />
    </div>
  );
}
