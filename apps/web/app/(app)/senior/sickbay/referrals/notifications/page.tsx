import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { getTodayNotifications, type TimelineRow } from "@/lib/sickbay/notify-reads";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { ScheduledSendButton } from "@/components/sickbay/scheduled-send-button";

// On-read derivations (`in 1h 30m` / `9h ago`) are computed server-side at request time — no ticking
// client clock, no cron. A scheduled row renders DUE the instant scheduled_for <= now.
export const dynamic = "force-dynamic";

const TIER_ICON: Record<number, string> = {
  1: "bg-gold-bg text-gold",
  2: "bg-warn-bg text-warn border-[1.5px] border-warn",
  3: "bg-terra-bg text-terra border-[1.5px] border-terra",
};
const TIER_PILL: Record<number, string> = {
  1: "text-gold bg-gold-bg",
  2: "text-warn bg-warn-bg",
  3: "text-terra bg-terra-bg",
};

/**
 * `/senior/sickbay/referrals/notifications` — §03, today's parent-notifications timeline (INCR-26).
 * Every row's recipient = PARENT. Clinical-read gated ([HEADMASTER, MATRON]); ADMIN gets no fetch.
 *
 * 🔴 Console-only (D7/§3): the fabricated 85% delivery-rate tile, the "undelivered from MTN / auto-
 * retry" panel and the "Failed 1" pill are OMITTED (no provider telemetry exists). The stats strip is
 * 3-up. A DUE scheduled row shows "Due HH:MM" + a manual Send-now (nothing auto-fires).
 */
export default async function NotificationsTimelinePage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return <ClinicalRestricted label="Notifications" />;

  const now = new Date();
  const { rows, stats } = await getTodayNotifications(school.id, now);
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const fired = stats.tier1 + stats.tier2 + stats.tier3;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        ·{" "}
        <Link href="/senior/sickbay/referrals" className="text-gold no-underline">
          Referrals
        </Link>{" "}
        · Notifications · Today
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        Today&apos;s <em className="font-normal italic text-gold">notifications.</em>
      </h1>
      <p className="mb-5 max-w-2xl text-[13px] leading-[1.55] text-navy-2">
        The three-tier rule fired <b className="font-semibold text-navy">{fired}</b> {fired === 1 ? "time" : "times"}{" "}
        today. Every event keyed off the setup-page policy anchor.
        {stats.due > 0 && (
          <>
            {" "}
            <b className="font-semibold text-navy">{stats.due}</b> {stats.due === 1 ? "notification is" : "notifications are"}{" "}
            scheduled — the matron sends at the window.
          </>
        )}
      </p>

      {/* Stats — 3-up, colours mapped to the tiers (the delivery-rate tile is OMITTED, console-only). */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Tier 1 today" value={stats.tier1} unit="SMS" valClass="text-gold" trend="Light notify" />
        <Stat label="Tier 2 today" value={stats.tier2} unit="call + SMS" valClass="text-warn" trend="Admission notify" />
        <Stat label="Tier 3 today" value={stats.tier3} unit="phone-first" valClass="text-terra" trend="Referral / consult" />
      </div>

      {/* Derived filter counts (a legend, not a live filter — see the case thread for compose). */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Today</span>
        <FilterCount label="All" n={rows.length} active />
        <FilterCount label="Tier 1" n={stats.tier1} />
        <FilterCount label="Tier 2" n={stats.tier2} />
        <FilterCount label="Tier 3" n={stats.tier3} />
        <FilterCount label="Due / queued" n={stats.due} />
      </div>

      <div className="overflow-hidden rounded-[12px] border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-[12px] italic text-navy-3">No notifications today.</p>
        ) : (
          rows.map((r) => <TimelineRowView key={r.id} r={r} canWrite={canWrite} />)
        )}
      </div>
    </div>
  );
}

function TimelineRowView({ r, canWrite }: { r: TimelineRow; canWrite: boolean }) {
  const isDue = r.scheduled === "DUE" || r.scheduled === "PENDING";
  return (
    <div
      className={`grid grid-cols-[80px_36px_1fr_auto] items-center gap-[14px] border-b border-border px-[20px] py-[14px] last:border-b-0 ${
        isDue ? "bg-[linear-gradient(90deg,var(--bg)_0%,var(--surface)_100%)] opacity-70" : ""
      }`}
    >
      <div className="font-mono text-[11px] font-semibold text-navy-2">
        {r.timeHHMM}
        <span className={`mt-px block text-[9px] font-medium ${isDue ? "italic text-gold" : "text-navy-3"}`}>{r.ago}</span>
      </div>
      <span className={`grid size-9 place-items-center rounded-full font-display text-[13px] font-semibold ${TIER_ICON[r.tier]}`}>
        {r.tier}
      </span>
      <div className="text-[12px] text-navy-2">
        <div>
          <b className="font-semibold text-navy">{r.studentShort}</b> · {r.formLabel}
          {r.houseName ? ` ${r.houseName}` : ""}
          {r.triggerLabel ? (
            <>
              {" · "}
              <em className="font-semibold not-italic text-gold">{r.triggerLabel}</em>
            </>
          ) : null}
        </div>
        <div className="mt-[3px] text-[10px] font-medium text-navy-3">
          <span className="mr-1 rounded-full border border-border bg-bg px-[6px] py-px text-[9px] font-bold uppercase tracking-[0.08em]">
            {r.channel === "CALL" ? "Phone" : r.channel === "SMS" ? "SMS" : r.channel}
          </span>
          {r.durationLabel ?? (r.direction === "INBOUND" ? "parent-initiated" : "")}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {isDue ? (
          <>
            <span className="rounded-full bg-gold-bg px-2 py-[3px] text-[8px] font-bold uppercase tracking-[0.12em] text-gold">
              Due {r.dueHHMM}
            </span>
            {canWrite && <ScheduledSendButton notificationId={r.id} />}
          </>
        ) : (
          <span className={`rounded-full px-2 py-[3px] text-[8px] font-bold uppercase tracking-[0.12em] ${TIER_PILL[r.tier]}`}>
            Tier {r.tier}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, valClass, trend }: { label: string; value: number; unit: string; valClass: string; trend: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface p-[14px_16px]">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className="mt-1">
        <span className={`font-display text-[26px] font-semibold ${valClass}`}>{value}</span>{" "}
        <span className="text-[11px] font-medium text-navy-3">{unit}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-navy-3">{trend}</div>
    </div>
  );
}

function FilterCount({ label, n, active }: { label: string; n: number; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-[6px] text-[11px] font-semibold ${
        active ? "border-navy bg-navy text-bg" : "border-border-2 bg-surface text-navy-2"
      }`}
    >
      {label}
      <span
        className={`ml-[5px] rounded-full px-[6px] py-px font-mono text-[10px] ${
          active ? "bg-[rgba(200,151,91,0.2)] text-gold-soft" : "bg-[rgba(200,151,91,0.18)] text-gold"
        }`}
      >
        {n}
      </span>
    </span>
  );
}
