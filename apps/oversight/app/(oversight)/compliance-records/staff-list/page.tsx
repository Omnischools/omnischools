import { getOfficerSession } from "@/lib/auth";
import { listSchoolsInJurisdiction } from "@/lib/oversight/school-ref";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";
import { BrowseForm } from "./browse-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff list browse" };

export default async function StaffListPage() {
  const officer = await getOfficerSession();
  if (!officer) {
    return (
      <>
        <PageHead
          crumb="Compliance records · staff list"
          title={
            <>
              Staff list, <em className="accent-italic">then record.</em>
            </>
          }
          lede="The staff list opens only after the justification is logged, and the log records that a list was browsed."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            Browsing a school&apos;s staff list is a logged access and needs an officer
            identity to log it against.
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
        crumb="Compliance records · staff list"
        title={
          <>
            Staff list, <em className="accent-italic">then record.</em>
          </>
        }
        lede="The staff list opens only after the justification is logged, and the log records that a list was browsed — not only the record finally chosen."
      />
      <PageBody>
        <BrowseForm schools={schools} />
      </PageBody>
    </>
  );
}
