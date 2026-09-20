import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { getOutbreakMonitor, type OutbreakCategoryRow } from "@/lib/sickbay/surveillance-reads";
import { splitBold } from "@/lib/sickbay/defaults";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { OutbreakActions } from "@/components/sickbay/outbreak-actions";

// B15 — every window/threshold derivation is server-computed at request time and rendered as a static
// string; no ticking client clock on a clinical page (the frozen "as of" stamp, no pulse dot).
export const dynamic = "force-dynamic";

const asOf = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} GMT`;

/**
 * `/senior/sickbay/today/outbreak` — today §05, the 7-day outbreak monitor (SHS module 4.4 / INCR-27).
 *
 * 🔴 COUNTS-ONLY. The single most important PII fact of the whole increment: this page NAMES NO
 * STUDENT — only category + count + trend + status (A9). The reader carries no student column, so
 * there is nothing to leak; "view the N cases" is refused at the shape, not hidden in CSS.
 *
 * 🔴 TWO gates (owner D2 · R223): MODULE access is SICKBAY_ROLES (ADMIN reaches the route); the
 * CLINICAL read is SICKBAY_CLINICAL_READ_ROLES [HEADMASTER, MATRON] — the monitor aggregates the
 * school's disease surveillance, so it stays clinical, NOT ADMIN. The gate is the FIRST statement and
 * issues zero SQL for a refused reader.
 */
export default async function OutbreakMonitorPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return <ClinicalRestricted label="Today" />;

  const now = new Date();
  const monitor = await getOutbreakMonitor(school.id, now);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ page head ═══ */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        ·{" "}
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Today
        </a>{" "}
        · Outbreak monitor
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            Outbreak <em className="font-normal italic text-gold">monitor</em> · 7-day window
          </h1>
          <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
            <Bold text={monitor.lede} />
          </p>
        </div>
        <OutbreakActions />
      </div>

      {/* ═══ head row ═══ */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-t-[14px] border border-b-0 border-border bg-[linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] p-[16px_22px]">
        <div>
          <h3 className="font-display text-[16px] font-semibold tracking-[-0.005em] text-navy">
            {monitor.conditionCount} <em className="font-normal italic text-gold">conditions</em> tracked ·
            district-aligned categories
          </h3>
          <p className="mt-[3px] max-w-[640px] text-[12px] text-navy-3">
            Categories align with Ghana Health Service district surveillance · matron escalates to{" "}
            <b className="font-semibold text-navy-2">Wassa Amenfi GHS</b> on amber cluster (8+ cases or
            50% rise week-over-week).
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-border bg-bg px-[10px] py-[5px] font-mono text-[12px] font-semibold text-navy">
          as of {asOf(monitor.asOf)}
        </div>
      </div>

      {/* ═══ the syndromic rows — the full set always renders, zeros included ═══ */}
      <div className="overflow-hidden rounded-b-[14px] border border-border bg-surface">
        {monitor.categories.map((c, i) => (
          <OutbreakRow key={c.key} c={c} last={i === monitor.categories.length - 1} />
        ))}
      </div>

      {/* Honest footnote: the district artefact is print/console only; there is no integration. */}
      <p className="mt-4 text-[11px] italic text-navy-3">
        “Notify GHS-Amenfi” prints this aggregate report — counts, window and status, naming no student.
        No SMS or district integration is dispatched. Thresholds (4 / 8 / 50%) are fixed this release.
      </p>
    </div>
  );
}

const STATUS_PILL: Record<OutbreakCategoryRow["status"], { cls: string; label: string }> = {
  NORMAL: { cls: "bg-green-bg text-green", label: "Normal" },
  MONITOR: { cls: "bg-warn-bg text-warn", label: "Monitor" },
  AMBER: { cls: "bg-terra-bg text-terra", label: "Amber" },
};

const TREND_TONE = {
  up: "text-warn",
  down: "text-green",
  flat: "text-navy-3",
} as const;

function OutbreakRow({ c, last }: { c: OutbreakCategoryRow; last: boolean }) {
  const pill = STATUS_PILL[c.status];
  return (
    <div
      className={`grid grid-cols-[1fr_90px_110px_110px] items-center gap-[14px] p-[12px_22px] ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div>
        <div className="font-display text-[13px] font-semibold tracking-[-0.005em] text-navy">
          {c.label}
        </div>
        <div className="mt-px text-[10px] italic text-navy-3">{c.sub}</div>
      </div>
      <div className="text-right font-mono text-[18px] font-semibold text-navy">
        {c.count}
        <span className="mt-[2px] block font-sans text-[9px] font-medium uppercase not-italic tracking-[0.08em] text-gold">
          past 7 days
        </span>
      </div>
      {/* 🔴 blank (not "↔ steady") until a prior window exists — never a fabricated arrow. */}
      <div className={`text-[11px] font-semibold ${c.trend ? TREND_TONE[c.trend.direction] : "text-navy-3"}`}>
        {c.trend?.label ?? ""}
      </div>
      <div className="text-right">
        <span
          className={`inline-block rounded-full px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] ${pill.cls}`}
        >
          {pill.label}
        </span>
      </div>
    </div>
  );
}

/** `**bold**` → `<b>` via the shipped splitter. No copy authored inside a component. */
function Bold({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-navy-2">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
