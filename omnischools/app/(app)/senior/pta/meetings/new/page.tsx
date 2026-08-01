import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { isStaff } from "@/lib/access";
import {
  getConvenablePtas,
  getConveneStaffOptions,
  canConveneEmergency,
} from "@/lib/pta/meeting-data";
import { PtaConveneForm } from "@/components/pta/meeting-register";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/meetings/new` — convene a meeting (SHS module 4.7 / INCR-52). Regular: pick one of the PTAs
 * you are the Secretary of (∥ break-glass sees all). `?tier=emergency`: convene a NEW on-demand Emergency
 * PTA instance + its meeting in one tx (break-glass ∥ the General PTA Chair by identity). READ = isStaff +
 * BASIC redirect; the server actions re-check the write gate. SMS + dues DROPPED (R443 scope fence).
 */
export default async function ConvenePtaMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");

  const { tier } = await searchParams;
  const emergency = tier === "emergency";
  const viewer = { userId: user.id, roles: user.roles };

  if (emergency) {
    const allowed = await canConveneEmergency(school.id, viewer);
    if (!allowed) redirect("/senior/pta/meetings");
  }

  const [ptas, staff] = await Promise.all([
    emergency ? Promise.resolve([]) : getConvenablePtas(school.id, viewer),
    getConveneStaffOptions(school.id),
  ]);

  if (!emergency && ptas.length === 0) redirect("/senior/pta/meetings");

  return (
    <div className="pb-20">
      <header className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          PTA · Meetings · {emergency ? "Emergency" : "New"}
        </div>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {emergency ? (
            <>Convene an <em className="italic text-terra">emergency meeting</em></>
          ) : (
            <>Convene a <em className="italic text-gold">PTA meeting</em></>
          )}
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm leading-relaxed text-navy-3">
          {emergency
            ? "An Emergency PTA is convened on-demand — this creates a fresh Emergency instance and its meeting in one step. No standing officers or dues."
            : "Set the type, date, time, location and agenda. On the day you'll mark the two registers side by side."}{" "}
          <Link href="/senior/pta/meetings" className="font-semibold text-navy underline">
            Back to meetings
          </Link>
        </p>
      </header>

      <PtaConveneForm emergency={emergency} ptas={ptas} staff={staff} />
    </div>
  );
}
