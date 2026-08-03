import { requireBoard } from "@/lib/auth/server";
import { getSchoolRollup } from "@/lib/rollup/school-rollup";
import { boardTile, boardGhs, type BoardTile } from "@/lib/board/tiles";

/**
 * GOV-2 · the read-only board/director landing (URL `/board`). A MINIMAL honest shell — the full
 * designed 5-tile dashboard is GOV-4. It calls `getSchoolRollup` with the SESSION-resolved `school.id`
 * (never a URL/searchParams school id — R339); `searchParams.periodId` (async, Next 15) only picks the
 * term. Each tile honours the omit-not-fake convention via the pure `boardTile` helper: a NOT_CAPTURED
 * arm renders its reason and no number; a CAPTURED zero (e.g. GHS 0 collected) renders the real zero.
 */
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school } = await requireBoard();
  const { periodId } = await searchParams;
  const rollup = await getSchoolRollup(school.id, { periodId });

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";

  const tiles: { title: string; tile: BoardTile }[] = [
    { title: "Students on roll", tile: boardTile(rollup.enrolment, (d) => d.roll.toLocaleString("en-GH")) },
    {
      title: "Attendance rate",
      tile: boardTile(rollup.attendance, (d) => (d.schoolRate == null ? "—" : `${d.schoolRate}%`)),
    },
    { title: "Fees collected", tile: boardTile(rollup.feeCollections, (d) => boardGhs(d.collected)) },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-medium text-navy">
          Board <em className="not-italic text-gold">overview</em>.
        </h1>
        <p className="mt-1 text-[13px] text-navy-2">{termLabel}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map(({ title, tile }) => (
          <section
            key={title}
            className="rounded-xl border border-border bg-surface px-[22px] py-[18px]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
              {title}
            </div>
            {tile.status === "CAPTURED" ? (
              <div className="mt-2 font-display text-2xl font-medium text-navy">{tile.value}</div>
            ) : (
              <div className="mt-2 text-[13px] leading-relaxed text-navy-3">{tile.reason}</div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
