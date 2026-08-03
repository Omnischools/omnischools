import { requireBoard } from "@/lib/auth/server";
import { SignOutButton } from "@/components/app/sign-out-button";

/**
 * The read-only BOARD/DIRECTOR shell (GOV-2 / R333) — its OWN route group, deliberately NOT the staff
 * `app/(app)` shell (no AppSidebar, no staff chrome, no finance redirect). The guard admits ONLY a
 * BOARD_MEMBER at the active school; every other session is redirected by `requireBoard()`. The real
 * confinement lives in each PAGE's own `requireBoard()` (a layout redirect does not stop a page
 * rendering); this layout just draws the minimal header frame.
 */
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const { school } = await requireBoard();
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center gap-3.5 border-b border-border bg-surface px-7 py-[18px] print:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold font-display text-sm font-semibold text-navy">
          {school.name.trim()[0]?.toUpperCase() ?? "S"}
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-medium text-navy">{school.name}</div>
          <div className="text-[11px] text-navy-3">Board overview · read-only</div>
        </div>
        <SignOutButton />
      </header>
      <main className="mx-auto max-w-[980px] px-7 pb-9 pt-6">{children}</main>
    </div>
  );
}
