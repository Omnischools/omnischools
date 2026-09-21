import { notFound } from "next/navigation";
import { getOfficerSession } from "@/lib/auth";
import { getSchoolFacilitiesCensus } from "@/lib/oversight/infrastructure";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Panel, Provenance, RecField } from "@/components/oversight/primitives";

export const dynamic = "force-dynamic";

/**
 * Lucy C5 — the NON-GATED infrastructure drill.
 *
 * Deliberately absent from this page, and each absence is a decision:
 *   · no gate banner — nothing here is about a person;
 *   · no access strip and no R-#### reference — no access was logged, because none was made;
 *   · no `audit_access_log` write — see lib/oversight/infrastructure.ts;
 *   · no "Withheld" rows — there is no reason scope on this surface to explain one. `captured_by`
 *     and `caterer_name` are EXCLUDED at the query boundary, which means absent, not greyed.
 * It behaves like the ordinary school-profile drill, because that is what it is.
 */
export default async function SchoolFacilitiesPage({
  params,
}: {
  params: Promise<{ jurisdictionId: string }>;
}) {
  const { jurisdictionId } = await params;
  const officer = await getOfficerSession();
  if (!officer) notFound();

  const census = await getSchoolFacilitiesCensus(
    {
      jurisdictionId: officer.jurisdictionId,
      level: officer.level,
      officerId: officer.officerId,
    },
    jurisdictionId,
  );
  if (!census) notFound();

  const yesNo = (v: boolean) => (v ? "Yes" : "No");

  return (
    <>
      <PageHead
        crumb={`Schools · ${census.schoolName} · Facilities`}
        title={
          <>
            {census.schoolName} <em className="accent-italic">· facilities census</em>
          </>
        }
        lede={`Annual Census ${census.academicYear}${census.term ? ` · Term ${census.term}` : ""} — aggregate school data, not a named record. No access is logged for this view.`}
      />
      <PageBody>
        <Panel
          title={`${census.schoolName} · facilities census`}
          meta={`${census.academicYear} · as of ${census.asOfDate.slice(0, 10)}`}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <RecField label="Classrooms (total)" value={census.classroomsTotal} />
            <RecField label="Classrooms in good repair" value={census.classroomsGood} />
            <RecField label="Classrooms needing repair" value={census.classroomsRepair} />
            <RecField label="Latrines · boys" value={census.latrinesBoys} />
            <RecField label="Latrines · girls" value={census.latrinesGirls} />
            <RecField label="Latrines · staff" value={census.latrinesStaff} />
            <RecField label="Water on site" value={yesNo(census.hasWater)} />
            <RecField label="Handwashing" value={yesNo(census.hasHandwashing)} />
            <RecField label="Electricity" value={yesNo(census.hasElectricity)} />
            <RecField label="Library" value={yesNo(census.hasLibrary)} />
            <RecField label="ICT lab" value={yesNo(census.hasIctLab)} />
            <RecField label="Internet" value={yesNo(census.hasInternet)} />
            <RecField label="Kitchen" value={yesNo(census.hasKitchen)} />
            <RecField
              label="GSFP participating"
              value={yesNo(census.gsfpParticipating)}
            />
            <RecField
              label="Computers (working / total)"
              value={`${census.computersWorking ?? "—"} / ${census.computersTotal ?? "—"}`}
            />
            <RecField label="Library books" value={census.libraryBookCount ?? "—"} />
            <RecField
              label="Student desks (usable / broken)"
              value={`${census.studentDesksUsable ?? "—"} / ${census.studentDesksBroken ?? "—"}`}
            />
            <RecField label="Teacher desks" value={census.teacherDesks ?? "—"} />
            <RecField label="Chalkboards" value={census.chalkboards ?? "—"} />
            <RecField label="Whiteboards" value={census.whiteboards ?? "—"} />
            <RecField label="Projectors" value={census.projectors ?? "—"} />
          </div>

          <Provenance
            items={[
              ["Source", "annual census · read-only via the analytics boundary"],
              [
                "Grain",
                "one census row per school × term · summed spatially, never across terms",
              ],
              [
                "Not gated",
                "school infrastructure is not a named record · no access is logged",
              ],
            ]}
          />
        </Panel>
      </PageBody>
    </>
  );
}
