"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addStaff } from "@/lib/actions/staff";
import { createInvite } from "@/lib/actions/invites";
import { STAFF_ROLES } from "@/lib/staff-roles";
import { Modal } from "@/components/ui/modal";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export function AddStaffForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    setDone(null);
    setLink(null);
    setCopied(false);
  }

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const role = formData.get("role");
    const fullName = formData.get("fullName");
    const phone = formData.get("phone");
    const email = formData.get("email");
    const invite = formData.get("invite") === "on";

    const add = await addStaff({ fullName, phone, email, role });
    if (!add.ok) {
      setError(add.error ?? "Could not add staff.");
      setSaving(false);
      return;
    }
    if (invite) {
      const inv = await createInvite({ role, fullName, phone, email });
      if (inv.ok && inv.token) setLink(`${window.location.origin}/accept/${inv.token}`);
    }
    setSaving(false);
    setDone(String(fullName));
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        + Add staff
      </button>

      <Modal open={open} onClose={close} title={done ? "Staff added" : "Add staff"}>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-navy-2">
              <span className="font-semibold text-navy">{done}</span> has been added.
              {link ? " Share their set-up link if needed:" : ""}
            </p>
            {link && (
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
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDone(null);
                  setLink(null);
                  setCopied(false);
                }}
                className="text-sm font-semibold text-gold hover:underline"
              >
                Add another
              </button>
              <button onClick={close} className="text-sm text-navy-3 hover:text-navy">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <select
                  name="role"
                  required
                  defaultValue="TEACHER"
                  className={fieldClass}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy-2">
              <input type="checkbox" name="invite" defaultChecked />
              Send a password-setup invite (SMS / email)
            </label>

            {error && <p className="text-sm text-terra">{error}</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
              >
                {saving ? "Adding…" : "Add & invite"}
              </button>
              <button
                type="button"
                onClick={close}
                className="text-sm font-semibold text-navy-2 hover:text-navy"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-navy-3">
              They sign in with this phone (OTP), or set a password from the invite.
            </p>
          </form>
        )}
      </Modal>
    </>
  );
}
