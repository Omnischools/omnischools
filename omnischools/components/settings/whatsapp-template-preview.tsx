import {
  fillSampleValues,
  fillSampleSegments,
  type TemplateShape,
} from "@/lib/whatsapp-templates";

/**
 * A design-faithful WhatsApp message preview, rendered on the real WhatsApp chat
 * background (#E5DDD5). It reproduces the surface conventions: a chat header with
 * the school avatar + green verified badge, the white message card (with a DOCUMENT
 * / TEXT / IMAGE header block), the body with each `{variable}` replaced by its
 * sample value and highlighted in a gold chip, a small grey footer, WhatsApp-blue
 * (#027EB5) action buttons, and a "10:24 AM ✓✓" time row with light-blue (#34B7F1)
 * read ticks.
 *
 * The WhatsApp brand colours are set with explicit hex arbitrary-value classes
 * (never slash-opacity on custom tokens); the gold variable highlight uses the real
 * gold-bg / navy tokens.
 */

/** School initials for the avatar (e.g. "Christ the King JHS" → "CK"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const buttonIcon = (type: string): string =>
  type === "URL" ? "↗" : type === "PHONE" ? "📞" : "↩";

export function WhatsAppTemplatePreview({
  t,
  schoolName = "Your school",
}: {
  t: TemplateShape;
  schoolName?: string;
}) {
  const bodySegments = fillSampleSegments(t.body, t.sampleValues);
  const headerText = fillSampleValues(t.headerText, t.sampleValues);
  const filename = fillSampleValues(t.headerFilename, t.sampleValues);
  const activeButtons = t.buttons.filter((b) => (b.label ?? "").trim());

  return (
    <div className="rounded-2xl bg-[#E5DDD5] px-4 pb-6 pt-5">
      {/* Chat header */}
      <div className="mb-3.5 flex items-center gap-2.5 border-b border-[rgba(0,0,0,0.08)] pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-display text-[13px] font-semibold text-gold">
          {initials(schoolName)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-navy">
            <span className="truncate">{schoolName}</span>
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#25A859] text-[9px] font-bold text-white">
              ✓
            </span>
          </div>
          <div className="text-[11px] text-navy-3">Business · online</div>
        </div>
      </div>

      {/* Message card */}
      <div className="mr-8 overflow-hidden rounded-lg bg-white shadow-sm">
        {/* Header block */}
        {t.headerType === "DOCUMENT" && (
          <div className="flex items-center gap-2.5 border-b border-[rgba(0,0,0,0.04)] bg-[#e7f5ec] px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-terra font-display text-[11px] font-bold text-white">
              PDF
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-navy">
                {filename || "document.pdf"}
              </div>
              <div className="mt-0.5 text-[10px] text-navy-3">218 KB · PDF document</div>
            </div>
          </div>
        )}
        {t.headerType === "TEXT" && headerText && (
          <div className="px-3 pt-2.5 text-[15px] font-semibold text-navy">
            {headerText}
          </div>
        )}
        {t.headerType === "IMAGE" && (
          <div className="flex h-28 items-center justify-center bg-bg text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
            Image header
          </div>
        )}

        {/* Body with highlighted variables */}
        <div className="whitespace-pre-wrap break-words px-3 pb-1 pt-2.5 text-[13px] leading-snug text-navy">
          {bodySegments.length > 0 ? (
            bodySegments.map((seg, i) =>
              seg.filled ? (
                <span key={i} className="rounded-[3px] bg-gold-bg px-1 text-navy">
                  {seg.text}
                </span>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )
          ) : (
            <span className="italic text-navy-3">Your message body appears here…</span>
          )}
        </div>

        {/* Footer */}
        {t.footer && (
          <div className="px-3 pb-2 pt-1 text-[10px] text-navy-3">{t.footer}</div>
        )}

        {/* Time row */}
        <div className="flex items-center justify-end gap-1 px-2.5 pb-1.5 text-[10px] text-navy-3">
          10:24 AM <span className="font-bold text-[#34B7F1]">✓✓</span>
        </div>

        {/* Action buttons */}
        {activeButtons.length > 0 && (
          <div className="border-t border-[rgba(0,0,0,0.06)]">
            {activeButtons.map((b, i) => (
              <button
                key={i}
                type="button"
                className={`flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-medium text-[#027EB5] ${
                  i > 0 ? "border-t border-[rgba(0,0,0,0.06)]" : ""
                }`}
              >
                <span aria-hidden className="text-[11px]">
                  {buttonIcon(b.type)}
                </span>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
