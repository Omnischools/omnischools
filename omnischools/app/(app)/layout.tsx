import { requireSchool } from "@/lib/auth/server";
import { signOutAction } from "@/lib/actions/auth";
import { AppSidebar } from "@/components/app/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  return (
    <div className="bg-bg flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-surface flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold text-navy">
              {school.name}
            </div>
            <div className="text-xs text-navy-3">
              {school.schoolType.charAt(0) + school.schoolType.slice(1).toLowerCase()} ·{" "}
              {user.roles[0]?.replaceAll("_", " ").toLowerCase()}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-pill bg-green-bg px-2.5 py-1 text-xs font-medium text-green">
              ● Connected
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="hover:bg-bg rounded-md px-3 py-1.5 text-xs font-semibold text-navy-2 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
