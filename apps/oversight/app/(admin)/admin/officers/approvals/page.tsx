import { getAdminSession } from "@/lib/provisioning/admin-auth";
import { getProvisionerClient, isProvisionerConfigured } from "@/lib/provisioning/db";
import { listJurisdictionOptions } from "@/lib/provisioning/officers";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";
import { ApprovalForm } from "./approval-form";

export const dynamic = "force-dynamic";

/**
 * G8.d — the APPROVER's side of the two-person rule.
 *
 * An administrator who is NOT the proposer reviews the grant being asked for and, if they agree,
 * generates a short-lived approval code bound to that exact (officer uid, node) pair. The proposer
 * pastes it into their provision form; the server verifies the signature, the pair, the expiry and
 * that the two administrators are different people, and only then writes.
 *
 * ⚠ READ THIS BEFORE EXTENDING: what is NOT here is the "Awaiting approval" QUEUE from Lucy's map —
 * a list of pending proposals an approver can browse. That needs a persisted proposal, and Wells's
 * schema has no table for one (the long note in lib/provisioning/approval.ts explains why neither
 * existing table can hold it without overloading a meaning). The two-person RULE is fully enforced;
 * the asynchronous workflow around it is deferred and needs a `provisioning_proposal` table. Until
 * then the handoff is out-of-band — a message, a call — which is honest about what the system
 * guarantees (two distinct administrators) and what it does not (a durable record of the request).
 */
export default async function ApprovalsPage() {
  const admin = await getAdminSession();
  if (!admin) return null;

  if (!isProvisionerConfigured()) {
    return (
      <>
        <PageHead
          crumb="Oversight administration"
          title={
            <>
              Approve a <em className="accent-italic">grant.</em>
            </>
          }
          lede="Region and national grants need a second administrator."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Provisioning is not configured.">
            `PROVISIONER_DATABASE_URL` is unset (docs/PROVISIONING.md §4b).
          </Banner>
        </PageBody>
      </>
    );
  }

  const options = await listJurisdictionOptions(getProvisionerClient());
  const twoPersonNodes = options.filter(
    (o) => o.level === "REGION" || o.level === "NATIONAL",
  );

  return (
    <>
      <PageHead
        crumb="Oversight administration"
        title={
          <>
            Approve a <em className="accent-italic">grant.</em>
          </>
        }
        lede="A region or national officer sees an entire region or the whole country. Granting one takes two administrators — the proposer, and you."
      />
      <PageBody>
        <Banner tone="warn" glyph="!" title="You are the second signature.">
          Check the officer uid and the jurisdiction against what the proposer told you, and against
          the GES appointment record. The code you generate authorises that one grant, expires in 15
          minutes, and names you in the append-only provisioning log beside the proposer.
        </Banner>
        <ApprovalForm options={twoPersonNodes} adminId={admin.adminId} />
      </PageBody>
    </>
  );
}
