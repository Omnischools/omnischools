# Omnischools — Privacy Policy

**Effective:** 20 July 2026 · **Version:** Draft v0.1 — pending legal review

> **Draft for review — not legal advice.** This is a working draft grounded in how the
> Omnischools platform actually operates (data model, sub-processors, security). It must be
> reviewed by a qualified Ghanaian lawyer, and registration with the Data Protection Commission
> confirmed, before it is published. Items in `[SQUARE BRACKETS]` are placeholders to be
> completed by the business.

This policy explains how personal data is handled on Omnischools. It is written to align with
Ghana's **Data Protection Act, 2012 (Act 843)**.

## 1. Who we are, and our two roles

Omnischools is a school-management platform operated by `[LEGAL ENTITY NAME]`, a company
registered in Ghana (registration no. `[COMPANY REG NO.]`), of `[REGISTERED OFFICE ADDRESS]`
("Omnischools", "we", "us").

We act in **two different roles**, and your rights depend on which applies:

- **As a data processor** — for the records a school enters about its students, guardians and
  applicants. The *school* is the data controller; it decides what to collect and why, and is
  responsible for having a lawful basis. We process that data **only on the school's instructions**,
  to provide the service.
- **As a data controller** — for a narrower set of data whose purposes we decide ourselves: the
  account details of staff who sign in (name, phone, email, role), platform usage and security logs,
  and enquiries submitted through our marketing or demo forms.

## 2. The data we handle, and whose it is

A school's use of Omnischools involves the following categories. Much of it concerns **children**,
and some is **sensitive** (health and financial information).

- **Students (minors):** name, date of birth, sex, student ID, class, programme, enrolment status,
  boarding/residency details.
- **Student health records (sensitive):** blood group, allergies, chronic conditions, medications,
  emergency contact — where a school records them.
- **Guardians / parents:** name, relationship, phone, email.
- **Applicants:** admission-application details (child and guardian) and supporting-document references.
- **Academic records:** attendance (including reason codes such as medical/excused), gradebook
  scores, report cards and, for senior schools, the score ledger.
- **Financial records:** invoices, payments, receipts and discounts recorded against a student.
- **Staff:** profile details (which may include date of birth, gender, address, emergency contact,
  qualifications) and, where used, compensation information (salary, SSNIT, PAYE).
- **Communications:** phone numbers, message content and delivery logs of SMS and in-app messages.
- **Account & security data (we control):** the name, phone, email and role of each user who signs
  in, and audit logs of actions taken — including the actor, timestamp, IP address and browser
  (user-agent) of the request.

## 3. How and why we use it

We use this data solely to provide the service: to display your records, generate report cards,
invoices and receipts, send the SMS and messages you initiate, produce the reports you request,
authenticate users, and keep the platform secure. **We do not sell your data, and we do not use it
for advertising.** We do not use the personal data a school enters to train AI models.

## 4. The service providers we share data with

We rely on a small number of trusted providers ("sub-processors"). Each receives only the data it
needs, and only to help us deliver the service:

| Provider | Purpose | Data shared |
|---|---|---|
| **Supabase** | Database, authentication, file storage | All platform data; phone numbers for sign-in (hosted in the EU — see §5) |
| **Vercel** | Application hosting | Processes requests; does not retain your records |
| **Hubtel** (and the SMS provider for sign-in codes) | Delivering SMS and one-time sign-in codes | Recipient phone number and message content |
| **Resend** | Transactional email (e.g. staff invitations) | Recipient email and message content |
| **Anthropic** | Transcribing photographed handwritten score sheets | The photograph and class roster, sent for a single transcription; the image is not stored by us or used for model training |
| **Error & usage analytics** | Diagnosing faults, understanding usage (only if enabled) | Not currently enabled; when enabled, error context and usage events — not student records |

We keep this list current and will notify schools before adding a sub-processor that materially
changes how data is handled.

## 5. Where your data is stored, and cross-border transfer

Your data is currently hosted by Supabase in the **European Union (London region)**, chosen for
proximity to Ghana. This means personal data is transferred outside Ghana for storage and
processing. We rely on the provider's contractual and technical safeguards for that transfer,
consistent with the cross-border-transfer provisions of Act 843. If we change where data is hosted,
we will update this policy.

> **[Reconcile before launch]** Any public claim that data is "resident in Ghana" (e.g. marketing
> copy) must be reconciled with EU hosting, or the hosting changed.

## 6. Children's data and lawful basis

Much of the data concerns children. Because we act as a **processor** for that data, each school is
responsible for having a lawful basis to collect and enter it — including obtaining parental or
guardian consent where the law requires — and for informing parents how their child's data is used.
Guardians can be invited to view only their own child's records.

## 7. Your rights under Act 843 {#data-protection}

Under the Data Protection Act, 2012 (Act 843), individuals have rights over their personal data,
including the rights to be informed, to access, to correct inaccurate data, to object to processing,
and to request deletion.

Because a school is usually the **controller** for student, guardian and staff records, requests
about that data are normally directed to the school, and we assist the school in responding. For
data we control (your sign-in account and enquiries you send us), contact us at
**hello@omnischools.gh**.

You may also complain to Ghana's **Data Protection Commission**, the supervisory authority for Act
843. Our data-protection contact is `[DPO / CONTACT NAME]`, and our registration with the Data
Protection Commission is `[DPC REGISTRATION NUMBER — or "in progress"]`.

## 8. Retention, deletion and export

We keep your data for as long as your school uses Omnischools. Each school can set a retention
preference in settings; today that preference is **recorded for compliance but not yet enforced
automatically** — automatic purging is planned for a future release, and until then nothing is
deleted on a schedule. You can export key records (students, staff, fee structures) to CSV at any
time, and ask us to delete your data when you leave. When an account is closed, its records —
students, guardians, health, financial, academic, communications and audit data — are removed.

## 9. How we protect your data

- **Strict tenant isolation** — every school's records are separated at the database level using
  row-level security, enforced so a query without the correct school context returns nothing rather
  than another school's data. Records are keyed so a cross-school reference is not structurally
  possible.
- **Role-based access** — staff see only what their role allows within their own school; finance
  roles are confined to billing; students and parents cannot reach staff areas.
- **Auditing** — changes are recorded in an append-only audit log (who, what, when).
- **Encryption in transit** — data is encrypted between your device and the platform. Data at rest is
  protected by the encryption our hosting provider applies at the storage layer. *We do not currently
  apply additional field-level encryption to individual columns such as health or salary data.*

No system is perfectly secure, but we take reasonable measures against unauthorised access,
consistent with Act 843.

## 10. Cookies and sessions

When you sign in, we use a session cookie to keep you signed in. It is necessary for the service and
is not used for advertising or cross-site tracking.

## 11. Changes and contact

We may update this policy as the platform evolves and will communicate material changes to school
administrators. Privacy questions or data requests: **hello@omnischools.gh**.
