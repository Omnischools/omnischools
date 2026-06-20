import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Omnischools collects, uses and protects school data.",
};

const sections: { h: string; p: string }[] = [
  {
    h: "1. What we collect",
    p: "To run a school we store the records you enter — student and guardian details, staff profiles, classes and subjects, attendance, grades, fees and payments, and communications sent through the platform. We also collect basic account data (name, phone, role) for the people who sign in.",
  },
  {
    h: "2. How we use it",
    p: "Data is used solely to provide the service to your school: showing your records, generating report cards and invoices, sending the SMS and messages you initiate, and producing the reports you ask for. We do not sell your data or use it for advertising.",
  },
  {
    h: "3. Tenant isolation",
    p: "Each school's data is logically isolated. Row-level security ensures one school can never read or write another school's records. Staff only see the data their role grants within their own school.",
  },
  {
    h: "4. Guardians & minors",
    p: "Much of the data concerns children. Schools are responsible for having a lawful basis to enter student data. Guardians can be invited to view their own child's records; they do not see other students.",
  },
  {
    h: "5. SMS & communications",
    p: "When you send messages, the recipient's phone number is shared with our SMS provider only to deliver that message. Message content you compose is stored so you have a record of what was sent.",
  },
  {
    h: "6. Retention & export",
    p: "We keep your data for as long as your school uses Omnischools, plus any period set by your retention policy. You can export your records at any time, and request deletion when you leave the platform.",
  },
  {
    h: "7. Security",
    p: "Data is encrypted in transit. Access is limited to authorised staff and audited. We follow reasonable measures to protect against unauthorised access, consistent with Ghana's Data Protection Act.",
  },
  {
    h: "8. Contact",
    p: "Privacy questions or data requests can be sent to hello@omnischools.gh.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
        Legal
      </div>
      <h1 className="font-display text-4xl font-semibold text-navy">
        Privacy <em className="not-italic text-gold [font-style:italic]">Policy.</em>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-navy-3">
        How school data is collected, used and protected on Omnischools. This is a starting
        template — replace with your reviewed legal copy before launch.
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
        <Link href="/terms" className="font-semibold text-gold hover:underline">
          Terms of Service
        </Link>
        .
      </div>
    </main>
  );
}
