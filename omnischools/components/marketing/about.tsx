import Image from "next/image";

export function About() {
  return (
    <section id="about" className="relative">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-6 py-24 md:grid-cols-[1fr_1.05fr] md:gap-20 md:px-8">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-gold-soft bg-gold-bg">
          <Image
            src="/img/about-headmaster.png"
            alt="A Ghanaian headmaster in a kente-patterned shirt reviewing student records at his desk computer."
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
          <span className="bg-navy-deep/55 absolute bottom-3 right-3.5 rounded-pill px-2.5 py-1 text-[10px] italic text-white/85 backdrop-blur">
            illustration · AI-generated
          </span>
        </div>
        <div>
          <div className="mb-[18px] inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            About Omnischools
          </div>
          <h2 className="mb-[22px] font-display text-[clamp(32px,4vw,46px)] font-semibold leading-tight text-navy">
            Built <em className="not-italic text-gold [font-style:italic]">here</em>, for
            the way schools work here.
          </h2>
          <div className="space-y-4 text-base leading-[1.7] text-navy-2">
            <p>
              Most school management systems are designed somewhere else, then translated
              — fees in dollars, terms that don&apos;t match ours, gradebooks that have
              never heard of BECE. Omnischools is the opposite: every workflow was
              designed against how a Ghanaian school actually runs, then the software was
              built to match.
            </p>
            <p>
              That means{" "}
              <b className="font-semibold text-navy">
                mobile money is a first-class payment method, not an add-on
              </b>
              . It means the gradebook understands a WASSCE qualification rate, not just
              an American GPA. It means attendance can be taken on a phone with patchy
              data and sync later. And it means the data stays in Ghana, governed by
              Ghanaian law.
            </p>
            <p>
              Three products, one platform:{" "}
              <b className="font-semibold text-navy">Basic</b> for KG/Primary/JHS,{" "}
              <b className="font-semibold text-navy">Senior</b> for SHS with boarding, and{" "}
              <b className="font-semibold text-navy">Oversight</b> — the GES dashboard
              that lets districts, regions and the Ministry see the system whole.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
