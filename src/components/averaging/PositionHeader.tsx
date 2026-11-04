"use client";

/**
 * The position being simulated, at a glance. Who it is (name, side, days to
 * run) and the one action ("Open in Analysis") across the top; underneath, the
 * four numbers that frame the question on the left, and on the right a picture
 * of where the premium stands — what you paid against what it's worth now, and
 * how much of the price is real value versus time that will melt away. The
 * picture is what makes the case for (or against) averaging at a glance.
 */

import type { ReactNode } from "react";

import { ExternalLinkIcon, PlusIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import { pillButton, signedPct, signedRupee } from "@/components/averaging/ui";
import type { SimulatorCandidate } from "@/components/AveragingSimulator";
import { positionOverview, THETA_HEAVY_DTE, type PositionOverview } from "@/lib/averaging";
import { formatAsOf, formatINR, formatLevel, pnlColorClass } from "@/lib/format";
import { INSTRUMENT_LABELS } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-10" → "10 Nov" without going through a timezone. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  const m = Number(month);
  return m >= 1 && m <= 12 ? `${Number(day)} ${MONTHS[m - 1]}` : iso;
}

/** "39 pts in the money", "200 pts out of the money", or "at the money". */
function moneyness(pts: number): string {
  const n = Math.round(Math.abs(pts)).toLocaleString("en-IN");
  if (Math.round(pts) === 0) return "at the money";
  return pts > 0 ? `${n} pts in the money` : `${n} pts out of the money`;
}

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap font-mono text-lg font-semibold tabular-nums sm:text-xl">{children}</dd>
      {sub && <dd className="mt-0.5 text-xs font-medium tabular-nums text-muted-foreground">{sub}</dd>}
    </div>
  );
}

/** One thin stacked bar: segments by width, in the order given. */
function StackBar({ parts }: { parts: { pct: number; className: string }[] }) {
  return (
    <div aria-hidden="true" className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      {parts.map((p, i) => (
        <div key={i} className={`h-full transition-[width] duration-300 motion-reduce:transition-none ${p.className}`} style={{ width: `${p.pct}%` }} />
      ))}
    </div>
  );
}

