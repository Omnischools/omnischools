"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCensusHandFill, markCensusCompleted } from "@/lib/actions/census";
import type { CensusHandFill } from "@/lib/reports/census/hand-fill-schema";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL } from "@/lib/sen/vocab";

/**
 * GOV-9 / GOV-9b · the census completion panel (management-gated by the page + the actions). Appears once a
 * DRAFT row exists: a Download-PDF link (DRAFT or COMPLETED) + Mark-completed (which locks the filing). For an
 * **ANNUAL** run it also shows the hand-fill form for the sections Omnischools doesn't track (an un-entered
 * section stays blank → the PDF prints a hatched blank, never a 0); §5 is hand-filled here ONLY when the SEN
 * register is not adopted. A **MID_YEAR** run has NO hand-fill (every mid-year section is auto) — just download
 * + complete.
 */

const inputCls =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";
const capCls = "text-[11px] font-semibold uppercase tracking-wide text-navy-3";

type Existing = { status: string; handFill: CensusHandFill } | null;
type Cadence = "MID_YEAR" | "ANNUAL";

export function CensusCompletionPanel({
  cadence,
  academicYear,
  existing,
  senAdopted,
}: {
  cadence: Cadence;
  academicYear: string;
  existing: Existing;
  senAdopted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hf = existing?.handFill ?? { version: 1 as const };
  const status = existing?.status ?? null;
  const locked = status === "COMPLETED";
  const annual = cadence === "ANNUAL";
  const label = annual ? "annual" : "mid-year";
  const pdfHref = `/api/reports/statutory/census?cadence=${cadence}&year=${encodeURIComponent(academicYear)}`;

  if (status === null) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-lg font-semibold text-navy">Complete &amp; file the {label} census</h2>
        <p className="mt-1 text-sm text-navy-3">
          Generate the census above first. Then you can{annual ? " hand-fill the sections Omnischools doesn't track," : ""} download the print-and-sign PDF and mark it completed.
        </p>
      </section>
    );
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const n = (k: string): number | null => {
      const v = fd.get(k);
      return v == null || v === "" ? null : Number(v);
    };
    const str = (k: string): string | null => {
      const v = fd.get(k);
      return v && String(v).trim() ? String(v).trim() : null;
    };
    const some = (...vals: (number | null)[]) => vals.some((v) => v != null);

    const repetition = some(n("rep_m"), n("rep_f")) ? { male: n("rep_m") ?? 0, female: n("rep_f") ?? 0 } : null;
    const qualifications = some(n("q_tm"), n("q_tf"), n("q_um"), n("q_uf"))
      ? { trainedMale: n("q_tm") ?? 0, trainedFemale: n("q_tf") ?? 0, untrainedMale: n("q_um") ?? 0, untrainedFemale: n("q_uf") ?? 0 }
      : null;
    const movementExits = some(n("mv_w"), n("mv_ti"), n("mv_to"))
      ? { withdrawals: n("mv_w") ?? 0, transfersIn: n("mv_ti") ?? 0, transfersOut: n("mv_to") ?? 0 }
      : null;
    const feedingParticipates = fd.get("feed_part") === "on";
    const feeding = feedingParticipates || n("feed_fed") != null || str("feed_caterer")
      ? { participates: feedingParticipates, pupilsFed: n("feed_fed"), caterer: str("feed_caterer") }
      : null;
    const textbooksNote = str("txt_note");
    const textbooksAdequate = fd.get("txt_adequate") === "on";
    const textbooks = textbooksAdequate || textbooksNote ? { adequate: textbooksAdequate, note: textbooksNote } : null;

    let specialNeeds: Record<string, { male: number; female: number }> | null = null;
    if (!senAdopted) {
      const sn: Record<string, { male: number; female: number }> = {};
      let any = false;
      for (const c of SEN_CATEGORY_ORDER) {
        const m = n(`sen_${c}_m`);
        const f = n(`sen_${c}_f`);
        if (m != null || f != null) {
          sn[c] = { male: m ?? 0, female: f ?? 0 };
          any = true;
        }
      }
      specialNeeds = any ? sn : null;
    }

    setBusy(true);
    setMsg(null);
    const res = await saveCensusHandFill({
      academicYear,
      handFill: { repetition, qualifications, movementExits, feeding, textbooks, specialNeeds },
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Hand-fill saved." });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error });
    }
  }

  async function onComplete() {
    setBusy(true);
    setMsg(null);
    const res = await markCensusCompleted({ academicYear, cadence });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Census marked completed and locked." });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error });
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-navy">Complete &amp; file the {label} census</h2>
          <p className="text-sm text-navy-3">
            {locked ? (
              <>
                <b className="text-green">Completed &amp; locked.</b> Download the official filing to print, sign
                and stamp.
              </>
            ) : annual ? (
              <>
                Hand-fill the sections below (leave blank to complete in pen), then download the print-and-sign
                PDF. Marking completed locks the filing.
              </>
            ) : (
              <>Download the print-and-sign PDF, then sign and stamp. Marking completed locks the filing.</>
            )}
          </p>
        </div>
        <a
          href={pdfHref}
          className="shrink-0 rounded-md bg-navy px-4 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep"
        >
          Download PDF →
        </a>
      </div>

      {annual && !locked && (
        <form onSubmit={onSave} className="space-y-4">
          <Group title="Repetition (repeaters)">
            <Num name="rep_m" label="Boys" def={hf.repetition?.male} />
            <Num name="rep_f" label="Girls" def={hf.repetition?.female} />
          </Group>
          <Group title="Staff qualifications">
            <Num name="q_tm" label="Trained · M" def={hf.qualifications?.trainedMale} />
            <Num name="q_tf" label="Trained · F" def={hf.qualifications?.trainedFemale} />
            <Num name="q_um" label="Untrained · M" def={hf.qualifications?.untrainedMale} />
            <Num name="q_uf" label="Untrained · F" def={hf.qualifications?.untrainedFemale} />
          </Group>
          <Group title="Movement — full-year exits">
            <Num name="mv_w" label="Withdrawals" def={hf.movementExits?.withdrawals} />
            <Num name="mv_ti" label="Transfers in" def={hf.movementExits?.transfersIn} />
            <Num name="mv_to" label="Transfers out" def={hf.movementExits?.transfersOut} />
          </Group>
          <Group title="School feeding (GSFP)">
            <Check name="feed_part" label="Participates" def={hf.feeding?.participates} />
            <Num name="feed_fed" label="Pupils fed daily" def={hf.feeding?.pupilsFed ?? undefined} />
            <Text name="feed_caterer" label="Caterer" def={hf.feeding?.caterer ?? undefined} />
          </Group>
          <Group title="Textbooks">
            <Check name="txt_adequate" label="Adequate" def={hf.textbooks?.adequate} />
            <Text name="txt_note" label="Note" def={hf.textbooks?.note ?? undefined} />
          </Group>
          {!senAdopted && (
            <Group title="Special needs §5 (SEN register not adopted — enter de-identified counts)">
              {SEN_CATEGORY_ORDER.map((c) => (
                <div key={c} className="col-span-2 grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <span className="text-sm text-navy-2">{SEN_CATEGORY_LABEL[c]}</span>
                  <Num name={`sen_${c}_m`} label="B" def={hf.specialNeeds?.[c]?.male} narrow />
                  <Num name={`sen_${c}_f`} label="G" def={hf.specialNeeds?.[c]?.female} narrow />
                </div>
              ))}
            </Group>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save hand-fill"}
            </button>
            <CompleteButton onClick={onComplete} busy={busy} />
            {msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
          </div>
        </form>
      )}

      {!annual && !locked && (
        <div className="flex flex-wrap items-center gap-3">
          <CompleteButton onClick={onComplete} busy={busy} />
          {msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
        </div>
      )}

      {locked && msg && <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>}
    </section>
  );
}

function CompleteButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md bg-green px-4 py-2.5 text-sm font-bold text-bg hover:opacity-90 disabled:opacity-60"
    >
      Mark completed &amp; lock
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border bg-bg p-3">
      <legend className={capCls}>{title}</legend>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </fieldset>
  );
}
function Num({ name, label, def, narrow }: { name: string; label: string; def?: number | null; narrow?: boolean }) {
  return (
    <label className="block">
      <span className={capCls}>{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        defaultValue={def ?? ""}
        className={`${inputCls} ${narrow ? "w-16" : ""}`}
      />
    </label>
  );
}
function Text({ name, label, def }: { name: string; label: string; def?: string }) {
  return (
    <label className="block">
      <span className={capCls}>{label}</span>
      <input type="text" name={name} defaultValue={def ?? ""} className={inputCls} />
    </label>
  );
}
function Check({ name, label, def }: { name: string; label: string; def?: boolean }) {
  return (
    <label className="flex items-center gap-2 pt-5 text-sm text-navy-2">
      <input type="checkbox" name={name} defaultChecked={def ?? false} />
      {label}
    </label>
  );
}
