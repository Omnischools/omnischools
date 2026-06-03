"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendSmsToAudience } from "@/lib/actions/comms";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function SmsComposer({
  classOptions,
  templates,
}: {
  classOptions: { id: string; name: string }[];
  templates: { id: string; name: string; body: string }[];
}) {
  const router = useRouter();
  const [audience, setAudience] = useState("WHOLE_SCHOOL");
  const [classId, setClassId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const usingTemplate = templateId !== "";

  async function send() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await sendSmsToAudience({
      audience,
      classId,
      templateId,
      message: usingTemplate ? "" : message,
    });
    setBusy(false);
    if (res.ok) {
      setResult(`Sent ${res.sent} · ${res.failed} failed`);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div className="bg-surface space-y-3 rounded-xl border border-border p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Audience</label>
          <select
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
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Choose</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Template (optional)</label>
        <select
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            const t = templates.find((x) => x.id === e.target.value);
            if (t) setMessage(t.body);
          }}
          className={fieldClass}
        >
          <option value="">— custom message —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>
          Message{" "}
          {usingTemplate && (
            <span className="font-medium text-navy-3">(from template)</span>
          )}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={usingTemplate}
          placeholder="Type a message — {student} and {school} are replaced per recipient"
          className={`${fieldClass} min-h-[80px] resize-y disabled:opacity-70`}
        />
      </div>

      {error && <p className="text-sm text-terra">{error}</p>}
      {result && <p className="text-sm text-green">{result}</p>}
      <p className="text-xs text-navy-3">
        Sends to each student&apos;s primary guardian. {"{student}"} and {"{school}"} are
        personalised per recipient.
      </p>
      <button
        onClick={send}
        disabled={busy}
        className="rounded-md bg-green px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send SMS"}
      </button>
    </div>
  );
}