function Key({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-sm ${swatch}`} />
      {children}
    </span>
  );
}

/** What you paid against what it's worth, and what the price is made of — the two bars that say whether averaging is worth thinking about. */
function PremiumPanel({ overview, avgPrice, ltp, dte }: { overview: PositionOverview; avgPrice: number; ltp: number; dte: number }) {
  const { invested, worth, pnl, intrinsic, timeValue, timeValueShare } = overview;
  // Paid and worth on one scale: the shared part, then the gap — red when it's a loss, green when it's a gain.
  const scale = Math.max(invested, worth, 1);
  const shared = (Math.min(invested, worth) / scale) * 100;
  const gap = (Math.abs(pnl) / scale) * 100;
  const loss = pnl < 0;
  const thetaHeavy = dte <= THETA_HEAVY_DTE;

  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl bg-muted/40 p-3.5">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">What you paid vs what it is worth now</p>
        <StackBar parts={[{ pct: shared, className: "bg-accent-solid" }, { pct: gap, className: loss ? "bg-danger-fg" : "bg-profit" }]} />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <Key swatch="bg-accent-solid">
            Worth now <span className="font-mono font-semibold text-foreground">{formatINR(worth)}</span>
          </Key>
          <Key swatch={loss ? "bg-danger-fg" : "bg-profit"}>
            {loss ? "Lost" : "Gained"} <span className="font-mono font-semibold text-foreground">{formatINR(Math.abs(pnl))}</span>
          </Key>
          <span className="whitespace-nowrap">
            Paid <span className="font-mono font-semibold text-foreground">{formatINR(invested)}</span>{" "}
            <span className="font-mono">({avgPrice.toFixed(2)}/unit)</span>
          </span>
        </p>
      </div>

      {timeValueShare !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">What the {ltp.toFixed(2)} price is made of</p>
          <StackBar
            parts={[
              { pct: (intrinsic / ltp) * 100, className: "bg-accent-solid" },
              { pct: timeValueShare * 100, className: thetaHeavy ? "bg-warning" : "bg-muted-foreground/50" },
            ]}
          />
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <Key swatch="bg-accent-solid">
              Real value <span className="font-mono font-semibold text-foreground">{intrinsic.toFixed(2)}</span>
            </Key>
            <Key swatch={thetaHeavy ? "bg-warning" : "bg-muted-foreground/50"}>
              Time value <span className="font-mono font-semibold text-foreground">{timeValue.toFixed(2)}</span>{" "}
              <span className={thetaHeavy ? "font-semibold text-warning" : ""}>({Math.round(timeValueShare * 100)}%)</span>
            </Key>
            <span>melts to zero by expiry</span>
          </p>
        </div>
      )}
    </div>
  );
}

export default function PositionHeader({
  candidates,
  candidate,
  onSelect,
  dte,
  nowMs,
  pricesAtMs,
  canOpenAnalysis,
  onOpenAnalysis,
  actionAdds = false,
  actionLabel = "Open in Analysis",
  actionHint = "Loads this position plus the simulated lots.",
  appliedText = null,
  note = "Simulation only — this never places an order. Treats this as a naked long leg; hedges in other rows are ignored.",
}: {
  candidates: SimulatorCandidate[];
  candidate: SimulatorCandidate;
  onSelect: (id: string) => void;
  dte: number;
  nowMs: number;
  /** When last-known prices are from, if that's not "now" — shown instead of the clock while they're stale. */
  pricesAtMs?: number;
  canOpenAnalysis: boolean;
  onOpenAnalysis: () => void;
  /** True when the button adds the lots to something on this page (a plus), rather than leaving for another one. */
  actionAdds?: boolean;
  /** The main button's wording — "Open in Analysis" unless the page has something better to do with the lots. */
  actionLabel?: string;
  actionHint?: string;
  /** What the button has just done, shown in place of the hint for a moment. */
  appliedText?: string | null;
  note?: string;
}) {
  const { position, spot, ltp, stale, contract } = candidate;
  const indexName = INSTRUMENT_LABELS[position.instrument];
  const overview = positionOverview(position, spot, ltp);
  const { qty, pnl, pnlPct } = overview;
  const thetaHeavy = dte <= THETA_HEAVY_DTE;

  return (
    <div className="@container relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
      {/* A soft wash of the accent colour in the corner — depth, not decoration that carries meaning. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative flex flex-col gap-4">
        {candidates.length > 1 && (
          <div role="group" aria-label="Position to simulate" className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const active = c.id === candidate.id;
              return (
                <button key={c.id} type="button" aria-pressed={active} onClick={() => onSelect(c.id)} className={pillButton(active)}>
                  {c.contract}
                  <span className="font-mono text-xs opacity-70">
                    {c.position.lots} lot{c.position.lots === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight">{contract}</h3>
              <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                Long {position.type === "CE" ? "call" : "put"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${thetaHeavy ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}
              >
                {dte <= 0 ? "Expires today" : `${dte} day${dte === 1 ? "" : "s"} to expiry`}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              You hold {position.lots} lot{position.lots === 1 ? "" : "s"} ({qty} qty) · strike {formatLevel(position.strike).replace(/\.00$/, "")} · expires{" "}
              {shortDate(position.expiry)}
              {thetaHeavy && dte > 0 ? " · time decay is fast now" : ""}
            </p>
          </div>

          <div className="flex flex-col items-start gap-1 sm:items-end">
            <button
              type="button"
              onClick={onOpenAnalysis}
              disabled={!canOpenAnalysis}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-opacity hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10"
            >
              {actionAdds ? <PlusIcon className="size-4" /> : <ExternalLinkIcon className="size-4" />}
              {actionLabel}
            </button>
            {/* role=status: a screen reader hears that it worked, without the focus moving. */}
            <p role="status" className={`text-xs ${appliedText ? "font-semibold text-profit" : "text-muted-foreground"}`}>
              {appliedText ?? (canOpenAnalysis ? actionHint : "Add a lot and a buy price first.")}
            </p>
          </div>
        </div>

        {/* Numbers on the left, the picture of them on the right; stacked on a narrow card. */}
        <div className="grid gap-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @min-[44rem]:gap-x-8">
          <dl className="grid grid-cols-2 content-between gap-x-4 gap-y-4">
            <Stat label="Live price (LTP)">{ltp.toFixed(2)}</Stat>
            <Stat label={indexName} sub={moneyness(overview.moneynessPts)}>
              {formatLevel(spot)}
            </Stat>
            <Stat label="You paid (average)" sub={`${formatINR(overview.invested)} in all`}>
              {position.avgPrice.toFixed(2)}
            </Stat>
            <Stat
              label="Your P&L right now"
              sub={
                <span className={`inline-flex items-center gap-1 ${pnlColorClass(pnl)}`}>
                  {pnl > 0 && <TrendingUpIcon className="size-3" />}
                  {pnl < 0 && <TrendingDownIcon className="size-3" />}
                  {pnlPct === null ? "" : signedPct(pnlPct)}
                </span>
              }
            >
              <span className={pnlColorClass(pnl)}>{signedRupee(pnl)}</span>
            </Stat>
          </dl>

          <PremiumPanel overview={overview} avgPrice={position.avgPrice} ltp={ltp} dte={dte} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>{note}</p>
          <p className={`flex items-center gap-1.5 whitespace-nowrap tabular-nums ${stale ? "font-medium text-warning" : ""}`}>
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${stale ? "bg-warning" : "animate-pulse bg-profit motion-reduce:animate-none"}`}
            />
            {stale ? `Last prices ${formatAsOf(pricesAtMs ?? nowMs)}` : `Updated ${new Date(nowMs).toLocaleTimeString("en-IN")}`}
          </p>
        </div>
      </div>
    </div>
  );
}
