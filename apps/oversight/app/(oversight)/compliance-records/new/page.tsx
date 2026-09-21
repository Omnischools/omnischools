import { getOfficerSession } from "@/lib/auth";
import { listSchoolsInJurisdiction } from "@/lib/oversight/school-ref";
import { isIndividualDrilldownAvailable } from "@/lib/oversight/named-record-access";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";
import { GateForm } from "./gate-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Request a named record" };

export default async function NewComplianceRecordPage() {
  const officer = await getOfficerSession();

  if (!officer) {
    // No identity ⇒ no audit row is possible ⇒ no access. Fail closed, and say so plainly.
    return (
      <>
        <PageHead
          crumb="Compliance records"
          title={
            <>
              Request a <em className="accent-italic">named record.</em>
            </>
          }
          lede="Named-record access is logged and reviewable. State the compliance reason before the record is shown."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            Named-record access is recorded against the officer who made it. Without a GES
            staff session there is nobody to log the access against, so the gate does not
            open.
          </Banner>
        </PageBody>
      </>
    );
  }

  const schools = await listSchoolsInJurisdiction({
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
            Request a <em className="accent-italic">named record.</em>
          </>
        }
        lede="Named-record access is logged and reviewable. State the compliance reason before the record is shown."
      />
      <PageBody>
        {isIndividualDrilldownAvailable() ? null : (
          <Banner tone="gold" glyph="⊘" title="Individual drill-down unavailable.">
            The operational read-back is not configured, so no individual record can be
            opened. The aggregate view remains available.
          </Banner>
        )}
        <GateForm schools={schools} />
      </PageBody>
    </>
  );
}
