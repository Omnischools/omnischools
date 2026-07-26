import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_RECON_READ_ROLES,
  SICKBAY_ROLES,
} from "@/lib/access";
import { getReferralHistory, type HistoryRow } from "@/lib/sickbay/referral-reads";
import {
  HISTORY_RANGES,
  HISTORY_RANGE_LABEL,
  parseHistoryRange,
  type NhisTriState,
} from "@/lib/sickbay/referrals";
import { SURVEILLANCE_CATEGORY_VALUES, type SurveillanceCategory } from "@/lib/sickbay/surveillance";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { ReferralNav } from "@/components/sickbay/referral-nav";

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/**
 * `/senior/sickbay/referrals/history` — referral-log §04, the 30-day history (SHS module 4.4 /
 * INCR-27). Reads the shipped 0062 tables (no migration). CLINICAL-read gated (HEADMASTER + MATRON,
 * NOT ADMIN — R223/D2): every row pairs a name with the visit's LIVE `working_impression` (the
 * "Diagnosis" column, R190). The mix bars are COUNTS-ONLY (no student named — A11). Range + category
 * are URL state, so the page stays server-rendered and no client imports the reader.
 *
 * Exports (CSV / PDF / Term report) are OMITTED — an export carries names + impressions out of the
 * room (A10). Day-one EMPTY states render honestly (no fabricated 12/7/58%).
 */
