"use client";
/**
 * Sickbay setup §1 (mode & staff) + §2 (capacity & hours) — surface `schoolup-sickbay-setup.html`
 * lines 211–553, ported 1:1 via docs/senior/sickbay-setup-surface-map.md.
 *
 * Client component: it owns the mode radio, the bed inputs and the slot editor. It receives PLAIN
 * SERIALIZABLE props — never a DB row, never a `*-data` import (the server reader lives behind
 * `import "server-only"`).
 *
 * Two behaviours worth naming:
 *   • MODE C renders NO §2 AT ALL — no tiles, no greyed table, no disabled control, no `0`, no `—`,
 *     no PLACEHOLDER badge (AC A7). One explanatory panel takes its place and names why, and §1
 *     promotes the prefect card ABOVE clinical staff: in a referral-only school the prefects ARE the
 *     front line, not a leftover.
 *   • A MATRON sees every row and NO affordance (AC E2): no selectable mode card, no bed input, no
 *     slot editor, no Save, no Reset. The data is hers to read; the configuration is not hers to set.
 *
 * Token discipline (repo memory `no-alpha-token-opacity`): the §1/§2 body has ZERO translucency —
 * every colour here is a solid token or a dedicated `-bg` tint. Slash-opacity on a raw-hex token
 * (`bg-gold/8`) renders NOTHING and `next build` passes anyway.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  resetScheduleSlots,
  saveBedCapacity,
  saveClinicalStaff,
  setSickbayMode,
  toggleScheduleSlot,
  updateScheduleSlot,
} from "@/lib/actions/sickbay-config";
import {
  BED_TILE_COPY,
  MODE_C_CAPACITY_PANEL,
  SICKBAY_MODE_CARDS,
  canSaveMode,
  formatDayType,
  formatTimeWindow,
  initials,
  splitBold,
  type SickbayBedCounts,
  type SickbayCapabilities,
  type SickbayMode,
  type SickbaySlot,
} from "@/lib/sickbay/defaults";

export interface StaffRow {
  post: "SENIOR_MATRON" | "ASSISTANT_MATRON" | "VISITING_DOCTOR";
  name: string;
  /** Fully composed role line with `**bold**` fragments, e.g. `Senior Matron · **N&MC #N-04827**`. */
  roleLine: string;
  /** The static role pill — what this person IS, never a live shift status (R27 · AC F2). */
  pill: string;
}
export interface PrefectRow {
  studentId: string;
  shortName: string;
  initials: string;
  formLabel: string;
  houseName: string;
}

/**
 * The staff editor's values. The two doctor keys are OPTIONAL and are ABSENT (not null) in a mode
 * with no visiting-doctor capability — absent means "not sent, leave the stored value alone", which
 * is what keeps a B→C→B round trip lossless (AC A6).
 */
export interface StaffFormValues {
  matronUserId: string | null;
  assistantMatronUserId: string | null;
  visitingDoctorName?: string | null;
  visitingDoctorAffiliation?: string | null;
}

