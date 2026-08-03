import { requireBoard } from "@/lib/auth/server";
import { getSchoolRollup, type NetPositionFinanceArm, type RollupArm } from "@/lib/rollup/school-rollup";
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

      <FinancialPosition arm={rollup.netPositionFinance} />
    </div>
  );
}

/**
 * GOV-3 · the net-position finance area (R349/R350) — THREE DISTINCT labelled streams shown side by
 * side, NEVER summed into a single profit/surplus. A minimal shell (not the GOV-4 dashboard). Each
 * stream honours the omit-not-fake convention: a NOT_CAPTURED / NOT_APPLICABLE inner arm renders its
 * reason and NO number; a CAPTURED real zero renders "GHS 0".
 */
function FinancialPosition({ arm }: { arm: RollupArm<NetPositionFinanceArm> }) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-medium text-navy">
        Financial <em className="not-italic text-gold">position</em>.
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-navy-3">
        Financial position — three separate records shown side by side. Fee collections and the
        school&apos;s books are kept as separate ledgers and are not combined into a single profit;
        payroll is a current monthly figure.
      </p>

      {arm.status !== "CAPTURED" ? (
        <p className="mt-4 rounded-xl border border-border bg-surface px-[22px] py-[18px] text-[13px] leading-relaxed text-navy-3">
          {arm.reason}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {/* Stream 1 · Fee collections (collected headline) — the feeCollections arm, reused verbatim. */}
          <StreamCard title="Fee collections">
            {(() => {
              const t = boardTile(arm.data.fees, (d) => boardGhs(d.collected));
              return t.status === "CAPTURED" ? (
                <>
                  <Headline>{t.value}</Headline>
                  <Caption>collected · this term</Caption>
                </>
              ) : (
                <Reason>{t.reason}</Reason>
              );
            })()}
          </StreamCard>

          {/* Stream 2 · Books (this term) — income / expense / net, all WITHIN the one books ledger. */}
          <StreamCard title="Books (this term)">
            {arm.data.books.status === "CAPTURED" ? (
              <dl className="mt-2 space-y-1 text-[13px]">
                <Line label="Income" value={boardGhs(arm.data.books.data.income)} />
                <Line label="Expense" value={boardGhs(arm.data.books.data.expense)} />
                <Line label="Net" value={boardGhs(arm.data.books.data.net)} strong />
              </dl>
            ) : (
              <Reason>{arm.data.books.reason}</Reason>
            )}
          </StreamCard>

          {/* Stream 3 · Payroll (school-paid · gross · monthly) — GES memo shown separately beside it. */}
          <StreamCard title="Payroll">
            {arm.data.payroll.status === "CAPTURED" ? (
              <>
                <Headline>{boardGhs(arm.data.payroll.data.schoolPaidMonthlyTotal)}</Headline>
                <Caption>school-paid · gross · monthly</Caption>
                <div className="mt-2 text-[11px] leading-relaxed text-navy-3">
                  GES-paid (memo, not added): {boardGhs(arm.data.payroll.data.gesPaidMonthlyMemo)}
                  {arm.data.payroll.data.allowanceMonthlyMemo > 0 && (
                    <>
                      <br />
                      Allowance (memo, not added): {boardGhs(arm.data.payroll.data.allowanceMonthlyMemo)}
                    </>
                  )}
                </div>
              </>
            ) : (
              <Reason>{arm.data.payroll.reason}</Reason>
            )}
          </StreamCard>
        </div>
      )}
    </div>
  );
}

function StreamCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-[22px] py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">{title}</div>
      {children}
    </section>
  );
}

const Headline = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2 font-display text-2xl font-medium text-navy">{children}</div>
);
const Caption = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-0.5 text-[11px] text-navy-3">{children}</div>
);
const Reason = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2 text-[13px] leading-relaxed text-navy-3">{children}</div>
);

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy-3">{label}</dt>
      <dd className={strong ? "font-display font-medium text-navy" : "text-navy-2"}>{value}</dd>
    </div>
  );
}