export default async function ReferralHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; cat?: string }>;
}) {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return <ClinicalRestricted label="Referrals" />;

  const sp = await searchParams;
  const range = parseHistoryRange(sp.range);
  const category = (SURVEILLANCE_CATEGORY_VALUES as readonly string[]).includes(sp.cat ?? "")
    ? (sp.cat as SurveillanceCategory)
    : null;

  const now = new Date();
  const h = await getReferralHistory(school.id, now, { range, category });

  const maxCat = Math.max(1, ...h.categoryMix.map((b) => b.count));
  const maxHosp = Math.max(1, ...h.hospitalMix.map((b) => b.count));
  const catQuery = (c: SurveillanceCategory | null) =>
    `?range=${range}${c ? `&cat=${c}` : ""}`;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <Link href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </Link>{" "}
        ·{" "}
        <Link href="/senior/sickbay/referrals" className="text-gold no-underline">
          Referrals
        </Link>{" "}
        · History · 30 days
      </div>
      <div className="mb-4">
        <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
          30-day <em className="font-normal italic text-gold">history.</em>
        </h1>
        <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
          {h.rangeCounts[range] === 0 ? (
            "No referrals in the last 30 days."
          ) : (
            <>
              <b className="font-semibold text-navy-2">
                {h.total} referral{h.total === 1 ? "" : "s"}
              </b>{" "}
              in {HISTORY_RANGE_LABEL[range].toLowerCase()} · {h.closed} closed · {h.open} still active.
              {h.topCategory ? ` ${h.topCategory.label} leads at ${h.topCategory.count} of ${h.total}.` : ""}
            </>
          )}
        </p>
      </div>

      <ReferralNav
        active="history"
        showHistory
        showReconciliation={hasAnyRole(roles, SICKBAY_RECON_READ_ROLES)}
      />

      {/* ═══ filter strip — range + category facets, URL state ═══ */}
      <div className="mb-5 space-y-3">
        <FilterGroup label="Range">
          {HISTORY_RANGES.map((rg) => (
            <Pill
              key={rg}
              href={`?range=${rg}${category ? `&cat=${category}` : ""}`}
              label={HISTORY_RANGE_LABEL[rg]}
              count={h.rangeCounts[rg]}
              active={rg === range}
            />
          ))}
        </FilterGroup>
        {h.categoryFacets.length > 0 && (
          <FilterGroup label="Filter">
            <Pill href={catQuery(null)} label="All" count={h.total} active={category === null} />
            {h.categoryFacets.map((f) => (
              <Pill
                key={f.key}
                href={catQuery(f.key)}
                label={f.label}
                count={f.count}
                active={category === f.key}
              />
            ))}
          </FilterGroup>
        )}
      </div>

      {/* ═══ the 30-day table ═══ */}
      {h.rows.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] italic text-navy-3">
          {h.rangeCounts[range] === 0
            ? "No referrals in the last 30 days."
            : "No referrals match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Date", "Student", "Diagnosis", "Hospital", "NHIS", "Status", "Out-of-pocket"].map(
                  (th, i) => (
                    <th
                      key={th}
                      className={`border-b border-border-2 bg-bg p-[10px_14px] text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3 ${
                        i === 4 ? "text-center" : i === 6 ? "text-right" : "text-left"
                      }`}
                    >
                      {th}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {h.rows.map((r) => (
                <HistoryTableRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ two analysis cards — the mix bars (counts-only, safe aggregate) ═══ */}
      {h.rows.length > 0 && (
        <div className="mt-6 grid gap-[14px] lg:grid-cols-2">
          <MixCard title="Diagnosis mix" tail={HISTORY_RANGE_LABEL[range].toLowerCase()}>
            {h.categoryMix.map((b) => (
              <MixBar key={b.key} label={b.label} count={b.count} pct={(b.count / maxCat) * 100} tone="bg-terra" />
            ))}
          </MixCard>
          <MixCard title="Hospital mix" tail={HISTORY_RANGE_LABEL[range].toLowerCase()}>
            {h.hospitalMix.map((b) => (
              <MixBar key={b.key} label={b.label} count={b.count} pct={(b.count / maxHosp) * 100} tone="bg-gold" />
            ))}
          </MixCard>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</span>
      {children}
    </div>
  );
}

function Pill({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-[6px] rounded-full border px-[12px] py-[5px] text-[11px] font-semibold no-underline ${
        active ? "border-navy bg-navy text-bg" : "border-border-2 bg-surface text-navy-2"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-[6px] py-px font-mono text-[10px] ${
          active ? "bg-[rgba(200,151,91,0.2)] text-gold-soft" : "bg-[rgba(200,151,91,0.18)] text-gold"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

const NHIS_PILL: Record<NhisTriState, string> = {
  YES: "bg-green-bg text-green",
  PARTIAL: "bg-warn-bg text-warn",
  EXPIRED: "bg-terra-bg text-terra",
};

function HistoryTableRow({ r }: { r: HistoryRow }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="p-[11px_14px] font-mono text-[11px] font-semibold text-navy-2">
        {r.departedAt ? DATE.format(r.departedAt) : "—"}
        {r.departedAt && (
          <span className="mt-px block font-sans text-[9px] font-medium text-navy-3">
            {hhmm(r.departedAt)}
          </span>
        )}
      </td>
      <td className="p-[11px_14px]">
        <div className="font-display text-[12px] font-semibold text-navy">{r.studentName}</div>
        <div className="text-[10px] text-navy-3">
          {r.formLabel}
          {r.houseName ? ` · ${r.houseName}` : ""}
        </div>
      </td>
      {/* 🔴 the "Diagnosis" column = the visit's LIVE working_impression (R190), never re-stored. */}
      <td className="p-[11px_14px] text-[12px] font-semibold text-navy-2">
        {r.workingImpression ?? "—"}
      </td>
      <td className="p-[11px_14px]">
        <div className="text-[12px] font-semibold text-navy-2">{r.hospitalName}</div>
        {(r.hospitalDistanceKm !== null || r.hospitalIsPrimary) && (
          <div className="font-mono text-[10px] text-navy-3">
            {r.hospitalDistanceKm !== null ? `${r.hospitalDistanceKm} km` : ""}
            {r.hospitalDistanceKm !== null && r.hospitalIsPrimary ? " · " : ""}
            {r.hospitalIsPrimary ? "primary" : ""}
          </div>
        )}
      </td>
      <td className="p-[11px_14px] text-center">
        <span
          className={`inline-block rounded-full px-[8px] py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] ${NHIS_PILL[r.nhis]}`}
        >
          {r.nhisLabel}
        </span>
      </td>
      <td className="p-[11px_14px] text-[11px] text-navy-2">{r.dayLabel}</td>
      <td className="p-[11px_14px] text-right font-mono text-[12px] font-semibold text-navy">
        GHS {r.outOfPocket.toFixed(2)}
      </td>
    </tr>
  );
}

function MixCard({
  title,
  tail,
  children,
}: {
  title: string;
  tail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="border-b border-border p-[14px_20px_12px] font-display text-[15px] font-semibold text-navy">
        {title} <em className="font-normal italic text-gold">· {tail}</em>
      </div>
      <div className="space-y-[10px] p-[16px_20px_20px]">{children}</div>
    </div>
  );
}

function MixBar({
  label,
  count,
  pct,
  tone,
}: {
  label: string;
  count: number;
  pct: number;
  tone: string;
}) {
  return (
    <div>
      <div className="mb-[4px] flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-navy-2">{label}</span>
        <span className="font-mono text-[11px] text-navy-3">{count}</span>
      </div>
      <div className="h-[8px] overflow-hidden rounded-full bg-bg">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}
