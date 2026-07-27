"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVlcValue, updateVlcSessionTemplate } from "@/lib/actions/vlc";
import type { VlcValueView } from "@/lib/vlc/setup-data";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-[12px] text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

/**
 * The curriculum library — 11 value cards + the (deferred) add-value tile. In F0 every card renders
 * in ONE neutral base style (no live taught/current/upcoming — there are no sessions yet); "capstone"
 * is the one config marker (a static property of value 11). Editable when `canEdit`: rename the value
 * (EN/Twi) and edit each session's A/B title + prompt. Add / reorder / remove are DEFERRED (R291) —
 * the "+ Add a value" tile renders as an inert affordance.
 */
export function CurriculumLibrary({
  values,
  canEdit,
}: {
  values: VlcValueView[];
  canEdit: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      {values.map((v) => (
        <ValueCard key={v.ordinal} value={v} canEdit={canEdit} />
      ))}
      {canEdit && <AddValueTile />}
    </div>
  );
}

function ValueCard({ value, canEdit }: { value: VlcValueView; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
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
          <div className="flex justify-end gap-2">
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

/** The add-value affordance — copy verbatim; the form is DEFERRED to the next-year config (R291). */
function AddValueTile() {
  return (
    <div
      className="flex min-h-[170px] items-center justify-center rounded-[10px] border border-dashed border-border-2 bg-bg p-4 text-center"
      aria-disabled
    >
      <div>
        <div className="font-display text-[32px] italic leading-none text-gold-soft">+</div>
        <div className="mt-1.5 text-[11px] font-semibold text-navy-3">
          Add a value to next year&apos;s curriculum
        </div>
        <div className="mt-1.5 text-[10px] italic leading-relaxed text-navy-3">
          Year-by-year configurable · admin only · changes apply next academic year
        </div>
      </div>
    </div>
  );
}
