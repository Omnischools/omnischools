import Link from "next/link";
import Image from "next/image";

const TRUST = [
  { val: "3", em: true, suffix: " products", label: "Basic · Senior · Oversight" },
  { val: "KG–SHS", label: "Every level, one platform" },
  { val: "Ghana-first", label: "Built here, hosted here, WAEC + NaCCA-aligned" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-[120px] pt-20 md:px-8">
      <div className="mx-auto grid max-w-[1280px] items-center gap-16 md:grid-cols-[1fr_1.05fr]">
        <div>
          <div className="mb-[22px] flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
            <span className="h-[1.5px] w-7 bg-gold" />
            Built for Ghana · KG through SHS
          </div>
          <h1 className="mb-6 font-display text-[clamp(40px,5.5vw,68px)] font-semibold leading-[1.05] tracking-[-0.02em] text-navy">
            The school management system{" "}
            <em className="font-medium not-italic text-gold [font-style:italic]">
              schools actually run on.
            </em>
          </h1>
          <p className="mb-9 max-w-[520px] text-lg leading-relaxed text-navy-2">
            Omnischools brings admissions, fees, attendance, performance and parent
            communication into{" "}
            <b className="font-semibold text-navy">one warm, careful platform</b> —
            designed for Ghanaian basic and senior high schools, by people who know the
            work.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/start"
              className="text-bg inline-flex items-center justify-center rounded-[10px] bg-navy px-7 py-3.5 text-[15px] font-semibold transition-colors hover:bg-navy-deep"
            >
              Start your school free
            </Link>
            <Link
              href="/contact"
              className="border-border-2 hover:bg-surface inline-flex items-center justify-center rounded-[10px] border px-7 py-3.5 text-[15px] font-semibold text-navy transition-colors"
            >
              Book a demo →
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-8 border-t border-border pt-6">
            {TRUST.map((t) => (
              <div key={t.label}>
                <div className="font-display text-[26px] font-semibold leading-none text-navy">
                  {t.em ? (
                    <em className="not-italic text-gold [font-style:italic]">{t.val}</em>
                  ) : (
                    t.val
                  )}
                  {t.suffix}
                </div>
                <div className="mt-1.5 max-w-[160px] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-navy-3">
                  {t.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl border border-gold-soft bg-gold-bg">
            <Image
              src="/img/hero-students.png"
              alt="Two Ghanaian primary school students in yellow uniform reading together at their desk, smiling."
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
            <span className="bg-navy-deep/55 absolute bottom-3 right-3.5 rounded-pill px-2.5 py-1 text-[10px] italic text-white/85 backdrop-blur">
              illustration · AI-generated
            </span>
          </div>
          <div className="bg-surface absolute -bottom-8 -left-8 z-[3] hidden max-w-[240px] rounded-2xl border border-border px-[22px] py-[18px] shadow-lg md:block">
            <div className="font-display text-[28px] font-semibold leading-none text-navy">
              <em className="not-italic text-gold [font-style:italic]">Mobile money</em>{" "}
              native
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-navy-3">
              MTN MoMo · Telecel Cash · AirtelTigo Money · fees reconciled in real time,
              parents receipted by SMS the moment payment lands
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
