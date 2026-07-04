"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import {
  deleteTemplate,
  duplicateTemplate,
  resolveTemplate,
  submitTemplate,
} from "@/lib/actions/whatsapp-templates";

const primaryBtn =
  "rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60";
const ghostBtn =
  "rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-gold disabled:opacity-60";
const dangerBtn =
  "rounded-md border border-terra bg-terra-bg px-4 py-2.5 text-sm font-semibold text-terra transition-colors hover:opacity-90 disabled:opacity-60";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; id?: string }>,
    onOk?: (id?: string) => void,
  ) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      if (onOk) onOk(res.id);
      else router.refresh();
    });
  };
  return { router, pending, error, run };
}

/** DRAFT: Submit + Delete (Edit is a plain link rendered on the page). */
export function DraftActions({ id }: { id: string }) {
  const { router, pending, error, run } = useAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={primaryBtn}
          onClick={() =>
            run(
              () => submitTemplate({ id }),
              () => router.refresh(),
            )
          }
        >
          {pending ? "Working…" : "Submit for review"}
        </button>
        <button
          type="button"
          disabled={pending}
          className={dangerBtn}
          onClick={() => {
            if (confirm("Delete this draft? This can't be undone."))
              run(
                () => deleteTemplate({ id }),
                () => router.push("/settings/channels/whatsapp/templates"),
              );
          }}
        >
          Delete
        </button>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
    </div>
  );
}

/**
 * PENDING: the dev stand-in for Meta's approval callback. Once the WhatsApp
 * Business API is wired a webhook resolves this automatically.
 */
export function ResolveActions({ id }: { id: string }) {
  const { pending, error, run } = useAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded-md bg-green px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:opacity-90 disabled:opacity-60"
          onClick={() => run(() => resolveTemplate({ id, decision: "APPROVED" }))}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          className={dangerBtn}
          onClick={() => setRejectOpen(true)}
        >
          Reject…
        </button>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}

      {rejectOpen && (
        <Modal open onClose={() => setRejectOpen(false)} title="Reject template">
          <div className="space-y-3">
            <p className="text-sm text-navy-3">
              Give a reason — it stands in for Meta&apos;s rejection note and shows on the
              template.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="e.g. Body contains promotional content in a Utility template"
              className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pending}
                className={dangerBtn}
                onClick={() =>
                  run(
                    () => resolveTemplate({ id, decision: "REJECTED", reason }),
                    () => setRejectOpen(false),
                  )
                }
              >
                {pending ? "Working…" : "Reject template"}
              </button>
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                className="px-3 py-2.5 text-sm font-semibold text-navy-2 hover:text-navy"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** APPROVED / REJECTED: Duplicate as a new version + Delete. */
export function ResolvedActions({ id }: { id: string }) {
  const { router, pending, error, run } = useAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={ghostBtn}
          onClick={() =>
            run(
              () => duplicateTemplate({ id }),
              (newId) => {
                if (newId)
                  router.push(`/settings/channels/whatsapp/templates/${newId}/edit`);
                else router.refresh();
              },
            )
          }
        >
          {pending ? "Working…" : "Duplicate as new version"}
        </button>
        <button
          type="button"
          disabled={pending}
          className={dangerBtn}
          onClick={() => {
            if (confirm("Delete this template? This can't be undone."))
              run(
                () => deleteTemplate({ id }),
                () => router.push("/settings/channels/whatsapp/templates"),
              );
          }}
        >
          Delete
        </button>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
    </div>
  );
}
