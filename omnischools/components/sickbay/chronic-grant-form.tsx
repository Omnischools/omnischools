"use client";

/**
 * §04 `+ Grant access` form (SHS module 4.4 / INCR-23b · R139). A client component that takes ONLY
 * SCALAR option lists (R120 — never a reader row) and calls the MATRON-only `grantAccess` action. The
 * server re-validates everything; this form's client rules (PARTIAL disabled on a mental-health plan,
 * the directive note shown only for DIRECTIVE) are affordances, not the boundary.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { grantAccess } from "@/lib/actions/sickbay-chronic";
import { GRANT_MH_CONSEQUENCE } from "@/lib/sickbay/chronic-copy"; // pure/client-safe (Dex-confirmed)

type StaffOpt = { id: string; name: string; roleLabel: string };
type EntryOpt = {
  entryId: string;
  studentName: string;
  conditionLabel: string;
  hmRestricted: boolean;
};
type HouseOpt = { id: string; name: string };
type Scope = "FULL_PLAN" | "PARTIAL" | "DIRECTIVE";

const field =
  "w-full rounded-[6px] border border-border-2 bg-surface px-[10px] py-[8px] text-[12px] text-navy";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3";

export function ChronicGrantForm({
  staff,
  entries,
  houses,
}: {
  staff: StaffOpt[];
  entries: EntryOpt[];
  houses: HouseOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [entryId, setEntryId] = useState(entries[0]?.entryId ?? "");
  const [scope, setScope] = useState<Scope>("PARTIAL");
  const [noExpiry, setNoExpiry] = useState(true);

  const selected = entries.find((e) => e.entryId === entryId);
  const isMH = selected?.hmRestricted ?? false;

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-2 bg-bg p-[16px_18px] text-[12px] italic text-navy-3">
        Open a care plan first — there is nothing to grant access to yet.
      </p>
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setError(null);
    setDone(false);
    start(async () => {
      const res = await grantAccess({
        entryId: f.get("entryId"),
        granteeUserId: f.get("granteeUserId"),
        scope: f.get("scope"),
        scopeLabel: (f.get("scopeLabel") as string)?.trim() || null,
        reason: f.get("reason"),
        directiveNote: (f.get("directiveNote") as string)?.trim() || null,
        houseId: (f.get("houseId") as string) || null,
        expiresAt: noExpiry ? null : (f.get("expiresAt") as string) || null,
      });
      if (res.ok) {
        setDone(true);
        formEl.reset();
        setScope("PARTIAL");
        setNoExpiry(true);
        router.refresh();
      } else {
        setError(res.error ?? "Could not grant access.");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border bg-surface p-[20px_22px]"
    >
      <div className="mb-4 font-display text-[16px] font-semibold text-navy">
        Grant <em className="font-normal italic text-gold">access</em>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="granteeUserId">
            Member of staff
          </label>
          <select id="granteeUserId" name="granteeUserId" required className={field}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.roleLabel}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="entryId">
            Care plan
          </label>
          <select
            id="entryId"
            name="entryId"
            required
            className={field}
            value={entryId}
            onChange={(ev) => setEntryId(ev.target.value)}
          >
            {entries.map((e) => (
              <option key={e.entryId} value={e.entryId}>
                {e.studentName} · {e.conditionLabel}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="scope">
            Scope
          </label>
          <select
            id="scope"
            name="scope"
            className={field}
            value={scope}
            onChange={(ev) => setScope(ev.target.value as Scope)}
          >
            <option value="FULL_PLAN">Full plan</option>
            {/* R132.1 — no dorm card for a mental-health plan. */}
            <option value="PARTIAL" disabled={isMH}>
              Partial (dorm card){isMH ? " — not for a mental-health plan" : ""}
            </option>
            <option value="DIRECTIVE">Directive</option>
          </select>
          {/* R135/E20 — the grant-side consequence line: granting on a mental-health plan shares a
              psychiatric history in full. The matron sees it at the point of choice. */}
          {isMH && (
            <p className="mt-2 rounded-md bg-terra-bg px-3 py-2 text-[11px] font-medium text-terra">
              {GRANT_MH_CONSEQUENCE}
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="scopeLabel">
            Scope label <span className="font-normal normal-case text-navy-3">(optional)</span>
          </label>
          <input id="scopeLabel" name="scopeLabel" maxLength={120} className={field} />
        </div>
        {scope === "DIRECTIVE" && (
          <div className="sm:col-span-2">
            <label className={label} htmlFor="directiveNote">
              Directive — the one sentence this person will see
            </label>
            <textarea id="directiveNote" name="directiveNote" required rows={2} className={field} />
          </div>
        )}
        <div>
          <label className={label} htmlFor="houseId">
            Tie to a House{" "}
            <span className="font-normal normal-case text-navy-3">(auto-expires on HM change)</span>
          </label>
          <select id="houseId" name="houseId" className={field} defaultValue="">
            <option value="">No House tie</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} House
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="expiresAt">
            Expires
          </label>
          <div className="flex items-center gap-3">
            <input
              id="expiresAt"
              name="expiresAt"
              type="date"
              disabled={noExpiry}
              className={`${field} disabled:opacity-50`}
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-navy-2">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={(ev) => setNoExpiry(ev.target.checked)}
              />
              No expiry
            </label>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="reason">
            Reason <span className="font-normal normal-case text-navy-3">(recorded in the trail)</span>
          </label>
          <textarea id="reason" name="reason" required rows={2} className={field} />
        </div>
      </div>

      {error && <p className="mt-3 text-[12px] font-semibold text-terra">{error}</p>}
      {done && <p className="mt-3 text-[12px] font-semibold text-green">Access granted.</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[6px] border border-navy bg-navy px-[16px] py-[9px] text-[12px] font-bold text-bg disabled:opacity-60"
        >
          {pending ? "Granting…" : "Grant access"}
        </button>
      </div>
    </form>
  );
}
