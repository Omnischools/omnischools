"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setClassTeacher } from "@/lib/actions/classes";
import type { StaffOption } from "@/lib/data/staff-options";

export function ClassTeacherSelect({
  classId,
  current,
  staff,
}: {
  classId: string;
  current: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(userId: string) {
    setBusy(true);
    await setClassTeacher({ classId, userId });
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      defaultValue={current ?? ""}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold disabled:opacity-60"
    >
      <option value="">— unassigned —</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
