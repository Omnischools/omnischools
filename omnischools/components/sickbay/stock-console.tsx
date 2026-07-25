"use client";
/**
 * Sickbay setup §3 (SHS module 4.4 / INCR-24a) — standing orders · drug stock · controlled-substance
 * register. Ported from `schoolup-sickbay-setup.html` §3 (555–704) via
 * docs/senior/sickbay-medication-surface-map.md §A, built to the rulings.
 *
 * Client component: PLAIN SERIALIZABLE props only — the view types from `@/lib/sickbay/stock`, never a
 * `*-reads` module (the readers live behind `import "server-only"`). Write affordances render only when
 * `canWrite` (SICKBAY_STOCK_WRITE_ROLES = [ADMIN, MATRON], R165) — a HEADMASTER reads every row and sees
 * no CTA; every server action re-checks the gate, so a hand-crafted POST is refused too.
 *
 * 🔴 Risk 4 (R162): NO student anywhere on this screen — a drug beside a student is a re-identification,
 * and the ADMIN can read this page. The stock row is form + quantity; the register is drug · type ·
 * qty · date · actor · witness.
 *
 * Token discipline (repo memory `no-alpha-token-opacity`): every fill is a solid token or a dedicated
 * `-bg` tint — zero slash-opacity (`bg-terra/60` renders NOTHING on a raw-hex token and `next build`
 * passes anyway).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createStandingOrder,
  createStockItem,
  editStandingOrder,
  editStockItem,
  recordControlledMovement,
  setStandingOrderActive,
} from "@/lib/actions/sickbay-stock";
import type {
  ControlledBlockView,
  ControlledMovementView,
  StandingOrderView,
  StockItemView,
  StockStatus,
} from "@/lib/sickbay/stock";

interface Clinician {
  id: string;
  name: string;
}

export interface StockConsoleProps {
  canWrite: boolean;
  standingOrders: StandingOrderView[];
  stock: StockItemView[];
  reorderCount: number;
  controlled: ControlledBlockView[];
  /** Witness candidates for a controlled wastage — MATRON candidates; the action enforces the N&MC licence. */
  clinicians: Clinician[];
}

type ActionResult = { ok: boolean; error?: string };

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";
const BTN_PRIMARY =
  "rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50";
const BTN_GHOST =
  "rounded-md border border-border-2 bg-surface px-3.5 py-[7px] text-[11px] font-semibold text-navy";
const ADD_LINK =
  "inline-flex items-center gap-2 rounded-lg border border-dashed border-gold px-3.5 py-2.5 text-[11px] font-semibold text-gold";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  };
  return { run, pending, error, setError };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
        {label}
      </span>
      {children}
    </label>
  );
}

