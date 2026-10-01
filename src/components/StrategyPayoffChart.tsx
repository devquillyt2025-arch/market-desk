"use client";

/**
 * Payoff chart for the Analysis tab — hand-drawn SVG rather than Recharts,
 * because the look needs things a chart lib makes awkward: one curve that
 * switches colour at the zero line, tinted profit/loss regions, ±1/2σ bands,
 * and a movable "target" marker.
 */

import { useId, useMemo, useState, type PointerEvent } from "react";

import { formatCompactINR } from "@/lib/format";
import type { CurvePoint } from "@/lib/calculateStrategy";

const W = 720;
const H = 340;
const M = { l: 58, r: 16, t: 30, b: 30 };

type Props = {
  points: CurvePoint[];
  spot: number;
  targetSpot: number;
  /** One-sigma move to expiry as a fraction of spot; 0 hides the bands. */
  sdPct: number;
  /** P&L at the target spot on the target date. */
  targetPnl: number;
  showTarget: boolean;
};

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  const step = (frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return ticks;
}

export default function StrategyPayoffChart({ points, spot, targetSpot, sdPct, targetPnl, showTarget }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const xMin = points[0].spot;
    const xMax = points[points.length - 1].spot;
    let yMin = 0;
    let yMax = 0;
    for (const p of points) {
      yMin = Math.min(yMin, p.expiry, p.target);
      yMax = Math.max(yMax, p.expiry, p.target);
    }
    const pad = (yMax - yMin || 1) * 0.1;
    yMin -= pad;
    yMax += pad;
    const x = (v: number) => M.l + ((v - xMin) / (xMax - xMin)) * (W - M.l - M.r);
    const y = (v: number) => M.t + ((yMax - v) / (yMax - yMin)) * (H - M.t - M.b);
    const line = (key: "expiry" | "target") =>
      points.map((p, i) => `${i ? "L" : "M"}${x(p.spot).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    const expiryLine = line("expiry");
    const area = `${expiryLine}L${x(xMax).toFixed(1)},${y(0).toFixed(1)}L${x(xMin).toFixed(1)},${y(0).toFixed(1)}Z`;
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      x,
      y,
      expiryLine,
      area,
      targetLine: line("target"),
      xTicks: niceTicks(xMin, xMax, 6),
      yTicks: niceTicks(yMin, yMax, 5),
    };
  }, [points]);

  const { x, y } = geo;
  const zeroY = y(0);
  const inRange = (v: number) => v >= geo.xMin && v <= geo.xMax;

  function handleMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(geo.xMin + frac * (geo.xMax - geo.xMin));
  }

  const hoverPoint = useMemo(() => {
    if (hover === null) return null;
    let best = points[0];
    for (const p of points) if (Math.abs(p.spot - hover) < Math.abs(best.spot - hover)) best = p;
    return best;
  }, [hover, points]);

  const sdBands =
    sdPct > 0
      ? [
          { v: spot * (1 - 2 * sdPct), label: "-2SD" },
          { v: spot * (1 - sdPct), label: "-1SD" },
          { v: spot * (1 + sdPct), label: "1SD" },
          { v: spot * (1 + 2 * sdPct), label: "2SD" },
        ].filter((b) => inRange(b.v))
      : [];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Strategy payoff chart">
        <defs>
          <clipPath id={`${uid}-above`}>
            <rect x={0} y={0} width={W} height={Math.max(zeroY, 0)} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <rect x={0} y={Math.max(zeroY, 0)} width={W} height={H} />
          </clipPath>
        </defs>

        {/* ±1/2σ bands */}
        {sdBands.length === 4 && (
          <>
            <rect
              x={x(sdBands[0].v)}
              y={M.t}
              width={x(sdBands[3].v) - x(sdBands[0].v)}
              height={H - M.t - M.b}
              className="fill-muted-foreground/5"
            />
            <rect
              x={x(sdBands[1].v)}
              y={M.t}
              width={x(sdBands[2].v) - x(sdBands[1].v)}
              height={H - M.t - M.b}
              className="fill-muted-foreground/5"
            />
          </>
        )}
        {sdBands.map((b) => (
          <g key={b.label}>
            <line x1={x(b.v)} x2={x(b.v)} y1={M.t} y2={H - M.b} className="stroke-border" strokeDasharray="2 3" />
            <text x={x(b.v)} y={M.t - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {b.label}
            </text>
          </g>
        ))}

        {/* grid + axes */}
        {geo.yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="stroke-border/60" />
            <text x={M.l - 8} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {formatCompactINR(t)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {Math.round(t).toLocaleString("en-IN")}
          </text>
        ))}

        {/* profit / loss tints and the expiry curve, split at zero */}
        <path d={geo.area} clipPath={`url(#${uid}-above)`} className="fill-profit/15" />
        <path d={geo.area} clipPath={`url(#${uid}-below)`} className="fill-loss/20" />
        <line x1={M.l} x2={W - M.r} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/60" />
        <path
          d={geo.expiryLine}
          clipPath={`url(#${uid}-above)`}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          className="stroke-profit"
        />
        <path
          d={geo.expiryLine}
          clipPath={`url(#${uid}-below)`}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          className="stroke-danger-fg"
        />
        <path d={geo.targetLine} fill="none" strokeWidth={2.5} strokeLinejoin="round" className="stroke-accent" />

        {/* current spot */}
        {inRange(spot) && (
          <g>
            <line x1={x(spot)} x2={x(spot)} y1={M.t} y2={H - M.b} className="stroke-foreground/70" />
            <text x={x(spot)} y={M.t - 16} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
              Spot {spot.toFixed(2)}
            </text>
          </g>
        )}

        {/* target marker */}
        {showTarget && inRange(targetSpot) && (
          <g>
            <line x1={x(targetSpot)} x2={x(targetSpot)} y1={M.t} y2={H - M.b} className="stroke-accent/50" strokeDasharray="4 3" />
            <circle cx={x(targetSpot)} cy={y(targetPnl)} r={5} className="fill-accent stroke-background" strokeWidth={2} />
          </g>
        )}

        {/* hover crosshair */}
        {hoverPoint && (
          <g pointerEvents="none">
            <line x1={x(hoverPoint.spot)} x2={x(hoverPoint.spot)} y1={M.t} y2={H - M.b} className="stroke-muted-foreground/60" />
            <circle cx={x(hoverPoint.spot)} cy={y(hoverPoint.expiry)} r={3.5} className="fill-foreground" />
            <circle cx={x(hoverPoint.spot)} cy={y(hoverPoint.target)} r={3.5} className="fill-accent" />
          </g>
        )}
        <rect
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hoverPoint && (
        <div
          className="pointer-events-none absolute top-8 z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(x(hoverPoint.spot) / W) * 100}%` }}
        >
          <div className="font-medium">{hoverPoint.spot.toFixed(1)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2 rounded-full bg-foreground" />
            On expiry
            <span className={`font-mono tabular-nums ${hoverPoint.expiry >= 0 ? "text-profit" : "text-danger-fg"}`}>
              {formatCompactINR(hoverPoint.expiry)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2 rounded-full bg-accent" />
            On target date
            <span className={`font-mono tabular-nums ${hoverPoint.target >= 0 ? "text-profit" : "text-danger-fg"}`}>
              {formatCompactINR(hoverPoint.target)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
