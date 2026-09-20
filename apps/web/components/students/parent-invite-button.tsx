"use client";
import { useState } from "react";
import { createInvite } from "@/lib/actions/invites";

/**
 * INCR-19a STAFF affordance — invite a guardian to the (19b) parent portal from the student profile's
 * guardian list. This is a STAFF surface; no PARENT page/route ships in 19a. The SMS goes to the
 * guardian's STORED number (the action never trusts a typed phone, AC C2); with no Hubtel creds it
 * console-degrades and the returned link can be copied for testing.
 */
export function ParentInviteButton({
  studentId,
  guardianId,
  linked,
}: {
  studentId: string;
  guardianId: string;
  linked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (linked) {
    return (
      <span className="rounded-pill bg-green-bg px-2 py-0.5 text-xs font-medium text-green">
        Portal linked
      </span>
    );
  }

  if (link) {
    return (
      <button
        onClick={() => {
          navigator.clipboard?.writeText(link);
          setCopied(true);
        }}
        className="text-xs font-semibold text-gold hover:underline"
      >
        {copied ? "Link copied ✓" : "Copy portal invite link"}
      </button>
    );
  }

  async function invite() {
    setBusy(true);
    setError(null);
    const res = await createInvite({ role: "PARENT", studentId, guardianId });
    setBusy(false);
    if (res.ok && res.token) setLink(`${window.location.origin}/accept/${res.token}`);
    else setError(res.error ?? "Could not invite.");
  }

  return (
    <div className="text-right">
      <button
        onClick={invite}
        disabled={busy}
        className="text-xs font-semibold text-navy-3 transition-colors hover:text-gold disabled:opacity-50"
      >
        {busy ? "…" : "Invite to parent portal"}
      </button>
      {error && <div className="mt-1 text-xs text-terra">{error}</div>}
    </div>
  );
}
