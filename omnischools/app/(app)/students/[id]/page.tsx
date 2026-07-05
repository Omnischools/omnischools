import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  studentGuardians,
  studentHealthRecords,
  classes,
  users,
  academicPeriod,
  attendanceRecords,
  invoices,
  payments,
  receipts,
  gradebookScores,
  reportCards,
  subjects,
  notificationLog,
  auditLog,
} from "@/db/schema";
import { num } from "@/lib/fees-helpers";

export const dynamic = "force-dynamic";

const ghs = (v: number) => `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cap = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");
const titleize = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const fmtDob = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const fmtDate = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const ageFrom = (dob: string, today: string) => {
  const b = new Date(dob + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (
    t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())
  )
    a--;
  return a;
};

const pctToneOf = (p: number) => (p >= 90 ? "text-green" : p >= 70 ? "text-gold" : "text-terra");

export default async function StudentDetailPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        otherNames: students.otherNames,
        lastName: students.lastName,
        code: students.studentCode,
        sex: students.sex,
        dob: students.dateOfBirth,
        status: students.status,
        classLabel: students.currentClassLabel,
        classId: students.classId,
        enrolledOn: students.enrolledOn,
        className: classes.name,
        teacher: users.fullName,
      })
      .from(students)
      .leftJoin(classes, eq(students.classId, classes.id))
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(eq(students.id, params.id), eq(students.schoolId, school.id)));
    if (!student) return null;

    // Current term (for attendance + latest scores fallback).
    const [term] = await tx
      .select({
        periodId: academicPeriod.periodId,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
        label: academicPeriod.periodLabel,
      })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
        ),
      )
      .limit(1);

    const [
      guardians,
      attRecs,
      invs,
      pays,
      latestCard,
      notes,
      activity,
    ] = await Promise.all([
      tx
        .select()
        .from(studentGuardians)
        .where(eq(studentGuardians.studentId, student.id))
        .orderBy(desc(studentGuardians.isPrimary)),
      term
        ? tx
            .select({ status: attendanceRecords.status })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.schoolId, school.id),
                eq(attendanceRecords.studentId, student.id),
                gte(attendanceRecords.date, term.startsOn),
                lte(attendanceRecords.date, term.endsOn),
              ),
            )
        : Promise.resolve([] as { status: string }[]),
      tx.select().from(invoices).where(eq(invoices.studentId, student.id)),
      tx
        .select({
          id: payments.id,
          grossAmount: payments.grossAmount,
          method: payments.method,
          recordedAt: payments.recordedAt,
          voidedAt: payments.voidedAt,
          receiptNumber: receipts.receiptNumber,
        })
        .from(payments)
        .leftJoin(receipts, eq(receipts.paymentId, payments.id))
        .where(eq(payments.studentId, student.id))
        .orderBy(desc(payments.recordedAt))
        .limit(5),
      // Latest report card by generation time (most recent period with a card).
      tx
        .select({
          periodId: reportCards.periodId,
          overallTotal: reportCards.overallTotal,
          overallGrade: reportCards.overallGrade,
          remark: reportCards.remark,
          periodLabel: academicPeriod.periodLabel,
        })
        .from(reportCards)
        .leftJoin(academicPeriod, eq(reportCards.periodId, academicPeriod.periodId))
        .where(and(eq(reportCards.schoolId, school.id), eq(reportCards.studentId, student.id)))
        .orderBy(desc(reportCards.generatedAt))
        .limit(1),
      tx
        .select({
          id: notificationLog.id,
          message: notificationLog.message,
          status: notificationLog.status,
          provider: notificationLog.provider,
          createdAt: notificationLog.createdAt,
        })
        .from(notificationLog)
        .where(eq(notificationLog.studentId, student.id))
        .orderBy(desc(notificationLog.createdAt))
        .limit(6),
      tx
        .select({
          auditId: auditLog.auditId,
          actionType: auditLog.actionType,
          entityType: auditLog.entityType,
          reason: auditLog.reason,
          actorRole: auditLog.actorRole,
          actor: users.fullName,
          occurredAt: auditLog.occurredAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.actorUserId, users.id))
        .where(and(eq(auditLog.schoolId, school.id), eq(auditLog.entityId, student.id)))
        .orderBy(desc(auditLog.occurredAt))
        .limit(8),
    ]);

    // Per-subject scores for the latest card's period (or current term if a card exists).
    const scorePeriodId = latestCard[0]?.periodId ?? null;
    const scores = scorePeriodId
      ? await tx
          .select({
            subject: subjects.name,
            total: gradebookScores.total,
            grade: gradebookScores.grade,
          })
          .from(gradebookScores)
          .innerJoin(subjects, eq(gradebookScores.subjectId, subjects.id))
          .where(
            and(
              eq(gradebookScores.schoolId, school.id),
              eq(gradebookScores.studentId, student.id),
              eq(gradebookScores.periodId, scorePeriodId),
            ),
          )
          .orderBy(asc(subjects.name))
      : [];

    const [health] = await tx
      .select()
      .from(studentHealthRecords)
      .where(eq(studentHealthRecords.studentId, student.id));

    return { student, term, guardians, attRecs, invs, pays, latestCard, notes, activity, scores, health };
  });

  if (!data) notFound();
  const { student, term, guardians, attRecs, invs, pays, latestCard, notes, activity, scores, health } = data;

  const healthItems: { label: string; value: string }[] = health
    ? [
        { label: "Blood group", value: health.bloodGroup ?? "" },
        { label: "Allergies", value: health.allergies ?? "" },
        { label: "Conditions", value: health.conditions ?? "" },
        { label: "Medications", value: health.medications ?? "" },
        {
          label: "Emergency contact",
          value: [
            health.emergencyContactName,
            health.emergencyContactPhone,
            health.emergencyContactRelation
              ? `(${cap(health.emergencyContactRelation)})`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
        { label: "Notes", value: health.notes ?? "" },
      ].filter((i) => i.value.trim() !== "")
    : [];

  // ── Attendance derivations ────────────────────────────────────────────
  const attCounts: Record<string, number> = {};
  for (const r of attRecs) attCounts[r.status] = (attCounts[r.status] ?? 0) + 1;
  const attTotal = attRecs.length;
  const present = attCounts.PRESENT ?? 0;
  const late = attCounts.LATE ?? 0;
  const absent = attCounts.ABSENT ?? 0;
  const excused = (attCounts.EXCUSED ?? 0) + (attCounts.MEDICAL ?? 0);
  const termPct = attTotal > 0 ? Math.round(((present + late) / attTotal) * 100) : null;

  // ── Billing derivations ───────────────────────────────────────────────
  const live = invs.filter((i) => i.status !== "VOIDED");
  const totalBilled = live.reduce((s, i) => s + num(i.billedAmount), 0);
  const totalPaid = live.reduce((s, i) => s + num(i.paidAmount), 0);
  const balance = live.reduce((s, i) => s + num(i.balanceAmount), 0);

  // ── Performance derivations ───────────────────────────────────────────
  const card = latestCard[0] ?? null;
  const perfValue =
    card && card.overallGrade
      ? card.overallGrade
      : card && card.overallTotal != null
        ? num(card.overallTotal).toFixed(1)
        : "—";
  const perfSub = card
    ? `${card.periodLabel ?? "latest term"}${card.overallTotal != null ? ` · ${num(card.overallTotal).toFixed(1)} avg` : ""}`
    : "no report card yet";

  const primaryGuardian = guardians[0] ?? null;

  return (
    <div className="mx-auto max-w-page">
      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <div className="text-xs text-navy-3">
        <Link href="/students" className="text-gold hover:underline">
          Students
        </Link>{" "}
        / {student.className ?? student.classLabel ?? "—"} / {student.firstName} {student.lastName}
      </div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div className="mb-8 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-2xl font-semibold text-navy">
            {(student.firstName[0] ?? "") + (student.lastName[0] ?? "")}
          </span>
          <div>
            <h1 className="font-display text-3xl font-semibold text-navy">
              {student.firstName}
              {student.otherNames ? ` ${student.otherNames}` : ""}{" "}
              <em className="not-italic text-gold">{student.lastName}</em>
            </h1>
            <p className="mt-0.5 text-sm text-navy-3">
              {student.className ?? student.classLabel ?? "—"}
              {student.teacher ? (
                <>
                  {" · "}class teacher{" "}
                  <b className="font-semibold text-navy-2">{student.teacher}</b>
                </>
              ) : null}
              {" · "}
              {cap(student.status)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Chip glyph="ID">
                <b className="font-mono font-semibold text-navy-2">{student.code}</b>
              </Chip>
              {student.dob && (
                <Chip glyph="◷">
                  {fmtDob(student.dob)} · age {ageFrom(student.dob, today)}
                </Chip>
              )}
              {primaryGuardian && (
                <Chip glyph="G">
                  <b className="font-semibold text-navy-2">{primaryGuardian.name}</b>
                  {" · "}
                  <span className="font-mono">{primaryGuardian.phone}</span>
                </Chip>
              )}
              <Chip glyph="●" tone={student.status === "ACTIVE" ? "green" : "muted"}>
                {cap(student.status)}
              </Chip>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/students/${student.id}/edit`}
            className="rounded-md bg-navy px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            Edit profile
          </Link>
          <Link
            href={`/students/${student.id}/billing`}
            className="rounded-md border border-border-2 px-3.5 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Billing
          </Link>
          <Link
            href={`/attendance/student/${student.id}`}
            className="rounded-md border border-border-2 px-3.5 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Attendance
          </Link>
        </div>
      </div>

      {/* ── At a glance ────────────────────────────────────────── */}
      <SectionHead num="" title="At a glance" />
      <div className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Glance
          value={termPct === null ? "—" : `${termPct}%`}
          valueTone={termPct === null ? "text-navy-3" : pctToneOf(termPct)}
          label="Term attendance"
          sub={attTotal > 0 ? `${present + late} of ${attTotal} days` : "no records yet"}
        />
        <Glance
          value={perfValue}
          valueTone={perfValue === "—" ? "text-navy-3" : "text-navy"}
          label="Performance"
          sub={perfSub}
        />
        <Glance
          value={ghs(balance)}
          valueTone={balance > 0 ? "text-terra" : "text-green"}
          label="Outstanding balance"
          sub={balance > 0 ? "due" : "fully settled"}
        />
        <Glance
          value={cap(student.status)}
          valueTone={student.status === "ACTIVE" ? "text-green" : "text-navy"}
          label="Status"
          sub={student.enrolledOn ? `enrolled ${fmtDate(student.enrolledOn)}` : "enrolment date —"}
        />
      </div>

      {/* ── 01 · Attendance ────────────────────────────────────── */}
      <Section num="01" title="Attendance" right={<GoldLink href={`/attendance/student/${student.id}`}>View full attendance →</GoldLink>}>
        {attTotal === 0 ? (
          <Muted>No attendance records {term ? "this term yet" : "— no active term"}.</Muted>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div className={`font-display text-4xl font-semibold ${termPct === null ? "text-navy-3" : pctToneOf(termPct ?? 0)}`}>
                {termPct === null ? "—" : `${termPct}%`}
              </div>
              <div className="mt-0.5 text-[11px] text-navy-3">
                {term ? term.label : "term"} · {present + late} of {attTotal} days
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CountPill label="Present" value={present} tone="green" />
              <CountPill label="Late" value={late} tone="gold" />
              <CountPill label="Absent" value={absent} tone="terra" />
              <CountPill label="Excused" value={excused} tone="muted" />
            </div>
          </div>
        )}
      </Section>

      {/* ── 02 · Performance ───────────────────────────────────── */}
      <Section
        num="02"
        title="Performance"
        right={
          card ? (
            <GoldLink href={`/gradebook/report/${student.id}?periodId=${card.periodId}`}>Open report card →</GoldLink>
          ) : (
            <GoldLink href="/gradebook">View gradebook →</GoldLink>
          )
        }
      >
        {!card ? (
          <Muted>No report card generated yet.</Muted>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-semibold text-navy">
                {card.overallGrade ?? "—"}
              </span>
              <span className="text-sm text-navy-2">
                {card.overallTotal != null ? `${num(card.overallTotal).toFixed(1)} overall` : "no overall total"}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-navy-3">
                {card.periodLabel ?? "latest term"}
              </span>
            </div>
            {scores.length === 0 ? (
              <Muted>No subject scores recorded for this period.</Muted>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Subject</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {scores.map((s, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2.5 text-navy">{s.subject}</td>
                        <td className="px-4 py-2.5 text-right text-navy-2">
                          {s.total != null ? num(s.total).toFixed(1) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-navy">
                          {s.grade ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── 03 · Billing ───────────────────────────────────────── */}
      <Section num="03" title="Billing" right={<GoldLink href={`/fees/${student.id}`}>View billing →</GoldLink>}>
        {invs.length === 0 && pays.length === 0 ? (
          <Muted>No invoices or payments yet.</Muted>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              <MiniStat label="Total billed" value={ghs(totalBilled)} tone="text-navy" />
              <MiniStat label="Total paid" value={ghs(totalPaid)} tone="text-green" />
              <MiniStat label="Balance" value={ghs(balance)} tone={balance > 0 ? "text-terra" : "text-green"} />
            </div>
            {pays.length === 0 ? (
              <Muted>No payments recorded yet.</Muted>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Receipt</th>
                      <th className="px-4 py-2.5 font-semibold">Method</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pays.map((p) => (
                      <tr key={p.id} className={p.voidedAt ? "opacity-50" : ""}>
                        <td className="px-4 py-2.5 font-mono text-xs text-navy-2">{p.receiptNumber ?? "—"}</td>
                        <td className="px-4 py-2.5 text-navy-2">{titleize(p.method)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-navy">{ghs(num(p.grossAmount))}</td>
                        <td className="px-4 py-2.5 text-navy-3">
                          <span className="flex items-center gap-2">
                            {fmtDate(p.recordedAt)}
                            {p.voidedAt && (
                              <span className="rounded-pill bg-terra-bg px-2 py-0.5 text-[10px] font-bold uppercase text-terra">
                                Voided
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── 04 · Guardians & contact ───────────────────────────── */}
      <Section num="04" title="Guardians & contact">
        {guardians.length === 0 ? (
          <Muted>No guardian recorded.</Muted>
        ) : (
          <div className="space-y-2">
            {guardians.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-navy">
                    {g.name} <span className="text-navy-3">· {cap(g.relationship)}</span>
                  </div>
                  <div className="font-mono text-xs text-navy-3">{g.phone}</div>
                </div>
                {g.isPrimary && (
                  <span className="rounded-pill bg-gold-bg px-2 py-0.5 text-xs font-medium text-navy">
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 05 · Health & emergency ────────────────────────────── */}
      <Section
        num="05"
        title="Health & emergency"
        right={<GoldLink href={`/students/${student.id}/edit`}>Edit →</GoldLink>}
      >
        {healthItems.length === 0 ? (
          <Muted>No health or emergency information recorded.</Muted>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {healthItems.map((i) => (
              <div key={i.label}>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
                  {i.label}
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-navy">{i.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {/* ── 06 · Communications ────────────────────────────────── */}
      <Section num="06" title="Communications">
        {notes.length === 0 ? (
          <Muted>No messages sent for this student yet.</Muted>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {notes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-navy-3">
                    SMS{n.provider ? ` · ${n.provider}` : ""}
                  </div>
                  <div className="truncate text-sm text-navy">{n.message}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-navy-3">{fmtDate(n.createdAt)}</div>
                  <div className="text-[11px] font-semibold text-navy-2">{cap(n.status)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 07 · Recent activity ───────────────────────────────── */}
      <Section num="07" title="Recent activity">
        {activity.length === 0 ? (
          <Muted>No recorded activity for this student yet.</Muted>
        ) : (
          <ol className="space-y-3">
            {activity.map((a) => (
              <li key={a.auditId} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm text-navy">
                    <b className="font-semibold">{cap(a.actionType)}</b>
                    {a.entityType ? <span className="text-navy-3"> · {titleize(a.entityType)}</span> : null}
                    {a.reason ? <span className="text-navy-2"> — {a.reason}</span> : null}
                  </div>
                  <div className="text-[11px] text-navy-3">
                    {a.actor ?? (a.actorRole ? cap(a.actorRole) : "System")} · {fmtDate(a.occurredAt)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

// ── Presentational helpers (server components / pure) ───────────────────

function Chip({
  glyph,
  tone,
  children,
}: {
  glyph: string;
  tone?: "green" | "muted";
  children: React.ReactNode;
}) {
  const border = tone === "green" ? "border-green" : "border-border";
  const text = tone === "green" ? "text-green" : "text-navy-3";
  const glyphTone = tone === "green" ? "text-green" : tone === "muted" ? "text-navy-3" : "text-gold";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill border bg-bg px-2.5 py-1 text-[11px] ${border} ${text}`}>
      <span className={`font-display text-[10px] font-bold ${glyphTone}`}>{glyph}</span>
      {children}
    </span>
  );
}

function SectionHead({ num, title, meta }: { num: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-3">
      {num && <span className="font-display text-xl font-semibold italic text-gold">{num}</span>}
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      {meta && <span className="text-[11px] uppercase tracking-wide text-navy-3">{meta}</span>}
    </div>
  );
}

function Section({
  num,
  title,
  right,
  children,
}: {
  num: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <SectionHead num={num} title={title} />
        {right && <div className="text-sm">{right}</div>}
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">{children}</div>
    </section>
  );
}

function GoldLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-gold hover:underline">
      {children}
    </Link>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-navy-3">{children}</p>;
}

function Glance({
  value,
  valueTone,
  label,
  sub,
}: {
  value: string;
  valueTone: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="bg-surface p-5">
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${valueTone}`}>{value}</div>
      <div className="mt-1 text-[11px] text-navy-3">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-surface p-4">
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function CountPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "gold" | "terra" | "muted";
}) {
  const map: Record<string, string> = {
    green: "bg-green-bg text-green",
    gold: "bg-gold-bg text-navy",
    terra: "bg-terra-bg text-terra",
    muted: "bg-bg text-navy-3",
  };
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-pill px-3 py-1.5 text-[11px] ${map[tone]}`}>
      <b className="font-display text-sm font-semibold">{value}</b>
      {label}
    </span>
  );
}
