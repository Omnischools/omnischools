"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postAnnouncement, createTemplate } from "@/lib/actions/comms";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function AnnouncementComposer({
  classOptions,
}: {
  classOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [audience, setAudience] = useState("WHOLE_SCHOOL");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function action(formData: FormData) {
    setBusy(true);
    setError(null);
    const res = await postAnnouncement({
      title: formData.get("title"),
      body: formData.get("body"),
      audience: formData.get("audience"),
      classId: formData.get("classId"),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      router.refresh();
    } else setError(res.error ?? "Error");
  }

  return (
    <form
      action={action}
      className="bg-surface space-y-3 rounded-xl border border-border p-5"
    >
      <div>
        <label className={labelClass}>Title</label>
        <input name="title" required className={fieldClass} />
      </div>
      <div>
        <label className={labelClass}>Message</label>
        <textarea
          name="body"
          required
          className={`${fieldClass} min-h-[90px] resize-y`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Audience</label>
          <select
            name="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className={fieldClass}
          >
            <option value="WHOLE_SCHOOL">Whole school</option>
            <option value="CLASS">A class</option>
          </select>
        </div>
        {audience === "CLASS" && (
          <div>
            <label className={labelClass}>Class</label>
            <select name="classId" defaultValue="" required className={fieldClass}>
              <option value="" disabled>
                Choose
              </option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
      {done && <p className="text-sm text-green">✓ Announcement posted.</p>}
      <button
        type="submit"
        disabled={busy}
        onClick={() => setDone(false)}
        className="text-bg rounded-md bg-navy px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Posting…" : "Post announcement"}
      </button>
    </form>
  );
}

export function TemplateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border-border-2 bg-surface rounded-md border px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
      >
        + New template
      </button>
    );
  }
  async function action(formData: FormData) {
    setBusy(true);
    setError(null);
    const res = await createTemplate({
      name: formData.get("name"),
      body: formData.get("body"),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error ?? "Error");
  }
  return (
    <form
      action={action}
      className="bg-surface space-y-2 rounded-xl border border-border p-4"
    >
      <input name="name" required placeholder="Template name" className={fieldClass} />
      <textarea
        name="body"
        required
        placeholder="Message — use {student_first} and {school_short} as placeholders"
        className={`${fieldClass} min-h-[70px] resize-y`}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-bg rounded-md bg-navy px-4 py-2 text-sm font-semibold hover:bg-navy-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save template"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 text-sm text-navy-3"
        >
          cancel
        </button>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
    </form>
  );
}
