"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { TOPICS, topicLabel } from "@/lib/inbox/topics";
import {
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  moveRule,
  saveFallback,
} from "@/lib/actions/inbox-routing";

export type StaffOption = { id: string; name: string };

export type RuleRow = {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  isFallback: boolean;
  matchTopic: string | null;
  matchClass: string | null;
  matchKeywords: string | null;
  assignToUserId: string | null;
  notifyAllAdmins: boolean;
};

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

/** The plain-English action clause shared by normal + fallback cards. */
function actionText(assigneeName: string | null, notifyAllAdmins: boolean): string {
  const assign = assigneeName ? `assign to ${assigneeName}` : "leave unassigned";
  return notifyAllAdmins ? `${assign}, notify all admins` : assign;
}

export function InboxRoutingManager({
  rules,
  fallback,
  staff,
}: {
  rules: RuleRow[];
  fallback: RuleRow | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // create / edit form state (null = closed; "new" = create; else editing that rule)
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);

  const staffName = (id: string | null) =>
    id ? (staff.find((s) => s.id === id)?.name ?? "—") : null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-terra bg-terra-bg px-3 py-2 text-sm text-terra">
          {error}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No rules yet — every thread falls through to the fallback below. Add a rule to
          send specific topics or classes to the right person.
        </p>
      ) : (
        <ol className="space-y-3">
          {rules.map((r, i) => (
            <li
              key={r.id}
              className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-bg font-display text-sm font-semibold text-gold">
                {r.position + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[15px] font-semibold text-navy">
                    {r.name}
                  </span>
                  {!r.enabled && (
                    <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-navy-3">
                      Paused
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-navy-3">
                  <RuleSentence rule={r} assigneeName={staffName(r.assignToUserId)} />
                </p>
              </div>

              {/* enabled toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={r.enabled ? "Pause rule" : "Enable rule"}
                disabled={pending}
                onClick={() => run(() => toggleRule({ id: r.id, enabled: !r.enabled }))}
                className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                  r.enabled ? "bg-green" : "bg-border-2"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${
                    r.enabled ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>

              {/* move up / down */}
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={pending || i === 0}
                  onClick={() => run(() => moveRule({ id: r.id, direction: "UP" }))}
                  className="flex h-5 w-5 items-center justify-center rounded text-navy-3 transition-colors hover:bg-bg hover:text-navy disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={pending || i === rules.length - 1}
                  onClick={() => run(() => moveRule({ id: r.id, direction: "DOWN" }))}
                  className="flex h-5 w-5 items-center justify-center rounded text-navy-3 transition-colors hover:bg-bg hover:text-navy disabled:opacity-30"
                >
                  ↓
                </button>
              </div>

              {/* edit / delete */}
              <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="text-gold hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete the rule “${r.name}”?`))
                      run(() => deleteRule({ id: r.id }));
                  }}
                  className="text-terra hover:underline disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* fallback card */}
      {fallback && (
        <div className="flex items-start gap-4 rounded-xl border border-dashed border-border-2 bg-surface p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg font-display text-base font-semibold text-navy-3">
            ∞
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[15px] font-semibold text-navy">
                Fallback
              </span>
              <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-navy-3">
                catches the rest
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-navy-3">
              Any thread no rule above matches →{" "}
              <b className="font-semibold text-navy-2">
                {actionText(staffName(fallback.assignToUserId), fallback.notifyAllAdmins)}
              </b>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(fallback)}
            className="shrink-0 text-xs font-semibold text-gold hover:underline"
          >
            Edit
          </button>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
        >
          + New rule
        </button>
      </div>

      {editing !== null && (
        <RuleForm
          rule={editing === "new" ? null : editing}
          staff={staff}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Builds the bold "When … → action" statement for a rule card. */
function RuleSentence({
  rule,
  assigneeName,
}: {
  rule: RuleRow;
  assigneeName: string | null;
}) {
  const conds: React.ReactNode[] = [];
  if (rule.matchTopic)
    conds.push(
      <>
        topic is <b className="font-semibold text-navy-2">{topicLabel(rule.matchTopic)}</b>
      </>,
    );
  if (rule.matchClass)
    conds.push(
      <>
        class contains <b className="font-semibold text-navy-2">{rule.matchClass}</b>
      </>,
    );
  if (rule.matchKeywords)
    conds.push(
      <>
        message mentions{" "}
        <b className="font-semibold text-navy-2">{rule.matchKeywords}</b>
      </>,
    );

  return (
    <>
      {conds.length === 0 ? (
        <>Any thread</>
      ) : (
        <>
          When{" "}
          {conds.map((c, i) => (
            <span key={i}>
              {i > 0 && " and "}
              {c}
            </span>
          ))}
        </>
      )}{" "}
      →{" "}
      <b className="font-semibold text-navy-2">
        {assigneeName ? `assign to ${assigneeName}` : "leave unassigned"}
      </b>
      {rule.notifyAllAdmins && (
        <span className="text-navy-3"> + notify all admins</span>
      )}
    </>
  );
}

/** Create / edit modal. A fallback rule shows only the action fields. */
function RuleForm({
  rule,
  staff,
  onClose,
  onSaved,
}: {
  rule: RuleRow | null;
  staff: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isFallback = rule?.isFallback ?? false;
  const isEdit = !!rule;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const assignToUserId = (formData.get("assignToUserId") as string) ?? "";
    const notifyAllAdmins = formData.get("notifyAllAdmins") === "on";

    let res: { ok: boolean; error?: string };
    if (isFallback) {
      res = await saveFallback({ assignToUserId, notifyAllAdmins });
    } else if (isEdit && rule) {
      res = await updateRule({
        id: rule.id,
        name: formData.get("name"),
        matchTopic: formData.get("matchTopic"),
        matchClass: formData.get("matchClass"),
        matchKeywords: formData.get("matchKeywords"),
        assignToUserId,
        notifyAllAdmins,
      });
    } else {
      res = await createRule({
        name: formData.get("name"),
        matchTopic: formData.get("matchTopic"),
        matchClass: formData.get("matchClass"),
        matchKeywords: formData.get("matchKeywords"),
        assignToUserId,
        notifyAllAdmins,
      });
    }
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error ?? "Could not save the rule.");
  }

  const title = isFallback ? "Edit fallback" : isEdit ? "Edit rule" : "New routing rule";

  return (
    <Modal open onClose={onClose} title={title}>
      <form action={action} className="space-y-3">
        {!isFallback && (
          <>
            <div>
              <label className={labelClass}>Rule name</label>
              <input
                name="name"
                required
                defaultValue={rule?.name ?? ""}
                placeholder="e.g. Billing to the bursar"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Topic <span className="font-medium text-navy-3">— optional</span>
              </label>
              <select
                name="matchTopic"
                defaultValue={rule?.matchTopic ?? ""}
                className={fieldClass}
              >
                <option value="">Any topic</option>
                {TOPICS.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Class contains{" "}
                <span className="font-medium text-navy-3">— optional</span>
              </label>
              <input
                name="matchClass"
                defaultValue={rule?.matchClass ?? ""}
                placeholder="e.g. JHS 2A or JHS 3"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Keywords{" "}
                <span className="font-medium text-navy-3">— comma-separated, optional</span>
              </label>
              <input
                name="matchKeywords"
                defaultValue={rule?.matchKeywords ?? ""}
                placeholder="e.g. uniform, transport"
                className={fieldClass}
              />
            </div>
            <div className="h-px bg-border" />
          </>
        )}

        <div>
          <label className={labelClass}>Assign to</label>
          <select
            name="assignToUserId"
            defaultValue={rule?.assignToUserId ?? ""}
            className={fieldClass}
          >
            <option value="">— Leave unassigned —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-navy-2">
          <input
            type="checkbox"
            name="notifyAllAdmins"
            defaultChecked={rule?.notifyAllAdmins ?? false}
            className="h-4 w-4 rounded border-border-2 text-gold focus:ring-gold"
          />
          Notify all admins
        </label>

        {error && <p className="text-sm text-terra">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save rule"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2.5 text-sm font-semibold text-navy-2 hover:text-navy"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
