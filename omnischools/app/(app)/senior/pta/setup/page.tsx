import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getPtaSetup } from "@/lib/pta/setup-data";
import { TierCard } from "@/components/pta/tier-card";
import { GenerateBar } from "@/components/pta/generate-bar";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/setup` — the PTA structure-setup spine (SHS module 4.7 / INCR-50): the four-tier config
 * (Form / House / General / Emergency), the forward-only dues-rate history, and the EXPLICIT idempotent
 * generation of `ptas`.
 *
 * ADMIN-ONLY (R415): the read gate IS the write gate (PTA_CONFIG_WRITE_ROLES = Admin / Headmaster). A
 * plain teacher/parent sees neither the nav link nor the page — this page redirects them. Parents return
 * as first-class actors only at INCR-55 (parent_scope), never here.
 *
 * Scope fence (R418): config + generation + dues-history ONLY. NO officers-as-roles, NO meetings, NO
 * invoices, NO parent path. HONESTY (R417): an unconfigured school shows coalesced defaults, ZERO `ptas`
 * (none exist until Generate), and gen-preview counts that DERIVE live from the class/House lists.
 */
export default async function PtaSetupPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!hasAnyRole(user.roles, PTA_CONFIG_WRITE_ROLES)) redirect("/dashboard");

  const setup = await getPtaSetup(school.id);
  const { tiers, genPreview, instanceCounts, provenance } = setup;

  return (
    <div className="mx-auto max-w-page pb-20">
      {/* ── Hero ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Settings · Governance · PTA structure
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Four tiers, <em className="italic text-gold">four conversations</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {school.name} · which PTAs your school runs, how often they meet, who their officers are, and
          whether they collect dues. A PTA in a Ghanaian SHS isn&apos;t one body — it&apos;s four: the{" "}
          <b className="font-semibold text-navy-2">Form PTA</b> (class-level),{" "}
          <b className="font-semibold text-navy-2">House PTA</b> (boarding &amp; pastoral),{" "}
          <b className="font-semibold text-navy-2">General PTA</b> (school-wide governance), and the{" "}
          <b className="font-semibold text-navy-2">Emergency PTA</b> (convened when something can&apos;t
          wait). Configure once when SHS opens; revisit anytime.
        </p>
      </header>

      {/* ── Tiers intro ── */}
      <div className="mb-8 rounded-2xl border border-gold-soft bg-gold-bg px-7 py-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          Before you configure
        </div>
        <h3 className="mt-1 font-display text-xl font-semibold text-navy">
          A PTA in Ghana isn&apos;t <em className="italic text-gold">one body</em>, it&apos;s four.
        </h3>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-navy-2">
          Most SHSs run <b className="font-semibold text-navy">all four tiers</b> in some form. Day
          schools may skip the House PTA if Houses are nominal. New schools often start with only the
          General PTA and add the Form tier in year two.{" "}
          <b className="font-semibold text-navy">
            Whatever combination works for your school, configure it here.
          </b>{" "}
          You can switch tiers on or off later — existing records are preserved.
        </p>
      </div>

      {/* ── The four tier cards ── */}
      <div className="space-y-4">
        {tiers.map((tier) => (
          <TierCard key={tier.tierType} tier={tier} />
        ))}
      </div>

      {/* ── Auto-generation preview (navy · no-alpha discipline) ── */}
      <div className="mt-8 rounded-2xl bg-navy px-7 py-6 text-bg">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          What this configuration produces
        </div>
        <h4 className="mt-1 font-display text-xl font-medium">
          What <em className="italic text-gold">Generate PTAs now</em> will create
        </h4>
        <div className="mt-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <GenTile
            num={genPreview.form}
            label="Form PTAs"
            detail={`One per class · ${genPreview.activeClasses} active ${genPreview.activeClasses === 1 ? "class" : "classes"}`}
          />
          <GenTile
            num={genPreview.house}
            label="House PTAs"
            detail={`One per House · ${genPreview.activeHouses} active ${genPreview.activeHouses === 1 ? "House" : "Houses"}`}
          />
          <GenTile num={genPreview.general} label="General PTA" detail="School-wide · one singleton" />
          <GenTile
            num={null}
            label="Emergency PTAs"
            detail="On-demand only · no standing instances · convened when needed"
          />
        </div>
        {instanceCounts.active + instanceCounts.closed > 0 && (
          <p className="mt-4 text-[12px] text-gold-soft">
            Currently live: <b className="text-bg">{instanceCounts.form}</b> Form ·{" "}
            <b className="text-bg">{instanceCounts.house}</b> House ·{" "}
            <b className="text-bg">{instanceCounts.general}</b> General
            {instanceCounts.closed > 0 ? ` · ${instanceCounts.closed} closed (preserved)` : ""}.
          </p>
        )}
      </div>

      {/* ── Dues posture ── */}
      <div className="mt-6 rounded-2xl border border-gold-soft bg-gold-bg px-7 py-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          Dues posture · the Omnischools rule
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-navy-2">
          <em className="font-display italic text-gold">Dues are forward-only.</em> If you change Form
          PTA dues from GHS 50 to GHS 75 mid-term, students already invoiced at GHS 50 keep their
          existing invoice unchanged. The new amount applies to all new invoices from the effective
          date onward.{" "}
          <b className="font-semibold text-navy">
            Same pattern as discounts and fee structures across Omnischools.
          </b>{" "}
          Past records stay accurate; future records reflect the change. Every dues change is
          audit-logged with timestamp, admin, and reason.
        </p>
      </div>

      {/* ── Foot · Generate ── */}
      <GenerateBar provenance={provenance} />
    </div>
  );
}

/** One tile of the navy gen-preview. `num = null` renders the Emergency "—" (no standing instances). */
function GenTile({ num, label, detail }: { num: number | null; label: string; detail: string }) {
  const zero = num === null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div
        className={`font-display text-3xl font-medium leading-none ${zero ? "text-[rgba(232,212,184,0.5)]" : "text-gold"}`}
      >
        {zero ? "—" : num}
      </div>
      <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft">
        {label}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-[rgba(250,247,242,0.55)]">{detail}</div>
    </div>
  );
}
