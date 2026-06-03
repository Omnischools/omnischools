"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "How long does it take to get a school up and running?",
    a: "For a standard basic school, two weeks from contract to go-live: one week loading your structure (classes, staff, students, fee schedule) and one week of paid-pilot use before the rest of the school migrates. For SHS with boarding, allow three to four weeks. We do the heavy lifting on data migration if you have an existing system.",
  },
  {
    q: "Does it work without good internet?",
    a: "Yes — the mobile apps for attendance and gradebook are offline-first: teachers mark a class register without a connection and it syncs when the school's WiFi or a phone's data comes back. The web admin needs a connection, but most daily-use surfaces work fine on intermittent connectivity. We designed for the reality of rural schools.",
  },
  {
    q: "Which mobile money providers do you support?",
    a: "MTN MoMo, Telecel Cash, and AirtelTigo Money, plus card and bank transfer. Payments reconcile in real-time and parents get an automatic receipt by SMS or WhatsApp. We process payments through a Bank of Ghana-licensed gateway.",
  },
  {
    q: "Where is our school's data stored?",
    a: "In data centres serving Ghana, governed by Ghana's Data Protection Act. We're registered with the Data Protection Commission, and named-record access — including by us, for support — is justification-gated and audit-logged.",
  },
  {
    q: "Is there a discount for small schools?",
    a: "The per-student price is the same, so a 60-pupil school pays for 60 pupils — there's no minimum that punishes small schools. Public basic schools partnering with GES through Oversight may also qualify for subsidised Basic licensing; ask us during the demo.",
  },
  {
    q: "How is Oversight different from the school products?",
    a: "Omnischools Basic and Senior run an individual school. Oversight is a separate product for GES that aggregates anonymised statistics across schools using the platform. It is provisioned through GES, not bought by a school, and is governed by a formal data-sharing agreement with strict aggregate-by-default rules.",
  },
  {
    q: "Does Omnischools replace STPSHS for SHS schools?",
    a: "No. STPSHS is WAEC's regulator ledger. Omnischools is the school's operating system underneath: the five-category in-term score ledger (assignments, mid-semester exam, end-of-semester exam, project work, portfolio) that produces those terminal figures, plus everything that depends on the same data. At term end Omnischools generates an STPSHS-ready printable score sheet from the ledger. If WAEC adds bulk-upload or API capability, the export becomes machine-to-machine.",
  },
  {
    q: "Can my teachers keep their paper score ledgers?",
    a: "Yes, completely. Omnischools supports three capture paths and the teacher chooses per (subject × class × semester). Path A auto-compiles the semester's scores from in-semester entries. Path B scans the teacher's existing paper ledger with verification-first OCR — every cell is teacher-confirmed before commit. Path C is direct digital entry. The paper ledger is a feature, not a transitional artifact.",
  },
  {
    q: "What about NaCCA's Subject Specific Apps (SSP) for lesson planning?",
    a: "SSP is NaCCA and CENDLOS's AI-assisted lesson-planning tools. It serves a different purpose than Omnischools: SSP is a productivity tool for the teacher's planning workflow, while Omnischools is the school's operating system for the operational workflow around students. We do not build a competing AI lesson-plan generator — that is NaCCA's domain. Where it helps, we link out to the official tools at curriculumresources.edu.gh.",
  },
];

export function Faq({ withHeading = true }: { withHeading?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" className="bg-surface border-t border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-24 md:px-8">
        {withHeading && (
          <div className="mx-auto mb-14 max-w-[640px] text-center">
            <div className="mb-[18px] inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
              Common questions
            </div>
            <h2 className="font-display text-[clamp(32px,4vw,46px)] font-semibold leading-tight text-navy">
              The things schools{" "}
              <em className="not-italic text-gold [font-style:italic]">actually ask</em>{" "}
              us.
            </h2>
          </div>
        )}
        <div className="mx-auto max-w-[820px] border-t border-border">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-b border-border">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left font-display text-[18px] font-semibold text-navy transition-colors hover:text-gold"
                >
                  {item.q}
                  <span
                    className={cn(
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-base font-bold transition-transform",
                      isOpen ? "rotate-45 bg-gold text-navy" : "bg-gold-bg text-gold",
                    )}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <p className="pb-6 text-[15px] leading-[1.65] text-navy-2">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
