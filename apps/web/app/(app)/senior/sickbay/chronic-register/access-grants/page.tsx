import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES } from "@/lib/access";
import { getAccessGrants, getGrantFormOptions } from "@/lib/sickbay/chronic-reads";
import {
  AUDIT_TAG,
  EMPTY_AUDIT,
  EMPTY_GRANTS,
  H1_GRANTS_EM,
  H1_GRANTS_LEAD,
  NO_EXPIRY,
  REVOKED_LABEL,
  REVOKED_PILL,
  SCOPE_LABEL,
  SCOPE_PILL,
  grantsLede,
} from "@/lib/sickbay/chronic-copy";
import { splitBold } from "@/lib/sickbay/defaults";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { ChronicGrantForm } from "@/components/sickbay/chronic-grant-form";
import { ChronicRevokeButton } from "@/components/sickbay/chronic-revoke-button";

// R117 · force-dynamic — grant expiry/liveness is evaluated server-side per request, never cached.
export const dynamic = "force-dynamic";

const DMY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/**
 * `/senior/sickbay/chronic-register/access-grants` — §04. CLINICAL-READER-ONLY (R134/R137): a grantee
 * NEVER reaches it (he must not learn who else knows), ADMIN keeps the module-access panel (D2). Lists
 * EVERY live grant + per-row effective scope (revoked rows stay, append-only), plus the audit trail
 * (reads ∪ writes) rendered by the pure formatter — no condition ever surfaces (R122).
 */
export default async function AccessGrantsPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) {
    if (roles.includes("ADMIN")) return <ClinicalRestricted label="Access grants" />;
    notFound(); // a grantee / other staffer must never learn who else knows (R122/E18)
  }

  const { id: userId } = await resolveActor(school.id);
  const now = new Date();
  const view = await getAccessGrants(school.id, { userId, roles }, now);
  if (!view) notFound();
  const formOptions = view.isMatron ? await getGrantFormOptions(school.id, { userId, roles }) : null;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ crumb ═══ */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <Link href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </Link>{" "}
        ·{" "}
        <Link href="/senior/sickbay/chronic-register" className="text-gold no-underline">
          Chronic register
        </Link>{" "}
        · Access grants
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        {H1_GRANTS_LEAD}
        <em className="font-normal italic text-gold">{H1_GRANTS_EM}</em>
      </h1>
      <p className="mb-6 max-w-[720px] text-[13px] text-navy-3">
        <Bold text={grantsLede(view.liveGrantCount, view.studentCount)} />
      </p>

      {/* ═══ grant issuance form — MATRON only ═══ */}
      {formOptions && (
        <div className="mb-8">
          <ChronicGrantForm
            staff={formOptions.staff}
            entries={formOptions.entries}
            houses={formOptions.houses}
          />
        </div>
      )}

      {/* ═══ grants table ═══ */}
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Grants</div>
      {view.grants.length === 0 ? (
        <p className="mb-8 rounded-xl border border-border bg-surface p-[16px_18px] text-[12px] italic text-navy-3">
          {EMPTY_GRANTS}
        </p>
      ) : (
        <div className="mb-8 overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Staff member", "Student · scope", "Access level", "Expires", "Reason", ""].map(
                  (c, i) => (
                    <th
                      key={c || i}
                      className={`border-b border-border-2 bg-bg p-[11px_14px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                        i >= 5 ? "text-right" : "text-left"
                      }`}
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {view.grants.map((g) => {
                const expired = !g.revoked && !g.live && g.expiresAt !== null;
                return (
                  <tr key={g.grantId} className="align-top">
                    <td className="border-b border-border p-[12px_14px] text-[12px]">
                      <div className="font-semibold text-navy">{g.granteeName}</div>
                      {g.granteeRoleLine && (
                        <div className="text-[10px] text-navy-3">{g.granteeRoleLine}</div>
                      )}
                    </td>
                    <td className="border-b border-border p-[12px_14px] text-[12px]">
                      <div className="font-semibold text-navy">{g.studentName}</div>
                      <div className="text-[10px] text-navy-3">{SCOPE_LABEL[g.scope]}</div>
                    </td>
                    <td className="border-b border-border p-[12px_14px] text-[12px]">
                      {g.revoked ? (
                        <span
                          className={`inline-block rounded-full border px-2 py-[3px] text-[10px] font-semibold ${REVOKED_PILL}`}
                        >
                          {REVOKED_LABEL}
                        </span>
                      ) : (
                        <span
                          className={`inline-block rounded-full border px-2 py-[3px] text-[10px] font-semibold ${SCOPE_PILL[g.scope]}`}
                        >
                          {SCOPE_LABEL[g.scope]}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-border p-[12px_14px] text-[11px]">
                      {g.expiresAt ? (
                        <span className={expired ? "text-navy-3" : "font-mono text-navy-2"}>
                          {DMY.format(g.expiresAt)}
                          {expired ? " · expired" : ""}
                        </span>
                      ) : (
                        <span className="italic text-green">{NO_EXPIRY}</span>
                      )}
                    </td>
                    <td className="border-b border-border p-[12px_14px] text-[11px] text-navy-3">
                      {g.reason ?? ""}
                    </td>
                    <td className="border-b border-border p-[12px_14px] text-right">
                      {view.isMatron && !g.revoked ? (
                        <ChronicRevokeButton
                          grantId={g.grantId}
                          granteeName={g.granteeName}
                          studentName={g.studentName}
                        />
                      ) : (
                        <span className="text-[11px] text-navy-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ audit trail ═══ */}
      <div id="audit" className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
        Audit trail · append-only
      </div>
      {view.audit.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-[16px_18px] text-[12px] italic text-navy-3">
          {EMPTY_AUDIT}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {view.audit.map((a, i) => {
            const tag = AUDIT_TAG[a.kind];
            return (
              <div
                key={i}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-[18px] border-b border-border p-[12px_18px] last:border-b-0"
              >
                <div className="font-mono text-[11px] font-semibold text-navy-2">
                  {hhmm(a.at)}
                  <span className="mt-px block font-sans text-[9px] font-medium text-navy-3">
                    {DAY.format(a.at).replace(",", "")}
                  </span>
                </div>
                <div className="text-[12px] text-navy-2">
                  <Bold text={a.sentence} />
                </div>
                <span
                  className={`rounded-full border px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.12em] ${tag.cls}`}
                >
                  {tag.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** `**bold**` → `<b>` (navy). */
function Bold({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-navy">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
