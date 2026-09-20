import { requireParent } from "@/lib/auth/server";

/**
 * The PARENT portal shell (SHS module 4.3 / INCR-19b) — its OWN route group, deliberately NOT the staff
 * `app/(app)` shell (no sidebar, no `/start`, no finance redirect; Kofi R5). The guard admits ONLY a
 * PARENT at the active school; a staff-only session is redirected to their dashboard. The per-page chrome
 * (parent header + nav) lives in the page because it needs the resolved child's name — this layout is just
 * the guard + the phone-first background frame.
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  await requireParent();
  return <div className="min-h-screen bg-bg">{children}</div>;
}
