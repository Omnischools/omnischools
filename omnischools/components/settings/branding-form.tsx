"use client";
import { useState } from "react";
/* eslint-disable @next/next/no-img-element */
import { useRouter } from "next/navigation";
import { uploadBrandingImage, updateSchoolBranding } from "@/lib/actions/settings";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

type Kind = "logo" | "stamp";

export function BrandingForm({
  initial,
  schoolName,
}: {
  initial: { logoUrl: string; stampUrl: string; brandColor: string };
  schoolName: string;
}) {
  const router = useRouter();
  const [logo, setLogo] = useState(initial.logoUrl);
  const [stamp, setStamp] = useState(initial.stampUrl);
  const [color, setColor] = useState(initial.brandColor);
  const [busy, setBusy] = useState<Kind | "color" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const swatch = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1A2B47";
  const initials = (schoolName.trim()[0] ?? "S").toUpperCase();

  async function onPick(kind: Kind, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(kind);
    setMsg(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const res = await uploadBrandingImage(fd);
    setBusy(null);
    if (res.ok && res.url) {
      if (kind === "logo") setLogo(res.url);
      else setStamp(res.url);
      setMsg({ ok: true, text: `${kind === "logo" ? "Logo" : "Stamp"} updated.` });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Upload failed." });
  }

  async function removeImg(kind: Kind) {
    setBusy(kind);
    setMsg(null);
    const res = await updateSchoolBranding(
      kind === "logo" ? { logoUrl: "" } : { stampUrl: "" },
    );
    setBusy(null);
    if (res.ok) {
      if (kind === "logo") setLogo("");
      else setStamp("");
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not remove." });
  }

  async function saveColor() {
    setBusy("color");
    setMsg(null);
    const res = await updateSchoolBranding({ brandColor: color });
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: "Colour saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  const uploader = (kind: Kind, url: string, isStamp: boolean) => (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="font-display text-base font-medium text-navy">
        {isStamp ? "Official stamp" : "School logo"}
      </div>
      <p className="mb-4 mt-0.5 text-[12px] text-navy-3">
        {isStamp
          ? "Appears on every generated PDF (statements, report cards)."
          : "Shown on receipts and announcements."}{" "}
        PNG, JPG, WebP or SVG · max 2 MB.
      </p>
      <div className="flex items-center gap-4">
        {url ? (
          <img
            src={url}
            alt={isStamp ? "Official stamp" : "School logo"}
            className={
              isStamp
                ? "h-20 w-20 rounded-full border border-border bg-bg object-contain p-1"
                : "h-16 w-auto max-w-[160px] rounded-md border border-border bg-bg object-contain p-1"
            }
          />
        ) : isStamp ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-2 text-[10px] text-navy-3">
            No stamp
          </div>
        ) : (
          <div
            className="flex h-16 w-16 items-center justify-center rounded-md font-display text-2xl font-semibold text-white"
            style={{ background: swatch }}
          >
            {initials}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label
            className={`cursor-pointer rounded-md bg-navy px-4 py-2 text-center text-sm font-semibold text-bg transition-colors hover:bg-navy-deep ${
              busy === kind ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {busy === kind ? "Uploading…" : url ? "Replace" : "Upload"}
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onPick(kind, e)}
            />
          </label>
          {url && (
            <button
              type="button"
              disabled={busy === kind}
              onClick={() => removeImg(kind)}
              className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {uploader("logo", logo, false)}
        {uploader("stamp", stamp, true)}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="font-display text-base font-medium text-navy">Brand colour</div>
        <p className="mb-3 mt-0.5 text-[12px] text-navy-3">
          An accent for your branded documents. App theming stays navy/gold.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={swatch}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border-2 bg-bg"
            aria-label="Brand colour picker"
          />
          <input
            className={`${fieldClass} max-w-[160px] font-mono uppercase`}
            value={color}
            placeholder="#1A2B47"
            maxLength={7}
            onChange={(e) => setColor(e.target.value)}
          />
          <button
            onClick={saveColor}
            disabled={busy === "color" || color === initial.brandColor}
            className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy === "color" ? "Saving…" : "Save colour"}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}
          role={msg.ok ? undefined : "alert"}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
