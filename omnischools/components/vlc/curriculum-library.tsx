"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVlcValue, updateVlcSessionTemplate } from "@/lib/actions/vlc";
import {
  proposeAddValue,
  proposeReorderValues,
  proposeRemoveValue,
} from "@/lib/actions/vlc-change-request";
import type { VlcValueView } from "@/lib/vlc/setup-data";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-[12px] text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

/**
 * The curriculum library — value cards + the functional add / reorder / remove affordances (issue #296).
 * Rename (EN/Twi) and session prompt edits apply IMMEDIATELY (VLC_CONFIG_WRITE_ROLES). Add / reorder /
 * remove are STRUCTURAL: they do NOT change the library directly — they PROPOSE a change that the
 * Headmaster approves in the pending panel. `canEdit` = Dean/Admin (may propose + rename); a read-only
 * HM/FM sees the cards without any control. Copy is neutral ("student support" curriculum).
 */
export function CurriculumLibrary({
  values,
  canEdit,
}: {
  values: VlcValueView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<VlcValueView[]>(values);
  const [error, setError] = useState<string | null>(null);

  // Reorder only makes sense once a school is seeded (every card has a real row id) and has ≥2 values.
  const canReorder = canEdit && values.length >= 2 && values.every((v) => v.id !== null);

  function startReorder() {
    setOrder(values);
    setError(null);
    setReordering(true);
  }
  function move(index: number, delta: number) {
    setOrder((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }
  function submitOrder() {
    setError(null);
    startTransition(async () => {
      const ids = order.map((v) => v.id).filter((id): id is string => id !== null);
      const res = await proposeReorderValues({ order: ids });
      if (!res.ok) return setError(res.error ?? "Could not submit the new order.");
      setReordering(false);
      router.refresh();
    });
  }

  if (reordering) {
    return (
      <div className="rounded-2xl border border-gold bg-gold-bg p-4">
        <div className="mb-3 text-[11px] font-semibold text-navy-3">
          Set the new order, then propose it. The change applies once the Headmaster approves.
        </div>
        <ol className="space-y-2">
          {order.map((v, i) => (
            <li
              key={v.id ?? v.ordinal}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
            >
              <span className="w-6 text-center font-display text-sm font-semibold italic text-gold-soft">
                {i + 1}
              </span>
              <b className="flex-1 font-semibold text-navy">{v.nameEn}</b>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0 || pending}
                aria-label={`Move ${v.nameEn} up`}
                className="rounded-md border border-border-2 bg-surface px-2 py-1 text-[11px] font-semibold text-navy hover:bg-gold-bg disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1 || pending}
                aria-label={`Move ${v.nameEn} down`}
                className="rounded-md border border-border-2 bg-surface px-2 py-1 text-[11px] font-semibold text-navy hover:bg-gold-bg disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        {error && <p className="mt-2 text-[11px] font-semibold text-terra">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => setReordering(false)}
            disabled={pending}
            className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submitOrder}
            disabled={pending}
            className="rounded-md bg-navy px-3.5 py-1.5 text-[11px] font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Propose this order"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {canReorder && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={startReorder}
            className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy hover:bg-gold-bg"
          >
            Reorder values
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {values.map((v) => (
          <ValueCard key={v.ordinal} value={v} canEdit={canEdit} />
        ))}
        {canEdit && <AddValueTile />}
      </div>
    </>
  );
}

function ValueCard({ value, canEdit }: { value: VlcValueView; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState(value.nameEn);
  const [nameTwi, setNameTwi] = useState(value.nameTwi ?? "");
  const [aTitle, setATitle] = useState(value.sessionA?.title ?? "");
  const [aPrompt, setAPrompt] = useState(value.sessionA?.prompt ?? "");
  const [bTitle, setBTitle] = useState(value.sessionB?.title ?? "");
  const [bPrompt, setBPrompt] = useState(value.sessionB?.prompt ?? "");

  // A coalesced default (unseeded school) has no row id — read-only even for a Dean until seeded.
  const canEditThis = canEdit && value.id !== null;

  function cancel() {
    setNameEn(value.nameEn);
    setNameTwi(value.nameTwi ?? "");
    setATitle(value.sessionA?.title ?? "");
    setAPrompt(value.sessionA?.prompt ?? "");
    setBTitle(value.sessionB?.title ?? "");
    setBPrompt(value.sessionB?.prompt ?? "");
    setEditing(false);
    setConfirmRemove(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      // The value rename + each session prompt are three distinct actions (one per entity); dispatch
      // only the ones that changed and have a row id.
      if (value.id && (nameEn !== value.nameEn || nameTwi !== (value.nameTwi ?? ""))) {
        const res = await updateVlcValue({ id: value.id, nameEn, nameTwi });
        if (!res.ok) return setError(res.error ?? "Could not save the value.");
      }
      if (
        value.sessionA?.id &&
        (aTitle !== value.sessionA.title || aPrompt !== (value.sessionA.prompt ?? ""))
      ) {
        const res = await updateVlcSessionTemplate({
          id: value.sessionA.id,
          title: aTitle,
          prompt: aPrompt,
        });
        if (!res.ok) return setError(res.error ?? "Could not save session A.");
      }
      if (
        value.sessionB?.id &&
        (bTitle !== value.sessionB.title || bPrompt !== (value.sessionB.prompt ?? ""))
      ) {
        const res = await updateVlcSessionTemplate({
          id: value.sessionB.id,
          title: bTitle,
          prompt: bPrompt,
        });
        if (!res.ok) return setError(res.error ?? "Could not save session B.");
      }
      setEditing(false);
      router.refresh();
    });
  }

  // Remove is STRUCTURAL — it proposes a soft-archive for the Headmaster to approve; it does not remove
  // the value now (and never deletes — session history is preserved).
  function proposeRemove() {
    if (!value.id) return;
    setError(null);
    startTransition(async () => {
      const res = await proposeRemoveValue({ valueId: value.id });
      if (!res.ok) return setError(res.error ?? "Could not propose removal.");
      setEditing(false);
      setConfirmRemove(false);
      router.refresh();
    });
  }

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-border bg-surface p-4">
      <div className="absolute right-3.5 top-3 font-display text-3xl font-medium italic leading-none text-gold-soft">
        {String(value.ordinal).padStart(2, "0")}
      </div>

      {!editing ? (
        <>
          <h4 className="pr-10 font-display text-lg font-semibold leading-tight text-navy">
            {value.nameEn}
          </h4>
          <div className="mb-2.5 border-b border-dashed border-border pb-2 text-[11px] italic text-navy-3">
            {[value.nameTwi, value.descriptor].filter(Boolean).join(" · ")}
            {value.capstone && (
              <span className="ml-1 font-semibold not-italic text-terra">capstone</span>
            )}
          </div>
          <Session tag="A" session={value.sessionA} />
          <Session tag="B" session={value.sessionB} />
          {canEditThis && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setEditing(true)}
                className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy hover:bg-gold-bg"
              >
                Edit
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2 pr-10">
          <Field label="Value name (English)" value={nameEn} onChange={setNameEn} />
          <Field label="Twi name" value={nameTwi} onChange={setNameTwi} />
          <div className="rounded-md bg-bg p-2.5">
            <div className="mb-1 font-display text-[11px] font-semibold italic text-gold">
              Session A · intro
            </div>
            <Field label="Title" value={aTitle} onChange={setATitle} />
            <Field label="Prompt" value={aPrompt} onChange={setAPrompt} />
          </div>
          <div className="rounded-md bg-bg p-2.5">
            <div className="mb-1 font-display text-[11px] font-semibold italic text-gold">
              Session B · application
            </div>
            <Field label="Title" value={bTitle} onChange={setBTitle} />
            <Field label="Prompt" value={bPrompt} onChange={setBPrompt} />
          </div>
          {error && <p className="text-[11px] font-semibold text-terra">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!confirmRemove ? (
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={pending}
                className="text-[11px] font-semibold text-terra hover:underline disabled:opacity-50"
              >
                Propose removal
              </button>
            ) : (
              <button
                onClick={proposeRemove}
                disabled={pending}
                className="rounded-md border border-terra bg-terra-bg px-2.5 py-1 text-[11px] font-semibold text-terra disabled:opacity-50"
              >
                {pending ? "Submitting…" : "Confirm — send to Headmaster"}
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={cancel}
                disabled={pending}
                className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-md bg-navy px-3.5 py-1.5 text-[11px] font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Session({
  tag,
  session,
}: {
  tag: "A" | "B";
  session: VlcValueView["sessionA"];
}) {
  if (!session) return null;
  return (
    <div className="flex gap-2 py-1 text-[11px] leading-snug text-navy-2">
      <span className="w-3.5 shrink-0 font-display text-xs font-semibold italic text-gold">
        {tag}
      </span>
      <div>
        <b className="font-semibold text-navy">{session.title}</b>
        {session.prompt ? ` · ${session.prompt}` : ""}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium text-navy-3">{label}</span>
      <input className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * The add-value affordance — now FUNCTIONAL (issue #296). Collapsed to a tile; on click it opens a form
 * that PROPOSES a new value (name, Twi, descriptor, term group, capstone, two sessions) for the
 * Headmaster to approve. Nothing lands on the library until approval.
 */
function AddValueTile() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameTwi, setNameTwi] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [termGroup, setTermGroup] = useState("1");
  const [capstone, setCapstone] = useState(false);
  const [aTitle, setATitle] = useState("");
  const [aPrompt, setAPrompt] = useState("");
  const [bTitle, setBTitle] = useState("");
  const [bPrompt, setBPrompt] = useState("");

  function reset() {
    setNameEn("");
    setNameTwi("");
    setDescriptor("");
    setTermGroup("1");
    setCapstone(false);
    setATitle("");
    setAPrompt("");
    setBTitle("");
    setBPrompt("");
    setError(null);
    setOpen(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await proposeAddValue({
        nameEn,
        nameTwi,
        descriptor,
        termGroup,
        capstone,
        sessionA: { title: aTitle, prompt: aPrompt },
        sessionB: { title: bTitle, prompt: bPrompt },
      });
      if (!res.ok) return setError(res.error ?? "Could not submit the proposal.");
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-[170px] items-center justify-center rounded-[10px] border border-dashed border-border-2 bg-bg p-4 text-center hover:border-gold hover:bg-gold-bg"
      >
        <div>
          <div className="font-display text-[32px] italic leading-none text-gold-soft">+</div>
          <div className="mt-1.5 text-[11px] font-semibold text-navy-3">Propose a new value</div>
          <div className="mt-1.5 text-[10px] italic leading-relaxed text-navy-3">
            Configurable · Dean or Admin proposes · applies once the Headmaster approves
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-gold bg-surface p-4">
      <div className="font-display text-sm font-semibold text-navy">Propose a new value</div>
      <Field label="Value name (English)" value={nameEn} onChange={setNameEn} />
      <Field label="Twi name" value={nameTwi} onChange={setNameTwi} />
      <Field label="Descriptor" value={descriptor} onChange={setDescriptor} />
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="mb-0.5 block text-[10px] font-medium text-navy-3">Term group</span>
          <select
            className={fieldClass}
            value={termGroup}
            onChange={(e) => setTermGroup(e.target.value)}
          >
            <option value="1">1 · Foundations</option>
            <option value="2">2 · Interpersonal</option>
            <option value="3">3 · Integration</option>
          </select>
        </label>
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-navy-2">
          <input type="checkbox" checked={capstone} onChange={(e) => setCapstone(e.target.checked)} />
          Capstone
        </label>
      </div>
      <div className="rounded-md bg-bg p-2.5">
        <div className="mb-1 font-display text-[11px] font-semibold italic text-gold">Session A · intro</div>
        <Field label="Title" value={aTitle} onChange={setATitle} />
        <Field label="Prompt" value={aPrompt} onChange={setAPrompt} />
      </div>
      <div className="rounded-md bg-bg p-2.5">
        <div className="mb-1 font-display text-[11px] font-semibold italic text-gold">Session B · application</div>
        <Field label="Title" value={bTitle} onChange={setBTitle} />
        <Field label="Prompt" value={bPrompt} onChange={setBPrompt} />
      </div>
      {error && <p className="text-[11px] font-semibold text-terra">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={reset}
          disabled={pending}
          className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-navy px-3.5 py-1.5 text-[11px] font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Propose to Headmaster"}
        </button>
      </div>
    </div>
  );
}
