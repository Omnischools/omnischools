import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing a school's use of Omnischools.",
};

// Document metadata — bump VERSION and EFFECTIVE_DATE when the copy is revised.
const EFFECTIVE_DATE = "20 July 2026";
const VERSION = "Draft v0.1 — pending legal review";

const CONTACT_EMAIL = "hello@omnischools.gh";

type Section = { h: string; body: React.ReactNode };

const sections: Section[] = [
  {
    h: "1. Agreement",
    body: (
      <p>
        These Terms of Service are a contract between [LEGAL ENTITY NAME] (&ldquo;Omnischools&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;), a company registered in Ghana, and the school that
        creates an account (&ldquo;you&rdquo;, &ldquo;your school&rdquo;). By creating a school on
        Omnischools and using the platform, your school and its authorised users agree to these
        Terms. If you are accepting on behalf of a school, you confirm you are authorised to bind
        that school.
      </p>
    ),
  },
  {
    h: "2. Your account and security",
    body: (
      <p>
        Each user signs in with their own phone number, using a one-time code or a password. You are
        responsible for keeping sign-in credentials secure, for ensuring only appropriate staff have
        accounts, and for activity carried out under your school&rsquo;s accounts. Notify us promptly
        of any unauthorised use.
      </p>
    ),
  },
  {
    h: "3. Acceptable use",
    body: (
      <p>
        You agree to use Omnischools only for the lawful administration of your school — managing
        students, staff, fees, attendance, grades and communications. You will not misuse the
        platform, attempt to access another school&rsquo;s data, send unlawful or unsolicited
        messages, or interfere with the platform&rsquo;s operation or security.
      </p>
    ),
  },
  {
    h: "4. Your data and our role",
    body: (
      <p>
        Your school owns the records it enters. For the data your school enters about students,
        guardians and applicants, your school is the data controller and we act as your{" "}
        <strong>data processor</strong> — we process that data only to provide the service, as set
        out in the{" "}
        <Link href="/privacy" className="font-semibold text-gold hover:underline">
          Privacy Policy
        </Link>
        . Each school&rsquo;s data is isolated from every other school&rsquo;s. You may export your
        data at any time.
      </p>
    ),
  },
  {
    h: "5. Subscription and fees",
    body: (
      <>
        <p>
          Omnischools is offered on a freemium basis. New schools begin with a 30-day free trial, and
          a free tier remains available. Paid tiers are charged per student for each academic period
          (per term, or per semester for senior schools), billed at the start of the period, with no
          setup fee and no per-user minimum. Prices are as shown on our pricing page and may change on
          reasonable notice.
        </p>
        <p className="mt-2">
          You can cancel at any time; your paid features continue until the end of the period you have
          paid for. Fees are exclusive of any taxes or levies that may apply. If a payment for a paid
          tier is not made when due, we may suspend paid features after notice, while leaving your
          data available for export. Subscription payments to Omnischools are made by [SUBSCRIPTION
          PAYMENT METHOD — placeholder].
        </p>
      </>
    ),
  },
  {
    h: "6. School and parent fees are separate",
    body: (
      <p>
        The fee structures, amounts and payment channels your school configures for its own parents
        are yours to set and collect. Omnischools facilitates record-keeping and, where enabled,
        reconciliation of payments made through a Bank of Ghana-licensed payment gateway; it is{" "}
        <strong>not a party</strong> to the fees owed between a school and its parents, and is not
        responsible for collecting them.
      </p>
    ),
  },
  {
    h: "7. Automated transcription of score sheets",
    body: (
      <p>
        Where a teacher photographs a handwritten score sheet, the platform may use a third-party
        artificial-intelligence service to transcribe the marks. The image is sent for that single
        transcription and is not stored by us afterwards. You are responsible for checking transcribed
        scores before they are relied upon.
      </p>
    ),
  },
  {
    h: "8. Availability and liability",
    body: (
      <p>
        We work to keep Omnischools available and accurate, but the service is provided on an
        &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis, without warranties of any kind. To
        the fullest extent permitted by Ghanaian law, we are not liable for indirect, incidental or
        consequential loss arising from use of the platform, and our total liability is limited to the
        fees your school paid to us in the twelve months before the claim.
      </p>
    ),
  },
  {
    h: "9. Suspension and termination",
    body: (
      <p>
        Either party may end this agreement. You may stop using the platform and close your account at
        any time. We may suspend or terminate access for a serious or repeated breach of these Terms,
        or for non-payment of a paid tier, giving reasonable notice where practicable. On termination
        you will have a reasonable window to export your data before it is removed.
      </p>
    ),
  },
  {
    h: "10. Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of the Republic of Ghana. The parties will try to resolve
        any dispute amicably; failing that, the dispute is subject to the exclusive jurisdiction of
        the courts of Ghana, sitting in [CITY / VENUE — placeholder].
      </p>
    ),
  },
  {
    h: "11. Changes",
    body: (
      <p>
        We may update these Terms as the platform evolves. Material changes will be communicated to
        school administrators. Continued use after a change takes effect constitutes acceptance.
      </p>
    ),
  },
  {
    h: "12. Contact",
    body: (
      <p>
        Questions about these Terms can be sent to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-gold hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Legal</div>
      <h1 className="font-display text-4xl font-semibold text-navy">
        Terms of <em className="not-italic text-gold [font-style:italic]">Service.</em>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-navy-3">
        The terms governing your school&rsquo;s use of Omnischools.
      </p>
      <p className="mt-2 text-[12px] text-navy-3">
        Effective {EFFECTIVE_DATE} · {VERSION}
      </p>

      <div className="mt-6 max-w-2xl rounded-lg border border-gold-soft bg-gold-bg px-4 py-3 text-[13px] leading-relaxed text-navy-2">
        <strong>Draft for review — not legal advice.</strong> This is a working draft grounded in how
        the platform operates. It must be reviewed by a qualified Ghanaian lawyer before it is
        published. Bracketed [ ] items are placeholders to be completed.
      </div>

      <div className="mt-10 space-y-7">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold text-navy">{s.h}</h2>
            <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-navy-2">{s.body}</div>
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
