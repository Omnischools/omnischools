import Link from "next/link";
import { and, count, eq, notInArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  schools,
  roles,
  roleAssignments,
  academicPeriodConfig,
  gradeScale,
} from "@/db/schema";
import { NON_STAFF_ROLE_CODES } from "@/lib/staff-roles";
import { SETTINGS_GROUPS, type SettingsTone } from "@/lib/settings-nav";

export const dynamic = "force-dynamic";

const TONE_TILE: Record<SettingsTone, string> = {
  navy: "bg-navy text-bg",
  gold: "bg-gold-bg text-gold",
  green: "bg-green-bg text-green",
  terra: "bg-terra-bg text-terra",
  blue: "bg-[#EEF1F9] text-[#3858A8]",
};

export default async function SettingsPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [row] = await tx.select().from(schools).where(eq(schools.id, school.id));
    const [staff] = await tx
      .select({ n: count() })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, school.id),
          notInArray(roles.code, NON_STAFF_ROLE_CODES),
        ),
      );
    const [periodCfg] = await tx
      .select()
      .from(academicPeriodConfig)
      .where(eq(academicPeriodConfig.schoolId, school.id));
    const [grades] = await tx
      .select({ n: count() })
      .from(gradeScale)
      .where(eq(gradeScale.schoolId, school.id));
    return {
      row,
      staffCount: Number(staff?.n ?? 0),
      periodCfg,
      gradeCount: Number(grades?.n ?? 0),
    };
  });

  const infoComplete = !!(data.row?.gesCode && data.row?.address && data.row?.regionId);

  const health = [
    {
      ok: infoComplete,
      label: infoComplete ? "School info" : "School info",
      meta: infoComplete ? "Complete" : "Add address to finish",
    },
    {
      ok: !!data.periodCfg,
      label: data.periodCfg ? `${data.periodCfg.academicYear}` : "No calendar",
      meta: data.periodCfg
        ? `${data.periodCfg.periodCount} ${data.periodCfg.periodType.toLowerCase()}s`
        : "Set up the calendar",
    },
    {
      ok: data.gradeCount > 0,
      label: data.gradeCount > 0 ? `${data.gradeCount} grades` : "No grade scale",
      meta: data.gradeCount > 0 ? "Grade scale set" : "Add a grade scale",
    },
    {
      ok: data.staffCount > 0,
      label: `${data.staffCount} staff`,
      meta: data.staffCount > 0 ? "Can sign in" : "Add your staff",
    },
  ];

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Settings
      </div>
      <h1 className="font-display text-3xl font-semibold text-navy">
        School <em className="not-italic text-gold [font-style:italic]">settings.</em>
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm text-navy-3">
        Everything you can configure about how Omnischools works for{" "}
        <b className="text-navy">{data.row?.name ?? school.name}</b>. Some sections need
        attention; most are set and forgotten.
      </p>

      {/* Health strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {health.map((h, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              h.ok ? "border-green/30 bg-green-bg/40" : "border-warn/30 bg-warn-bg/40"
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-bold ${
                h.ok ? "bg-green text-surface" : "bg-warn text-surface"
              }`}
            >
              {h.ok ? "✓" : "!"}
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold text-navy">{h.label}</div>
              <div className="truncate text-[11px] text-navy-3">{h.meta}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Groups */}
      <div className="mt-9 space-y-9">
        {SETTINGS_GROUPS.map((g) => (
          <section key={g.num}>
            <div className="mb-4 flex items-baseline gap-3">
              <span className="font-display text-2xl font-medium italic text-gold">
                {g.num}
              </span>
              <h2 className="font-display text-xl font-medium text-navy">
                {g.title} <em className="not-italic text-gold [font-style:italic]">{g.em}</em>
              </h2>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
                {g.meta}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.cards.map((c) => {
                const inner = (
                  <>
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm font-semibold ${TONE_TILE[c.tone]}`}
                      >
                        {c.icon}
                      </div>
                      <div className="font-display text-[15px] font-medium text-navy">
                        {c.name}{" "}
                        <em className="not-italic text-gold [font-style:italic]">{c.em}</em>
                      </div>
                    </div>
                    <p className="mt-2.5 text-[12px] leading-relaxed text-navy-3">{c.desc}</p>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px]">
                      {c.soon ? (
                        <span className="rounded-full bg-bg px-2 py-0.5 font-semibold uppercase tracking-[0.1em] text-navy-3">
                          Soon
                        </span>
                      ) : c.external ? (
                        <span className="font-semibold text-navy-3">Opens {c.href}</span>
                      ) : (
                        <span className="font-semibold text-green">Ready</span>
                      )}
                      <span className="font-semibold text-gold">
                        {c.soon ? "" : c.external ? "Open →" : "Configure →"}
                      </span>
                    </div>
                  </>
                );

                const base =
                  "block rounded-xl border bg-surface p-5 transition-colors";
                if (c.soon) {
                  return (
                    <div
                      key={c.key}
                      className={`${base} border-dashed border-border-2 opacity-70`}
                    >
                      {inner}
                    </div>
                  );
                }
                return (
                  <Link
                    key={c.key}
                    href={c.href}
                    className={`${base} border-border hover:border-gold hover:shadow-sm`}
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
