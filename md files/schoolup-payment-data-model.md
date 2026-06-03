# Omnischools · Payment data model

Designed for MVP1 (manual entry) with MVP2 (aggregator integration) baked in. Building this shape now means MVP2 ships as a webhook handler and a reconciliation report — no migrations, no breaking changes.

## Guiding principles

1. **Payment is a first-class entity,** not a property of an invoice.
2. **Allocation is a separate concern** from the payment itself. One payment can settle many invoices; one invoice can receive many payments.
3. **Settlement and recording are different.** A payment can be recorded immediately (Omnischools sees it) while still pending settlement (money hasn't reached the school's bank). Both states must be representable.
4. **Idempotency is non-negotiable.** Webhooks retry. The same payment must never be recorded twice.
5. **Audit trail is append-only.** Mistakes are corrected by adding void + correction entries, never by silent edits.

---

## Core tables

### `payments`

A payment is an inbound flow of money toward a student's outstanding invoices. One payment = one transaction (one MoMo TXN, one cash handover, one bank transfer).

```
payments
├── id                       UUID, primary key
├── school_id                FK → schools (multi-tenant scoping)
├── student_id               FK → students (the payment is FOR this student)
├── recorded_by_user_id      FK → users (who entered it; null for webhook entries)
├── recorded_via             enum: manual | webhook | api | import
│
├── gross_amount             decimal(12,2), NOT NULL
├── fee_amount               decimal(12,2), default 0    -- aggregator fee
├── net_amount               decimal(12,2), NOT NULL     -- what hits school's account
├── currency                 char(3), default 'GHS'
│
├── method                   enum: mtn_momo | telecel_cash | airteltigo_money
│                                  | bank_transfer | cash | cheque | other
├── method_reference         varchar(120)                -- TXN ID, cheque #, etc.
├── method_phone             varchar(20)                 -- for mobile money
├── method_bank              varchar(80)                 -- for bank transfer
│
├── aggregator               enum: hubtel | paystack | flutterwave | korba | null
├── aggregator_txn_id        varchar(120)                -- unique per aggregator
├── aggregator_status        enum: pending | confirmed | failed | reversed | null
│
├── settlement_status        enum: pending | confirmed | settled | reconciled | disputed
├── settlement_expected_at   timestamp                   -- T+1 for MoMo
├── settled_at               timestamp                   -- when bank confirmed
│
├── paid_at                  timestamp, NOT NULL         -- when parent paid
├── recorded_at              timestamp, NOT NULL         -- when entered into Omnischools
├── voided_at                timestamp                   -- nullable; void marker
├── voided_by_user_id        FK → users
├── void_reason              text
│
├── note                     text                        -- internal admin note
└── metadata                 jsonb                       -- aggregator payload, anything else
```

**Constraints**

- Unique constraint on `(school_id, aggregator, aggregator_txn_id)` where `aggregator_txn_id` is not null — this is the idempotency lock for webhooks.
- `gross_amount = fee_amount + net_amount` — enforced in code, not SQL (some methods have no fee).
- A voided payment is read-only; allocations are reversed via `payment_allocations.voided_at`.

### `payment_allocations`

How a payment's amount gets distributed across one or more invoices. This is the MVP1 multi-line allocation table, but it's also the bedrock for MVP2 credit balances.

```
payment_allocations
├── id                       UUID, primary key
├── payment_id               FK → payments
├── invoice_id               FK → invoices (nullable — see below)
├── allocation_type          enum: invoice | credit | refund
├── amount                   decimal(12,2), NOT NULL
├── allocated_at             timestamp, NOT NULL
├── allocated_by_user_id     FK → users (null for auto-allocations)
├── allocation_method        enum: manual | auto_oldest_first | auto_newest_first
├── voided_at                timestamp                   -- if reallocated later
└── void_reason              text
```

**Why three allocation types**

- `invoice` — the standard case. Amount applied to a specific invoice.
- `credit` — overpayment going to student's credit balance. Invoice_id is null. (MVP2 only — the column exists in MVP1 unused.)
- `refund` — credit being paid back out. Negative amount. (MVP2.)

**Constraints**

- Sum of non-voided allocations for a payment ≤ payment's net_amount.
- An allocation against an invoice must not push that invoice's paid amount above its billed amount (with discount applied).

### `invoices`

The bill issued to a student for a term. Largely unchanged from any reasonable schema, but I'm including it so the relationships are clear.

```
invoices
├── id                       UUID, primary key
├── school_id                FK → schools
├── student_id               FK → students
├── invoice_number           varchar(40)                 -- INV-2026-0184
├── academic_year            varchar(20)
├── term_id                  FK → terms
│
├── subtotal_amount          decimal(12,2)               -- before discounts
├── discount_amount          decimal(12,2), default 0
├── discount_tier_id         FK → discount_tiers, nullable
├── billed_amount            decimal(12,2)               -- subtotal - discount
├── paid_amount              decimal(12,2), default 0    -- denormalised; sum of allocations
├── balance_amount            decimal(12,2)              -- billed - paid; computed or stored
│
├── status                   enum: draft | issued | partial | paid | overdue
│                                  | exempt | voided
├── issued_at                timestamp
├── due_at                   timestamp
├── paid_at                  timestamp                   -- when balance hit 0
└── voided_at                timestamp
```

