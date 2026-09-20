"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateHouse, addDormitory } from "@/lib/actions/boarding-config";
import { fieldClass } from "@/components/ui/fields";
import type { HouseConfigCard, StaffOption } from "@/lib/boarding/programme-data";

const GENDER_PILL: Record<"BOYS" | "GIRLS" | "COED", string> = {
  BOYS: "bg-navy text-bg",
  GIRLS: "bg-terra text-bg",
  COED: "bg-gold text-navy",
};

export function HousesEditor({
  houses,
  staff,
  canEdit,
}: {
  houses: HouseConfigCard[];
  staff: StaffOption[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<HouseConfigCard | null>(null);
  const [provisioning, setProvisioning] = useState<HouseConfigCard | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {houses.map((h) => (
          <div key={h.id} className="overflow-hidden rounded-xl border border-border bg-surface">
            {/* h-band — house.colour is USER DATA, inline style only; white House gets the border guard. */}
            <div
              className={`h-1.5 w-full ${h.isLight ? "border-b border-border-2" : ""}`}
              style={{ backgroundColor: h.colour ?? "var(--navy)" }}
            />
            <div className="p-5">
              <div className="mb-3.5 flex items-start justify-between border-b border-dashed border-border pb-3">
                <div>
                  <h4 className="font-display text-xl font-semibold leading-tight text-navy">
                    {h.name} <em className="italic text-gold">House</em>
                  </h4>
                  <div className="mt-1 text-[10px] text-navy-3">
                    <b className="text-navy-2">Colour</b> {colourWord(h.colour)}
                    {h.foundedYear ? <> · <b className="text-navy-2">Founded</b> {h.foundedYear}</> : null}
                    {h.namedAfter ? <> · {h.namedAfter}</> : null}
                  </div>
                </div>
                {h.gender && (
                  <span
                    className={`rounded-pill px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${GENDER_PILL[h.gender]}`}
                  >
                    {h.gender}
                  </span>
                )}
              </div>

              <div className="mb-3.5 grid grid-cols-3 gap-2.5">
                <Cell label="Dorms" value={h.dormCount} />
                <Cell label="Beds" value={h.bedCount} em />
                <Cell label="Filled" value={h.filled} />
              </div>

              {/* occupancy bar — BRAND token fill (green/warn), never house.colour; width is derived. */}
              <div className="mb-3 h-1.5 overflow-hidden rounded-pill bg-border">
                <div
                  className={`h-full ${h.occupancyWarn ? "bg-warn" : "bg-green"}`}
                  style={{ width: `${h.occupancyPct}%` }}
                />
              </div>

              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg p-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold font-display text-[11px] font-bold text-navy">
                  {initials(h.hmName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">
                    {h.gender === "GIRLS" ? "Housemistress" : "Housemaster"}
                  </div>
                  <div className="truncate text-xs font-bold text-navy">
                    {h.hmName ?? "Unassigned"}
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setEditing(h)}
                    className="flex-1 rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy"
                  >
                    Edit identity
                  </button>
                  <button
                    onClick={() => setProvisioning(h)}
                    className="flex-1 rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy"
                  >
                    Add dorm
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <HouseDialog house={editing} staff={staff} onClose={() => setEditing(null)} />
      )}
      {provisioning && (
        <DormDialog house={provisioning} onClose={() => setProvisioning(null)} />
      )}
    </>
  );
}

function HouseDialog({
  house,
  staff,
  onClose,
}: {
  house: HouseConfigCard;
  staff: StaffOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(house.name);
  const [colour, setColour] = useState(house.colour ?? "#1A2B47");
  const [gender, setGender] = useState<string>(house.gender ?? "");
  const [capacity, setCapacity] = useState<string>(house.capacity != null ? String(house.capacity) : "");
  const [hmUserId, setHmUserId] = useState<string>(house.hmUserId ?? "");
  const [foundedYear, setFoundedYear] = useState<string>(house.foundedYear != null ? String(house.foundedYear) : "");
  const [namedAfter, setNamedAfter] = useState(house.namedAfter ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateHouse({
        houseId: house.id,
        name,
        colour: colour || null,
        gender: gender || null,
        capacity: capacity === "" ? null : Number(capacity),
        hmUserId: hmUserId || null,
        foundedYear: foundedYear === "" ? null : Number(foundedYear),
        namedAfter: namedAfter || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog title={`Edit ${house.name} House`}>
      <Field label="House name">
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Colour (user data · hex)">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#1A2B47"}
            onChange={(e) => setColour(e.target.value)}
            className="h-9 w-12 rounded border border-border-2 bg-surface"
          />
          <input className={fieldClass} value={colour} onChange={(e) => setColour(e.target.value)} placeholder="#B43A2F" />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gender">
          <select className={fieldClass} value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Not set</option>
            <option value="BOYS">Boys</option>
            <option value="GIRLS">Girls</option>
            <option value="COED">Mixed</option>
          </select>
        </Field>
        <Field label="Capacity (planning)">
          <input type="number" min={0} className={fieldClass} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
      </div>
      <Field label="Resident Housemaster">
        <select className={fieldClass} value={hmUserId} onChange={(e) => setHmUserId(e.target.value)}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Founded (year)">
          <input type="number" className={fieldClass} value={foundedYear} onChange={(e) => setFoundedYear(e.target.value)} placeholder="1956" />
        </Field>
        <Field label="Named after">
          <input className={fieldClass} value={namedAfter} onChange={(e) => setNamedAfter(e.target.value)} />
        </Field>
      </div>
      <DialogActions pending={pending} error={error} onClose={onClose} onSave={save} />
    </Dialog>
  );
}

function DormDialog({ house, onClose }: { house: HouseConfigCard; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [bunkCount, setBunkCount] = useState("15");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await addDormitory({
        houseId: house.id,
        name,
        sectionLabel: sectionLabel || null,
        bunkCount: Number(bunkCount),
      });
      if (!res.ok) {
        setError(res.error ?? "Could not provision the dormitory.");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog title={`Provision a dormitory · ${house.name}`}>
      <p className="mb-3 text-xs text-navy-3">
        Creates the dormitory and its bunks over the boarding spine. Per-student bunk assignment
        stays on the House roster.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dorm name">
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="I" />
        </Field>
        <Field label="Bunks">
          <input type="number" min={1} max={60} className={fieldClass} value={bunkCount} onChange={(e) => setBunkCount(e.target.value)} />
        </Field>
      </div>
      <Field label="Section label (optional)">
        <input className={fieldClass} value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)} placeholder="North wing" />
      </Field>
      <DialogActions pending={pending} error={error} onClose={onClose} onSave={save} saveLabel="Provision" />
    </Dialog>
  );
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h3 className="mb-4 font-display text-lg font-semibold text-navy">{title}</h3>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}
function DialogActions({
  pending,
  error,
  onClose,
  onSave,
  saveLabel = "Save",
}: {
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <>
      {error && <p className="text-xs font-semibold text-terra">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={pending}
          className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : saveLabel}
        </button>
      </div>
    </>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-navy-2">{label}</span>
      {children}
    </label>
  );
}
function Cell({ label, value, em }: { label: string; value: number; em?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">{label}</div>
      <div className={`mt-0.5 font-display text-base font-semibold leading-none ${em ? "italic text-gold" : "text-navy"}`}>
        {value}
      </div>
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "—";
  return name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "—";
}
function colourWord(hex: string | null): string {
  if (!hex) return "not set";
  return hex;
}
