"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendReply } from "@/lib/actions/inbox";

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    const res = await sendReply({ conversationId, body });
    setSending(false);
    if (res.ok) {
      setBody("");
      router.refresh();
    } else setError(res.error ?? "Could not send.");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Type a reply… (sent by SMS)"
        className="w-full resize-none rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface"
      />
      <div className="mt-2 flex items-center justify-between">
        {error ? (
          <span className="text-sm text-terra">{error}</span>
        ) : (
          <span className="text-xs text-navy-3">{body.length}/1000</span>
        )}
        <button
          onClick={send}
          disabled={sending || !body.trim()}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </div>
  );
}