const fmtDate = (d: Date | null): string =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
const toInputDate = (d: Date | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function StockConsole(props: StockConsoleProps) {
  return (
    <div className="px-6 pb-4 md:px-9">
      {/* ═══ §3 head — derived reorder count (N-DIV-1), the fabricated "3" does not render ═══ */}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <span className="text-gold">Sickbay</span> / Setup / Standing orders &amp; stock
      </div>
      <h2 className="font-display text-[24px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        Standing orders &amp; <em className="font-normal italic text-gold">stock</em>
      </h2>
      <p className="mt-1 max-w-[760px] text-[13px] leading-[1.6] text-navy-3">
        First-line treatments the Matron is cleared to administer without doctor sign-off · plus the
        master drug stock register ·{" "}
        <b className="font-semibold text-navy-2">
          {props.reorderCount} item{props.reorderCount === 1 ? "" : "s"} below reorder point
        </b>
      </p>

      <StandingOrders
        canWrite={props.canWrite}
        orders={props.standingOrders}
      />
      <StockRegister canWrite={props.canWrite} items={props.stock} />
      <ControlledRegister
        canWrite={props.canWrite}
        blocks={props.controlled}
        controlledFlagged={props.stock.some((s) => s.isControlled)}
        clinicians={props.clinicians}
      />
    </div>
  );
}

/* ────────────────────────────── standing orders ────────────────────────────── */

function StandingOrders({ canWrite, orders }: { canWrite: boolean; orders: StandingOrderView[] }) {
  const { run, pending, error, setError } = useRun();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section id="standing-orders" className="mt-9 scroll-mt-24">
      <h3 className="font-display text-[16px] font-semibold text-navy">
        <em className="font-normal italic text-gold">Standing orders</em> · what the Matron treats
        without escalation
      </h3>
      <p className="mt-2 max-w-[760px] text-[12px] leading-[1.6] text-navy-3">
        These are the first-line treatments registered with the visiting doctor under N&amp;MC scope of
        practice. Anything outside this list waits for the visiting doctor — or escalates to referral.
      </p>

      {error && <ErrorLine>{error}</ErrorLine>}

      {orders.length === 0 && !adding ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-[12px] text-navy-3">
          No standing orders registered.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
          {orders.map((o) =>
            editingId === o.id ? (
              <StandingOrderForm
                key={o.id}
                initial={o}
                pending={pending}
                onCancel={() => {
                  setError(null);
                  setEditingId(null);
                }}
                onSubmit={(values) =>
                  run(() => editStandingOrder({ ...values, id: o.id }), () => setEditingId(null))
                }
              />
            ) : (
              <div
                key={o.id}
                className={`rounded-lg border border-border bg-bg px-[14px] py-[10px] ${
                  o.active ? "" : "opacity-60"
                }`}
              >
                <div className="font-display text-[13px] font-semibold tracking-[-0.005em] text-navy">
                  {o.complaint}
                  {!o.active && (
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.08em] text-navy-3">
                      inactive
                    </span>
                  )}
                </div>
                <div className="mt-[3px] text-[11px] leading-[1.5] text-navy-2">{o.treatment}</div>
                {o.escalation && (
                  <div className="mt-[3px] text-[11px] italic leading-[1.5] text-navy-3">
                    Escalation: {o.escalation}
                  </div>
                )}
                {o.orderedByDoctorName && (
                  <div className="mt-[3px] text-[10px] italic text-navy-3">
                    Ordered by {o.orderedByDoctorName}
                  </div>
                )}
                {canWrite && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-gold"
                      onClick={() => {
                        setError(null);
                        setEditingId(o.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className="text-[10px] font-semibold text-navy-3 disabled:opacity-50"
                      onClick={() =>
                        run(() => setStandingOrderActive({ id: o.id, active: !o.active }))
                      }
                    >
                      {o.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {canWrite &&
        (adding ? (
          <div className="mt-3">
            <StandingOrderForm
              pending={pending}
              onCancel={() => {
                setError(null);
                setAdding(false);
              }}
              onSubmit={(values) => run(() => createStandingOrder(values), () => setAdding(false))}
            />
          </div>
        ) : (
          <button type="button" className={`mt-3 ${ADD_LINK}`} onClick={() => setAdding(true)}>
            <Plus /> Add standing order
          </button>
        ))}
    </section>
  );
}

type StandingOrderValues = {
  complaint: string;
  treatment: string;
  escalation: string | null;
  orderedByDoctorName: string | null;
  active: boolean;
};

function StandingOrderForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: StandingOrderView;
  pending: boolean;
  onSubmit: (v: StandingOrderValues) => void;
  onCancel: () => void;
}) {
  const [complaint, setComplaint] = useState(initial?.complaint ?? "");
  const [treatment, setTreatment] = useState(initial?.treatment ?? "");
  const [escalation, setEscalation] = useState(initial?.escalation ?? "");
  const [doctor, setDoctor] = useState(initial?.orderedByDoctorName ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="grid grid-cols-1 gap-2.5">
        <Field label="Complaint">
          <input className={FIELD} value={complaint} onChange={(e) => setComplaint(e.target.value)} />
        </Field>
        <Field label="Treatment">
          <textarea
            className={FIELD}
            rows={2}
            value={treatment}
            onChange={(e) => setTreatment(e.target.value)}
          />
        </Field>
        <Field label="Escalation (optional)">
          <input className={FIELD} value={escalation} onChange={(e) => setEscalation(e.target.value)} />
        </Field>
        <Field label="Ordered by (doctor · optional)">
          <input className={FIELD} value={doctor} onChange={(e) => setDoctor(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={BTN_PRIMARY}
          onClick={() =>
            onSubmit({
              complaint,
              treatment,
              escalation: escalation.trim() || null,
              orderedByDoctorName: doctor.trim() || null,
              active,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────── stock register ────────────────────────────── */

function StockRegister({ canWrite, items }: { canWrite: boolean; items: StockItemView[] }) {
  const { run, pending, error, setError } = useRun();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section id="stock" className="mt-10 scroll-mt-24">
      <h3 className="font-display text-[16px] font-semibold text-navy">
        Drug stock register · {items.length} item{items.length === 1 ? "" : "s"}
      </h3>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Item", "In stock", "Reorder at", "Last restocked", "Status"].map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-border-2 bg-bg px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-[12px] text-navy-3">
                  No stock items yet.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className={`border-b border-border last:border-b-0 ${it.active ? "" : "opacity-60"}`}>
                  <td className="px-3 py-2.5 align-middle text-[12px]">
                    <b className="font-semibold text-navy">{it.drugName}</b>
                    {(it.formLabel || it.unit) && (
                      <span className="mt-px block text-[10px] italic text-navy-3">
                        {[it.formLabel, it.unit].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {it.isControlled && <ControlledPill />}
                  </td>
                  <td className="px-3 py-2.5 text-right align-middle font-mono text-[12px] font-semibold text-navy">
                    {it.qtyOnHand}
                    {it.unit ? <span className="text-navy-3"> {it.unit}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right align-middle font-mono text-[12px] text-navy-2">
                    {it.reorderPoint ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right align-middle font-mono text-[12px] text-navy-2">
                    {fmtDate(it.lastRestockedAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right align-middle">
                    <StatusPill status={it.status} />
                    {canWrite && (
                      <button
                        type="button"
                        className="ml-2 text-[10px] font-semibold text-gold"
                        onClick={() => {
                          setError(null);
                          setEditingId(it.id);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canWrite && editingId && (
        <div className="mt-3">
          <StockItemForm
            initial={items.find((i) => i.id === editingId)}
            pending={pending}
            onCancel={() => {
              setError(null);
              setEditingId(null);
            }}
            onSubmit={(values) =>
              run(() => editStockItem({ ...values, id: editingId }), () => setEditingId(null))
            }
          />
        </div>
      )}

      {canWrite &&
        !editingId &&
        (adding ? (
          <div className="mt-3">
            <StockItemForm
              pending={pending}
              onCancel={() => {
                setError(null);
                setAdding(false);
              }}
              onSubmit={(values) => run(() => createStockItem(values), () => setAdding(false))}
            />
          </div>
        ) : (
          <button type="button" className={`mt-3 ${ADD_LINK}`} onClick={() => setAdding(true)}>
            <Plus /> Add item
          </button>
        ))}
    </section>
  );
}

type StockValues = {
  drugName: string;
  formLabel: string | null;
  unit: string | null;
  qtyOnHand: number;
  reorderPoint: number | null;
  isControlled: boolean;
  lastRestockedAt: string | null;
  active: boolean;
};

function StockItemForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: StockItemView;
  pending: boolean;
  onSubmit: (v: StockValues) => void;
  onCancel: () => void;
}) {
  const [drugName, setDrugName] = useState(initial?.drugName ?? "");
  const [formLabel, setFormLabel] = useState(initial?.formLabel ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [qty, setQty] = useState(String(initial?.qtyOnHand ?? 0));
  const [reorder, setReorder] = useState(initial?.reorderPoint == null ? "" : String(initial.reorderPoint));
  const [controlled, setControlled] = useState(initial?.isControlled ?? false);
  const [restocked, setRestocked] = useState(toInputDate(initial?.lastRestockedAt ?? null));
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Field label="Drug name">
          <input className={FIELD} value={drugName} onChange={(e) => setDrugName(e.target.value)} />
        </Field>
        <Field label="Form (e.g. 500mg tablet)">
          <input className={FIELD} value={formLabel} onChange={(e) => setFormLabel(e.target.value)} />
        </Field>
        <Field label="Unit (e.g. tablets)">
          <input className={FIELD} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <Field label="In stock">
          <input
            type="number"
            className={`${FIELD} font-mono`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="Reorder at">
          <input
            type="number"
            className={`${FIELD} font-mono`}
            value={reorder}
            onChange={(e) => setReorder(e.target.value)}
          />
        </Field>
        <Field label="Last restocked">
          <input
            type="date"
            className={`${FIELD} font-mono`}
            value={restocked}
            onChange={(e) => setRestocked(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input
            type="checkbox"
            checked={controlled}
            onChange={(e) => setControlled(e.target.checked)}
          />
          Controlled substance
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-navy-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={BTN_PRIMARY}
          onClick={() =>
            onSubmit({
              drugName,
              formLabel: formLabel.trim() || null,
              unit: unit.trim() || null,
              qtyOnHand: Number(qty) || 0,
              reorderPoint: reorder.trim() === "" ? null : Number(reorder),
              isControlled: controlled,
              lastRestockedAt: restocked || null,
              active,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── controlled-substance register ─────────────────────── */

function ControlledRegister({
  canWrite,
  blocks,
  controlledFlagged,
  clinicians,
}: {
  canWrite: boolean;
  blocks: ControlledBlockView[];
  controlledFlagged: boolean;
  clinicians: Clinician[];
}) {
  return (
    <section id="controlled-register" className="mt-10 scroll-mt-24">
      <h3 className="font-display text-[16px] font-semibold text-navy">
        Controlled <em className="font-normal italic text-gold">substances</em> · running balance
      </h3>
      <p className="mt-2 max-w-[760px] text-[12px] leading-[1.6] text-navy-3">
        A running balance derived from receipts, administrations, and wastage. No stored count — the
        number below is computed each time you open this page.
      </p>

      {!controlledFlagged ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-[12px] text-navy-3">
          No controlled substances flagged. Mark an item &ldquo;controlled&rdquo; in the stock register.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3">
          {blocks.map((b) => (
            <ControlledBlock key={b.stockItemId} block={b} canWrite={canWrite} clinicians={clinicians} />
          ))}
        </div>
      )}
    </section>
  );
}

function ControlledBlock({
  block,
  canWrite,
  clinicians,
}: {
  block: ControlledBlockView;
  canWrite: boolean;
  clinicians: Clinician[];
}) {
  const { run, pending, error, setError } = useRun();
  const [recording, setRecording] = useState(false);
  const negative = block.balance < 0;

  return (
    <div className="rounded-[12px] border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-[14px] font-semibold text-navy">
          {block.drugName}
          {block.formLabel && (
            <span className="ml-2 text-[10px] italic text-navy-3">{block.formLabel}</span>
          )}
        </div>
        <div className={`font-mono text-[16px] font-semibold ${negative ? "text-terra" : "text-navy"}`}>
          {block.balance}
          {block.unit ? <span className="text-[11px] text-navy-3"> {block.unit}</span> : null}
        </div>
      </div>
      {negative && (
        <div className="mt-1 text-[11px] font-semibold text-terra">Balance below zero — reconcile.</div>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}

      {block.movements.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-navy-3">No movements recorded.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Date", "Type", "Qty", "Actor", "Witness", "Batch", "Reason"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-border-2 bg-bg px-2.5 py-1.5 text-left text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.movements.map((m) => (
                <MovementRow key={m.id} m={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite &&
        (recording ? (
          <div className="mt-3">
            <MovementForm
              stockItemId={block.stockItemId}
              clinicians={clinicians}
              pending={pending}
              onCancel={() => {
                setError(null);
                setRecording(false);
              }}
              onSubmit={(values) =>
                run(() => recordControlledMovement(values), () => setRecording(false))
              }
            />
          </div>
        ) : (
          <button type="button" className={`mt-3 ${ADD_LINK}`} onClick={() => setRecording(true)}>
            <Plus /> Record movement
          </button>
        ))}
    </div>
  );
}

function MovementRow({ m }: { m: ControlledMovementView }) {
  const label: Record<ControlledMovementView["kind"], string> = {
    RECEIPT: "Receipt",
    WASTAGE: "Wastage",
    ADJUSTMENT: "Adjustment",
    ADMINISTERED: "Administered",
  };
  const qtyColor = m.quantity > 0 ? "text-green" : "text-terra";
  const sign = m.quantity > 0 ? "+" : "";
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-2.5 py-2 font-mono text-[11px] text-navy-2">{fmtDate(m.occurredAt)}</td>
      <td className="px-2.5 py-2 text-[11px] text-navy-2">{label[m.kind]}</td>
      <td className={`px-2.5 py-2 font-mono text-[11px] font-semibold ${qtyColor}`}>
        {sign}
        {m.quantity}
      </td>
      <td className="px-2.5 py-2 text-[11px] text-navy-2">{m.actorName ?? "—"}</td>
      <td className="px-2.5 py-2 text-[11px] text-navy-2">
        {m.witnessName ?? (m.witnessOverrideReason ? `override — ${m.witnessOverrideReason}` : "—")}
      </td>
      <td className="px-2.5 py-2 text-[11px] text-navy-3">{m.batchRef ?? "—"}</td>
      <td className="px-2.5 py-2 text-[11px] text-navy-3">{m.reason ?? "—"}</td>
    </tr>
  );
}

type MovementValues = {
  stockItemId: string;
  movementType: "RECEIPT" | "WASTAGE" | "ADJUSTMENT";
  quantity: number;
  occurredAt: string;
  batchRef: string | null;
  reason: string | null;
  witnessUserId: string | null;
};

function MovementForm({
  stockItemId,
  clinicians,
  pending,
  onSubmit,
  onCancel,
}: {
  stockItemId: string;
  clinicians: Clinician[];
  pending: boolean;
  onSubmit: (v: MovementValues) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<MovementValues["movementType"]>("RECEIPT");
  const [qty, setQty] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [batch, setBatch] = useState("");
  const [reason, setReason] = useState("");
  const [witness, setWitness] = useState("");
  const witnessRequired = type === "WASTAGE";
  const reasonRequired = type !== "RECEIPT";

  return (
    <div className="rounded-lg border border-border bg-bg p-3.5">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Field label="Type">
          <select
            className={FIELD}
            value={type}
            onChange={(e) => setType(e.target.value as MovementValues["movementType"])}
          >
            <option value="RECEIPT">Receipt</option>
            <option value="WASTAGE">Wastage</option>
            <option value="ADJUSTMENT">Adjustment (±)</option>
          </select>
        </Field>
        <Field label={type === "ADJUSTMENT" ? "Quantity (±)" : "Quantity"}>
          <input
            type="number"
            className={`${FIELD} font-mono`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="When">
          <input
            type="date"
            className={`${FIELD} font-mono`}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Batch ref (optional)">
          <input className={FIELD} value={batch} onChange={(e) => setBatch(e.target.value)} />
        </Field>
        <Field label={`Reason${reasonRequired ? "" : " (optional)"}`}>
          <input className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {witnessRequired && (
          <Field label="Witness (N&MC clinician)">
            <select className={FIELD} value={witness} onChange={(e) => setWitness(e.target.value)}>
              <option value="">Select a witness…</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <p className="mt-2 text-[10px] italic text-navy-3">
        Append-only — a correction is a new adjustment row. A wastage needs a witnessing N&amp;MC clinician.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={BTN_PRIMARY}
          onClick={() =>
            onSubmit({
              stockItemId,
              movementType: type,
              quantity: Number(qty) || 0,
              occurredAt: when,
              batchRef: batch.trim() || null,
              reason: reason.trim() || null,
              witnessUserId: witness || null,
            })
          }
        >
          {pending ? "Recording…" : "Record"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────── shared bits ────────────────────────────── */

function StatusPill({ status }: { status: StockStatus }) {
  const cls: Record<StockStatus, string> = {
    OK: "bg-green-bg text-green",
    LOW: "bg-warn-bg text-warn",
    REORDER: "bg-terra-bg text-terra",
  };
  const label: Record<StockStatus, string> = { OK: "OK", LOW: "Low", REORDER: "Reorder" };
  return (
    <span
      className={`inline-block rounded-full px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] ${cls[status]}`}
    >
      {label[status]}
    </span>
  );
}

/** A drug name + a Controlled flag is NOT a leak — no student (R162/§2.3 authored addition). */
function ControlledPill() {
  return (
    <span className="ml-2 inline-block rounded-full bg-navy-2 px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] text-bg">
      Controlled
    </span>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-terra bg-terra-bg px-4 py-2.5 text-[12px] font-semibold text-terra">
      {children}
    </div>
  );
}

function Plus() {
  return (
    <span className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[12px] font-bold text-surface">
      +
    </span>
  );
}
