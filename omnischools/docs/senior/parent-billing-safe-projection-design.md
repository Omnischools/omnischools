# INCR-BILL — Parent Billing ("Fees") tab · approved safe-projection design

**Status:** owner-approved (design-first checkpoint). Route `/statement`, tab label **"Fees"** (7th parent tab; both `/billing` and `/fees` are staff routes). This is the deferred R476 full-billing view (the PTA increment used a dues bridge + deferred paid/outstanding — un-deferred here).

## Owner decisions
- **Mechanism = narrow `parent_scope` grants (option a)**, NOT the SECURITY DEFINER projection (Wells recommended b for money; owner chose a — consistent with attendance/sickbay). ⇒ the reader PROJECTION is the sole column guard; grants must be **READ-ONLY** (a parent must never forge a payment/invoice).
- **v1 scope = FULL**: own-child line-item breakdown + payments/receipts history + multi-child aggregate.

## RLS (Wells, prod-paste-0095) — the 9th boundary widening (parent_readable 25 → 29)
READ-ONLY own-child `parent_scope` (SELECT + write-denied) on exactly four tables:
`invoice`, `invoice_line_item` (via own-child invoice), `payment`, `receipt` — each `student_id IN parent_student_ids(school, pu)` (line_item via invoice), tenant-fenced, `pu IS NULL OR …`. **A parent can SELECT but NOT INSERT/UPDATE/DELETE** (forging a payment is the attack — Wells proves write-denial non-superuser + a scripts/rls-test.ts probe).
**NEVER widen (stay parent_deny — structural half of the security):** `payment_allocation`, `invoice_discount_application`, `discount`, `discount_tier`, `fee_structure`, `fee_structure_item`, `fee_category`, `payment_audit_log`.

## Reader (`lib/parent/parent-billing-data.ts`) — the column guard
`loadParentBilling` under `withParentScope` only. Reads students (own children) + invoice (+ academic_period for the term label — parent-readable since #278) + invoice_line_item + payment (leftJoin receipt). Excludes DRAFT + VOIDED invoices. Multi-child: own children only; household sibling discount surfaces as the net `billed` per child (never another child's amount or the rank).

**Exposed safe field-set** (the frozen projection):
- Per invoice: `invoiceNumber`, `termLabel` + `academicYear`, `billed`, `paid`, `outstanding` (=billed−paid, must equal stored balance), `discount` scalar (only when > 0), `status` (Paid/Partly paid/Unpaid/Overdue/Covered=EXEMPT), `dueLabel`, `lineItems[{description, amount, isOptional}]`.
- Per child: name, studentCode, billed/paid/outstanding totals.
- Per receipt: date, method label, gross amount, receiptNumber, `/r/{token}` link (existing code-gated page), voided/refunded label.
- Aggregate: totalOutstanding across own children.

**Deny-list — NEVER selected** (RLS opens the row; the projection is the only column guard): `payment.{netAmount,feeAmount,aggregator,settlementStatus,methodReference,currency,recordedByUserId,voidedByUserId,voidReason}`, `invoice.{subtotalAmount, void internals}`, `receipt.{pdfUrl}`, and every never-widen table.

## UI (`app/(parent)/statement/page.tsx`) — READ-ONLY, no gateway
Balance triad per child + aggregate strip (when >1 child); invoice cards (term/number/due, line-item breakdown, billed/paid/balance, discount line, status pill); payments & receipts list (linking to `/r/{token}`); a "how to pay" OFFLINE note (MoMo/bank/office) — **no "Pay now", no gateway** (never provisioned; `payment.aggregator` null in MVP1). Honest empties (no linked child → NoChild; child with no invoices → honest empty; paid-up → "GHS 0.00 — paid up", never blank).

## OC decisions (owner-approved defaults)
- Line items: **SHOW** own-child breakdown (owner picked full scope). *Known minor:* a PTA-dues line item (the `pta_dues_charge`→`invoice_line_item` bridge) can appear here AND on the PTA tab — shown honestly by description in v1; exclude-or-label is a fast-follow.
- Payments/receipts: **SHOW**. Amount = **gross** (tendered, matches the receipt). method_reference **hidden** in the list (still on the receipt PDF).
- Multi-child: **SHOW** aggregate + per-child.
- Discount: **net scalar only**; mechanic/rank structurally denied.
- Void: voided **invoices** excluded; voided/refunded **payments** shown labelled (reconcile with a held receipt); the balance nets voids via the denormalised invoice fields.
- Term label: shown via `academic_period` (parent-readable since #278), not year-only.
- OC-BILL-RECEIPT-PDF: the linked `/r/{token}` PDF (shipped) shows the cashier name + ref — a normal physical-receipt convention; left unchanged. The in-app tab's deny-list is intentionally tighter.

Sources: Kofi R486–R493 / AC-BILL-01..26, Lucy surface synthesis + SHOW/OMIT table, Wells mechanism proposal + feasibility — in the session transcript.
