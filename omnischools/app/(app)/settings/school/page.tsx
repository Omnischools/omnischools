import { eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools, regions, districts } from "@/db/schema";
import { SchoolInfoForm } from "@/components/settings/school-info-form";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "School info" };

const title = (s?: string | null) =>
  s ? s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ") : "—";

export default async function SchoolInfoPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .select({
        name: schools.name,
        shortName: schools.shortName,
        gesCode: schools.gesCode,
        csspsCode: schools.csspsCode,
        yearFounded: schools.yearFounded,
        address: schools.address,
        ownership: schools.ownership,
        schoolType: schools.schoolType,
        regionName: regions.name,
        districtName: districts.name,
      })
      .from(schools)
      .leftJoin(regions, eq(schools.regionId, regions.id))
      .leftJoin(districts, eq(schools.districtId, districts.id))
      .where(eq(schools.id, school.id));
    return row;
  });

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          School <em className="not-italic text-gold [font-style:italic]">info.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Your school&apos;s details, used across receipts, statements and messages.
        </p>
      </div>

      <SchoolInfoForm
        initial={{
          name: data?.name ?? school.name,
          shortName: data?.shortName ?? "",
          csspsCode: data?.csspsCode ?? "",
          yearFounded: data?.yearFounded ?? "",
          address: data?.address ?? "",
          ownership: data?.ownership ?? "PUBLIC",
        }}
        readOnly={{
          gesCode: data?.gesCode ?? "—",
          region: data?.regionName ?? "—",
          district: data?.districtName ?? "—",
          type: title(data?.schoolType),
        }}
      />
    </div>
  );
}
