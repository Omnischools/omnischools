import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { searchActiveStudents } from "@/lib/sickbay/visit-reads";
import { getNhisCardContext } from "@/lib/sickbay/nhis-reads";
import { NhisCardConsole } from "@/components/sickbay/nhis-card-console";

export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/nhis` — the NHIS card identity management surface (SHS module 4.4 / INCR-25a). One
 * card per student: pick a student, then view / record / edit their single `student_nhis_card`.
 *
 * 🔴 R195 — the card is clinical-adjacent identity, so the PAGE gate is SICKBAY_CLINICAL_READ_ROLES
 * ([HEADMASTER, MATRON]): a non-clinical ADMIN is redirected and never receives a card payload. WRITE
 * affordances render only for SICKBAY_CLINICAL_WRITE_ROLES ([MATRON]); the action re-checks the gate.
 *
 * 🚫 There is NO school-wide roll-up (the forbidden STPSHS `1,108/1,200 · 92.3%` matrix, R182): the
 * student search is intake identity only and every card read is scoped to ONE studentId.
 */
export default async function NhisCardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; studentId?: string }>;
}) {
  const { school, user } = await requireSchoolRole(SICKBAY_CLINICAL_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);

  const sp = await searchParams;
  const q = sp.q ?? "";
  const selectedId = sp.studentId ?? "";

  const students = await searchActiveStudents(school.id, q);
  const context = selectedId ? await getNhisCardContext(school.id, selectedId) : null;

  const withParam = (studentId: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("studentId", studentId);
    return `/senior/sickbay/nhis?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · NHIS cards
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        NHIS <em className="font-normal italic text-gold">cards.</em>
      </h1>
      <p className="mb-6 max-w-[720px] text-[13px] text-navy-3">
        The National Health Insurance card that covers a student at referral. One card per student —
        the holder may be the student or a guardian whose household card covers them.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* Student picker — a plain GET so the roster never ships wholesale (server search). */}
        <div className="rounded-xl border border-border bg-surface p-[16px_18px]">
          <form method="get" className="mb-3 flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search student by name or code"
              className="flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold"
            />
            {selectedId && <input type="hidden" name="studentId" value={selectedId} />}
            <button
              type="submit"
              className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-2 text-[12px] font-semibold text-navy-2"
            >
              Search
            </button>
          </form>
          {students.length === 0 ? (
            <p className="py-2 text-[12px] italic text-navy-3">
              {q ? "No active student matches that." : "Type a name or code to find the student."}
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-auto rounded-md border border-border">
              {students.map((s) => (
                <li key={s.id}>
                  <Link
                    href={withParam(s.id)}
                    className={`flex flex-col gap-0.5 border-b border-border px-3 py-2 text-[12px] last:border-b-0 hover:bg-gold-bg ${
                      s.id === selectedId ? "bg-gold-bg" : ""
                    }`}
                  >
                    <span className="font-semibold text-navy">{s.name}</span>
                    <span className="text-navy-3">
                      {s.formLabel}
                      {s.houseName ? ` · ${s.houseName} House` : ""} · {s.studentCode}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected student's card */}
        <div>
          {!selectedId ? (
            <div className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] leading-[1.65] text-navy-2">
              Pick a student to view or record their NHIS card.
            </div>
          ) : !context ? (
            <div className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] leading-[1.65] text-navy-2">
              That student is no longer available.
            </div>
          ) : (
            <NhisCardConsole
              canWrite={canWrite}
              student={context.student}
              card={context.card}
              guardians={context.guardians}
            />
          )}
        </div>
      </div>
    </div>
  );
}
