import Link from "next/link";
import { requireParent } from "@/lib/auth/server";
import { getSessionId } from "@/lib/auth";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import { relationshipLabel } from "@/lib/wassce/parent-copy";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { ParentHeader } from "../parent-chrome";

/**
 * INCR-34 (L2a) · the parent portal account page — self-service change password (owner call: parents
 * get their own control). Same PARENT session gate as the other (parent) routes; not a feature tab, so
 * it renders the header only (no ParentNav). The form action is `requireUser`-gated and acts on the
 * current session only.
 */
export const dynamic = "force-dynamic";

export default async function ParentAccountPage() {
  const { user, school } = await requireParent();
  // INCR-39: pass the pre-change session for the offline-buffer re-key (harmless no-op for a parent
  // with no ledger buffer, but keeps the form's contract identical across both hosts).
  const sessionId = await getSessionId();
  const data = await loadParentPortal(school.id, user.id);
  const child = data.children[0] ?? null;
  const guardianDisplay = data.guardianName ?? user.name ?? "Parent";
  const relation = data.guardianRelationship ? relationshipLabel(data.guardianRelationship) : "Parent";

  return (
    <div className="mx-auto max-w-[980px]">
      <ParentHeader
        schoolName={school.name}
        childName={child?.fullName ?? null}
        guardianDisplay={guardianDisplay}
        relation={relation}
      />

      <div className="px-7 pb-9 pt-6">
        <Link href="/wassce" className="text-[13px] font-medium text-navy-3 hover:text-gold">
          ← Back to portal
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
    </div>
  );
}
