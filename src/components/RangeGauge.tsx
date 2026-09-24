"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { RangeGauge as RangeGaugeData } from "@/lib/calculateRisk";
import { formatINR, pnlColorClass } from "@/lib/format";
import { INSTRUMENT_LABELS } from "@/lib/types";

const LABEL_ROW_PX = 34;
/** Two breakeven labels whose anchors sit closer than this many px would overlap, so the later one drops to a second row. */
const LABEL_MIN_GAP_PX = 84;
/** Width assumed until the bar has been measured (desktop-ish, so first paint rarely staggers needlessly). */
const DEFAULT_BAR_PX = 600;

function formatPrice(v: number): string {
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Tooltip width (Tailwind w-52) and how far its centre may drift past the bar's own ends before it'd leave the card. */
const TOOLTIP_PX = 208;
const TOOLTIP_OVERHANG_PX = 44;

/** Linear interpolation along the gauge's sampled payoff curve — exact, since the payoff is piecewise linear between the samples. */
function pnlAtPrice(curve: RangeGaugeData["curve"], price: number): number {
  if (price <= curve[0].price) return curve[0].pnl;
  for (let i = 1; i < curve.length; i++) {
    if (price <= curve[i].price) {
      const a = curve[i - 1];
      const b = curve[i];
      return b.price === a.price ? b.pnl : a.pnl + ((b.pnl - a.pnl) * (price - a.price)) / (b.price - a.price);
    }
  }
  return curve[curve.length - 1].pnl;
}

function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function formatExpiry(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function dteLabel(dte: number): string {
  if (dte < 0) return "expired";
  if (dte === 0) return "expires today";
  return `${dte}d left`;
}

/**
 * One underlying+expiry as a horizontal range bar: green where the combined
 * position profits at expiry, red where it loses, a marker for the live spot,
 * a tick per breakeven (with its distance from spot), and a lighter band for
 * the market-implied 1σ expected range. Hovering (or touch-dragging) the bar
 * reads out the combined P&L at expiry for whatever price is under the cursor.
 */
export default function RangeGauge({ gauge }: { gauge: RangeGaugeData }) {
  const span = gauge.max - gauge.min;
  const at = (price: number) => ((price - gauge.min) / span) * 100;
  const clamp = (pct: number) => Math.min(Math.max(pct, 0), 100);

  const spotPct = clamp(at(gauge.spot));
  const bandLeft = clamp(at(gauge.sigmaLow));
  const bandRight = clamp(at(gauge.sigmaHigh));
  const inProfit = gauge.pnlAtSpot > 0;

  // Label collisions depend on real pixels, not % of bar — the same 2.2% gap
  // that's fine on desktop overlaps on a ~190px phone bar.
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(DEFAULT_BAR_PX);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [hover, setHover] = useState<{ ratio: number; width: number } | null>(null);
  function trackPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHover({
      ratio: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      width: rect.width,
    });
  }
  const hoverPrice = hover ? gauge.min + hover.ratio * span : null;
  const hoverPnl = hoverPrice === null ? null : pnlAtPrice(gauge.curve, hoverPrice);

  // Stagger breakeven labels that would otherwise overlap: a label that
  // crowds the previous one moves to the other row.
  const breakevens: { price: number; pct: number; row: number }[] = [];
  for (const price of gauge.breakevens) {
    const pct = clamp(at(price));
    const prev = breakevens[breakevens.length - 1];
    const collides = prev !== undefined && ((pct - prev.pct) / 100) * barWidth < LABEL_MIN_GAP_PX;
    breakevens.push({ price, pct, row: collides ? 1 - prev.row : 0 });
  }
  const rows = breakevens.some((b) => b.row === 1) ? 2 : 1;

  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">{INSTRUMENT_LABELS[gauge.instrument]}</h3>
          <span className="text-xs text-muted-foreground">
            {formatExpiry(gauge.expiry)} · {dteLabel(gauge.dte)}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            inProfit ? "bg-profit/10 text-profit" : "bg-loss/15 text-danger-fg"
          }`}
        >
          {inProfit ? "Inside profit zone" : "In the loss zone"}
        </span>
      </div>

      <div ref={barRef} className="mx-8 mt-3">
        {/* Spot label sits above the bar; breakeven labels hang below it. */}
        <div className="relative h-8">
          <span
            className={`absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 font-mono text-xs font-semibold text-background transition-opacity ${
              hover ? "opacity-0" : ""
            }`}
            style={{ left: `${spotPct}%` }}
          >
            Spot {formatPrice(gauge.spot)}
          </span>
          {hover && hoverPrice !== null && hoverPnl !== null && (
            <div
              className="pointer-events-none absolute bottom-0 z-10 flex -translate-x-1/2 items-center justify-between gap-3 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 shadow-lg"
              style={{
                width: TOOLTIP_PX,
                left: Math.min(
                  Math.max(hover.ratio * hover.width, TOOLTIP_PX / 2 - TOOLTIP_OVERHANG_PX),
                  Math.max(hover.width - TOOLTIP_PX / 2 + TOOLTIP_OVERHANG_PX, TOOLTIP_PX / 2 - TOOLTIP_OVERHANG_PX),
                ),
              }}
            >
              <span className="font-mono text-xs tabular-nums">
                {formatPrice(hoverPrice)}{" "}
                <span className="text-muted-foreground">
                  ({signedPct(((hoverPrice - gauge.spot) / gauge.spot) * 100)})
                </span>
              </span>
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  Math.round(hoverPnl) > 0 ? "text-profit" : Math.round(hoverPnl) < 0 ? "text-danger-fg" : ""
                }`}
              >
                {Math.round(hoverPnl) > 0 ? "+" : ""}
                {formatINR(hoverPnl)}
              </span>
            </div>
          )}
        </div>

        <div
          className="-my-2 cursor-crosshair touch-pan-y py-2"
          onPointerMove={trackPointer}
          onPointerDown={trackPointer}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
        >
          <div className="relative h-3.5">
            <div className="absolute inset-0 flex overflow-hidden rounded-full">
              {gauge.zones.map((z) => (
                <div
                  key={z.from}
                  className={z.profit ? "bg-profit/45" : "bg-loss/45"}
                  style={{ width: `${((z.to - z.from) / span) * 100}%` }}
                />
              ))}
            </div>
            <div
              className="absolute inset-y-0 rounded-sm bg-foreground/15 ring-1 ring-inset ring-foreground/25"
              style={{
                left: `${bandLeft}%`,
                width: `${Math.max(bandRight - bandLeft, 0)}%`,
              }}
              title={`1σ expected range: ${formatPrice(gauge.sigmaLow)} – ${formatPrice(gauge.sigmaHigh)}`}
            />
            {/* Spot needle, extending up into its label. */}
            <div
              className="absolute -top-1 bottom-[-4px] w-0.5 -translate-x-1/2 rounded-full bg-foreground"
              style={{ left: `${spotPct}%` }}
            />
            {breakevens.map((b) => (
              <div
                key={b.price}
                className="absolute -bottom-1 -top-1 border-l border-dashed border-foreground/70"
                style={{ left: `${b.pct}%` }}
              />
            ))}
            {hover && hoverPnl !== null && (
              <>
                <div
                  className="pointer-events-none absolute -bottom-1.5 -top-2 w-px -translate-x-1/2 bg-accent"
                  style={{ left: `${hover.ratio * 100}%` }}
                />
                <div
                  className={`pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${
                    Math.round(hoverPnl) > 0
                      ? "bg-profit"
                      : Math.round(hoverPnl) < 0
                        ? "bg-danger-fg"
                        : "bg-muted-foreground"
                  }`}
                  style={{ left: `${hover.ratio * 100}%` }}
                />
              </>
            )}
          </div>
        </div>

        <div className="relative mt-1.5" style={{ height: rows * LABEL_ROW_PX }}>
          {breakevens.map((b) => {
            const pctFromSpot = ((b.price - gauge.spot) / gauge.spot) * 100;
            return (
              <div
                key={b.price}
                className="absolute -translate-x-1/2 whitespace-nowrap text-center"
                style={{ left: `${b.pct}%`, top: b.row * LABEL_ROW_PX }}
              >
                <p className="font-mono text-xs font-semibold tabular-nums">BE {formatPrice(b.price)}</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {pctFromSpot > 0 ? "+" : ""}
                  {pctFromSpot.toFixed(1)}%
                </p>
              </div>
            );
          })}
          {breakevens.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              No breakeven in this range — the whole window is {gauge.zones[0]?.profit ? "profit" : "loss"} at expiry.
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-profit/45" /> Profit at expiry
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-loss/45" /> Loss at expiry
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-foreground/15 ring-1 ring-inset ring-foreground/25" /> 1σ range{" "}
            <span className="font-mono tabular-nums">
              {formatPrice(gauge.sigmaLow)}–{formatPrice(gauge.sigmaHigh)}
            </span>
          </span>
        </div>
        <span>
          If it expired at spot:{" "}
          <span className={`font-mono font-semibold tabular-nums ${pnlColorClass(gauge.pnlAtSpot)}`}>
            {formatINR(gauge.pnlAtSpot)}
          </span>
        </span>
      </div>
    </section>
  );
}
