"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSportsHouse,
  updateSportsHouse,
  archiveSportsHouse,
} from "@/lib/actions/sports-houses";
import { fieldClass } from "@/components/ui/fields";

type SportsHouse = { id: string; name: string; colour: string | null };

const DEFAULT_COLOUR = "#1A2B47";

export function SportsHousesManager({ houses }: { houses: SportsHouse[] }) {
  const [editing, setEditing] = useState<SportsHouse | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-navy">
          Houses <span className="text-sm font-normal text-navy-3">· {houses.length}</span>
        </h2>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
        >
          + New house
        </button>
      </div>

      {houses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-6 text-center text-sm text-navy-3">
          No sports houses yet. Create one to start grouping pupils.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {houses.map((h) => (
                <tr key={h.id} className="hover:bg-bg">
                  <td className="w-8 px-4 py-3">
                    {/* House dot — colour is USER DATA, inline style only. */}
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-border-2"
                      style={{ backgroundColor: h.colour ?? "var(--navy)" }}
                      title={h.colour ?? undefined}
                      aria-label={`${h.name} colour`}
                    />
                  </td>
                  <td className="px-2 py-3 font-medium text-navy">{h.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-navy-3">{h.colour ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(h)}
                      className="text-xs font-semibold text-navy-2 transition-colors hover:text-gold"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {editing && <EditDialog house={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(DEFAULT_COLOUR);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await createSportsHouse({ name, colour: colour || null });
      if (!res.ok) {
        setError(res.error ?? "Could not create.");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog title="New sports house">
      <NameColourFields
        name={name}
        colour={colour}
        onName={setName}
        onColour={setColour}
      />
      <DialogActions pending={pending} error={error} onClose={onClose} onSave={save} saveLabel="Create" />
    </Dialog>
  );
}

function EditDialog({ house, onClose }: { house: SportsHouse; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(house.name);
  const [colour, setColour] = useState(house.colour ?? DEFAULT_COLOUR);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateSportsHouse({ houseId: house.id, name, colour: colour || null });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  async function archive() {
    if (!confirm(`Archive ${house.name}? Pupils keep their records; new assignments stop.`)) return;
    setError(null);
    setBusy(true);
    const res = await archiveSportsHouse({ houseId: house.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not archive.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog title={`Edit ${house.name}`}>
      <NameColourFields name={name} colour={colour} onName={setName} onColour={setColour} />
      {error && <p className="text-xs font-semibold text-terra">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          onClick={archive}
          disabled={pending || busy}
          className="rounded-md border border-terra/40 bg-terra-bg px-3 py-2 text-sm font-semibold text-terra disabled:opacity-50"
        >
          {busy ? "Archiving…" : "Archive"}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={pending || busy}
            className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending || busy}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function NameColourFields({
  name,
  colour,
  onName,
  onColour,
}: {
  name: string;
  colour: string;
  onName: (v: string) => void;
  onColour: (v: string) => void;
}) {
  return (
    <>
      <Field label="House name">
        <input
          className={fieldClass}
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Red House"
        />
      </Field>
      <Field label="Colour (hex)">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : DEFAULT_COLOUR}
            onChange={(e) => onColour(e.target.value)}
            className="h-9 w-12 rounded border border-border-2 bg-surface"
          />
          <input
            className={fieldClass}
            value={colour}
            onChange={(e) => onColour(e.target.value)}
            placeholder="#B43A2F"
          />
        </div>
      </Field>
    </>
  );
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
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
