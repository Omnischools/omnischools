"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSchoolProfile } from "@/lib/actions/settings";

const OWNERSHIPS = ["PUBLIC", "PRIVATE", "MISSION", "INTERNATIONAL"] as const;
const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

type Props = {
  initial: {
    name: string;
    shortName: string;
    csspsCode: string;
    yearFounded: string;
    address: string;
    ownership: string;
  };
  readOnly: { gesCode: string; region: string; district: string; type: string };
};

export function SchoolInfoForm({ initial, readOnly }: Props) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setMsg(null);
  };
  const dirty = (Object.keys(initial) as (keyof typeof f)[]).some(
    (k) => f[k] !== initial[k],
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateSchoolProfile({
      name: f.name,
      shortName: f.shortName,
      csspsCode: f.csspsCode,
      yearFounded: f.yearFounded,
      address: f.address,
      ownership: f.ownership as (typeof OWNERSHIPS)[number],
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-navy">Editable details</h2>
        <p className="mb-4 mt-0.5 text-sm text-navy-3">
          These appear on receipts, statements and parent messages.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>School name</label>
            <input
              className={fieldClass}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>
              SMS sign-off <span className="font-medium text-navy-3">— short name</span>
            </label>
            <input
              className={`${fieldClass} font-mono uppercase tracking-wide`}
              value={f.shortName}
              maxLength={12}
              placeholder="OPTIONAL"
              onChange={(e) => set("shortName", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Ownership</label>
            <select
              className={fieldClass}
              value={f.ownership || "PUBLIC"}
              onChange={(e) => set("ownership", e.target.value)}
            >
              {OWNERSHIPS.map((o) => (
                <option key={o} value={o}>
                  {o.charAt(0) + o.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>CSSPS code</label>
            <input
              className={`${fieldClass} font-mono`}
              value={f.csspsCode}
              placeholder="SHS / TVI only"
              onChange={(e) => set("csspsCode", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Year founded</label>
            <input
              className={fieldClass}
              value={f.yearFounded}
              placeholder="1965"
              onChange={(e) => set("yearFounded", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Address (postal + GPS)</label>
            <input
              className={fieldClass}
              value={f.address}
              placeholder="P.O. Box 18, Sunyani · GA-077-0418"
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy || !dirty || f.name.trim().length < 2}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-navy">
          Identity <span className="text-navy-3">· locked</span>
        </h2>
        <p className="mb-4 mt-0.5 text-sm text-navy-3">
          Set at onboarding. Changing these needs a Headmaster + GES code re-verification.
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          {[
            ["GES code", readOnly.gesCode, true],
            ["School type", readOnly.type, false],
            ["Region", readOnly.region, false],
            ["District", readOnly.district, false],
          ].map(([k, v, mono]) => (
            <div key={k as string}>
              <dt className="text-navy-3">{k}</dt>
              <dd className={`font-medium text-navy ${mono ? "font-mono" : ""}`}>
                {(v as string) || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
