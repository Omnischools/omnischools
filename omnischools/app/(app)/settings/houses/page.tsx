import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { houses } from "@/db/schema";
import { SPORTS_HOUSE_WRITE_ROLES } from "@/lib/access";
import { SportsHousesManager } from "@/components/settings/sports-houses-manager";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sports houses" };

export default async function SportsHousesPage() {
  // Management-only surface (ADMIN / HEADMASTER); a non-admin is redirected to /dashboard.
  const { school } = await requireSchoolRole(SPORTS_HOUSE_WRITE_ROLES);
  // Basic-school (or COMBINED) feature only — hidden for a pure SENIOR school.
  if (school.schoolType === "SENIOR") notFound();

  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({ id: houses.id, name: houses.name, colour: houses.colour })
      .from(houses)
      .where(
        and(
          eq(houses.schoolId, school.id),
          eq(houses.kind, "SPORTS"),
          eq(houses.active, true),
        ),
      )
      .orderBy(asc(houses.name)),
  );

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Sports <em className="not-italic text-gold [font-style:italic]">houses.</em>
        </h1>
        <p className="max-w-2xl text-sm text-navy-3">
          The Houses pupils are grouped into for sports and inter-house competition. Each House has
          a name and a colour, shown as a dot on the class roster. Archiving a House keeps every
          pupil&apos;s record — it just stops new assignments.
        </p>
      </div>

      <SportsHousesManager houses={rows} />
    </div>
  );
}
