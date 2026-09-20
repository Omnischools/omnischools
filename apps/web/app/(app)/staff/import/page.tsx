import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { StaffImport } from "@/components/staff/staff-import";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import staff" };

export default async function ImportStaffPage() {
  const { school } = await requireSchool();

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/staff" label="Staff" />
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Import staff</h1>
          <p className="text-sm text-navy-3">
            Add many staff at once from a CSV — each can be invited to set their own
            password — or{" "}
            <Link href="/staff" className="text-gold underline">
              add a single staff member
            </Link>
            .
          </p>
        </div>
      </div>
      <StaffImport schoolName={school.name} />
    </div>
  );
}
