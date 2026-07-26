import { eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools } from "@/db/schema";
import { SecurityForm } from "@/components/settings/security-form";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { BackLink } from "@/components/ui/back-link";

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
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Login &amp; <em className="not-italic text-gold [font-style:italic]">security.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Two-factor for admins and how long sign-ins last.
        </p>
      </div>
      <section className="mb-6 rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-display text-lg font-medium text-navy">Change password</h2>
        <p className="mb-4 text-sm text-navy-3">
          Update the password you use to sign in. You can also sign in with a one-time code sent to
          your phone.
        </p>
        <ChangePasswordForm />
      </section>

      <SecurityForm
        initial={{
          require2fa: row?.require2fa ?? false,
          sessionHours: row?.sessionHours ?? 8,
        }}
      />
    </div>
  );
}
