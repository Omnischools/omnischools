import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getPlcSetup } from "@/lib/plc/setup-data";
import { SectionHead, SumCard } from "@/components/vlc/chrome";
import { CadenceCard } from "@/components/plc/cadence-card";
import { ContractCard } from "@/components/plc/contract-card";
import { PlcCard } from "@/components/plc/plc-card";
import { AddPlc } from "@/components/plc/add-plc";

export const dynamic = "force-dynamic";

/**
 * `/senior/plc/setup` — the PLC config spine (SHS module 4.6 / INCR-47): the school-wide Friday
 * cadence, the staff PLC groups (facilitator / members / term focus / per-PLC override), and the
 * 4-scalar CPD contract. READ gate = `isStaff` (R368, delivered by `requireSchool`); WRITE gate =
 * PLC_CONFIG_WRITE_ROLES (PD Coordinator / Admin / Headmaster) — a bare TEACHER reads the same surface
 * read-only, and every server action re-checks the write gate.
 *
 * Config only. Everything backed by INCR-48/49/NTC data (sessions held, attendance %, NTC sync,
 * "Generate next week's sessions") is OMITTED, never faked (R379). Summary strip = tiles 1 & 2 only
 * (Active PLCs · Staff in ≥1 PLC); the other 3 belong to later modules.
 */
export default async function PlcSetupPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const canEdit = hasAnyRole(user.roles, PLC_CONFIG_WRITE_ROLES);
  const setup = await getPlcSetup(school.id);
  const { programme, stats, plcs } = setup;
  const tb = stats.typeBreakdown;

  return (
    <div className="mx-auto max-w-page pb-20">
      {/* ── Hero ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Settings · Teacher development · PLC programme
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          PLC{" "}
          <em className="italic text-gold">
            programme{setup.academicYear ? ` · ${setup.academicYear}` : ""}
          </em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {school.name} · {stats.activePlcCount}{" "}
          {stats.activePlcCount === 1 ? "PLC" : "PLCs"} · {stats.staffInPlc}/
          {stats.teachingStaffCount} teaching staff in a PLC · the {programme.dayName} rhythm ·
          facilitators, members, focus and the CPD contract.
          {!canEdit && (
            <span className="ml-1 italic text-navy-3">
              You have read-only access to this surface.
            </span>
          )}
        </p>
      </header>

      {/* ── Summary strip — tiles 1 & 2 only (omit-not-fake) ── */}
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SumCard
          featured
          label="Active PLCs"
          big={`${stats.activePlcCount} ${stats.activePlcCount === 1 ? "PLC" : "PLCs"}`}
        >
          {tb.subject} subject · {tb.crossCutting} cross-cutting · <b className="text-bg">{tb.newTeacher} new-teacher</b>
        </SumCard>
        <SumCard label="Staff in ≥ 1 PLC" big={`${stats.staffInPlc} / ${stats.teachingStaffCount}`}>
          Teaching staff (Teacher · Form Master) assigned to at least one PLC
        </SumCard>
      </div>

      {/* ── School-wide cadence ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="When it runs"
          meta="One protected hour · a PLC may override with its facilitator's coordination"
        >
          The <em className="italic text-gold">{programme.dayName} rhythm</em> ·{" "}
          {programme.windowLabel}
        </SectionHead>
        <CadenceCard programme={programme} canEdit={canEdit} />
      </section>

      {/* ── PLC groups ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow={`${stats.activePlcCount} ${stats.activePlcCount === 1 ? "community" : "communities"} · staff-CPD architecture`}
          meta="Subject-based · cross-cutting · new-teacher · border colour marks the type"
        >
          The school&apos;s <em className="italic text-gold">Professional Learning Communities</em>
        </SectionHead>
        <div className="space-y-3.5">
          {plcs.map((plc) => (
            <PlcCard
              key={plc.id}
              plc={plc}
              staffOptions={setup.staffOptions}
              canEdit={canEdit}
              periodLabel={setup.periodLabel}
            />
          ))}
          {plcs.length === 0 && !canEdit && (
            <div className="rounded-2xl border border-dashed border-border-2 bg-surface px-6 py-8 text-center text-sm italic text-navy-3">
              No PLCs configured yet.
            </div>
          )}
          {canEdit && <AddPlc staffOptions={setup.staffOptions} />}
        </div>
      </section>

      {/* ── CPD points contract ── */}
      <section className="mb-8">
        <ContractCard programme={programme} canEdit={canEdit} />
      </section>

      {/* ── Foot provenance (rendered only when there IS a PLC edit history) ── */}
      {setup.provenance && (
        <div className="border-t border-border pt-4 text-[11px] italic text-navy-3">
          PLC programme last edited · {setup.provenance.at} by{" "}
          <b className="font-semibold not-italic text-navy-2">{setup.provenance.byName}</b>
        </div>
      )}
    </div>
  );
}
