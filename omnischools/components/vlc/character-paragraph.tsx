"use client";
/**
 * 🔴 INCR-43b — the VLC CHARACTER PARAGRAPH card (SHS module 4.5): the FM-authored school-leaver reference
 * paragraph, rendered on the slim `/senior/vlc/reference/[studentId]` route ONLY (never the 43a journal page —
 * that would breach the shipped scope fence). The server gates + fetches (getCharacterParagraph) and passes a
 * plain, pre-formatted view; this component never imports the reader.
 *
 * Owner #6 — FM-AUTHORED, NO AI: the copy NEVER implies a machine drafted / summarised / regenerates the
 * paragraph. Omit-not-faked: no "auto-drafted / auto-generated / generated from N entries / regenerates /
 * DRAFT · N OF 22 sessions", no placeholder body. What ships is an honest author-stamp provenance + a draft
 * the FM writes, with real Edit + "Lock for year-end" writes for the author (own-class FM / Dean).
 *
 * The HEADMASTER sees this card READ-ONLY (`canWrite=false` → no Edit/Lock mounts), and only once finalised —
 * the server reader withholds a draft from him. Every write re-checks the gate server-side, so the hidden
 * button is convenience; the action is the boundary.
 *
 * No-alpha token discipline (memory `no-alpha-token-opacity`): the navy confidential panel uses SOLID tokens
 * only — `bg-navy` / `bg-navy-2` ground, SOLID `text-gold-soft` (never `text-gold-soft/70`), `border-navy-3`
 * divider, `bg-warn text-navy` (DRAFT) / `bg-green text-bg` (LOCKED) pills. Verify tints in the live preview.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SectionHead } from "@/components/vlc/chrome";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { saveCharacterParagraph, lockCharacterParagraph } from "@/lib/actions/vlc-paragraph";

export interface ParagraphCardData {
  body: string;
  locked: boolean;
  provenanceLabel: string;
}

export function CharacterParagraphCard({
  studentId,
  studentName,
  formLabel,
  classLabel,
  paragraph,
  canWrite,
}: {
  studentId: string;
  studentName: string;
  formLabel: string | null;
  classLabel: string | null;
  paragraph: ParagraphCardData | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(paragraph?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const locked = paragraph?.locked ?? false;
  const classCrumb = [classLabel, formLabel].filter(Boolean).join(" · ") || "—";

  const save = () => {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await saveCharacterParagraph({ studentId, body });
      if (!res.ok) setError(res.error ?? "Could not save the paragraph.");
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  const lock = () => {
    if (pending) return;
    setLockError(null);
    start(async () => {
      const res = await lockCharacterParagraph({ studentId });
      if (!res.ok) setLockError(res.error ?? "Could not lock the paragraph.");
      else {
        setConfirmLock(false);
        router.refresh();
      }
    });
  };

  return (
    <section aria-label="School-leaver character paragraph">
      <SectionHead
        eyebrow="Year-end output · school-leaver character paragraph"
        meta="Goes on the school-leaver reference letter, not the transcript"
      >
        The <em className="italic text-gold">character paragraph</em>
      </SectionHead>

      {/* the navy confidential panel — SOLID tokens throughout (no-alpha trap) */}
      <div className="rounded-2xl border border-navy bg-navy p-6 text-bg">
        {/* head: provenance + title + status/visibility pills, over a solid divider */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-navy-3 pb-4">
          <div className="min-w-[240px]">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft">
              {paragraph ? paragraph.provenanceLabel : "Not started"}
            </div>
            <h2 className="mt-1 font-display text-2xl font-semibold text-bg">
              Character paragraph
              <em className="italic text-gold">
                {" "}
                · {studentName} · {classCrumb}
              </em>
            </h2>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`rounded-full px-[11px] py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${
                locked ? "bg-green text-bg" : "bg-warn text-navy"
              }`}
            >
              {locked ? "Locked · year-end" : "Draft"}
            </span>
            {/* the "+ HM" label — the ONE wider-read VLC panel; deliberately NOT the casework "FM + DEAN ONLY" */}
            <span className="rounded-full bg-gold px-[11px] py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-navy">
              FM + Dean + HM
            </span>
          </div>
        </div>

        {/* body — the FM's own free text (whitespace-pre-wrap), or the honest empty state */}
        {paragraph ? (
          <div className="mt-4 rounded-xl border border-navy-3 bg-navy-2 px-5 py-4">
            <p className="whitespace-pre-wrap font-display text-[14px] leading-relaxed text-bg">
              {paragraph.body}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13px] italic text-gold-soft">
            {canWrite
              ? `No character paragraph yet — write ${studentName}'s school-leaver reference.`
              : `The Form Master has not yet written ${studentName}'s character paragraph.`}
          </p>
        )}

        {/* foot: the honest ownership note + the author's affordances (hidden for HM + once locked) */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-gold-soft">
            Written and owned by the Form Master · appears on the school-leaver reference letter, not the
            transcript
            {locked ? " · locked — final for the reference letter" : ""}
          </p>
          {canWrite && !locked && !editing && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBody(paragraph?.body ?? "");
                  setError(null);
                  setEditing(true);
                }}
                className="rounded-md border border-gold-soft bg-navy-2 px-3 py-1.5 text-[11px] font-bold text-gold hover:brightness-110"
              >
                {paragraph ? "Edit draft" : "Write the paragraph"}
              </button>
              {paragraph && (
                <button
                  type="button"
                  onClick={() => {
                    setLockError(null);
                    setConfirmLock(true);
                  }}
                  className="rounded-md border border-gold bg-gold px-3 py-1.5 text-[11px] font-bold text-navy hover:brightness-95"
                >
                  Lock for year-end
                </button>
              )}
            </div>
          )}
        </div>

        {/* the inline editor (mirrors CaseEditor) — bg-surface/text-navy textarea on the navy card */}
        {canWrite && !locked && editing && (
          <div className="mt-4 rounded-xl border border-gold-soft bg-navy-2 p-3">
            <textarea
              value={body}
              maxLength={3000}
              rows={10}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the Form Master's character paragraph for the school-leaver reference letter…"
              className="w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] leading-relaxed text-navy"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending || !body.trim()}
                className="rounded-md border border-gold bg-gold px-4 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="rounded-md border border-gold-soft bg-navy px-3 py-2 text-xs font-bold text-gold-soft hover:brightness-110"
              >
                Cancel
              </button>
            </div>
            {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
          </div>
        )}
        {error && !editing && <p className="mt-2 text-[12px] text-terra">{error}</p>}
      </div>

      <ConfirmDialog
        open={confirmLock}
        title="Lock the character paragraph?"
        message="Locking freezes the paragraph for the year-end reference letter — you can't edit it after."
        confirmLabel="Lock for year-end"
        busyLabel="Locking…"
        busy={pending}
        error={lockError}
        tone="gold"
        onConfirm={lock}
        onClose={() => setConfirmLock(false)}
      />
    </section>
  );
}
