"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autoGroupHouseholds, setStudentHousehold } from "@/lib/actions/households";

type Member = { id: string; name: string; code: string; rank: number };
type Family = { id: string; name: string; members: Member[] };

const ordinal = (n: number) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

export function FamiliesCard({ families }: { families: Family[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function group() {
    setMsg(null);
    setError(null);
    startTransition(async () => {
      const res = await autoGroupHouseholds();
      if (res.ok) {
        setMsg(
          res.studentsGrouped === 0
            ? "No new siblings found to group."
            : `Grouped ${res.studentsGrouped} student${res.studentsGrouped === 1 ? "" : "s"} into ${res.householdsCreated} new famil${res.householdsCreated === 1 ? "y" : "ies"}.`,
        );
        router.refresh();
      } else setError(res.error ?? "Could not group.");
    });
  }

  function unlink(studentId: string) {
    startTransition(async () => {
      const res = await setStudentHousehold({ studentId, householdId: null });
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not update.");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-navy-3">
          Group siblings so sibling-rank discounts (1st / 2nd / 3rd child) can apply.
          Students whose primary guardian shares a phone number are matched
          automatically.
        </p>
        <button
          onClick={group}
          disabled={pending}
          className="rounded-md border border-border-2 bg-bg px-3.5 py-2 text-sm font-semibold text-navy transition-colors hover:border-gold disabled:opacity-50"
        >
          {pending ? "Working…" : "Auto-group by guardian phone"}
        </button>
      </div>

      {msg && <p className="mb-2 text-sm font-medium text-green">{msg}</p>}
      {error && <p className="mb-2 text-sm text-terra">{error}</p>}

      {families.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 bg-bg p-6 text-center text-sm text-navy-3">
          No families grouped yet. Use auto-group, or siblings sharing a guardian phone
          will be matched automatically.
        </p>
      ) : (
        <div className="space-y-3">
          {families.map((f) => (
            <div key={f.id} className="rounded-lg border border-border-2 bg-bg p-3">
              <div className="mb-1.5 text-sm font-semibold text-navy">{f.name}</div>
              <ul className="space-y-1">
                {f.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-navy-2">
                      <span className="mr-2 rounded-pill bg-gold-bg px-1.5 py-0.5 text-[11px] font-medium text-navy">
                        {ordinal(m.rank)} child
                      </span>
                      {m.name}
                      <span className="ml-2 font-mono text-xs text-navy-3">{m.code}</span>
                    </span>
                    <button
                      onClick={() => unlink(m.id)}
                      disabled={pending}
                      className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
