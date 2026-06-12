"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addTimetableSlot, removeTimetableSlot, addSubject } from "@/lib/actions/classes";
import { DAYS, DAY_LABEL } from "@/lib/timetable-days";
import type { StaffOption } from "@/lib/data/staff-options";

type Slot = {
  id: string;
  dayOfWeek: number;
  periodIndex: number;
  startTime: string | null;
  endTime: string | null;
  subjectName: string | null;
  teacherName: string | null;
};
type Subject = { id: string; name: string };

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold";

export function TimetableBuilder({
  classId,
  slots,
  subjects,
  teachers,
}: {
  classId: string;
  slots: Slot[];
  subjects: Subject[];
  teachers: StaffOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState("");

  async function add(formData: FormData) {
    setBusy(true);
    setError(null);
    const res = await addTimetableSlot({
      classId,
      dayOfWeek: formData.get("dayOfWeek"),
      periodIndex: formData.get("periodIndex"),
      subjectId: formData.get("subjectId"),
      teacherUserId: formData.get("teacherUserId"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not add lesson.");
  }

  async function remove(slotId: string) {
    setBusy(true);
    await removeTimetableSlot({ slotId });
    setBusy(false);
    router.refresh();
  }

  async function createSubject() {
    if (!newSubject.trim()) return;
    setBusy(true);
    const res = await addSubject({ name: newSubject });
    setBusy(false);
    if (res.ok) {
      setNewSubject("");
      router.refresh();
    } else setError(res.error ?? "Could not add subject.");
  }

  const ordered = [...slots].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.periodIndex - b.periodIndex,
  );

  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Timetable</h2>

      {ordered.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Day</th>
                <th className="px-4 py-2.5 font-semibold">Period</th>
                <th className="px-4 py-2.5 font-semibold">Time</th>
                <th className="px-4 py-2.5 font-semibold">Subject</th>
                <th className="px-4 py-2.5 font-semibold">Teacher</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordered.map((s) => (
                <tr key={s.id} className="hover:bg-bg">
                  <td className="px-4 py-2.5 font-medium text-navy">
                    {DAY_LABEL[s.dayOfWeek] ?? s.dayOfWeek}
                  </td>
                  <td className="px-4 py-2.5 text-navy-2">P{s.periodIndex}</td>
                  <td className="px-4 py-2.5 text-navy-3">
                    {s.startTime
                      ? `${s.startTime}${s.endTime ? `–${s.endTime}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-navy">{s.subjectName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-navy-2">{s.teacherName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => remove(s.id)}
                      disabled={busy}
                      className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        action={add}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4"
      >
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">Day</label>
          <select name="dayOfWeek" defaultValue="1" className={fieldClass}>
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">
            Period
          </label>
          <input
            name="periodIndex"
            type="number"
            min={1}
            max={15}
            defaultValue={1}
            className={`${fieldClass} w-16`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">
            Subject
          </label>
          <select name="subjectId" defaultValue="" className={fieldClass}>
            <option value="">—</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">
            Teacher
          </label>
          <select name="teacherUserId" defaultValue="" className={fieldClass}>
            <option value="">—</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">
            Start
          </label>
          <input name="startTime" placeholder="08:00" className={`${fieldClass} w-20`} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-navy-2">End</label>
          <input name="endTime" placeholder="08:40" className={`${fieldClass} w-20`} />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          Add lesson
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-terra">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <input
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          placeholder="New subject (e.g. Integrated Science)"
          className={fieldClass}
        />
        <button
          onClick={createSubject}
          disabled={busy || !newSubject.trim()}
          className="rounded-md border border-border-2 px-3 py-1.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg disabled:opacity-50"
        >
          + Add subject
        </button>
      </div>
    </div>
  );
}
