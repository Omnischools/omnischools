import { getAdminSession } from "@/lib/provisioning/admin-auth";
import { getProvisionerClient, isProvisionerConfigured } from "@/lib/provisioning/db";
import { listJurisdictionOptions } from "@/lib/provisioning/officers";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";
import { ProvisionForm } from "./provision-form";

export const dynamic = "force-dynamic";

/**
 * G8.b — provision an officer.
 *
 * The node options are fetched SERVER-SIDE and SCHOOL nodes are excluded by the query
 * (`listJurisdictionOptions`), so the client never receives a school node to render. Lucy G8.b is
 * explicit that schools must not be shown-then-disabled; doing the filtering in SQL also means the
 * rule cannot be lost by a change to this component.
 */
export default async function ProvisionOfficerPage() {
  const admin = await getAdminSession();
  if (!admin) return null;

  if (!isProvisionerConfigured()) {
    return (
      <>
        <PageHead
          crumb="Oversight administration"
          title={
            <>
              Provision an <em className="accent-italic">officer.</em>
            </>
          }
          lede="Officer accounts are created here, bound to one jurisdiction node."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Provisioning is not configured.">
            `PROVISIONER_DATABASE_URL` is unset (docs/PROVISIONING.md §4b). The console refuses
            rather than falling back to another credential.
          </Banner>
        </PageBody>
      </>
    );
  }

  const options = await listJurisdictionOptions(getProvisionerClient());

  return (
    <>
      <PageHead
        crumb="Oversight administration"
        title={
          <>
            Provision an <em className="accent-italic">officer.</em>
          </>
        }
        lede="Pick the jurisdiction node the officer oversees. The tier and the role are derived from that node — they are never typed."
      />
      <PageBody>
        <ProvisionForm options={options} adminId={admin.adminId} />
      </PageBody>
    </>
  );
}
