import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, notInArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  users,
  roles,
  roleAssignments,
  classes,
  students,
  staffProfiles,
  staffCompensation,
} from "@/db/schema";
import { NON_STAFF_ROLE_CODES, roleLabel } from "@/lib/staff-roles";
import { qualificationLabel } from "@/lib/staff-qualifications";
import { StaffProfileEdit } from "@/components/staff/staff-profile-edit";
import {
  StaffCompensationEdit,
  EMPTY_COMPENSATION,
} from "@/components/staff/staff-compensation-edit";

export const dynamic = "force-dynamic";

const fmtDob = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COMP_STATUS_LABEL: Record<string, string> = {
  SCHOOL_PAID: "School-paid",
  GES_PAID: "GES-paid",
  ALLOWANCE: "Allowance-only",
};
const COMP_METHOD_LABEL: Record<string, string> = { BANK: "Bank", CASH: "Cash", MOMO: "MoMo" };

/** Whole years between an ISO date and today (floored, never negative). */
const yearsSince = (iso: string, today: string) => {
  const b = new Date(iso + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  let y = t.getUTCFullYear() - b.getUTCFullYear();
  if (
    t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())
  )
    y--;
  return Math.max(0, y);
};

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

/** Split a full name into "given" + surname for the gold-em hero treatment. */
function splitName(full: string): { given: string; surname: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { given: "", surname: full.trim() };
  const surname = parts.pop() as string;
  return { given: parts.join(" "), surname };
}

