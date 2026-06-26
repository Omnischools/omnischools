# Senior-tier backlog (deferred from the Basic build)

When auditing the planned `Surfaces/*.html` against the live Basic-tier (KG · Primary ·
JHS) build, several surfaces turned out to be **Senior (SHS) / MVP2** designs. They are
intentionally **not** built in the current Basic product. This file records what was
deferred, page by page, so a future Senior MVP can pick them up. The Basic build keeps a
clean black-&-gold hero header on every page; nothing below blocks Basic use.

_Last updated: app hero-header sweep (classes · fees · admissions · billing · gradebook ·
communication · inbox)._

## Classes
Related surfaces (`schoolup-shs-class-roster.html`, `schoolup-class-roster-shs-variant.html`)
are **SHS**. Deferred:
- House column + 6-colour House dots; right-rail House distribution bars.
- Programme chips (General Arts / Science / Business / Agric).
- Dual-axis "class × House" sort; Programmes / Houses nav.

_Basic provision now: none needed — the Basic class list (name · level · class teacher ·
size · timetable) is complete._

## Admissions
Related surfaces (`schoolup-shs-student-admission.html`, `schoolup-shs-bulk-admission.html`)
are **SHS / CSSPS**. Deferred:
- Bulk CSSPS intake (paste-from-portal / CSV / PDF, ~240 students in one atomic commit).
- 17-day Free-SHS countdown card.
- BECE index / CSSPS placement-number verification + auto pre-fill.
- Programme picker (Science / Arts / Business / Agric) with capacity.
- House + residency (boarding / day) assignment; placed-no-show reconciliation.
- Horizontal stage progress.

_Basic provision now: none — the Basic public-application-link → review → enrol flow is
complete._

## Gradebook
Related surfaces (`schoolup-shs-score-ledger.html`, `schoolup-shs-score-ledger-pwa.html`)
are **SHS**. Deferred:
- 5-category NaCCA ledger grid (Basic uses the CA + Exam two-weight model).
- WASSCE / aggregate performance-band chart + legend.
- "Three ways" entry, incl. photograph paper book → OCR extract → verify cell-by-cell
  (low-confidence "?" cells); category-as-you-go.
- PWA phone frame + offline / online sync strip.
- Semester (vs term) framing.

_Basic provision now: none — the CA/Exam weighted grid + report cards cover Basic._

## Communication
Related surfaces are mostly covered in Basic (`schoolup-announcements.html`,
`schoolup-sms-library.html` → announcements composer + SMS + reusable template library +
delivery log all shipped). Deferred:
- **WhatsApp channel** (`schoolup-whatsapp-template-authoring.html`): Meta Business
  connection + template-approval workflow. Basic is SMS-only.
- Announcement **read-receipts** (per-parent read tracking). Basic tracks SENT/FAILED only.

## Inbox
Basic two-way SMS inbox (list · open-count · last-message preview · assignee pill ·
new-conversation · inbound webhook) is shipped. Deferred:
- **WhatsApp channel** (`schoolup-whatsapp-inbox.html`): WhatsApp threads.
- **Routing & assignment** (`schoolup-inbox-routing.html`): rules engine (top-to-bottom
  evaluation + fallback), thread reassignment flow, team / unassigned / assigned-to-you
  buckets. Basic has a single per-conversation assignee pill only.
- Topic-tagging of conversations; read receipts.

## Fees / Billing
No Senior deferrals — `schoolup-record-payment-drawer.html`, `schoolup-receipt-pdf.html`,
`schoolup-collection-trend.html` and `schoolup-discount-management.html` are all
Basic-tier and already implemented (the per-student `/fees/[id]` route holds the
record-payment drawer + receipt; `/billing` holds fee structures + discounts).
