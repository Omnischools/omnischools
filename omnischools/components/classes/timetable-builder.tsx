"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addTimetableSlots,
  removeTimetableSlot,
  updateTimetableSlot,
} from "@/lib/actions/classes";
import { DAYS, DAY_LABEL } from "@/lib/timetable-days";
import { COMMON_SUBJECTS } from "@/lib/field-options";
import { Combobox, DataList } from "@/components/ui/fields";
import type { StaffOption } from "@/lib/data/staff-options";

type Slot = {
  id: string;
  dayOfWeek: number;
  periodIndex: number;
  startTime: string | null;
  endTime: string | null;
  subjectName: string | null;
  teacherName: string | null;
  teacherUserId: string | null;
};
type Subject = { id: string; name: string };
type EditVals = {
  dayOfWeek: string;
  periodIndex: string;
  subjectName: string;
  teacherUserId: string;
  startTime: string;
  endTime: string;
};

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
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditVals | null>(null);

  const subjectOptions = Array.from(
    new Set([...COMMON_SUBJECTS, ...subjects.map((s) => s.name)]),
  );

  function startEdit(s: Slot) {
    setEditingId(s.id);
    setError(null);
    setEdit({
      dayOfWeek: String(s.dayOfWeek),
      periodIndex: String(s.periodIndex),
      subjectName: s.subjectName ?? "",
      teacherUserId: s.teacherUserId ?? "",
      startTime: s.startTime ?? "",
      endTime: s.endTime ?? "",
    });
  }

  async function saveEdit() {
    if (!editingId || !edit) return;
    setBusy(true);
    setError(null);
    const res = await updateTimetableSlot({ slotId: editingId, classId, ...edit });
    setBusy(false);
    if (res.ok) {
      setEditingId(null);
      setEdit(null);
      router.refresh();
    } else setError(res.error ?? "Could not update.");
  }

  async function add(formData: FormData) {
    const days = formData.getAll("day");
    if (days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await addTimetableSlots({
      classId,
      days,
      periodIndex: formData.get("periodIndex"),
      subjectName: formData.get("subjectName"),
      teacherUserId: formData.get("teacherUserId"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(
        `Added ${res.created} lesson${res.created === 1 ? "" : "s"}${res.skipped ? ` · skipped ${res.skipped} (clash/duplicate)` : ""}.`,
      );
      router.refresh();
    } else setError(res.error ?? "Could not add lessons.");
  }

  async function remove(slotId: string) {
    setBusy(true);
    await removeTimetableSlot({ slotId });
    setBusy(false);
    router.refresh();
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
              {ordered.map((s) =>
                editingId === s.id && edit ? (
                  <tr key={s.id} className="bg-gold-bg/40 align-middle">
                    <td className="px-3 py-2">
                      <select
                        value={edit.dayOfWeek}
                        onChange={(e) =>
                          setEdit((p) => p && { ...p, dayOfWeek: e.target.value })
                        }
                        className={fieldClass}
                      >
                        {DAYS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        max={15}
                        value={edit.periodIndex}
                        onChange={(e) =>
                          setEdit((p) => p && { ...p, periodIndex: e.target.value })
                        }
                        className={`${fieldClass} w-14`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          value={edit.startTime}
                          onChange={(e) =>
                            setEdit((p) => p && { ...p, startTime: e.target.value })
                          }
                          placeholder="11:15"
                          className={`${fieldClass} w-16`}
                        />
                        <input
                          value={edit.endTime}
                          onChange={(e) =>
                            setEdit((p) => p && { ...p, endTime: e.target.value })
                          }
                          placeholder="12:05"
                          className={`${fieldClass} w-16`}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Combobox
                        listId="subjects-list"
                        value={edit.subjectName}
                        onChange={(e) =>
                          setEdit((p) => p && { ...p, subjectName: e.target.value })
                        }
                        className="w-36 px-2.5 py-1.5"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={edit.teacherUserId}
                        onChange={(e) =>
                          setEdit((p) => p && { ...p, teacherUserId: e.target.value })
                        }
                        className={`${fieldClass} w-36`}
                      >
                        <option value="">—</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={saveEdit}
                        disabled={busy}
                        className="mr-2 text-xs font-semibold text-green disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEdit(null);
                        }}
                        className="text-xs font-semibold text-navy-3 hover:text-navy"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
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
                        onClick={() => startEdit(s)}
                        disabled={busy}
                        className="mr-3 text-xs font-semibold text-navy-3 transition-colors hover:text-gold disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(s.id)}
                        disabled={busy}
                        className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <form
        action={add}
        className="space-y-3 rounded-xl border border-border bg-surface p-4"
      >
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-navy-2">
            Days <span className="font-normal text-navy-3">— pick one or more</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <label
                key={d.value}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-2 px-2.5 py-1.5 text-sm text-navy-2 has-[:checked]:border-gold has-[:checked]:bg-gold-bg has-[:checked]:text-navy"
              >
                <input
                  type="checkbox"
                  name="day"
                  value={d.value}
                  defaultChecked={d.value === 1}
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
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
          <div className="min-w-44 flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-navy-2">
              Subject
            </label>
            <Combobox
              listId="subjects-list"
              name="subjectName"
              placeholder="Pick or type (e.g. Twi)"
              className="px-2.5 py-1.5"
            />
            <DataList id="subjects-list" options={subjectOptions} />
          </div>
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-navy-2">
              Teacher
            </label>
            <select
              name="teacherUserId"
              defaultValue=""
              className={`${fieldClass} w-full`}
            >
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
            <input
              name="startTime"
              placeholder="11:15"
              className={`${fieldClass} w-20`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-navy-2">
              End
            </label>
            <input name="endTime" placeholder="12:05" className={`${fieldClass} w-20`} />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            Add lesson(s)
          </button>
        </div>
      </form>

      {msg && <p className="mt-2 text-sm font-medium text-green">{msg}</p>}
      {error && <p className="mt-2 text-sm text-terra">{error}</p>}
    </div>
  );
}
