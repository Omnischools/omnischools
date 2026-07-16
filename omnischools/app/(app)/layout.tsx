import { requireSchool } from "@/lib/auth/server";
import { AppSidebar } from "@/components/app/sidebar";
import { SignOutButton } from "@/components/app/sign-out-button";
import { PwaSession } from "@/components/pwa-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  return (
    <div className="flex min-h-screen bg-bg">
      <PwaSession uid={user.id} />
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
