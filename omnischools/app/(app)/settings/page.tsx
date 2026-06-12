import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  schools,
  gradebookConfig,
  academicPeriodConfig,
  academicPeriod,
  smsTemplates,
} from "@/db/schema";
import { ProfileForm } from "@/components/settings/profile-form";
import { WeightsForm } from "@/components/settings/weights-form";

export const dynamic = "force-dynamic";

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

function Section({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-navy">{heading}</h2>
      {description && <p className="mb-4 mt-0.5 text-sm text-navy-3">{description}</p>}
      <div className={description ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [row] = await tx.select().from(schools).where(eq(schools.id, school.id));
    const [cfg] = await tx
      .select()
      .from(gradebookConfig)
      .where(eq(gradebookConfig.schoolId, school.id));
    const [periodCfg] = await tx
      .select()
      .from(academicPeriodConfig)
      .where(eq(academicPeriodConfig.schoolId, school.id));
    const periods = await tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id))
      .orderBy(asc(academicPeriod.periodNumber));
    const templates = await tx
      .select({ id: smsTemplates.id })
      .from(smsTemplates)
      .where(eq(smsTemplates.schoolId, school.id));
    return { row, cfg, periodCfg, periods, templateCount: templates.length };
  });

  const cw = data.cfg?.classWeight ?? 50;

  return (
    <div className="mx-auto max-w-prose">
      <div className="mb-5">
        <h1 className="font-display text-3xl font-semibold text-navy">Settings</h1>
        <p className="text-sm text-navy-3">
          Configure your school profile, calendar, grading and messaging.
        </p>
      </div>

      <div className="space-y-5">
        {/* School profile */}
        <Section heading="School profile">
          <ProfileForm
            initialName={data.row?.name ?? school.name}
            initialShortName={data.row?.shortName ?? ""}
          />
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-navy-3">GES code</dt>
              <dd className="font-mono font-medium text-navy">{data.row?.gesCode}</dd>
            </div>
            <div>
              <dt className="text-navy-3">Type</dt>
              <dd className="font-medium text-navy">{title(school.schoolType)}</dd>
            </div>
            <div>
              <dt className="text-navy-3">Ownership</dt>
              <dd className="font-medium text-navy">
                {data.row?.ownership ? title(data.row.ownership) : "—"}
              </dd>
            </div>
          </dl>
        </Section>

        {/* Academic calendar */}
        <Section
          heading="Academic calendar"
          description={
            data.periodCfg
              ? `${data.periodCfg.academicYear} · ${data.periodCfg.periodCount} ${title(
                  data.periodCfg.periodType,
                )}s (${title(data.periodCfg.source)})`
              : "No calendar configured yet."
          }
        >
          {data.periods.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {data.periods.map((p) => (
                <li
                  key={p.periodId}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-navy">{p.periodLabel}</span>
                  <span className="font-mono text-navy-3">
                    {p.startsOn} → {p.endsOn}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-navy-3">
              Periods are seeded from GES defaults during onboarding.
            </p>
          )}
        </Section>

        {/* Grading */}
        <Section
          heading="Grading"
          description="Set how class (continuous assessment) and exam scores combine into the term total."
        >
          <WeightsForm initialClassWeight={cw} />
        </Section>

        {/* Messaging */}
        <Section heading="Messaging">
          <p className="text-sm text-navy-2">
            {data.templateCount > 0
              ? `${data.templateCount} SMS template${data.templateCount === 1 ? "" : "s"} saved.`
              : "No SMS templates yet."}{" "}
            Messages sign off as{" "}
            <span className="font-mono font-medium text-navy">
              {data.row?.shortName || "your school name"}
            </span>
            .
          </p>
          <Link
            href="/communication"
            className="mt-4 inline-flex rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
          >
            Manage templates &amp; announcements →
          </Link>
        </Section>
      </div>
    </div>
  );
}
