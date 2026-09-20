"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startConversation } from "@/lib/actions/inbox";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export function NewConversationForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await startConversation({
      contactPhone: formData.get("contactPhone"),
      contactName: formData.get("contactName"),
      subject: formData.get("subject"),
      body: formData.get("body"),
    });
    setSaving(false);
    if (res.ok && res.id) router.push(`/inbox/${res.id}`);
    else setError(res.error ?? "Could not start the conversation.");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        + New message
      </button>
    );
  }

  return (
    <form
      action={action}
      className="w-full space-y-3 rounded-xl border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Parent phone</label>
          <input
            name="contactPhone"
            required
            placeholder="024 000 0000"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Name <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input name="contactName" className={fieldClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>
          Subject <span className="font-medium text-navy-3">— optional</span>
        </label>
        <input name="subject" placeholder="Re: fees" className={fieldClass} />
      </div>
      <div>
        <label className={labelClass}>Message</label>
        <textarea name="body" required rows={3} className={fieldClass} />
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Sending…" : "Send message"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="px-3 py-2.5 text-sm font-semibold text-navy-2 hover:text-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
