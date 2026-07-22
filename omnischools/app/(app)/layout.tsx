import { requireSchool } from "@/lib/auth/server";
import { getSessionId } from "@/lib/auth";
import { AppSidebar } from "@/components/app/sidebar";
import { SignOutButton } from "@/components/app/sign-out-button";
import { PwaSession } from "@/components/pwa-session";

/**
 * The staff-only guard is NOT here — it is inside `requireSchool()`, which this layout and all 82
 * pages under it already call.
 *
 * The distinction is narrow and worth stating precisely, because getting it wrong sends you down a
 * very expensive road. A redirect thrown from a **LAYOUT** does not stop the page: layouts and pages
 * render in parallel, so the page's own queries still run and its payload is still streamed. A
 * redirect thrown from the **page's own render, awaited before its own fetch**, does stop it — that
 * is ordinary sequential control flow. So the guard belongs in the function every page awaits first,
 * not in the shell around them.
 *
 * (Verified by Sarah on PR #176: with the guard in `requireSchool`, all 63 static routes here return
 * a bare error shell to a non-staff session, including `students/[id]/edit`, which fetches the same
 * health record and carries no data-layer guard of its own.)
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
