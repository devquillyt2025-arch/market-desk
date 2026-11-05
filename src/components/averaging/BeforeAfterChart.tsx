"use client";

/**
 * Profit and loss at every index level, before versus after the new lots, on
 * one chosen date. After is the solid line (green above zero, red below, with
 * the profit/loss glow); Before is dashed grey. The dots on the zero line are
 * the two break-evens. Hand-drawn SVG in the app's colour tokens, like the
 * Analysis chart, but sized to its own width so the text stays readable on a
 * phone. The table beside it carries the same numbers for anyone who can't
 * read a chart.
 */

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";

import { niceTicks } from "@/components/StrategyPayoffChart";
import { signedRupee } from "@/components/averaging/ui";
import type { PayoffCurve } from "@/lib/averaging";
import { formatCompactINR, formatLevel, pnlColorClass } from "@/lib/format";

const M = { l: 54, r: 16, t: 30, b: 28 };

function anchorFor(x: number, w: number): "start" | "middle" | "end" {
  if (x < M.l + 44) return "start";
  if (x > w - M.r - 44) return "end";
  return "middle";
}

/** The words around the two lines; the averaging simulator's by default. */
export type ChartLabels = { subject: string; after: string; before: string };
const DEFAULT_LABELS: ChartLabels = { subject: "the new lots", after: "After — with the new lots", before: "Before — as it is now" };

type ChartProps = { curve: PayoffCurve; spot: number; indexName: string; labels?: ChartLabels };

