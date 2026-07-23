import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { getChronicRegister } from "@/lib/sickbay/chronic-reads";
import { splitBold } from "@/lib/sickbay/defaults";
import {
  ADMITTED_NOW,
  CONDITION_PILL,
  EMPTY_REGISTER,
  EMPTY_REGISTER_CTA,
  FILTER_LABELS,
  H1_LIST_EM,
  H1_LIST_LEAD,
  NO_GRANTS,
  OPEN_PLAN,
  PLAN_REVIEW_DAYS,
  PRIVACY_BANNER_BODY,
  PRIVACY_BANNER_MH,
  PRIVACY_BANNER_TITLE_EM,
  PRIVACY_BANNER_TITLE_LEAD,
  REFERRAL_OVERLAY,
  REGISTER_COLUMNS,
  STATUS_PILL,
  STATUS_ROW_BORDER,
  conditionLabel,
  grantCountLabel,
  lastVisitStamp,
  registerCounts,
  registerLede,
  relativeVisitAge,
  statusPill,
} from "@/lib/sickbay/chronic-copy";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";

// R117 · force-dynamic — grant expiry is evaluated server-side per request and NEVER cached.
export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/chronic-register` — §01, the register list.
 *
 * 🔴 R117 — THE GATE IS `requireSchool()` (staff-only since PR #176) + `schoolType !== 'BASIC'`, NOT
 * `requireSchoolRole(SICKBAY_ROLES)` (which would refuse a future grantee before the reader can see
 * their grant). THE READER'S GATE IS THE ONLY CLINICAL BOUNDARY: `getChronicRegister` returns the
 * VISIBLE SET (`chronic_entry_ids`), so a non-clinical, ungranted staffer (ADMIN, a HOUSEMASTER with
 * no grant) gets an EMPTY register — deny-by-default (R112), indistinguishable from "no plans exist"
 * (§4.4/M3). That empty page is the design, not a bug.
 */
export default async function ChronicRegisterPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const { id: userId } = await resolveActor(school.id);

  const now = new Date();
  const rows = await getChronicRegister(school.id, { userId, roles }, now);
  if (!rows) return <ClinicalRestricted label="Chronic register" />;

  const counts = registerCounts(rows, now);
  const lastReview = rows.reduce<Date | null>(
    (max, r) => (r.reviewedAt && (!max || r.reviewedAt > max) ? r.reviewedAt : max),
    null,
  );
  const lede = registerLede(counts.all, lastReview);

  // Only buckets with rows render (C8/M3 — a zero count discloses a row the reader cannot open).
  const filters = [
    { label: FILTER_LABELS.all, n: counts.all },
    { label: FILTER_LABELS.crisis, n: counts.crisis },
    { label: FILTER_LABELS.monitor, n: counts.monitor },
    { label: FILTER_LABELS.stable, n: counts.stable },
    { label: FILTER_LABELS.referralManaged, n: counts.referralManaged },
  ].filter((f) => f.n > 0);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ page head ═══ */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · Chronic register
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            {H1_LIST_LEAD}
            <em className="font-normal italic text-gold">{H1_LIST_EM}</em>
          </h1>
          <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
            <Bold text={lede} />
          </p>
        </div>
        {/* `+ Add student` — MATRON only (an affordance filter, never a data filter, R72). */}
        {canWrite && (
          <Link
            href="/senior/sickbay/chronic-register/new"
            className="shrink-0 rounded-[6px] border border-navy bg-navy px-[14px] py-[9px] text-[12px] font-bold text-bg no-underline"
          >
            + Add student
          </Link>
        )}
      </div>

      {/* ═══ privacy banner (§3.2 — the re-authored non-disclosure copy, load-bearing) ═══ */}
      <div className="mb-6 grid grid-cols-[auto_1fr] items-center gap-[18px] rounded-xl bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] p-[18px_22px] text-bg">
        <div className="grid size-[42px] place-items-center rounded-[10px] bg-gold font-display text-[18px] font-bold text-navy">
          ⚿
        </div>
        <div>
          <div className="mb-[3px] font-display text-[16px] font-medium">
            {PRIVACY_BANNER_TITLE_LEAD}
            <em className="font-normal italic text-gold">{PRIVACY_BANNER_TITLE_EM}</em>
          </div>
          <p className="text-[11px] leading-[1.5] text-gold-soft">
            <BoldBg text={PRIVACY_BANNER_BODY} /> {PRIVACY_BANNER_MH}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-[18px_20px] text-[12px] italic text-navy-3">
          {EMPTY_REGISTER}
          {canWrite && (
            <>
              {" "}
              <Link
                href="/senior/sickbay/chronic-register/new"
                className="font-semibold not-italic text-gold no-underline"
              >
                {EMPTY_REGISTER_CTA}
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          {/* ═══ filter strip — static count pills; a zero bucket does NOT render (C8) ═══ */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Filter
            </span>
            {filters.map((f) => (
              <span
                key={f.label}
                className="rounded-full border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy-2"
              >
                {f.label}
                <span className="ml-[5px] rounded-full bg-gold-bg px-[6px] py-px font-mono text-[10px] text-gold">
                  {f.n}
                </span>
              </span>
            ))}
          </div>

          {/* ═══ register table ═══ */}
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {REGISTER_COLUMNS.map((c, i) => (
                    <th
                      key={c}
                      className={`border-b border-border-2 bg-bg p-[11px_14px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                        i >= 5 ? "text-right" : "text-left"
                      }`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = statusPill(r.status);
                  return (
                    <tr key={`${r.studentId}-${r.condition}`} className="align-middle">
                      {/* Student */}
                      <td
                        className={`border-b border-border border-l-[3px] p-[14px] pl-[11px] text-[12px] ${STATUS_ROW_BORDER[r.status]}`}
                      >
                        <div className="flex items-center gap-[10px]">
                          <span className="grid size-[34px] place-items-center rounded-full bg-gold-soft font-display text-[12px] font-semibold text-navy">
                            {r.initials}
                          </span>
                          <div>
                            <Link
                              href={`/senior/sickbay/chronic-register/${r.studentId}`}
                              className="block text-[13px] font-semibold text-navy no-underline hover:text-gold"
                            >
                              {r.studentName}
                            </Link>
                            <div className="text-[10px] text-navy-3">
                              <Bold
                                text={`**${r.formLabel}**${r.houseName ? ` · ${r.houseName}` : ""} · ${r.studentCode}`}
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Condition */}
                      <td className="border-b border-border p-[14px] text-[12px]">
                        <span
                          className={`inline-block rounded-full px-[10px] py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${CONDITION_PILL[r.condition]}`}
                        >
                          {conditionLabel(r.condition, r.conditionLabel)}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="border-b border-border p-[14px] text-[12px]">
                        <span
                          className={`inline-block rounded-full px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.04em] ${STATUS_PILL[s.tone]}`}
                        >
                          {s.label}
                        </span>
                        {r.referralManaged && (
                          <span className="ml-1 inline-block rounded-full bg-bg px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.04em] text-navy-3">
                            {REFERRAL_OVERLAY}
                          </span>
                        )}
                      </td>
                      {/* Daily medication — EMPTY cell for a mental-health row (C4/M4) */}
                      <td className="border-b border-border p-[14px] text-[12px] font-semibold text-navy">
                        {r.medicationLine ?? ""}
                      </td>
                      {/* Last visit */}
                      <td className="border-b border-border p-[14px] text-[12px]">
                        {r.admittedNow ? (
                          <span className="font-semibold text-terra">{ADMITTED_NOW}</span>
                        ) : r.lastVisitAt ? (
                          <div className="font-mono text-[11px] text-navy-2">
                            {lastVisitStamp(r.lastVisitAt)}
                            <span className="mt-px block font-sans text-[10px] text-navy-3">
                              {relativeVisitAge(r.lastVisitAt, now)}
                            </span>
                          </div>
                        ) : null}
                      </td>
                      {/* HM grants */}
                      <td className="border-b border-border p-[14px] text-right text-[10px] font-semibold text-navy-3">
                        {r.grantCount === 0 ? (
                          <span className="italic">{NO_GRANTS}</span>
                        ) : (
                          grantCountLabel(r.grantCount)
                        )}
                      </td>
                      {/* Plan */}
                      <td className="border-b border-border p-[14px] text-right text-[12px]">
                        <Link
                          href={`/senior/sickbay/chronic-register/${r.studentId}`}
                          className={`rounded-[6px] border px-[10px] py-[5px] text-[11px] font-semibold no-underline ${
                            r.status === "ACTIVE_CRISIS"
                              ? "border-gold bg-gold text-navy"
                              : "border-border-2 bg-surface text-navy"
                          }`}
                        >
                          {OPEN_PLAN}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ═══ summary tiles — 2 derived (§3.5); NHIS + WASSCE tiles omitted ═══ */}
          <div className="mt-6 grid gap-[14px] sm:grid-cols-2">
            <Tile
              label="Active crises (today)"
              value={String(counts.crisesToday)}
              denom={` of ${counts.all}`}
              active={counts.crisesToday > 0}
            />
            <Tile
              label="Plans needing review"
              value={String(counts.needingReview)}
              denom=" overdue"
              active={false}
              note={`older than ${PLAN_REVIEW_DAYS} days or never reviewed`}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  denom,
  active,
  note,
}: {
  label: string;
  value: string;
  denom: string;
  active: boolean;
  note?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-surface p-[16px_18px] ${
        active ? "border-[1.5px] border-terra" : "border border-border"
      }`}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="mt-[3px] font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.018em] text-navy">
        {value}
        <span className="font-mono text-[14px] font-medium italic text-navy-3">{denom}</span>
      </div>
      {note && <div className="mt-1 text-[10px] italic text-navy-3">{note}</div>}
    </div>
  );
}

/** `**bold**` → `<b>` in navy-2 (body context). */
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

/** `**bold**` → `<b>` in bg (on the navy banner gradient). */
function BoldBg({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-bg">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
