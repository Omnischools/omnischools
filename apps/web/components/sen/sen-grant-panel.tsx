"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { grantSenAccess, revokeSenAccess } from "@/lib/actions/sen";
import type { SenGrantsAdmin } from "@/lib/sen/register-data";

/**
 * GOV-10b · admin Access-grants panel (R438). Grant a member of staff per-student access to a child's
 * ACCOMMODATIONS (never the diagnosis) for accommodation planning; revoke is append-only. Admin-gated by the
 * page + the actions.
 */
const inputCls =
  "mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none";
const capCls = "text-[11px] font-semibold uppercase tracking-wide text-navy-3";

export function SenGrantPanel({ data }: { data: SenGrantsAdmin }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onGrant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const strOpt = (k: string) => {
      const v = fd.get(k);
      return v && String(v).trim() ? String(v).trim() : null;
    };
    setBusy(true);
    setMsg(null);
    const res = await grantSenAccess({
      studentId: String(fd.get("studentId") ?? ""),
      granteeUserId: String(fd.get("granteeUserId") ?? ""),
      reason: String(fd.get("reason") ?? ""),
      expiresAt: strOpt("expiresAt"),
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Access granted." });
      setOpen(false);
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error });
    }
  }

  async function onRevoke(grantId: string) {
    setBusy(true);
    setMsg(null);
    const res = await revokeSenAccess({ grantId });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg({ ok: false, text: res.error });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-navy">Teacher access grants</h2>
          <p className="max-w-[640px] text-sm text-navy-3">
            Give a member of staff access to a student&apos;s <b className="text-navy-2">accommodations</b> (not
            the diagnosis) for accommodation planning. Revoking is append-only — the record stays.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={data.grantableStudents.length === 0}
            title={data.grantableStudents.length === 0 ? "No students with a consented record to grant yet" : undefined}
            className="shrink-0 rounded-md bg-navy px-4 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            + Grant access
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={onGrant} className="grid gap-3 rounded-lg border border-border bg-bg p-3 sm:grid-cols-2">
          <label className="block">
            <span className={capCls}>Student</span>
            <select name="studentId" required defaultValue="" className={inputCls}>
              <option value="" disabled>
                Select a student…
              </option>
              {data.grantableStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.className ? ` — ${s.className}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={capCls}>Grant to (staff)</span>
            <select name="granteeUserId" required defaultValue="" className={inputCls}>
              <option value="" disabled>
                Select a member of staff…
              </option>
              {data.granteeOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.roleLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={capCls}>Reason (accommodation planning)</span>
            <input type="text" name="reason" required maxLength={300} className={inputCls} />
          </label>
          <label className="block">
            <span className={capCls}>Expires (optional)</span>
            <input type="date" name="expiresAt" className={inputCls} />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-navy px-4 py-2.5 text-sm font-bold text-bg hover:bg-navy-deep disabled:opacity-60"
            >
              {busy ? "Granting…" : "Grant access"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-navy-3 hover:text-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {data.grants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-3 py-2 font-bold">Student</th>
                <th className="px-3 py-2 font-bold">Granted to</th>
                <th className="px-3 py-2 font-bold">Reason</th>
                <th className="px-3 py-2 font-bold">Expires</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.grants.map((g) => (
                <tr key={g.grantId}>
                  <td className="px-3 py-2 font-semibold text-navy">{g.studentName}</td>
                  <td className="px-3 py-2 text-navy-2">{g.granteeName}</td>
                  <td className="max-w-[220px] px-3 py-2 text-[12px] text-navy-3">{g.reason}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-navy-3">{g.expiresAt ?? "—"}</td>
                  <td className="px-3 py-2">
                    {g.revoked ? (
                      <span className="text-[11px] font-semibold text-navy-3">Revoked</span>
                    ) : g.live ? (
                      <span className="text-[11px] font-semibold text-green">Live</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-warn">Expired</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {g.live && (
                      <button
                        type="button"
                        onClick={() => onRevoke(g.grantId)}
                        disabled={busy}
                        className="rounded border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-terra hover:bg-terra-bg disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
    </section>
  );
}
