import {
  buttonTypeLabel,
  fillSampleValues,
  type TemplateShape,
} from "@/lib/whatsapp-templates";

/**
 * A read-only WhatsApp message-bubble preview. Renders the composed header /
 * body / footer / buttons with `{variables}` swapped for their sample values.
 * The WhatsApp greens come from --wa-green / --wa-bg (scoped tokens, applied via
 * arbitrary-value classes — never slash-opacity on the brand tokens).
 */
export function WhatsAppTemplatePreview({ t }: { t: TemplateShape }) {
  const body = fillSampleValues(t.body, t.sampleValues);
  const headerText = fillSampleValues(t.headerText, t.sampleValues);

  return (
    <div className="rounded-2xl border border-border bg-[#ece5dd] p-4">
      <div className="mx-auto max-w-sm">
        <div className="relative rounded-xl rounded-tl-sm bg-surface p-3 shadow-sm">
          {/* Header */}
          {t.headerType === "TEXT" && headerText && (
            <div className="mb-1 font-display text-[15px] font-semibold text-navy">
              {headerText}
            </div>
          )}
          {t.headerType === "IMAGE" && (
            <div className="mb-2 flex h-28 items-center justify-center rounded-lg bg-bg text-xs font-semibold uppercase tracking-[0.12em] text-navy-3">
              Image header
            </div>
          )}
          {t.headerType === "DOCUMENT" && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-bg px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-terra-bg text-xs font-semibold text-terra">
                PDF
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-navy-2">
                {t.headerFilename || "document.pdf"}
              </span>
            </div>
          )}

          {/* Body */}
          {body ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-navy">
              {body}
            </p>
          ) : (
            <p className="text-sm italic text-navy-3">Your message body appears here…</p>
          )}

          {/* Footer */}
          {t.footer && (
            <p className="mt-1.5 text-[11px] leading-snug text-navy-3">{t.footer}</p>
          )}

          {/* Sent time chrome */}
          <div className="mt-1 text-right text-[10px] text-navy-3">12:04 ✓✓</div>
        </div>

        {/* Buttons — WhatsApp renders these as tappable rows under the bubble */}
        {t.buttons.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {t.buttons.map((b, i) => (
              <div
                key={i}
                className="rounded-xl bg-surface py-2 text-center text-sm font-semibold text-[color:var(--wa-green)] shadow-sm"
              >
                <span className="mr-1.5 text-navy-3" aria-hidden>
                  {b.type === "URL" ? "↗" : b.type === "PHONE" ? "☏" : "↩"}
                </span>
                {b.label || buttonTypeLabel(b.type)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
