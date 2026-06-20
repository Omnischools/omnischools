"use client";
import { useState } from "react";
/* eslint-disable @next/next/no-img-element */
import { useRouter } from "next/navigation";
import { updateSchoolBranding } from "@/lib/actions/settings";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

export function BrandingForm({
  initial,
  schoolName,
}: {
  initial: { logoUrl: string; stampUrl: string; brandColor: string };
  schoolName: string;
}) {
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
  const color = /^#[0-9a-fA-F]{6}$/.test(f.brandColor) ? f.brandColor : "#1A2B47";
  const initials = (schoolName.trim()[0] ?? "S").toUpperCase();

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateSchoolBranding(f);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      {/* Form */}
      <div className="space-y-5 rounded-xl border border-border bg-surface p-6">
        <div>
          <label className={labelClass}>Logo URL</label>
          <input
            className={fieldClass}
            value={f.logoUrl}
            placeholder="https://…/logo.png"
            onChange={(e) => set("logoUrl", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-navy-3">
            A hosted PNG/SVG. Shown on receipts and announcements. (Direct uploads come
            later — paste a link for now.)
          </p>
        </div>
        <div>
          <label className={labelClass}>Official stamp URL</label>
          <input
            className={fieldClass}
            value={f.stampUrl}
            placeholder="https://…/stamp.png"
            onChange={(e) => set("stampUrl", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-navy-3">
            Appears on every generated PDF (statements, report cards).
          </p>
        </div>
        <div>
          <label className={labelClass}>Brand colour</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => set("brandColor", e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border-2 bg-bg"
              aria-label="Brand colour picker"
            />
            <input
              className={`${fieldClass} font-mono uppercase`}
              value={f.brandColor}
              placeholder="#1A2B47"
              maxLength={7}
              onChange={(e) => set("brandColor", e.target.value)}
            />
          </div>
          <p className="mt-1 text-[11px] text-navy-3">
            Used as an accent on your branded documents. App theming stays navy/gold.
          </p>
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save branding"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
          Preview
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-navy-2">Logo</div>
            {isUrl(f.logoUrl) ? (
              <img
                src={f.logoUrl}
                alt="School logo"
                className="h-16 w-auto max-w-full rounded-md border border-border bg-bg object-contain p-1"
              />
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-md font-display text-2xl font-semibold text-white"
                style={{ background: color }}
              >
                {initials}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-navy-2">Stamp</div>
            {isUrl(f.stampUrl) ? (
              <img
                src={f.stampUrl}
                alt="Official stamp"
                className="h-20 w-20 rounded-full border border-border bg-bg object-contain p-1"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-2 text-[10px] text-navy-3">
                No stamp
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-navy-2">Accent</div>
            <div className="flex items-center gap-2">
              <span
                className="h-6 w-6 rounded-md border border-border"
                style={{ background: color }}
              />
              <span className="font-mono text-xs uppercase text-navy-2">{color}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
