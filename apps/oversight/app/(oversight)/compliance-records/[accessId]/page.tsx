import Link from "next/link";
import { notFound } from "next/navigation";
import { getOfficerSession } from "@/lib/auth";
import { getAccessEntry } from "@/lib/oversight/audit-log";
import { fieldLabel } from "@/lib/oversight/copy";
import { PageBody, PageHead } from "@/components/oversight/shell";
import {
  Banner,
  BasisPill,
  OutcomePill,
  Panel,
  Provenance,
} from "@/components/oversight/primitives";

export const dynamic = "force-dynamic";

/**
 * Lucy §A2.2 — ONE AUDIT ENTRY, as written.
 *
 * ⚠ THIS PAGE DOES NOT SHOW THE RECORD, and that is the point. Re-opening the operational record to
 * render an audit entry would make reading the log an access in its own right: either a second
 * audit row per page view (drowning the real entries) or an unlogged fetch (which §6 forbids
 * outright). The entry is the artefact; the record was released once, at the moment the entry was
 * written. `fields_released` says what was in it.
 */
export default async function AccessEntryPage({
  params,
}: {
  params: Promise<{ accessId: string }>;
}) {
  const { accessId } = await params;
  const officer = await getOfficerSession();
  if (!officer) notFound();

  const entry = await getAccessEntry(
    {
      jurisdictionId: officer.jurisdictionId,
      level: officer.level,
      officerId: officer.officerId,
    },
    accessId,
  );
  if (!entry) notFound();

  const denied = entry.outcome !== "GRANTED";

  return (
    <>
      <PageHead
        crumb="Compliance records · entry"
        title={
          <>
            Entry <em className="accent-italic">{entry.accessId.slice(0, 8)}.</em>
          </>
        }
        lede="The logged entry, as written. The access it records is not re-opened by viewing it."
        actions={
          <Link href="/compliance-records" className="text-xs text-navy-3 underline">
            Back to log
          </Link>
        }
      />
      <PageBody>
        <div className="flex items-center justify-between rounded-lg bg-navy-deep px-5 py-4 text-bg">
          <div>
            <div className="font-mono text-xs text-gold">{entry.accessId}</div>
            <div className="font-display text-lg">Named-record access</div>
            <div className="text-bg/60 text-xs">
              {entry.occurredAt} · written by the compliance record view
            </div>
          </div>
          <div className="flex gap-2">
            <BasisPill basis={entry.legalBasis} />
            <OutcomePill outcome={entry.outcome} />
          </div>
        </div>

        <Panel title="The logged entry" meta="Immutable · as written">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Entry
              term="Accessing officer"
              detail={`${entry.officerId} · ${entry.officerRole}`}
            />
            <Entry term="Reason given" detail={entry.reasonCode} />
            <Entry
              term="Record accessed"
              detail={`${entry.recordType} · ${entry.targetRef}`}
            />
            <Entry
              term="Subject class (server-derived)"
              detail={entry.staffCategory ?? "—"}
            />
            <Entry term="Legal basis" detail={entry.legalBasis} />
            <Entry
              term="Consent relied on"
              detail={
                entry.legalBasis === "STATUTORY"
                  ? "None — statutory basis, no school consent required"
                  : (entry.consentRef ?? "None — access denied, no consent on record")
              }
            />
            <Entry
              term="Staff list browsed"
              detail={entry.rosterBrowsed ? "Yes" : "No"}
            />
            <Entry
              term="Exported"
              detail={
                entry.exported ? `Yes · ${entry.exportFormat ?? "unspecified"}` : "No"
              }
            />
          </dl>

          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-navy-3">
              Case reference &amp; explanation · as entered
            </div>
            <p className="mt-1 border-l-2 border-gold-soft pl-3 text-sm italic text-navy-2">
              {entry.caseReference ?? "—"}
            </p>
          </div>

          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-navy-3">
              Fields released
            </div>
            <p className="mt-1 text-sm text-navy">
              {denied || entry.fieldsReleased.length === 0
                ? "None — access denied, no consent on record"
                : entry.fieldsReleased.map(fieldLabel).join(", ")}
            </p>
          </div>
        </Panel>

        {denied ? (
          <Banner tone="gold" glyph="⊘" title="Denied at the gate — no record opened.">
            Consent not recorded — record not released; officer returned to aggregate
            view. Nothing left the operational database, which is why the fields-released
            set is empty.
          </Banner>
        ) : null}

        <Provenance
          items={[
            ["The entry", "immutable · a query attaches, the record is unchanged"],
            ["Reviewer", "GES internal audit · with national-tier visibility"],
            ["Outcome", "cleared, or escalated to the officer's line manager"],
          ]}
        />
      </PageBody>
    </>
  );
}

function Entry({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-md border border-border-1 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-navy-3">{term}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-navy">{detail}</dd>
    </div>
  );
}
