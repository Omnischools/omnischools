"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendParentMessage } from "@/lib/actions/parent-comms";

/**
 * INCR-COMM · the parent's compose box — the FIRST interactive parent-portal control. Calls the
 * `sendParentMessage` server action ONLY (no server-only import, so it can be a client component). In-app
 * framing, never "via SMS" (Lucy §6 guardrail). On success it clears + `router.refresh()` so the server
 * component re-reads the thread; on error it shows the action's message inline.
 */
const MAX = 1000;

export function Compose({ childFirstName }: { childFirstName: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const trimmed = body.trim();
  const tooLong = body.length > MAX;
  const canSend = trimmed.length > 0 && !tooLong && !pending;

  function submit() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const res = await sendParentMessage({ body });
      if (res.ok) {
        setBody("");
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't send your message. Please try again.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <label htmlFor="parent-message" className="text-[11px] font-semibold text-navy-3">
        Message the school about {childFirstName}
      </label>
      <textarea
        id="parent-message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        rows={3}
        placeholder="Write a message to the school…"
        className="mt-2 w-full resize-none rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy outline-none focus:border-gold disabled:opacity-60"
      />
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className={"font-mono text-[10px] " + (tooLong ? "text-terra" : "text-navy-3")}>
          {body.length} / {MAX}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="rounded-md bg-navy px-5 py-2 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-terra">{error}</p>}
      <p className="mt-1.5 text-[10px] text-navy-3">
        This goes to the school office in the app. They&apos;ll reply here.
      </p>
    </section>
  );
}
