import Link from "next/link";
import { requireBoard } from "@/lib/auth/server";
import { getSessionId } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

/**
 * GOV-2 · the board account page (URL `/board/account`, covered by the `/board` confinement prefix).
 * Mirrors the parent account page: `requireBoard()` gate, renders ONLY the self-service
 * `<ChangePasswordForm>` (NOT SecurityForm — that writes school security, a staff-only surface). The
 * form action is `requireUser`-gated and acts on the CURRENT session only.
 */
export const dynamic = "force-dynamic";

export default async function BoardAccountPage() {
  await requireBoard();
  const sessionId = await getSessionId();

  return (
    <div>
      <Link href="/board" className="text-[13px] font-medium text-navy-3 hover:text-gold">
        ← Back to overview
      </Link>
      <section className="mt-4 rounded-xl border border-border bg-surface px-[26px] py-[22px]">
        <h1 className="mb-1 font-display text-xl font-medium text-navy">
          Change your <em className="not-italic text-gold">password</em>.
        </h1>
        <p className="mb-4 text-[13px] leading-relaxed text-navy-2">
          Update the password you use to sign in. You can also sign in with a one-time code sent to
          your phone.
        </p>
        <ChangePasswordForm sessionId={sessionId} />
      </section>
    </div>
  );
}
