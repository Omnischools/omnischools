import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Omnischools.",
};

const sections: { h: string; p: string }[] = [
  {
    h: "1. Agreement",
    p: "By creating a school on Omnischools and using the platform, the school and its authorised users agree to these Terms of Service. If you are accepting on behalf of a school, you confirm you are authorised to bind that school.",
  },
  {
    h: "2. Your account",
    p: "Each user signs in with their own phone number and credentials. You are responsible for keeping access credentials secure and for activity carried out under your account. Notify us promptly of any unauthorised use.",
  },
  {
    h: "3. Acceptable use",
    p: "You agree to use Omnischools only for the lawful administration of your school — managing students, staff, fees, attendance, grades and communications. You will not misuse the platform, attempt to access other schools' data, or interfere with its operation.",
  },
  {
    h: "4. Your data",
    p: "Your school owns the records it enters. We process them on your behalf to provide the service, under the Privacy Policy. Each school's data is isolated from every other school's. You may export your data at any time.",
  },
  {
    h: "5. Fees & billing",
    p: "Fee structures, amounts and payment channels you configure are yours to set and collect. Omnischools facilitates record-keeping and, where enabled, payment reconciliation; it is not a party to the fees owed between a school and its parents.",
  },
  {
    h: "6. Availability",
    p: "We work to keep Omnischools available and accurate, but the service is provided on an “as is” basis. We are not liable for indirect or consequential loss arising from use of the platform, to the extent permitted by Ghanaian law.",
  },
  {
    h: "7. Changes",
    p: "We may update these terms as the platform evolves. Material changes will be communicated to school administrators. Continued use after a change constitutes acceptance.",
  },
  {
    h: "8. Contact",
    p: "Questions about these terms can be sent to hello@omnischools.gh.",
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
        Legal
      </div>
      <h1 className="font-display text-4xl font-semibold text-navy">
        Terms of <em className="not-italic text-gold [font-style:italic]">Service.</em>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-navy-3">
        A plain-language summary of how Omnischools may be used. This is a starting template —
        replace with your reviewed legal copy before launch.
      </p>

      <div className="mt-10 space-y-7">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold text-navy">{s.h}</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-navy-2">{s.p}</p>
          </section>
        ))}
      </div>

      <div className="mt-12 border-t border-border pt-6 text-sm text-navy-3">
        See also the{" "}
        <Link href="/privacy" className="font-semibold text-gold hover:underline">
          Privacy Policy
        </Link>
        .
      </div>
    </main>
  );
}
