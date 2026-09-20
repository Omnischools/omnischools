import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadMockConfig } from "@/lib/wassce/mock-data";
import { WassceMockConfigForm } from "@/components/senior/wassce-mock-config-form";

export const dynamic = "force-dynamic";

/**
 * WASSCE setup §2 — mock-cycle config (SHS module 4.3 / INCR-16 · `schoolup-wassce-setup` §2). ADMIN
 * write surface, role-gated to WASSCE_SETUP_ROLES (subject teachers denied — AC2). Lists every cohort's
 * mocks (F3-2026 completed history + F2-2027's scheduled Mock 1) and drives the schedule/edit writes.
 * A mock with `marking_complete_at` set is LOCKED (read-only history); the config form only edits an
 * unlocked mock, and the server re-checks (AC3). No projection is computed here.
 */
export default async function WassceMocksPage() {
  const { school } = await requireSchoolRole(WASSCE_SETUP_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const data = await withSchool(school.id, (tx) => loadMockConfig(tx, school.id));

  const editableMocks = data.timeline
    .filter((m) => !m.locked)
    .map((m) => ({
      id: m.id,
      label: `${m.cohortLabel} — ${m.name}`,
      name: m.name,
      mockNumber: m.mockNumber,
      isPredictor: m.isPredictor,
      scheduledStart: m.scheduledStart,
      scheduledEnd: m.scheduledEnd,
    }));

  return (
    <div className="mx-auto max-w-page space-y-6">
      <div className="border-b border-border pb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
          WASSCE · Setup · Mock cycle
        </div>
        <h1 className="mt-2 font-display text-3xl font-medium text-navy">
          Mock exam <em className="italic text-gold">cycle.</em>
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] text-navy-3">
          Two predictive mocks across the year. <b className="text-navy-2">Mock 1 in November</b> sets a
          baseline; <b className="text-navy-2">Mock 2 in March</b> drives the readiness statement — its
          grade is the projected WASSCE grade. Mocks are marked by F3 subject teachers on WAEC mark
          schemes. Scheduling and edits here apply to a cohort whose marking is still open.
        </p>
      </div>

      {/* Mock timeline — read-only history + scheduled rows (mock_exams) */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12px]">
          <thead className="border-b border-border bg-bg text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            <tr>
              <th className="px-4 py-3 text-left">Cohort</th>
              <th className="px-4 py-3 text-left">Mock</th>
              <th className="px-4 py-3 text-left">Window</th>
              <th className="px-4 py-3 text-center">Predictor</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.timeline.map((m) => (
              <tr key={m.id} className="border-b border-border">
                <td className="px-4 py-3 font-mono font-semibold text-navy">{m.cohortLabel}</td>
                <td className="px-4 py-3">
                  <span className="font-display font-semibold text-navy">{m.name}</span>
                  <span className="ml-1.5 text-navy-3">#{m.mockNumber}</span>
                </td>
                <td className="px-4 py-3 font-mono text-navy-2">
                  {m.scheduledStart ?? "—"}
                  {m.scheduledEnd ? ` → ${m.scheduledEnd}` : ""}
                </td>
                <td className="px-4 py-3 text-center">
                  {m.isPredictor ? (
                    <span className="rounded-full bg-gold-bg px-2 py-0.5 text-[10px] font-bold uppercase text-gold">
                      Predictor
                    </span>
                  ) : (
                    <span className="text-navy-3">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {m.locked ? (
                    <span className="rounded-full bg-green-bg px-2 py-0.5 text-[10px] font-bold uppercase text-green">
                      Complete · locked
                    </span>
                  ) : (
                    <span className="rounded-full border border-border-2 bg-bg px-2 py-0.5 text-[10px] font-bold uppercase text-navy-3">
                      Scheduled · open
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {data.timeline.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[12px] italic text-navy-3">
                  No mocks scheduled yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <WassceMockConfigForm
        cohorts={data.cohorts.map((c) => ({ id: c.id, label: c.label }))}
        editableMocks={editableMocks}
      />
    </div>
  );
}
