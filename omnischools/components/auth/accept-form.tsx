"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/lib/actions/invites";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function AcceptForm({ token, contact }: { token: string; contact: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await acceptInvite({ token, password });
    setSaving(false);
    if (res.ok) router.push("/login?accepted=1");
    else setError(res.error ?? "Could not complete sign-up.");
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>
          Your login <span className="font-medium text-navy-3">— from the invite</span>
        </label>
        <input value={contact} disabled className={`${fieldClass} opacity-70`} />
      </div>
      <div>
        <label className={labelClass}>Set a password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClass}>Confirm password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={fieldClass}
        />
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {saving ? "Setting up…" : "Accept & continue →"}
      </button>
      <p className="text-center text-xs text-navy-3">
        You can also sign in with your phone via OTP.
      </p>
    </div>
  );
}