**Note on denormalisation**

`paid_amount` and `balance_amount` are derived from `payment_allocations`, but storing them on the invoice makes the billing list query 100x faster. The trade-off: every allocation insert/void must update its parent invoice in the same transaction. Worth it.

### `invoice_line_items`

Each invoice's breakdown — Tuition, Transport, Books, etc. Mostly relevant for receipt generation.

```
invoice_line_items
├── id                       UUID
├── invoice_id               FK → invoices
├── fee_category_id          FK → fee_categories
├── description              varchar(120)
├── amount                   decimal(12,2)
└── is_optional              boolean
```

### `receipts`

Generated when a payment is recorded successfully. One receipt per payment (covers all that payment's allocations).

```
receipts
├── id                       UUID
├── school_id                FK → schools
├── payment_id               FK → payments (1:1)
├── receipt_number           varchar(40)                 -- RCT-2026-0541
├── student_id               FK → students
├── pdf_url                  text                        -- S3 / storage URL
├── generated_at             timestamp
├── voided_at                timestamp
└── void_replacement_id      FK → receipts, nullable     -- new receipt after void
```

### `payment_audit_log`

Append-only history of everything that happened to a payment. Backbone of trust.

```
payment_audit_log
├── id                       UUID
├── school_id                FK → schools
├── payment_id               FK → payments
├── invoice_id               FK → invoices, nullable     -- if scoped to an allocation
├── event_type               enum: created | allocation_added | allocation_voided
│                                   | settled | voided | sms_sent | sms_failed
│                                   | reconciliation_matched | reconciliation_disputed
│                                   | discount_overridden | refunded
├── actor_user_id            FK → users, nullable        -- null for system events
├── actor_type               enum: admin | system | webhook | reconciliation_job
├── before_state             jsonb                       -- snapshot before
├── after_state              jsonb                       -- snapshot after
├── notes                    text
└── created_at               timestamp
```

### `webhook_events` (MVP2 — exists as empty table in MVP1)

Inbound webhooks from aggregators. Stored before processing so retries are idempotent.

```
webhook_events
├── id                       UUID
├── school_id                FK → schools, nullable      -- determined during processing
├── aggregator               enum: hubtel | paystack | flutterwave | korba
├── event_type               varchar(80)                 -- payment.success, etc.
├── aggregator_event_id      varchar(120)                -- unique per aggregator
├── payload                  jsonb, NOT NULL
├── signature                text                        -- HMAC for verification
├── signature_verified       boolean
│
├── processing_status        enum: received | processing | processed | failed | ignored
├── attempt_count            int, default 0
├── last_attempted_at        timestamp
├── last_error               text
├── matched_payment_id       FK → payments, nullable     -- if this webhook created/matched a payment
│
├── received_at              timestamp
└── processed_at             timestamp
```

**Constraint:** unique on `(aggregator, aggregator_event_id)`. Same webhook never inserted twice.

### `aggregator_accounts` (MVP2)

A school's connection to a payment aggregator.

```
aggregator_accounts
├── id                       UUID
├── school_id                FK → schools
├── aggregator               enum: hubtel | paystack | flutterwave | korba
├── account_name             varchar(120)
├── api_key_encrypted        text                        -- encrypted at rest
├── webhook_secret_encrypted text
├── merchant_id              varchar(80)
├── settlement_account_iban  varchar(40)                 -- where money lands
├── settlement_account_bank  varchar(80)
├── is_active                boolean
├── connected_at             timestamp
└── last_settlement_at       timestamp
```

### `reconciliation_runs` (MVP2)

Daily job that compares aggregator's confirmed list against Omnischools's recorded list.

```
reconciliation_runs
├── id                       UUID
├── school_id                FK → schools
├── aggregator_account_id    FK → aggregator_accounts
├── period_start             timestamp
├── period_end               timestamp
├── aggregator_total         decimal(12,2)
├── schoolup_total           decimal(12,2)
├── matched_count            int
├── unmatched_aggregator     int           -- in aggregator, not in Omnischools
├── unmatched_schoolup       int           -- in Omnischools, not in aggregator
├── status                   enum: clean | discrepancies | failed
├── report_url               text          -- generated PDF/CSV
└── completed_at             timestamp
```

---

## Key flows

### Manual entry (MVP1)

1. Admin opens drawer, picks student, enters amount, selects method, fills in TXN ID
2. Admin allocates amount across one or more open invoices
3. On submit:
   - INSERT into `payments` with `recorded_via='manual'`, `aggregator=null`, `settlement_status='pending'`
   - INSERT one row per allocation into `payment_allocations`
   - UPDATE each affected invoice's `paid_amount`, `balance_amount`, `status`
   - INSERT into `payment_audit_log` event_type='created'
   - Generate receipt PDF, INSERT into `receipts`
   - Trigger SMS to guardian (separate `sms_log` table; success/failure becomes audit entries)

### Webhook entry (MVP2)

1. Aggregator POSTs webhook to `/webhooks/{aggregator}/payment`
2. Server verifies signature, INSERTs into `webhook_events` with `processing_status='received'`
3. Background worker picks up the event:
   - Looks up student by phone or by reference encoded in payment description
   - Checks for existing payment with same `aggregator_txn_id` (idempotency)
   - If new: creates payment with `recorded_via='webhook'`, auto-allocates oldest-first
   - If duplicate: marks webhook `processing_status='ignored'`, no-op
4. Updates `webhook_events.processing_status='processed'`, links `matched_payment_id`

### Settlement reconciliation (MVP2)

1. Daily job fetches aggregator's settlement list for the prior day
2. For each settlement: find matching payment by `aggregator_txn_id`, update `settled_at` and `settlement_status='settled'`
3. Discrepancies (aggregator says paid but no Omnischools record, or vice versa) get logged in `reconciliation_runs`
4. Admin sees a report on the billing page; resolves manually

### Voiding a payment

1. Admin clicks "Void payment" in the audit log of the recorded entry
2. Required: void_reason. System enforces this.
3. UPDATE `payments.voided_at`, `voided_by_user_id`, `void_reason`
4. UPDATE all that payment's `payment_allocations.voided_at`
5. Recompute affected invoices' `paid_amount`, `balance_amount`, `status`
6. Mark receipt as voided; if a replacement payment is recorded, link via `void_replacement_id`
7. INSERT audit entries for the void itself

---

## What MVP1 must implement

The minimum that makes the MVP2 transition free:

**Required schemas (built and used):**

- `payments` — all columns above, including the aggregator_* columns left null for manual entries
- `payment_allocations` — built and used for multi-line in the drawer
- `invoices`, `invoice_line_items` — already required
- `receipts` — generated on manual entry
- `payment_audit_log` — appending entries on every state change

**Required schemas (built but mostly empty):**

- `webhook_events` — table exists, no rows yet
- `aggregator_accounts` — table exists, no rows yet
- `reconciliation_runs` — table exists, no rows yet

**Code patterns (built into MVP1 architecture):**

- Idempotency wrapper around payment creation. Even manual entries pass through it; future webhooks plug in for free.
- Allocation logic encapsulated in a service, not duplicated across drawer code and (future) webhook code.
- Receipt generation triggered by a payment-created event, not by the drawer's submit button. Webhook payments emit the same event later.
- SMS notification triggered by the same event.

---

## What MVP2 adds without migration

- Webhook handler endpoints (one per aggregator)
- Background worker to process `webhook_events`
- Daily reconciliation job
- Aggregator account connection screen in school settings
- Parent-app payment flow (calls aggregator's payment-init API, redirects to MoMo prompt)
- Settlement status surfaced on the billing page (pending vs. settled)
- `credit` and `refund` allocation types come alive
- Failed-webhook admin alert UI

The payments table doesn't change. The allocations table doesn't change. The receipt template doesn't change. That's the whole point.

---

## Reconciliation: what to commit to in MVP1

Even without aggregator integration, the manual-entry drawer should populate `settlement_status` properly:

- Cash payment → `settlement_status='settled'` immediately, `settled_at=paid_at`. Money is already in the school's hand.
- Bank transfer (manual entry) → `settlement_status='confirmed'`, no `settled_at` until admin verifies the bank deposit. (Optional MVP1 feature: a separate "Mark as settled" action.)
- MoMo (manual entry) → `settlement_status='confirmed'`, no `settled_at`. In MVP2 this updates automatically when the daily reconciliation job runs.

This means in MVP1, the billing page can already show "GHS 12,400.00 confirmed but not yet settled" — useful information for headmistresses tracking cash flow, even without the aggregator.

---

## Open questions worth deciding now

1. **Currency handling.** Hardcoded GHS for MVP1, or build for currency-per-school from day one? My take: hardcoded GHS, but the column exists. Multi-currency is a v3 problem.

2. **Discount as a fee adjustment vs. a separate ledger entry.** Currently modelled as `invoices.discount_amount`. Alternative: store discount as a synthetic negative-amount line item in `invoice_line_items`. Latter is cleaner for receipts but harder to query for reports. Sticking with the current shape unless you push back.

3. **Partial allocation policy.** If admin enters GHS 440.00 but only allocates GHS 400.00, do we reject the submit, or save the unallocated GHS 60.00 as a pending credit? MVP1: reject. MVP2: save as credit. The drawer's "Unallocated: GHS 0.00" summary is designed to make this visible.

4. **Receipt mutability.** A voided payment's receipt is also voided. If a corrected payment is recorded after, does it get a new receipt number, or reuse the old one with a "v2" suffix? My take: new number, link via `void_replacement_id`. Auditors prefer this.

5. **Multi-tenant isolation.** Every table has `school_id` and every query is scoped. Suggested implementation: row-level security in Postgres, or app-layer enforcement via a base query class. Either works; pick one and commit.
