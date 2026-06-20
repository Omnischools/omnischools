import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools } from "@/db/schema";
import { SecurityForm } from "@/components/settings/security-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Login & security" };

export default async function SecurityPage() {
  const { school } = await requireSchool();
  const [row] = await withSchool(school.id, (tx) =>
    tx
      .select({ require2fa: schools.require2fa, sessionHours: schools.sessionHours })
      .from(schools)
      .where(eq(schools.id, school.id)),
  );

  return (
    <div className="mx-auto max-w-page">
      <Link href="/settings" className="text-sm text-navy-3 hover:text-gold">
        ← Settings
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Login &amp; <em className="not-italic text-gold [font-style:italic]">security.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Two-factor for admins and how long sign-ins last.
        </p>
      </div>
      <SecurityForm
        initial={{
          require2fa: row?.require2fa ?? false,
          sessionHours: row?.sessionHours ?? 8,
        }}
      />
    </div>
  );
}
