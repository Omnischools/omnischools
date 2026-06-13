"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createInvite } from "@/lib/actions/invites";
import { STAFF_ROLES } from "@/lib/staff-roles";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export function InviteStaffForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await createInvite({
      role: formData.get("role"),
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      email: formData.get("email"),
    });
    setSaving(false);
    if (res.ok && res.token) {
      setLink(`${window.location.origin}/accept/${res.token}`);
      router.refresh();
    } else setError(res.error ?? "Could not create the invite.");
  }

  function reset() {
    setOpen(false);
    setLink(null);
    setError(null);
    setCopied(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border-2 px-4 py-2.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
      >
        Invite
      </button>
    );
  }

  return (
    <div className="absolute right-0 top-12 z-10 w-80 rounded-xl border border-border bg-surface p-5 shadow-lg">
      {link ? (
        <div className="space-y-3">
          <h3 className="font-display text-base font-semibold text-navy">
            Invite created
          </h3>
          <p className="text-sm text-navy-3">
            We&apos;ve sent the link by SMS{". "}Share it directly if needed:
          </p>
          <div className="flex items-center gap-2">
            <input readOnly value={link} className={`${fieldClass} text-xs`} />
            <button
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
              className="shrink-0 rounded-md bg-navy px-3 py-2 text-xs font-semibold text-bg"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setLink(null);
                setCopied(false);
              }}
              className="text-sm font-semibold text-gold hover:underline"
            >
              Invite another
            </button>
            <button onClick={reset} className="text-sm text-navy-3 hover:text-navy">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form action={action} className="space-y-3">
          <h3 className="font-display text-base font-semibold text-navy">
            Invite a staff member
          </h3>
          <div>
            <label className={labelClass}>Full name</label>
            <input name="fullName" required className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Phone (login)</label>
            <input
              name="phone"
              required
              placeholder="024 000 0000"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Email <span className="font-medium text-navy-3">— optional</span>
            </label>
            <input name="email" type="email" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <select name="role" required defaultValue="TEACHER" className={fieldClass}>
              {STAFF_ROLES.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-terra">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {saving ? "Sending…" : "Send invite"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-sm font-semibold text-navy-2 hover:text-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
