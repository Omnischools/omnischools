"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateStaff } from "@/lib/actions/staff";
import { createInvite } from "@/lib/actions/invites";
import { RoleEditor } from "@/components/staff/role-editor";
import { RowCheckbox } from "@/components/ui/selection";

const inputClass =
  "w-full rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:bg-surface";

type Member = {
  userId: string;
  name: string | null;
  phone: string;
  email: string | null;
  roles: { assignmentId: string; code: string; label: string | null }[];
};

export function StaffRow({
  member,
  selected,
  onToggle,
  onRequestDelete,
}: {
  member: Member;
  selected: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name ?? "");
  const [phone, setPhone] = useState(member.phone);
  const [email, setEmail] = useState(member.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function cancel() {
    setEditing(false);
    setName(member.name ?? "");
    setPhone(member.phone);
    setEmail(member.email ?? "");
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await updateStaff({
      userId: member.userId,
      fullName: name,
      phone,
      email,
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else setError(res.error ?? "Could not save.");
  }

  async function invite() {
    setBusy(true);
    setError(null);
    const res = await createInvite({
      role: member.roles[0]?.code ?? "TEACHER",
      fullName: member.name ?? "Staff",
      phone: member.phone,
      email: member.email ?? "",
    });
    setBusy(false);
    if (res.ok && res.token) setLink(`${window.location.origin}/accept/${res.token}`);
    else setError(res.error ?? "Could not invite.");
  }

  return (
    <tr className="align-top hover:bg-bg">
      <td className="px-4 py-3">
        <RowCheckbox
          checked={selected}
          onChange={onToggle}
          label={`Select ${member.name ?? "staff"}`}
        />
      </td>
      <td className="px-4 py-3 font-medium text-navy">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        ) : (
          (member.name ?? "—")
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-navy-2">
        {editing ? (
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            className={`${inputClass} font-sans`}
          />
        ) : (
          member.phone || "—"
        )}
      </td>
      <td className="px-4 py-3 text-navy-2">
        {editing ? (
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="—"
            className={inputClass}
          />
        ) : (
          (member.email ?? "—")
        )}
      </td>
      <td className="px-4 py-3">
        <RoleEditor userId={member.userId} assignments={member.roles} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={busy}
              className="mr-3 text-xs font-semibold text-green disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={cancel}
              className="text-xs font-semibold text-navy-3 hover:text-navy"
            >
              Cancel
            </button>
          </>
        ) : link ? (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link);
              setCopied(true);
            }}
            className="text-xs font-semibold text-gold hover:underline"
          >
            {copied ? "Link copied ✓" : "Copy invite link"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="mr-3 text-xs font-semibold text-navy-3 transition-colors hover:text-gold disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={invite}
              disabled={busy}
              className="mr-3 text-xs font-semibold text-navy-3 transition-colors hover:text-gold disabled:opacity-50"
            >
              {busy ? "…" : "Invite"}
            </button>
            <button
              onClick={onRequestDelete}
              disabled={busy}
              className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
        {error && <div className="mt-1 text-xs text-terra">{error}</div>}
      </td>
    </tr>
  );
}
