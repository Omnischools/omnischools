import { requireSchool } from "@/lib/auth/server";
import { getSessionId } from "@/lib/auth";
import { AppSidebar } from "@/components/app/sidebar";
import { SignOutButton } from "@/components/app/sign-out-button";
import { PwaSession } from "@/components/pwa-session";

/**
 * The staff-only guard is NOT here — it is inside `requireSchool()`, which this layout and all 82
 * pages under it already call. That placement is deliberate and was arrived at the hard way: a
 * redirect thrown from a LAYOUT does not stop the page rendering. Layouts and pages render in
 * parallel, so the page's own queries still run and its payload is still streamed; a production
 * build served a 307 to `/wassce` whose body nonetheless carried the student's allergies,
 * conditions and medications. The navigation was blocked and the bytes were not.
 * Guarding inside `requireSchool` puts the check in each page's OWN render, before its own reads.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  const sessionId = await getSessionId();
  return (
    <div className="flex min-h-screen bg-bg">
      <PwaSession sessionId={sessionId} />
      <AppSidebar
        school={{
          name: school.name,
          shortName: school.shortName,
          schoolType: school.schoolType,
          location: school.location,
        }}
        user={{ name: user.name ?? null, roles: user.roles }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3 print:hidden">
          {/* School name shows on mobile (sidebar hidden < md); on desktop it lives in the sidebar. */}
          <div className="truncate font-display text-base font-semibold text-navy md:hidden">
            {school.name}
          </div>
          <div className="hidden md:block" />
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-pill bg-green-bg px-2.5 py-1 text-xs font-medium text-green">
              ● Connected
            </span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
