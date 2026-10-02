import Link from "next/link";
import { getAdminSession } from "@/lib/provisioning/admin-auth";
import { getProvisionerClient, isProvisionerConfigured } from "@/lib/provisioning/db";
import { listOfficers, listProvisioningAudit } from "@/lib/provisioning/officers";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner, Panel, Pill, Provenance } from "@/components/oversight/primitives";
import { DeactivateForm } from "./deactivate-form";

export const dynamic = "force-dynamic";

/**
 * G8.a — the officer list, and G8.e — the append-only provisioning history, on one page.
 *
 * They belong together: the list is the live state and the log is how it got there, and an
 * administrator looking at a surprising row's status wants the row above it in the log without
 * navigating. Lucy specifies them as separate surfaces; combining them is the only departure, and it
 * is a layout choice rather than a content one — every column of both tables is present.
 *
 * Both reads go through the PROVISIONER connection. There is no other way to see either table: the
 * app's own analytics role has no policy on the directory and no grant at all on the log, which is
 * what makes the officer roster unenumerable from the officer-facing runtime.
 */
export default async function AdminOfficersPage() {
  const admin = await getAdminSession();
  // The layout has already refused a non-administrator; this is the defence-in-depth repeat, because
  // a page is independently reachable if a future layout is restructured.
  if (!admin) return null;

  if (!isProvisionerConfigured()) {
    return (
      <>
        <PageHead
          crumb="Oversight administration"
          title={
            <>
              Provisioned <em className="accent-italic">officers.</em>
            </>
          }
          lede="Every Oversight officer, the jurisdiction they're bound to, and their status."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Provisioning is not configured.">
            `PROVISIONER_DATABASE_URL` is unset, so the console cannot read or write the officer
            directory. It must point at the dedicated non-owner provisioner role — never the
            app&apos;s analytics role and never the database owner (docs/PROVISIONING.md §4b).
          </Banner>
        </PageBody>
      </>
    );
  }

  const sql = getProvisionerClient();
  const [officers, audit] = await Promise.all([
    listOfficers(sql),
    listProvisioningAudit(sql, 50),
  ]);

  return (
    <>
      <PageHead
        crumb="Oversight administration"
        title={
          <>
            Provisioned <em className="accent-italic">officers.</em>
          </>
        }
        lede="Every Oversight officer, the jurisdiction they're bound to, and their status. Accounts are provisioned here — officers never self-register."
        actions={
          <Link
            href="/admin/officers/provision"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg"
          >
            Provision an officer →
          </Link>
        }
      />
      <PageBody>
        <Panel title="Officers" meta={`${officers.length} account(s)`}>
          {officers.length === 0 ? (
            <p className="text-sm text-navy-3">No officers provisioned yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-1 text-[10px] uppercase text-navy-3">
                <tr>
                  <th className="py-2 font-semibold">Officer</th>
                  <th className="py-2 font-semibold">Jurisdiction</th>
                  <th className="py-2 font-semibold">Tier</th>
                  <th className="py-2 font-semibold">Role</th>
                  <th className="py-2 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Provenance</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-1">
                {officers.map((o) => (
                  <tr key={o.officerId} className="hover:bg-gold-bg">
                    <td className="py-2">
                      <div className="font-semibold text-navy">{o.fullName ?? "—"}</div>
                      <div className="font-mono text-[10px] text-navy-3">{o.officerId}</div>
                      <div className="text-[10px] text-navy-3">{o.workEmail ?? "—"}</div>
                    </td>
                    <td className="py-2 text-xs text-navy-2">{o.jurisdictionName ?? "—"}</td>
                    <td className="py-2">
                      <Pill tone="gold">{o.tier ?? "—"}</Pill>
                    </td>
                    <td className="py-2 text-xs text-navy-2">{o.officerRole}</td>
                    <td className="py-2">
                      {o.isActive ? (
                        <Pill tone="green">Active</Pill>
                      ) : (
                        // The ONE place a withdrawn account reads terra: this is the admin's
                        // operational truth, not a message to a blameless officer (Lucy G8.a).
                        <Pill tone="terra">Deactivated</Pill>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[10px] text-navy-3">
                      {o.source} · {o.asOfDate}
                    </td>
                    <td className="py-2 text-right">
                      {o.isActive ? (
                        <DeactivateForm
                          officerId={o.officerId}
                          officerName={o.fullName ?? o.officerId}
                          jurisdictionName={o.jurisdictionName ?? ""}
                          tier={o.tier ?? ""}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Banner tone="navy" glyph="⛓" title="This provisioning log is append-only.">
          Who provisioned, approved, or withdrew which officer — and when — is recorded and cannot
          be edited or deleted. A correction is a withdrawal plus a re-provision, never an edit.
        </Banner>

        <Panel title="Provisioning history" meta={`${audit.length} most recent action(s)`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-1 text-[10px] uppercase text-navy-3">
              <tr>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Action</th>
                <th className="py-2 font-semibold">Officer</th>
                <th className="py-2 font-semibold">Tier</th>
                <th className="py-2 font-semibold">Administrator</th>
                <th className="py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-1">
              {audit.map((row) => (
                <tr key={row.provisioningId}>
                  <td className="py-2 font-mono text-[10px] text-navy-3">
                    {row.occurredAt.slice(0, 19)}
                  </td>
                  <td className="py-2">
                    <Pill
                      tone={
                        row.action === "DEACTIVATE"
                          ? "terra"
                          : row.action === "REACTIVATE" || row.action === "PROVISION"
                            ? "gold"
                            : "green"
                      }
                    >
                      {row.action}
                    </Pill>
                  </td>
                  <td className="py-2 font-mono text-[10px] text-navy-2">
                    {row.targetOfficerId}
                  </td>
                  <td className="py-2 text-xs text-navy-2">{row.targetTier}</td>
                  <td className="py-2 font-mono text-[10px] text-navy-2">
                    <div>proposer {row.actorId.slice(0, 8)}</div>
                    {row.approverId ? (
                      <div className="text-green">approver {row.approverId.slice(0, 8)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 text-xs text-navy-2">
                    {row.roleBefore ? `${row.roleBefore} → ` : ""}
                    {row.roleAfter ?? "—"} · {row.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Provenance
            items={[
              ["Written by", "the provisioning console · one row per action"],
              ["Append-only", "entries cannot be edited or deleted"],
              ["Scope", "all Oversight officer accounts, all tiers"],
            ]}
          />
        </Panel>
      </PageBody>
    </>
  );
}