/** The drawing itself, at a given pixel width — split from the measuring wrapper below so it renders (and tests) at any size. */
export function ChartPlot({ curve, spot, indexName, width, labels = DEFAULT_LABELS }: ChartProps & { width: number }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const W = Math.max(width, 280);
  const H = W < 520 ? 250 : 330;

  const geo = useMemo(() => {
    const pts = curve.points;
    const xMin = pts[0].level;
    const xMax = pts[pts.length - 1].level;
    let yMin = 0;
    let yMax = 0;
    for (const p of pts) {
      for (const v of [p.before, p.after]) {
        if (v === null) continue;
        yMin = Math.min(yMin, v);
        yMax = Math.max(yMax, v);
      }
    }
    const pad = (yMax - yMin || 1) * 0.12;
    yMin -= pad;
    yMax += pad;
    const x = (v: number) => M.l + ((v - xMin) / (xMax - xMin)) * (W - M.l - M.r);
    const y = (v: number) => M.t + ((yMax - v) / (yMax - yMin)) * (H - M.t - M.b);
    const path = (key: "before" | "after") => {
      let d = "";
      let pen = false;
      for (const p of pts) {
        const v = p[key];
        if (v === null) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${x(p.level).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const afterLine = path("after");
    return {
      xMin,
      xMax,
      x,
      y,
      beforeLine: path("before"),
      afterLine,
      area: afterLine ? `${afterLine}L${x(xMax).toFixed(1)},${y(0).toFixed(1)}L${x(xMin).toFixed(1)},${y(0).toFixed(1)}Z` : "",
      xTicks: niceTicks(xMin, xMax, W < 520 ? 4 : 6),
      yTicks: niceTicks(yMin, yMax, 4),
    };
  }, [curve, W, H]);

  const { x, y } = geo;
  const zeroY = y(0);
  const plotBottom = H - M.b;

  function handleMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const level = geo.xMin + ((e.clientX - rect.left) / rect.width) * (geo.xMax - geo.xMin);
    let best = 0;
    curve.points.forEach((p, i) => {
      if (Math.abs(p.level - level) < Math.abs(curve.points[best].level - level)) best = i;
    });
    setHover(best);
  }

  const hovered = hover === null ? null : curve.points[Math.min(hover, curve.points.length - 1)];
  const { breakevenBefore: beB, breakevenAfter: beA } = curve;
  // "today" / "expiry" read naturally in lower case; a date ("Fri, 6 Nov") doesn't.
  const when = curve.scenario.key.startsWith("date:") ? `on ${curve.scenario.label}` : curve.scenario.label.toLowerCase();
  const label =
    `Profit and loss ${when} across ${indexName} levels ${formatLevel(geo.xMin)} to ${formatLevel(geo.xMax)}, ` +
    `before and after ${labels.subject}.` +
    (beB !== null && beA !== null ? ` Break-even moves from ${formatLevel(beB)} to ${formatLevel(beA)}.` : "") +
    ` The exact figures are in the table.`;

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="select-none" role="img" aria-label={label}>
        <defs>
          <clipPath id={`${uid}-above`}>
            <rect x={0} y={0} width={W} height={Math.max(zeroY, 0)} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <rect x={0} y={Math.max(zeroY, 0)} width={W} height={H} />
          </clipPath>
          {/* The tints fade towards the zero line, so the area reads as depth of profit / loss rather than a flat block. */}
          <linearGradient id={`${uid}-gain`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={zeroY} y2={M.t}>
            <stop offset="0" style={{ stopColor: "var(--profit)", stopOpacity: 0.03 }} />
            <stop offset="1" style={{ stopColor: "var(--profit)", stopOpacity: 0.3 }} />
          </linearGradient>
          <linearGradient id={`${uid}-pain`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={zeroY} y2={H - M.b}>
            <stop offset="0" style={{ stopColor: "var(--loss)", stopOpacity: 0.03 }} />
            <stop offset="1" style={{ stopColor: "var(--loss)", stopOpacity: 0.34 }} />
          </linearGradient>
        </defs>

        {geo.yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="stroke-border/60" />
            <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {formatCompactINR(t)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {Math.round(t).toLocaleString("en-IN")}
          </text>
        ))}

        {geo.area && (
          <>
            <path d={geo.area} clipPath={`url(#${uid}-above)`} fill={`url(#${uid}-gain)`} />
            <path d={geo.area} clipPath={`url(#${uid}-below)`} fill={`url(#${uid}-pain)`} />
          </>
        )}
        <line x1={M.l} x2={W - M.r} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/60" />

        {geo.beforeLine && (
          <path d={geo.beforeLine} fill="none" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" className="stroke-muted-foreground" />
        )}
        {geo.afterLine && (
          <>
            <path d={geo.afterLine} clipPath={`url(#${uid}-above)`} fill="none" strokeWidth={2.75} strokeLinejoin="round" className="stroke-profit" />
            <path d={geo.afterLine} clipPath={`url(#${uid}-below)`} fill="none" strokeWidth={2.75} strokeLinejoin="round" className="stroke-danger-fg" />
          </>
        )}

        {spot >= geo.xMin && spot <= geo.xMax && (
          <g>
            <line x1={x(spot)} x2={x(spot)} y1={M.t} y2={plotBottom} strokeDasharray="2 3" className="stroke-foreground/50" />
            <text x={x(spot)} y={M.t - 10} textAnchor={anchorFor(x(spot), W)} className="fill-foreground text-[11px] font-semibold">
              {indexName} {formatLevel(spot)}
            </text>
          </g>
        )}

        {beB !== null && (
          <g>
            <circle cx={x(beB)} cy={zeroY} r={8} fill="none" strokeWidth={2} className="stroke-muted-foreground" />
            <text x={x(beB)} y={zeroY + 20} textAnchor={anchorFor(x(beB), W)} className="fill-muted-foreground text-[11px]">
              {formatLevel(beB)}
            </text>
          </g>
        )}
        {beA !== null && (
          <g>
            <circle cx={x(beA)} cy={zeroY} r={4.5} strokeWidth={1.5} className="fill-accent-solid stroke-background" />
            <text x={x(beA)} y={zeroY - 12} textAnchor={anchorFor(x(beA), W)} className="fill-foreground text-[11px] font-semibold">
              {formatLevel(beA)}
            </text>
          </g>
        )}

        {hovered && (
          <g pointerEvents="none">
            <line x1={x(hovered.level)} x2={x(hovered.level)} y1={M.t} y2={plotBottom} className="stroke-muted-foreground/70" />
            {hovered.before !== null && <circle cx={x(hovered.level)} cy={y(hovered.before)} r={4} className="fill-muted-foreground" />}
            {hovered.after !== null && <circle cx={x(hovered.level)} cy={y(hovered.after)} r={4.5} className="fill-accent-solid stroke-background" strokeWidth={2} />}
          </g>
        )}
        <rect
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={handleMove}
          onPointerDown={handleMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(x(hovered.level), 80), W - 80) }}
        >
          <p className="font-mono font-semibold tabular-nums">
            {indexName} {formatLevel(hovered.level)}
          </p>
          <p className="mt-1 flex items-center justify-between gap-4 whitespace-nowrap">
            <span className="text-muted-foreground">Before</span>
            <span className={`font-mono tabular-nums ${hovered.before === null ? "" : pnlColorClass(hovered.before)}`}>
              {hovered.before === null ? "—" : signedRupee(hovered.before)}
            </span>
          </p>
          <p className="flex items-center justify-between gap-4 whitespace-nowrap">
            <span className="text-muted-foreground">After</span>
            <span className={`font-mono font-semibold tabular-nums ${hovered.after === null ? "" : pnlColorClass(hovered.after)}`}>
              {hovered.after === null ? "—" : signedRupee(hovered.after)}
            </span>
          </p>
          {hovered.before !== null && hovered.after !== null && (
            <p className="mt-1 flex items-center justify-between gap-4 whitespace-nowrap border-t border-border pt-1">
              <span className="text-muted-foreground">Change</span>
              <span className="font-mono tabular-nums">{signedRupee(hovered.after - hovered.before)}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The chart at its container's width, under a short key to the lines and dots. */
export default function BeforeAfterChart(props: ChartProps) {
  const labels = props.labels ?? DEFAULT_LABELS;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <svg width="22" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="22" y2="3" strokeWidth="2.5" className="stroke-profit" />
          </svg>
          {labels.after}
        </span>
        <span className="flex items-center gap-2">
          <svg width="22" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="22" y2="3" strokeWidth="2" strokeDasharray="5 4" className="stroke-muted-foreground" />
          </svg>
          {labels.before}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent-solid" aria-hidden="true" />
          Break-even after
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3.5 rounded-full border-2 border-muted-foreground" aria-hidden="true" />
          Break-even before
        </span>
      </div>

      {/* Space is held before the width is measured (phone-height below sm, full height above) so the page doesn't jump when the chart appears. */}
      <div ref={wrap} className="min-h-[250px] w-full sm:min-h-[330px]" style={width > 0 ? { minHeight: width < 520 ? 250 : 330 } : undefined}>
        {width > 0 && <ChartPlot {...props} width={width} />}
      </div>
    </div>
  );
}
