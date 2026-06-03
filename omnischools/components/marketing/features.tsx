const FEATURES = [
  {
    icon: "A",
    title: "Admissions & enrolment",
    body: "Online applications, document upload, approval workflow, automatic student ID assignment. From form-fill to first day, digitised.",
  },
  {
    icon: "F",
    title: "Fees & mobile money",
    body: "MoMo, bank transfer, card. Invoices, partial payments, exemptions, real-time reconciliation, parent receipts — built for Ghana's payment reality.",
  },
  {
    icon: "G",
    title: "Gradebook & transcripts",
    body: "Termly assessments, weighted grading, automatic report cards, BECE and WASSCE cohort tracking. Continuous performance, not just terminal exams.",
  },
  {
    icon: "T",
    title: "Attendance & timetable",
    body: "Class registers on mobile, parent alerts for absences, conflict-aware timetable builder. Designed for offline-friendly use in low-connectivity areas.",
  },
  {
    icon: "C",
    title: "Communication",
    body: "SMS, WhatsApp, in-app messaging. School-wide announcements, class groups, parent notifications — broadcast or one-to-one, all from one inbox.",
  },
  {
    icon: "B",
    title: "Books & finance",
    body: "Income, expenses, fixed assets, financial reports. Built around how a Ghanaian school's accountant actually does the books, not a generic ledger.",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-surface border-y border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-24 md:px-8">
        <div className="mb-16 max-w-[760px]">
          <div className="mb-[18px] inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            What&apos;s inside
          </div>
          <h2 className="mb-[18px] font-display text-[clamp(32px,4vw,46px)] font-semibold leading-tight text-navy">
            Every module a Ghanaian school{" "}
            <em className="not-italic text-gold [font-style:italic]">actually needs</em> —
            and none it doesn&apos;t.
          </h2>
          <p className="text-[17px] leading-relaxed text-navy-2">
            One platform that runs the whole school day, from admissions to results. Each
            module works on its own, and they all talk to each other.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-7 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-bg rounded-[14px] border border-border px-7 py-8 transition-all hover:-translate-y-0.5 hover:border-gold-soft hover:shadow-md"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-navy font-display text-[18px] font-semibold italic text-gold-soft">
                {f.icon}
              </div>
              <h3 className="mb-2.5 font-display text-[19px] font-semibold text-navy">
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-navy-2">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