const initialsOf = (full: string) => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default async function StaffDetailPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    // The user must hold ≥1 non-student/parent role at this school to be staff here.
    const [staffUser] = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        email: users.email,
      })
      .from(users)
      .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(users.id, params.id),
          eq(roleAssignments.schoolId, school.id),
          notInArray(roles.code, NON_STAFF_ROLE_CODES),
        ),
      )
      .limit(1);
    if (!staffUser) return null;

    const [roleRows, [profile], [compensation], teacherClasses, classSizes] =
      await Promise.all([
      tx
        .select({
          assignmentId: roleAssignments.id,
          code: roles.code,
          label: roles.label,
          startDate: roleAssignments.startDate,
          endDate: roleAssignments.endDate,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.schoolId, school.id),
            eq(roleAssignments.userId, staffUser.id),
            notInArray(roles.code, NON_STAFF_ROLE_CODES),
          ),
        )
        .orderBy(asc(roleAssignments.startDate)),
      tx
        .select()
        .from(staffProfiles)
        .where(
          and(
            eq(staffProfiles.schoolId, school.id),
            eq(staffProfiles.userId, staffUser.id),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(staffCompensation)
        .where(
          and(
            eq(staffCompensation.schoolId, school.id),
            eq(staffCompensation.userId, staffUser.id),
          ),
        )
        .limit(1),
      tx
        .select({ id: classes.id, name: classes.name, level: classes.level })
        .from(classes)
        .where(
          and(
            eq(classes.schoolId, school.id),
            eq(classes.classTeacherUserId, staffUser.id),
          ),
        )
        .orderBy(asc(classes.name)),
      tx
        .select({ classId: students.classId, n: count() })
        .from(students)
        .where(eq(students.schoolId, school.id))
        .groupBy(students.classId),
    ]);

    return {
      staffUser,
      roleRows,
      profile: profile ?? null,
      compensation: compensation ?? null,
      teacherClasses,
      classSizes,
    };
  });

  if (!data) notFound();
  const { staffUser, roleRows, profile, compensation, teacherClasses, classSizes } = data;

  const fullName = staffUser.fullName ?? "—";
  const { given, surname } = splitName(staffUser.fullName ?? "");

  const activeRoles = roleRows.filter((r) => r.endDate === null);
  const primaryRole = activeRoles[0] ?? roleRows[0] ?? null;
  const primaryLabel = primaryRole
    ? roleLabel(primaryRole.code, primaryRole.label)
    : "No role";

  const sizeOf = new Map(classSizes.map((r) => [r.classId, Number(r.n)]));

  const dob = profile?.dateOfBirth ?? null;
  const gender = profile?.gender ?? null;

  // Tenure — earliest role start date (roleRows are ordered ascending by start).
  const firstStart = roleRows.length > 0 ? roleRows[0].startDate : null;

  // Compensation — net = monthly − ssnit − paye.
  const compMonthly = compensation ? Number(compensation.monthlyAmount) : 0;
  const compSsnit = compensation ? Number(compensation.ssnitDeduction) : 0;
  const compPaye = compensation ? Number(compensation.payeDeduction) : 0;
  const compNet = compMonthly - compSsnit - compPaye;

  return (
    <div className="mx-auto max-w-page">
      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <div className="text-xs text-navy-3">
        <Link href="/staff" className="text-gold hover:underline">
          Staff
        </Link>{" "}
        / {fullName}
      </div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div className="mb-8 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-2xl font-semibold text-navy">
            {initialsOf(fullName)}
          </span>
          <div>
            <h1 className="font-display text-3xl font-semibold text-navy">
              {given ? `${given} ` : ""}
              <em className="not-italic text-gold">{surname}</em>
            </h1>
            <p className="mt-0.5 text-sm text-navy-3">
              {activeRoles.length} active {activeRoles.length === 1 ? "role" : "roles"}
              {" · "}
              <b className="font-semibold text-navy-2">{primaryLabel}</b>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Chip glyph="☎">
                <b className="font-mono font-semibold text-navy-2">{staffUser.phone || "—"}</b>
              </Chip>
              {staffUser.email && <Chip glyph="@">{staffUser.email}</Chip>}
              {dob && (
                <Chip glyph="◷">
                  {fmtDob(dob)} · age {ageFrom(dob, today)}
                </Chip>
              )}
              {gender && <Chip glyph="●">{gender}</Chip>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StaffProfileEdit
            userId={staffUser.id}
            initial={{
              fullName: staffUser.fullName ?? "",
              phone: staffUser.phone ?? "",
              email: staffUser.email ?? "",
              dateOfBirth: profile?.dateOfBirth ?? "",
              gender: profile?.gender ?? "",
              address: profile?.address ?? "",
              emergencyContact: profile?.emergencyContact ?? "",
              qualificationLevel: profile?.qualificationLevel ?? "",
              highestQualification: profile?.highestQualification ?? "",
              undergraduate: profile?.undergraduate ?? "",
              ntcLicenceNumber: profile?.ntcLicenceNumber ?? "",
              ntcLicenceExpiry: profile?.ntcLicenceExpiry ?? "",
              specialisations: profile?.specialisations ?? "",
            }}
          />
          <Link
            href="/staff/compensation"
            className="rounded-md border border-navy px-3.5 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-bg"
          >
            Compensation
          </Link>
          <Link
            href="/classes"
            className="rounded-md border border-border-2 px-3.5 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            View classes
          </Link>
        </div>
      </div>

      {/* ── 01 · Active roles ──────────────────────────────────── */}
      <Section num="01" title="Active roles">
        {roleRows.length === 0 ? (
          <Muted>No roles assigned at this school.</Muted>
        ) : (
          <div className="space-y-2">
            {roleRows.map((r) => (
              <div
                key={r.assignmentId}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="font-display text-base font-semibold text-gold">
                    {roleLabel(r.code, r.label)}
                  </div>
                  <div className="text-xs text-navy-3">since {fmtDob(r.startDate)}</div>
                </div>
                {r.endDate === null ? (
                  <span className="rounded-pill bg-green-bg px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green">
                    Active
                  </span>
                ) : (
                  <span className="rounded-pill bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-navy-3">
                    ended {fmtDob(r.endDate)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 02 · Personal & contact ────────────────────────────── */}
      <Section num="02" title="Personal & contact">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <Field label="Full name" value={staffUser.fullName} />
          <Field
            label="Date of birth"
            value={dob ? `${fmtDob(dob)} · ${ageFrom(dob, today)} years` : null}
          />
          <Field label="Gender" value={gender} />
          <Field label="Phone" value={staffUser.phone} mono />
          <Field label="Email" value={staffUser.email} />
          <Field label="Address" value={profile?.address ?? null} />
          <Field label="Emergency contact" value={profile?.emergencyContact ?? null} />
        </dl>
      </Section>

      {/* ── 03 · Qualifications & licensure ────────────────────── */}
      <Section num="03" title="Qualifications & licensure">
        {!profile ? (
          <Muted>No profile details captured yet — use Edit profile to add them.</Muted>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            <Field label="Highest qualification" value={profile.highestQualification} />
            <Field label="Undergraduate" value={profile.undergraduate} />
            <Field
              label="NTC licence"
              value={
                profile.ntcLicenceNumber
                  ? `${profile.ntcLicenceNumber}${
                      profile.ntcLicenceExpiry
                        ? ` · expires ${fmtDob(profile.ntcLicenceExpiry)}`
                        : ""
                    }`
                  : null
              }
            />
            <Field
              label="Level"
              value={
                profile.qualificationLevel
                  ? qualificationLabel(profile.qualificationLevel)
                  : null
              }
            />
            <div className="bg-surface p-4 sm:col-span-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                Specialisations
              </dt>
              <dd className="mt-1.5">
                {specialisationChips(profile.specialisations)}
              </dd>
            </div>
          </dl>
        )}
      </Section>

      {/* ── 04 · Class assignments ─────────────────────────────── */}
      <Section
        num="04"
        title="Class assignments"
        right={<GoldLink href="/classes">View classes →</GoldLink>}
      >
        {teacherClasses.length === 0 ? (
          <Muted>Not the class teacher of any class.</Muted>
        ) : (
          <div className="space-y-2">
            {teacherClasses.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-navy">{c.name}</div>
                  {c.level && <div className="text-xs text-navy-3">{c.level}</div>}
                </div>
                <span className="text-xs text-navy-3">
                  {sizeOf.get(c.id) ?? 0} students
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 05 · Compensation ──────────────────────────────────── */}
      <Section
        num="05"
        title="Compensation"
        right={
          <StaffCompensationEdit
            userId={staffUser.id}
            hasRecord={!!compensation}
            variant="secondary"
            initial={
              compensation
                ? {
                    salaryStatus: compensation.salaryStatus,
                    monthlyAmount: compMonthly ? String(compMonthly) : "",
                    payMethod: compensation.payMethod,
                    payCadence: compensation.payCadence,
                    ssnitDeduction: compSsnit ? String(compSsnit) : "",
                    payeDeduction: compPaye ? String(compPaye) : "",
                    effectiveFrom: compensation.effectiveFrom ?? "",
                    notes: compensation.notes ?? "",
                  }
                : EMPTY_COMPENSATION
            }
          />
        }
      >
        {!compensation ? (
          <Muted>No compensation set — use Set compensation.</Muted>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            <Field
              label="Salary status"
              value={COMP_STATUS_LABEL[compensation.salaryStatus] ?? compensation.salaryStatus}
            />
            <Field label="Monthly amount" value={ghs(compMonthly)} mono />
            <Field
              label="Pay method"
              value={`${COMP_METHOD_LABEL[compensation.payMethod] ?? compensation.payMethod} · ${
                compensation.payCadence === "TERMLY" ? "Termly" : "Monthly"
              }`}
            />
            <Field
              label="SSNIT"
              value={compSsnit > 0 ? ghs(compSsnit) : "—"}
              mono={compSsnit > 0}
            />
            <Field
              label="PAYE"
              value={compPaye > 0 ? ghs(compPaye) : "—"}
              mono={compPaye > 0}
            />
            <Field label="Net" value={ghs(compNet)} mono />
            <Field
              label="Effective from"
              value={compensation.effectiveFrom ? fmtDob(compensation.effectiveFrom) : null}
            />
            <Field
              label="Tenure"
              value={
                firstStart
                  ? `${yearsSince(firstStart, today)} ${
                      yearsSince(firstStart, today) === 1 ? "year" : "years"
                    }`
                  : null
              }
            />
          </dl>
        )}
      </Section>
    </div>
  );
}

// ── Presentational helpers (server components / pure) ───────────────────

function specialisationChips(raw: string | null) {
  const tags = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tags.length === 0) return <span className="text-sm text-navy-3">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t, i) => (
        <span
          key={i}
          className="rounded-pill bg-bg px-2.5 py-1 text-[11px] font-medium text-navy-2"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function Chip({ glyph, children }: { glyph: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-bg px-2.5 py-1 text-[11px] text-navy-3">
      <span className="font-display text-[10px] font-bold text-gold">{glyph}</span>
      {children}
    </span>
  );
}

function SectionHead({ num, title }: { num: string; title: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-3">
      {num && <span className="font-display text-xl font-semibold italic text-gold">{num}</span>}
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
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

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const has = value != null && value !== "";
  return (
    <div className="bg-surface p-4">
      <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</dt>
      <dd
        className={`mt-1 text-sm ${has ? "text-navy" : "text-navy-3"} ${
          mono && has ? "font-mono" : ""
        }`}
      >
        {has ? value : "—"}
      </dd>
    </div>
  );
}
