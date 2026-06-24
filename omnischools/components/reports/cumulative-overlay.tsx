/**
 * Region-02 overlay chart for the Collection-trend report (presentational,
 * server component). Renders two cumulative-collection series (this term in
 * gold, last term in navy-3) on a shared weekly x-axis, plus a "NOW" marker.
 *
 * Colours are inline hex literals because this is raw SVG — design tokens with
 * slash-opacity modifiers would silently break, and SVG gradients legitimately
 * use stop-opacity.
 */
export function CumulativeOverlay({
  current,
  prior,
  totalWeeks,
  currentWeekIndex,
  yMax,
  currentLabel,
  priorLabel,
}: {
  current: number[];
  prior: number[] | null;
  totalWeeks: number;
  currentWeekIndex: number;
  yMax: number;
  currentLabel?: string;
  priorLabel?: string;
}) {
  const W = 1000;
  const H = 280;
  const safeYMax = yMax > 0 ? yMax : 1;
  const denom = totalWeeks > 1 ? totalWeeks - 1 : 1;

  const x = (week: number) => ((week - 1) / denom) * W;
  const y = (v: number) => {
    const clamped = Math.max(0, Math.min(v, safeYMax));
    return H - (clamped / safeYMax) * H;
  };

  // current series drawn only up to currentWeekIndex
  const curPoints = current
    .slice(0, Math.max(1, currentWeekIndex))
    .map((v, i) => `${round(x(i + 1))},${round(y(v))}`);
  const priorPoints = (prior ?? []).map((v, i) => `${round(x(i + 1))},${round(y(v))}`);

  const nowX = round(x(currentWeekIndex));

  // area-fill paths (close down to baseline)
  const curArea =
    curPoints.length > 0
      ? `M ${curPoints[0]} L ${curPoints.join(" L ")} L ${round(x(Math.max(1, currentWeekIndex)))},${H} L ${round(x(1))},${H} Z`
      : "";
  const priorArea =
    priorPoints.length > 0
      ? `M ${priorPoints[0]} L ${priorPoints.join(" L ")} L ${round(x(prior!.length))},${H} L ${round(x(1))},${H} Z`
      : "";

  // y-axis labels: yMax, .8, .6, .4, .2, 0
  const yLabels = [1, 0.8, 0.6, 0.4, 0.2, 0].map((f) => kFmt(safeYMax * f));
  // x-axis labels Wk 1..Wk N
  const xLabels = Array.from({ length: totalWeeks }, (_, i) => `Wk ${i + 1}`);

  const curEnd = curPoints.length ? curPoints[curPoints.length - 1].split(",") : null;
  const curEndVal = current[Math.max(0, Math.min(currentWeekIndex, current.length) - 1)] ?? 0;
  const priorAtNow = prior ? (prior[Math.max(0, currentWeekIndex - 1)] ?? 0) : 0;

  return (
    <div className="relative h-[280px]">
      {/* y-axis labels column */}
      <div className="absolute bottom-7 left-0 top-0 flex w-14 flex-col justify-between pr-2.5 text-right font-mono text-[9px] font-semibold text-navy-3">
        {yLabels.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>

      {/* svg plot area */}
      <div className="absolute bottom-7 left-14 right-0 top-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="ctPriorGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5C6675" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#5C6675" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ctCurrentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C8975B" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#C8975B" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* horizontal grid lines (5) */}
          {[0, 56, 112, 168, 224].map((gy) => (
            <line
              key={gy}
              x1="0"
              y1={gy}
              x2={W}
              y2={gy}
              stroke="#E5DFD3"
              strokeWidth="0.5"
              strokeDasharray="2 4"
            />
          ))}

          {/* prior series */}
          {prior && priorPoints.length > 0 && (
            <>
              <path d={priorArea} fill="url(#ctPriorGrad)" />
              <polyline
                points={priorPoints.join(" ")}
                fill="none"
                stroke="#5C6675"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {/* current series (gold, up to NOW) */}
          {curPoints.length > 0 && (
            <>
              <path d={curArea} fill="url(#ctCurrentGrad)" />
              <polyline
                points={curPoints.join(" ")}
                fill="none"
                stroke="#C8975B"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {/* NOW marker */}
          <line
            x1={nowX}
            y1="0"
            x2={nowX}
            y2={H}
            stroke="#C8975B"
            strokeWidth="0.5"
            strokeDasharray="3 3"
            opacity="0.5"
          />
          <text
            x={nowX + 4}
            y="14"
            fontFamily="Manrope"
            fontSize="9"
            fontWeight="700"
            fill="#C8975B"
            letterSpacing="0.06em"
          >
            NOW · WK {currentWeekIndex}
          </text>

          {/* prior dot at NOW */}
          {prior && (
            <>
              <circle
                cx={nowX}
                cy={round(y(priorAtNow))}
                r="3"
                fill="#5C6675"
                stroke="#FAF7F2"
                strokeWidth="1.5"
              />
              <text
                x={nowX - 10}
                y={round(y(priorAtNow)) - 6}
                fontFamily="JetBrains Mono"
                fontSize="10"
                fontWeight="700"
                fill="#5C6675"
                textAnchor="end"
              >
                {kFmt(priorAtNow)}
              </text>
              {priorLabel && (
                <text
                  x={nowX - 10}
                  y={round(y(priorAtNow)) + 6}
                  fontFamily="Fraunces"
                  fontStyle="italic"
                  fontSize="9"
                  fill="#5C6675"
                  textAnchor="end"
                >
                  {priorLabel}
                </text>
              )}
            </>
          )}

          {/* current end dot */}
          {curEnd && (
            <>
              <circle
                cx={curEnd[0]}
                cy={curEnd[1]}
                r="5"
                fill="#C8975B"
                stroke="#FAF7F2"
                strokeWidth="2"
              />
              <text
                x={Number(curEnd[0]) + 12}
                y={Number(curEnd[1]) - 2}
                fontFamily="JetBrains Mono"
                fontSize="11"
                fontWeight="700"
                fill="#1A2B47"
              >
                GHS {kFmt(curEndVal)}
              </text>
              {currentLabel && (
                <text
                  x={Number(curEnd[0]) + 12}
                  y={Number(curEnd[1]) + 11}
                  fontFamily="Fraunces"
                  fontStyle="italic"
                  fontSize="10"
                  fill="#C8975B"
                >
                  {currentLabel}
                </text>
              )}
            </>
          )}
        </svg>
      </div>

      {/* x-axis labels */}
      <div className="absolute bottom-0 left-14 right-0 flex h-6 justify-between pt-1.5 font-mono text-[9px] font-semibold text-navy-3">
        {xLabels.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "178k", "1.2k", "950" style compact label. */
function kFmt(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(Math.round(n));
}
