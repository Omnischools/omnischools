import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Omnischools collects, uses and protects school data under Ghana's Data Protection Act, 2012 (Act 843).",
};

// Document metadata — bump VERSION and EFFECTIVE_DATE when the copy is revised.
const EFFECTIVE_DATE = "20 July 2026";
const VERSION = "Draft v0.1 — pending legal review";

const CONTACT_EMAIL = "hello@omnischools.gh";

type Section = { h: string; id?: string; body: React.ReactNode };

const sections: Section[] = [
  {
    h: "1. Who we are, and our two roles",
    body: (
      <>
        <p>
          Omnischools is a school-management platform operated by [LEGAL ENTITY NAME], a company
          registered in Ghana (registration no. [COMPANY REG NO.]), of [REGISTERED OFFICE ADDRESS]
          (&ldquo;Omnischools&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains how
          personal data is handled on the platform. It is written to align with Ghana&rsquo;s Data
          Protection Act, 2012 (Act 843).
        </p>
        <p className="mt-2">
          We act in <strong>two different roles</strong>, and your rights depend on which applies:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>As a data processor</strong>, for the records a school enters about its
            students, guardians and applicants. The <em>school</em> is the data controller — it
            decides what to collect and why, and it is responsible for having a lawful basis. We
            process that data <em>only</em> on the school&rsquo;s instructions, to provide the
            service.
          </li>
          <li>
            <strong>As a data controller</strong>, for a narrower set of data we decide the purposes
            of ourselves: the account details of staff who sign in (name, phone, email, role),
            platform usage and security logs, and enquiries submitted through our marketing or demo
            forms.
          </li>
        </ul>
      </>
    ),
  },
  {
    h: "2. The data we handle, and whose it is",
    body: (
      <>
        <p>
          A school&rsquo;s use of Omnischools involves the following categories of personal data.
          Much of it concerns <strong>children</strong>, and some of it is{" "}
          <strong>sensitive</strong> (health and financial information).
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Students (minors):</strong> name, date of birth, sex, student ID, class,
            programme, enrolment status and boarding/residency details.
          </li>
          <li>
            <strong>Student health records (sensitive):</strong> blood group, allergies, chronic
            conditions, current medications, and an emergency contact — where a school chooses to
            record them.
          </li>
          <li>
            <strong>Guardians / parents:</strong> name, relationship, phone number and email.
          </li>
          <li>
            <strong>Applicants:</strong> the details submitted on an admission application (child
            and guardian) and any supporting-document references.
          </li>
          <li>
            <strong>Academic records:</strong> attendance (including reason codes such as medical or
            excused), gradebook scores, report cards and, for senior schools, the score ledger.
          </li>
          <li>
            <strong>Financial records:</strong> invoices, payments, receipts and discounts recorded
            against a student.
          </li>
          <li>
            <strong>Staff:</strong> profile details (which may include date of birth, gender,
            address, emergency contact and qualifications) and, where a school uses it, compensation
            information (salary, SSNIT and PAYE figures).
          </li>
          <li>
            <strong>Communications:</strong> the phone numbers, message content and delivery logs of
            SMS and in-app messages a school sends or receives through the platform.
          </li>
          <li>
            <strong>Account &amp; security data (we control):</strong> the name, phone, email and
            role of each user who signs in, and audit logs of actions taken — which include the
            actor, timestamp, and the IP address and browser (user-agent) of the request.
          </li>
        </ul>
      </>
    ),
  },
  {
    h: "3. How and why we use it",
    body: (
      <p>
        We use this data solely to provide the service to your school: to display your records,
        generate report cards, invoices and receipts, send the SMS and messages you initiate,
        produce the reports you request, authenticate the people who sign in, and keep the platform
        secure. <strong>We do not sell your data, and we do not use it for advertising.</strong> We
        do not use the personal data a school enters to train artificial-intelligence models.
      </p>
    ),
  },
  {
    h: "4. The service providers we share data with",
    body: (
      <>
        <p>
          To run the platform we rely on a small number of trusted providers (&ldquo;sub-processors&rdquo;).
          Each receives only the data it needs for its function, and only to help us deliver the
          service:
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-navy-3">
                <th className="py-2 pr-4 font-semibold">Provider</th>
                <th className="py-2 pr-4 font-semibold">Purpose</th>
                <th className="py-2 font-semibold">Data shared</th>
              </tr>
            </thead>
            <tbody className="align-top text-navy-2">
              <tr className="border-b border-border">
                <td className="py-2 pr-4 font-semibold text-navy">Supabase</td>
                <td className="py-2 pr-4">Database, authentication and file storage</td>
                <td className="py-2">All platform data; phone numbers for sign-in (hosted in the EU — see section 5)</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4 font-semibold text-navy">Vercel</td>
                <td className="py-2 pr-4">Application hosting</td>
                <td className="py-2">Processes requests to the platform; does not retain your records</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4 font-semibold text-navy">Hubtel (and the SMS provider for sign-in codes)</td>
                <td className="py-2 pr-4">Delivering SMS messages and one-time sign-in codes</td>
                <td className="py-2">Recipient phone number and the message content being sent</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4 font-semibold text-navy">Resend</td>
                <td className="py-2 pr-4">Sending transactional email (e.g. staff invitations)</td>
                <td className="py-2">Recipient email address and message content</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2 pr-4 font-semibold text-navy">Anthropic</td>
                <td className="py-2 pr-4">Reading handwritten score sheets a teacher photographs, to transcribe the marks</td>
                <td className="py-2">The photograph and class roster, sent for that single transcription; the image is not stored by us or retained for model training</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-semibold text-navy">Error &amp; usage analytics</td>
                <td className="py-2 pr-4">Diagnosing faults and understanding usage (only if enabled)</td>
                <td className="py-2">Not currently enabled; when enabled, would carry error context and usage events, not your student records</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-navy-3">
          We keep this list current; we will give schools notice before adding a sub-processor that
          materially changes how data is handled.
        </p>
      </>
    ),
  },
  {
    h: "5. Where your data is stored, and cross-border transfer",
    body: (
      <p>
        Your data is currently hosted by Supabase in a data centre in the{" "}
        <strong>European Union (London region)</strong>, chosen for proximity to Ghana. This means
        personal data is transferred outside Ghana for storage and processing. We rely on the
        provider&rsquo;s contractual and technical safeguards for that transfer, consistent with the
        cross-border-transfer provisions of Act 843. If we change where data is hosted, we will
        update this policy.
      </p>
    ),
  },
  {
    h: "6. Children&rsquo;s data and lawful basis",
    body: (
      <p>
        Much of the data on the platform concerns children. Because we act as a{" "}
        <strong>processor</strong> for that data, each school is responsible for having a lawful
        basis to collect and enter it — including obtaining parental or guardian consent where the
        law requires it — and for telling parents how their child&rsquo;s data is used. We handle
        children&rsquo;s data only as needed to provide the service to the school. Guardians can be
        invited to view their own child&rsquo;s records; they cannot see other students.
      </p>
    ),
  },
  {
    h: "7. Your rights under Act 843",
    id: "data-protection",
    body: (
      <>
        <p>
          Under Ghana&rsquo;s Data Protection Act, 2012 (Act 843), individuals have rights over their
          personal data, including the right to be informed, to access their data, to correct
          inaccurate data, to object to processing, and to request deletion.
        </p>
        <p className="mt-2">
          Because a school is usually the data <strong>controller</strong> for student, guardian and
          staff records, requests about that data are normally directed to the school, and we will
          assist the school in responding. For data we control (your sign-in account and enquiries
          you send us), you can contact us directly at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-gold hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-2">
          You may also lodge a complaint with Ghana&rsquo;s Data Protection Commission, the
          supervisory authority for Act 843. Our data-protection contact is [DPO / CONTACT NAME], and
          our registration with the Data Protection Commission is [DPC REGISTRATION NUMBER — or
          &ldquo;in progress&rdquo;].
        </p>
      </>
    ),
  },
  {
    h: "8. Retention, deletion and export",
    body: (
      <p>
        We keep your data for as long as your school uses Omnischools. Each school can set a
        retention preference in its settings; today that preference is{" "}
        <strong>recorded for compliance but not yet enforced automatically</strong> — automatic
        purging is planned for a future release, and until then nothing is deleted on a schedule. You
        can export your key records (students, staff and fee structures) to CSV at any time, and you
        can ask us to delete your data when you leave the platform. When a school&rsquo;s account is
        closed, its records — including students, guardians, health, financial, academic,
        communications and audit data — are removed.
      </p>
    ),
  },
  {
    h: "9. How we protect your data",
    body: (
      <>
        <p>
          We design the platform to keep each school&rsquo;s data separate and to limit who can see
          what:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Strict tenant isolation.</strong> Every school&rsquo;s records are separated at
            the database level using row-level security, enforced so that a query without the correct
            school context returns nothing rather than another school&rsquo;s data. Records are also
            keyed so that a reference across two schools is not structurally possible.
          </li>
          <li>
            <strong>Role-based access.</strong> Staff see only what their role allows within their own
            school; finance roles are confined to billing, and students and parents cannot reach staff
            areas.
          </li>
          <li>
            <strong>Auditing.</strong> Changes are recorded in an append-only audit log capturing who
            did what and when.
          </li>
          <li>
            <strong>Encryption in transit.</strong> Data is encrypted while travelling between your
            device and the platform. Data at rest is protected by the encryption our hosting provider
            applies at the storage layer.{" "}
            <span className="text-navy-3">
              We do not currently apply additional field-level encryption to individual columns such
              as health or salary data.
            </span>
          </li>
        </ul>
        <p className="mt-2">
          No system can be guaranteed perfectly secure, but we take reasonable measures to protect
          against unauthorised access, consistent with Act 843.
        </p>
      </>
    ),
  },
  {
    h: "10. Cookies and sessions",
    body: (
      <p>
        When you sign in, we use a session cookie to keep you signed in. It is necessary for the
        service to work and is not used for advertising or cross-site tracking.
      </p>
    ),
  },
  {
    h: "11. Changes and contact",
    body: (
      <p>
        We may update this policy as the platform evolves; we will communicate material changes to
        school administrators. Privacy questions or data requests can be sent to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-gold hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Legal</div>
      <h1 className="font-display text-4xl font-semibold text-navy">
        Privacy <em className="not-italic text-gold [font-style:italic]">Policy.</em>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-navy-3">
        How school data is collected, used and protected on Omnischools, under Ghana&rsquo;s Data
        Protection Act, 2012 (Act 843).
      </p>
      <p className="mt-2 text-[12px] text-navy-3">
        Effective {EFFECTIVE_DATE} · {VERSION}
      </p>

      <div className="mt-6 max-w-2xl rounded-lg border border-gold-soft bg-gold-bg px-4 py-3 text-[13px] leading-relaxed text-navy-2">
        <strong>Draft for review — not legal advice.</strong> This is a working draft grounded in how
        the platform operates. It must be reviewed by a qualified Ghanaian lawyer, and registration
        with the Data Protection Commission confirmed, before it is published. Bracketed [ ] items
        are placeholders to be completed.
      </div>

      <div className="mt-10 space-y-7">
        {sections.map((s) => (
          <section key={s.h} id={s.id}>
            <h2 className="font-display text-lg font-semibold text-navy">{s.h}</h2>
            <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-navy-2">{s.body}</div>
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