export function SickbaySetupConsole({
  canWrite,
  mode,
  configured,
  capabilities,
  bedCounts,
  slots,
  staff,
  prefects,
  matronCandidates,
  staffForm,
}: {
  canWrite: boolean;
  mode: SickbayMode;
  /** false when the school has never declared a mode — it must render as having selected NOTHING. */
  configured: boolean;
  capabilities: SickbayCapabilities;
  bedCounts: SickbayBedCounts;
  slots: SickbaySlot[];
  staff: StaffRow[];
  prefects: PrefectRow[];
  matronCandidates: { id: string; name: string }[];
  staffForm: StaffFormValues;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // null until the school has declared a mode: an UNCONFIGURED school coalesces to REFERRAL_ONLY for
  // reading, but it has not *chosen* Mode C, so nothing is pre-selected and the save stays available.
  const [draftMode, setDraftMode] = useState<SickbayMode | null>(configured ? mode : null);

  // Affordances follow the DERIVED capability (R4), never a mode string compared inline.
  const clinical = capabilities.beds;
  const canSave = canSaveMode(draftMode, mode, configured);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
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
  }

  return (
    <div>
      {/* ═══ §1 page head ═══ */}
      <div className="border-b border-border bg-surface px-6 pb-[22px] pt-6 md:px-9">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
          <span className="text-gold">Sickbay</span> / Setup &amp; configuration
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
              Sickbay <em className="font-normal italic text-gold">configuration</em>
            </h1>
            {/* Lucy FLAG L1 — the surface lede advertises `standing orders` (INCR-24), `referral
                hospitals` (INCR-25) and `policy anchors`; restore each clause verbatim as its
                section lands. Mode C has no capacity to edit, so that clause drops too. */}
            <div className="mt-1 max-w-[720px] text-[13px] text-navy-3">
              <Bold
                text={
                  clinical
                    ? "How your sickbay is run · **mode**, **staff**, **capacity** · all editable here"
                    : "How your sickbay is run · **mode**, **staff** · all editable here"
                }
              />
            </div>
          </div>
          {canWrite && (
            <button
              type="button"
              disabled={!canSave || pending}
              onClick={() => draftMode && run(() => setSickbayMode({ mode: draftMode }))}
              className="rounded-md border border-gold bg-gold px-3.5 py-[9px] text-xs font-bold text-navy disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save mode
            </button>
          )}
        </div>
      </div>

      <div className="px-6 pb-14 pt-7 md:px-9">
        {error && (
          <div className="mb-4 rounded-lg border border-terra bg-terra-bg px-4 py-2.5 text-[12px] font-semibold text-terra">
            {error}
          </div>
        )}

        {/* ═══ Mode strip ═══ */}
        <h3 className="mb-3.5 font-display text-[18px] font-semibold text-navy">
          <em className="font-normal italic text-gold">Sickbay mode</em> · what kind of medical
          operation is this?
        </h3>
        {/* An unconfigured school is NOT a Mode-C school. It reads as referral-only because that is
            the safe default, but it has declared nothing — so no card is selected and the state says
            so in words. Declaring Mode C is a real answer and has to be savable. */}
        {!configured && (
          <p className="-mt-1.5 mb-3.5 text-[12px] text-navy-3">
            <b className="font-semibold text-navy-2">No mode declared yet.</b> Until one is saved this
            school counts as unconfigured
            {canWrite
              ? " — pick the mode that matches what this school actually runs and save it. Mode C is an answer, not a blank."
              : " — an Administrator or the Headmaster declares it."}
          </p>
        )}
        <div
          role="radiogroup"
          aria-label="Sickbay mode"
          aria-readonly={!canWrite}
          className="mb-8 grid grid-cols-1 gap-[14px] xl:grid-cols-3"
        >
          {SICKBAY_MODE_CARDS.map((m) => {
            const active = draftMode === m.mode;
            return (
              <label
                key={m.mode}
                className={`relative rounded-[14px] px-[22px] py-5 ${
                  active
                    ? "border-2 border-gold bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]"
                    : "border-[1.5px] border-border bg-surface"
                } ${canWrite ? "cursor-pointer" : ""} focus-within:outline focus-within:outline-2 focus-within:outline-gold`}
              >
                {canWrite && (
                  <input
                    type="radio"
                    name="sickbay-mode"
                    className="sr-only"
                    checked={active}
                    onChange={() => setDraftMode(m.mode)}
                  />
                )}
                {active && (
                  <span
                    aria-hidden
                    className="absolute right-[14px] top-[14px] size-[18px] rounded-full bg-gold"
                  />
                )}
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.16em] text-gold">
                  {m.tag}
                  {active ? " · selected" : ""}
                </div>
                <div className="mb-1.5 font-display text-[20px] font-semibold tracking-[-0.01em] text-navy">
                  {m.name}
                  <em className="font-normal italic text-gold">{m.nameEm}</em>
                </div>
                <div className="mb-2.5 text-[12px] leading-[1.55] text-navy-2">{m.desc}</div>
                {/* R28 — the percentages ship verbatim; they do NOT sum to 105%, the third has a
                    different denominator. Never computed, never stored. */}
                <div
                  className={`border-t pt-2.5 text-[10px] italic text-navy-3 ${
                    active ? "border-gold-soft" : "border-border"
                  }`}
                >
                  <Bold text={m.stat} mono />
                </div>
              </label>
            );
          })}
        </div>

        {/* ═══ Staff + prefects · Mode C promotes the prefects ABOVE clinical staff ═══ */}
        <div
          className={`mb-6 grid gap-[18px] ${clinical ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}
        >
          {clinical ? (
            <>
              <ClinicalStaffCard
                staff={staff}
                canWrite={canWrite}
                pending={pending}
                showVisitingDoctor={capabilities.visitingDoctor}
                matronCandidates={matronCandidates}
                staffForm={staffForm}
                onSave={(v, done) => run(() => saveClinicalStaff(v), done)}
              />
              <PrefectCard prefects={prefects} />
            </>
          ) : (
            <>
              <PrefectCard prefects={prefects} />
              <ClinicalStaffCard
                staff={staff}
                canWrite={canWrite}
                pending={pending}
                showVisitingDoctor={capabilities.visitingDoctor}
                matronCandidates={matronCandidates}
                staffForm={staffForm}
                onSave={(v, done) => run(() => saveClinicalStaff(v), done)}
              />
            </>
          )}
        </div>

        {/* ═══ §2 · Capacity & hours — ABSENT from the DOM in Mode C (AC A7) ═══ */}
        {!clinical ? (
          <section className="rounded-[14px] border border-border bg-surface px-7 py-6">
            <h2 className="font-display text-[16px] font-semibold text-navy">
              {MODE_C_CAPACITY_PANEL.heading}
            </h2>
            <p className="mt-2 max-w-[760px] text-[13px] leading-[1.65] text-navy-3">
              {MODE_C_CAPACITY_PANEL.body}
            </p>
          </section>
        ) : (
          <CapacityAndHours
            canWrite={canWrite}
            pending={pending}
            bedCounts={bedCounts}
            slots={slots}
            onSaveCapacity={(v) => run(() => saveBedCapacity(v))}
            onSaveSlot={(v, done) => run(() => updateScheduleSlot(v), done)}
            onToggleSlot={(v) => run(() => toggleScheduleSlot(v))}
            onReset={() => run(() => resetScheduleSlots())}
          />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────── §1 · Clinical staff ────────────────────────────── */

function ClinicalStaffCard({
  staff,
  canWrite,
  pending,
  showVisitingDoctor,
  matronCandidates,
  staffForm,
  onSave,
}: {
  staff: StaffRow[];
  canWrite: boolean;
  pending: boolean;
  /** R4 — a mode without the visiting-doctor capability neither renders nor SENDS those two fields. */
  showVisitingDoctor: boolean;
  matronCandidates: { id: string; name: string }[];
  staffForm: StaffFormValues;
  onSave: (v: StaffFormValues, done: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(staffForm);

  // Derived counts — never a hand-written literal (the §3 header that claims 3 reorder alerts over
  // a 2-alert table is this module's proof that copied counters drift).
  const active = staff.filter((s) => s.post !== "VISITING_DOCTOR").length;
  const visiting = staff.length - active;

  return (
    <Card title="Clinical " em="staff" meta={`${active} active · ${visiting} visiting`}>
      {staff.length === 0 && !editing && (
        <p className="py-2 text-[12px] text-navy-3">No clinical staff registered.</p>
      )}
      {staff.map((s) => (
        <div
          key={s.post}
          className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-border py-[11px] last:border-b-0"
        >
          <span
            className={`flex size-9 items-center justify-center rounded-full font-display text-[12px] font-bold ${
              s.post === "VISITING_DOCTOR"
                ? "border border-border bg-bg text-navy-2"
                : "bg-gold-bg text-navy"
            }`}
          >
            {initials(s.name)}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-navy">{s.name}</span>
            <span className="mt-px block text-[11px] text-navy-3">
              <Bold text={s.roleLine} mono />
            </span>
          </span>
          {/* R27 — `On shift` / `Off · back 18:00` need a per-staff shift roster that does not
              exist. A static role pill states what IS true instead of inventing what is now. */}
          <span className="rounded-full border border-border bg-bg px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] text-navy-2">
            {s.pill}
          </span>
        </div>
      ))}

      {canWrite && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-gold px-3.5 py-2.5 text-left text-[11px] font-semibold text-gold"
        >
          <span
            aria-hidden
            className="flex size-[18px] items-center justify-center rounded-full bg-gold text-[12px] font-bold text-surface"
          >
            +
          </span>
          Add clinical staff member
        </button>
      )}

      {canWrite && editing && (
        <div className="mt-3 rounded-lg border border-border bg-bg p-3.5">
          <Field label="Senior Matron">
            <select
              className={FIELD}
              value={form.matronUserId ?? ""}
              onChange={(e) => setForm({ ...form, matronUserId: e.target.value || null })}
            >
              <option value="">Not assigned</option>
              {matronCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assistant Matron">
            <select
              className={FIELD}
              value={form.assistantMatronUserId ?? ""}
              onChange={(e) => setForm({ ...form, assistantMatronUserId: e.target.value || null })}
            >
              <option value="">Not assigned</option>
              {matronCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {matronCandidates.length === 0 && (
            <p className="mb-2 text-[11px] italic text-navy-3">
              No staff member holds the Matron role in this school yet — assign it under Staff first.
            </p>
          )}
          {/* R21 — the visiting doctor is NOT a system user: name + affiliation text, no invite.
              Absent entirely without the capability: a referral-only school has no weekly doctor to
              edit, and the stored name survives untouched because it is never sent back as null. */}
          {showVisitingDoctor && (
            <>
              <Field label="Visiting doctor · name">
                <input
                  className={FIELD}
                  value={form.visitingDoctorName ?? ""}
                  placeholder="Dr K. Mensah"
                  onChange={(e) => setForm({ ...form, visitingDoctorName: e.target.value })}
                />
              </Field>
              <Field label="Visiting doctor · affiliation">
                <input
                  className={FIELD}
                  value={form.visitingDoctorAffiliation ?? ""}
                  placeholder="Asankrangwa Govt. Hospital"
                  onChange={(e) => setForm({ ...form, visitingDoctorAffiliation: e.target.value })}
                />
              </Field>
              <p className="mb-2.5 text-[10px] italic text-navy-3">
                The visiting doctor has no login — he is a directory entry, not a school account.
              </p>
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onSave(form, () => setEditing(false))}
              className="rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50"
            >
              Save staff
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(staffForm);
                setEditing(false);
              }}
              className="rounded-md border border-border-2 bg-surface px-3.5 py-[7px] text-[11px] font-semibold text-navy"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ────────────────────────────── §1 · Health prefects ────────────────────────────── */

/**
 * A DERIVED read of the Houses' `prefect_role = 'SICKBAY'` bunks (R23). Zero marked bunks renders an
 * honest empty state pointing at Boarding — never a fabricated roster, never a count of 6 (AC D7).
 * Seniority, training date and rotation cadence are OMITTED: nothing backs them.
 */
function PrefectCard({ prefects }: { prefects: PrefectRow[] }) {
  const houses = useMemo(
    () => Array.from(new Set(prefects.map((p) => p.houseName))),
    [prefects],
  );
  const head = prefects.slice(0, 3);
  const rest = prefects.slice(3);

  return (
    <Card
      title="School Health "
      em="Prefects"
      meta={`${prefects.length} students · SHEP-aligned`}
    >
      {prefects.length === 0 ? (
        <div className="py-2">
          <p className="text-[12px] text-navy-3">
            No Sick Bay Prefects appointed. A prefect is marked on a House bunk in Boarding — mark
            one per House and the roster appears here.
          </p>
          <Link
            href="/senior/boarding"
            className="mt-2.5 inline-block rounded-lg border border-dashed border-gold px-3.5 py-2.5 text-[11px] font-semibold text-gold"
          >
            Mark a Sick Bay Prefect in Boarding →
          </Link>
        </div>
      ) : (
        <>
          {head.map((p) => (
            <PrefectRowView key={p.studentId} p={p} />
          ))}
          {rest.length > 0 && (
            <details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-border py-[11px] group-open:border-b-0">
                <span className="flex size-9 items-center justify-center rounded-full bg-green-bg font-display text-[12px] font-bold text-green">
                  +{rest.length}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-navy">
                    {rest.length} more prefect{rest.length === 1 ? "" : "s"} ·{" "}
                    {Array.from(new Set(rest.map((r) => r.houseName))).join(", ")}
                  </span>
                  <span className="mt-px block text-[11px] text-navy-3">
                    Full roster covers all {houses.length} house{houses.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="rounded-full border border-border bg-bg px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] text-navy-2">
                  View all
                </span>
              </summary>
              {rest.map((p) => (
                <PrefectRowView key={p.studentId} p={p} />
              ))}
            </details>
          )}
        </>
      )}
    </Card>
  );
}

function PrefectRowView({ p }: { p: PrefectRow }) {
  return (
    <div className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-border py-[11px] last:border-b-0">
      <span className="flex size-9 items-center justify-center rounded-full bg-green-bg font-display text-[12px] font-bold text-green">
        {p.initials}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-navy">
          {p.shortName} · {p.formLabel}
        </span>
        <span className="mt-px block text-[11px] text-navy-3">
          Sick Bay Prefect · <b className="font-semibold text-navy-2">{p.houseName} House</b>
        </span>
      </span>
      <span />
    </div>
  );
}

/* ────────────────────────────── §2 · Capacity & hours ────────────────────────────── */

function CapacityAndHours({
  canWrite,
  pending,
  bedCounts,
  slots,
  onSaveCapacity,
  onSaveSlot,
  onToggleSlot,
  onReset,
}: {
  canWrite: boolean;
  pending: boolean;
  bedCounts: SickbayBedCounts;
  slots: SickbaySlot[];
  onSaveCapacity: (v: { general: number; isolation: number }) => void;
  onSaveSlot: (v: SlotDraft, done: () => void) => void;
  onToggleSlot: (v: { id: string; active: boolean }) => void;
  onReset: () => void;
}) {
  const [general, setGeneral] = useState(bedCounts.general);
  const [isolation, setIsolation] = useState(bedCounts.isolation);
  const dirty = general !== bedCounts.general || isolation !== bedCounts.isolation;

  return (
    <section id="capacity" className="scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-7">
        <div>
          <h2 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            Capacity &amp; <em className="font-normal italic text-gold">hours</em>
          </h2>
          <div className="mt-1 max-w-[720px] text-[13px] text-navy-3">
            <Bold text="Beds, isolation, operating hours, and the **06:30 medication round** · the anchor that defines a boarding sickbay's daily shape" />
          </div>
        </div>
        {canWrite && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `This replaces all ${slots.length} schedule slots with the 7 default slots. Continue?`,
                )
              ) {
                onReset();
              }
            }}
            className="rounded-md border border-border-2 bg-surface px-3.5 py-[9px] text-xs font-semibold text-navy disabled:opacity-50"
          >
            Reset to defaults
          </button>
        )}
      </div>

      <h3 className="mb-3 font-display text-[16px] font-semibold text-navy">Bed capacity</h3>

      {/* R27 — `Currently occupied 1/8 · Adwoa Mensa · bed 3 · since 09:14` and `Avg. weekly load`
          are OMITTED WHOLE. No admission table and no visit history exist at INCR-21, so even a
          `0/8` would be a hardcoded assertion about an entity the system cannot see. */}
      <div className="mb-[18px] grid grid-cols-1 gap-[14px] md:grid-cols-2">
        <BedTile
          label={BED_TILE_COPY.general.label}
          desc={BED_TILE_COPY.general.desc}
          value={general}
          canWrite={canWrite}
          onChange={setGeneral}
        />
        <BedTile
          label={BED_TILE_COPY.isolation.label}
          desc={BED_TILE_COPY.isolation.desc}
          value={isolation}
          canWrite={canWrite}
          onChange={setIsolation}
        />
      </div>
      {canWrite && dirty && (
        <div className="mb-[18px] flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => onSaveCapacity({ general, isolation })}
            className="rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50"
          >
            Save bed capacity
          </button>
          <button
            type="button"
            onClick={() => {
              setGeneral(bedCounts.general);
              setIsolation(bedCounts.isolation);
            }}
            className="text-[11px] font-semibold text-navy-3"
          >
            Cancel
          </button>
          <span className="text-[10px] italic text-navy-3">
            Raising adds new numbered beds; lowering retires the highest-numbered free beds. A bed
            number is never reused.
          </span>
        </div>
      )}

      <h3 className="mb-3 mt-6 font-display text-[16px] font-semibold text-navy">
        Operating hours &amp; rounds
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {slots.length === 0 ? (
          <p className="px-3.5 py-4 text-[12px] text-navy-3">
            No schedule slots configured.
            {canWrite ? " Use Reset to defaults to restore the canonical seven." : ""}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Schedule slot", "Time window", "Staffing", "Day type"].map((h, i) => (
                  <th
                    key={h}
                    className={`border-b border-border-2 bg-bg px-3.5 py-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                      i === 3 && !canWrite ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
                {canWrite && <th className="border-b border-border-2 bg-bg" />}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <SlotRow
                  key={s.id}
                  slot={s}
                  canWrite={canWrite}
                  pending={pending}
                  onSave={onSaveSlot}
                  onToggle={onToggleSlot}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function BedTile({
  label,
  desc,
  value,
  canWrite,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  canWrite: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-[18px] py-4">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      {canWrite ? (
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={200}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
          className="mt-1 w-24 border-b border-border-2 bg-transparent font-display text-[28px] font-semibold italic leading-[1.05] tracking-[-0.018em] text-gold outline-none focus:border-gold"
        />
      ) : (
        <div className="mt-1 font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.018em]">
          <em className="italic text-gold">{value}</em>
        </div>
      )}
      <div className="mt-[3px] text-[10px] italic text-navy-3">{desc}</div>
    </div>
  );
}

