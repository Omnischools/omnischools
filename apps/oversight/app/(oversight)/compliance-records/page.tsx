import Link from "next/link";
import { getOfficerSession } from "@/lib/auth";
import { listOwnAccesses } from "@/lib/oversight/audit-log";
import { PageBody, PageHead } from "@/components/oversight/shell";
import {
  Banner,
  BasisPill,
  OutcomePill,
  Panel,
  Pill,
  Provenance,
} from "@/components/oversight/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your access history" };

/**
 * Lucy §A1.3 — the officer's own access history, extended with C6's two accountability columns
 * (legal basis, and GRANTED vs DENIED). A denial is a first-class row here, not a gap.
 */
export default async function ComplianceRecordsPage() {
  const officer = await getOfficerSession();
  if (!officer) {
    return (
      <>
        <PageHead
          crumb="Compliance records"
          title={
            <>
              Your access <em className="accent-italic">history.</em>
            </>
          }
          lede="Every named-record access you have made — the same entries GES audit reviews."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            Your access history is keyed to your officer identity.
          </Banner>
        </PageBody>
      </>
    );
  }

  const entries = await listOwnAccesses({
    jurisdictionId: officer.jurisdictionId,
    level: officer.level,
    officerId: officer.officerId,
  });

  return (
    <>
      <PageHead
        crumb="Compliance records"
        title={
          <>
            Your access <em className="accent-italic">history.</em>
          </>
        }
        lede="Every named-record access you have made — the same entries GES audit reviews."
        actions={
          <Link
            href="/compliance-records/new"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg"
          >
            New record access →
          </Link>
        }
      />
      <PageBody>
        <Banner tone="navy" glyph="⛓" title="This log is append-only.">
          Entries cannot be edited or deleted — by anyone, including national
          administrators. A reviewer may add a query or a note to an entry, but the
          original access record is immutable. An audit log that could be altered would
          not be an audit log.
        </Banner>

        <Panel title="Named-record accesses by you" meta="Most recent first">
          {entries.length === 0 ? (
            <p className="text-sm text-navy-3">No named-record accesses yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-1 text-[10px] uppercase text-navy-3">
                <tr>
                  <th className="py-2 font-semibold">Entry</th>
                  <th className="py-2 font-semibold">Reason</th>
                  <th className="py-2 font-semibold">Record accessed</th>
                  <th className="py-2 font-semibold">Basis</th>
                  <th className="py-2 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-1">
                {entries.map((e) => (
                  <tr key={e.accessId} className="hover:bg-gold-bg">
                    <td className="py-2 font-mono text-[11px]">
                      <Link
                        href={`/compliance-records/${e.accessId}`}
                        className="text-gold"
                      >
                        {e.accessId.slice(0, 8)}
                      </Link>
                      <div className="text-navy-3">{e.occurredAt.slice(0, 16)}</div>
                    </td>
                    <td className="py-2 text-xs">{e.reasonCode}</td>
                    <td className="py-2 font-mono text-[11px] text-navy-2">
                      {e.recordType} · {e.targetRef}
                      {e.rosterBrowsed ? " · staff list browsed" : ""}
                      {e.exported ? ` · exported ${e.exportFormat ?? ""}` : ""}
                    </td>
                    <td className="py-2">
                      <BasisPill basis={e.legalBasis} />
                    </td>
                    <td className="py-2">
                      <OutcomePill outcome={e.outcome} />
                      {e.outcome !== "GRANTED" ? (
                        <div className="mt-1 text-[10px] text-navy-3">
                          Consent not recorded — record not released; officer returned to
                          aggregate view.
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Provenance
            items={[
              [
                "This history",
                "your accesses only · the full district log is audit-tier",
              ],
              ["Append-only", "entries cannot be edited or deleted, by anyone"],
              ["Audit log", "the same entries feed the Oversight access & audit surface"],
            ]}
          />
        </Panel>

        <p className="text-xs text-navy-3">
          <Pill tone="muted">Note</Pill> Students are not individually reachable through
          this path, and no individual-grain student table exists in the analytics
          database.
        </p>
      </PageBody>
    </>
  );
}