interface SlotDraft {
  id: string;
  label: string;
  description: string;
  startsAt: string;
  endsAt: string;
  staffing: string;
  daysOfWeek: number[];
  runsOnHolidays: boolean;
}
const DAY_PICKER = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

function SlotRow({
  slot,
  canWrite,
  pending,
  onSave,
  onToggle,
}: {
  slot: SickbaySlot;
  canWrite: boolean;
  pending: boolean;
  onSave: (v: SlotDraft, done: () => void) => void;
  onToggle: (v: { id: string; active: boolean }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<SlotDraft>({
    id: slot.id,
    label: slot.label,
    description: slot.description ?? "",
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    staffing: slot.staffing ?? "",
    daysOfWeek: slot.daysOfWeek,
    runsOnHolidays: slot.runsOnHolidays,
  });

  if (editing) {
    return (
      <tr className="border-b border-border last:border-b-0">
        <td colSpan={canWrite ? 5 : 4} className="bg-bg px-3.5 py-3.5">
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            <Field label="Slot label">
              <input className={FIELD} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
            </Field>
            <Field label="Staffing">
              <input className={FIELD} value={d.staffing} onChange={(e) => setD({ ...d, staffing: e.target.value })} />
            </Field>
            <Field label="Description · the handoff note when the matron is away">
              <input
                className={FIELD}
                value={d.description}
                onChange={(e) => setD({ ...d, description: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Starts">
                <input
                  type="time"
                  className={FIELD}
                  value={d.startsAt}
                  onChange={(e) => setD({ ...d, startsAt: e.target.value })}
                />
              </Field>
              <Field label="Ends · may be before the start (overnight)">
                <input
                  type="time"
                  className={FIELD}
                  value={d.endsAt}
                  onChange={(e) => setD({ ...d, endsAt: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-navy-2">Runs on</span>
            {DAY_PICKER.map(([n, lbl]) => (
              <label key={n} className="flex items-center gap-1 text-[11px] text-navy-2">
                <input
                  type="checkbox"
                  checked={d.daysOfWeek.includes(n)}
                  onChange={(e) =>
                    setD({
                      ...d,
                      daysOfWeek: e.target.checked
                        ? [...d.daysOfWeek, n]
                        : d.daysOfWeek.filter((x) => x !== n),
                    })
                  }
                />
                {lbl}
              </label>
            ))}
            <label className="flex items-center gap-1 text-[11px] text-navy-2">
              <input
                type="checkbox"
                checked={d.runsOnHolidays}
                onChange={(e) => setD({ ...d, runsOnHolidays: e.target.checked })}
              />
              Runs on holidays &amp; vacation
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onSave(d, () => setEditing(false))}
              className="rounded-md border border-gold bg-gold px-3.5 py-[7px] text-[11px] font-bold text-navy disabled:opacity-50"
            >
              Save slot
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border-2 bg-surface px-3.5 py-[7px] text-[11px] font-semibold text-navy"
            >
              Cancel
            </button>
            {slot.isAnchor && (
              <span className="self-center text-[10px] italic text-navy-3">
                The anchor round&apos;s time is editable, but it can never start after another
                medication round — and it cannot be removed or switched off.
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b border-border last:border-b-0 ${slot.active ? "" : "opacity-60"}`}>
      <td className="px-3.5 py-2.5 text-[12px] font-semibold text-navy">
        {slot.label}
        {slot.isAnchor && (
          <span className="ml-1.5 inline-block rounded-full bg-gold px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.08em] text-navy">
            Anchor
          </span>
        )}
        {!slot.active && (
          <span className="ml-1.5 inline-block rounded-full border border-border bg-bg px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.08em] text-navy-3">
            Off
          </span>
        )}
        {slot.description && (
          <span className="mt-px block text-[10px] font-normal text-navy-3">{slot.description}</span>
        )}
      </td>
      {/* AC C8 — 22:00 – 06:00 wraps midnight and is printed exactly as stored. */}
      <td className="px-3.5 py-2.5 font-mono text-[12px] font-medium text-navy-2">
        {formatTimeWindow(slot)}
      </td>
      <td className="px-3.5 py-2.5 text-[12px] text-navy">{slot.staffing ?? "—"}</td>
      <td className={`px-3.5 py-2.5 text-[12px] text-navy ${canWrite ? "" : "text-right"}`}>
        {/* R14 — derived from the day set, never stored beside it. */}
        {formatDayType(slot)}
      </td>
      {canWrite && (
        <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] font-semibold text-gold"
          >
            Edit
          </button>
          {!slot.isAnchor && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onToggle({ id: slot.id, active: !slot.active })}
              className="ml-3 text-[11px] font-semibold text-navy-3 disabled:opacity-50"
            >
              {slot.active ? "Turn off" : "Turn on"}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

/* ────────────────────────────── shared bits ────────────────────────────── */

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function Card({
  title,
  em,
  meta,
  children,
}: {
  title: string;
  em: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 pb-3 pt-3.5">
        <div className="font-display text-[16px] font-semibold tracking-[-0.005em] text-navy">
          {title}
          <em className="font-normal italic text-gold">{em}</em>
        </div>
        <div className="text-[10px] font-semibold tracking-[0.06em] text-navy-3">{meta}</div>
      </div>
      <div className="px-5 pb-[18px] pt-3.5">{children}</div>
    </div>
  );
}

/** Renders `a **b** c` with the bold fragments emphasised — mono for licence numbers. */
function Bold({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className={`font-semibold text-navy-2 ${mono ? "font-mono" : ""}`}>
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
