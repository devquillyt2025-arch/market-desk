"use client";

/**
 * Candles for the chosen timeframe with the plan's entry, stop and target as horizontal lines. Drawn as plain SVG in percentage
 * space (no chart library to load): the picture stretches to its box, strokes keep their width, and the labels are HTML on top so
 * their text never distorts. A toggle switches between ordinary and Heikin Ashi candles; the forming bar is drawn faint and is never
 * what a signal is read from.
 */

import { useMemo, useState } from "react";

import type { ChartBar } from "@/lib/natgasPlanner/signals";

import { price, tfWords } from "./plannerFormat";

export type ChartLine = { label: string; price: number; tone: "entry" | "stop" | "target" };

const LINE_COLOUR = { entry: "var(--muted-foreground)", stop: "var(--danger-fg)", target: "var(--profit)" } as const;
const PAD = 0.06;

export default function PlannerChart({ bars, tf, lines, pending }: { bars: readonly ChartBar[]; tf: number; lines: readonly ChartLine[]; pending: boolean }) {
  const [heikin, setHeikin] = useState(false);

  const shape = useMemo(() => {
    const view = bars.map((b) => (heikin ? { t: b.t, ...b.ha, forming: b.forming } : { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, green: b.c > b.o, forming: b.forming }));
    if (view.length === 0) return null;
    let lo = Math.min(...view.map((b) => b.l), ...lines.map((l) => l.price));
    let hi = Math.max(...view.map((b) => b.h), ...lines.map((l) => l.price));
    const pad = (hi - lo || 1) * PAD;
    lo -= pad;
    hi += pad;
    const y = (p: number) => ((hi - p) / (hi - lo)) * 100;
    return { view, y, lo, hi };
  }, [bars, heikin, lines]);

  const last = bars.at(-1);
  const summary = shape
    ? `${heikin ? "Heikin Ashi" : "Candle"} chart of the last ${bars.length} ${tfWords(tf)} bars, from ${price(shape.lo)} to ${price(shape.hi)}. Latest close ${price(last!.c)}.${lines.length ? ` ${lines.map((l) => `${l.label} ${price(l.price)}`).join(", ")}.` : ""}`
    : "No bars to draw.";
  const n = shape?.view.length ?? 0;
  const slot = 100 / Math.max(n, 1);

  return (
    <section aria-label="Chart" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Chart · {tfWords(tf)}</h2>
        <div role="group" aria-label="Candle type" className="inline-flex rounded-xl border border-border bg-background p-0.5">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={heikin === on}
              onClick={() => setHeikin(on)}
              className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${heikin === on ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {on ? "Heikin Ashi" : "Candles"}
            </button>
          ))}
        </div>
      </div>

      <div className={`relative mt-3 h-60 sm:h-72 ${pending ? "opacity-50" : ""}`} aria-busy={pending}>
        {shape ? (
          <>
            <svg role="img" aria-label={summary} viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="0" x2="100" y1={f * 100} y2={f * 100} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6" />
              ))}
              {shape.view.map((b, i) => {
                const x = (i + 0.5) * slot;
                const colour = b.green ? "var(--profit)" : "var(--danger-fg)";
                const top = shape.y(Math.max(b.o, b.c));
                const bottom = shape.y(Math.min(b.o, b.c));
                return (
                  <g key={b.t} opacity={b.forming ? 0.45 : 1}>
                    <line x1={x} x2={x} y1={shape.y(b.h)} y2={shape.y(b.l)} stroke={colour} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <rect x={x - slot * 0.34} width={slot * 0.68} y={top} height={Math.max(bottom - top, 0.25)} fill={colour} />
                  </g>
                );
              })}
              {lines.map((l) => (
                <line key={l.label} x1="0" x2="100" y1={shape.y(l.price)} y2={shape.y(l.price)} stroke={LINE_COLOUR[l.tone]} strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {lines.map((l) => (
              <span
                key={l.label}
                aria-hidden="true"
                className="absolute right-0 -translate-y-1/2 rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ring-border"
                style={{ top: `${Math.min(97, Math.max(3, shape.y(l.price)))}%`, color: LINE_COLOUR[l.tone] }}
              >
                {l.label} {price(l.price)}
              </span>
            ))}
            <span aria-hidden="true" className="absolute left-0 top-0 rounded bg-card/80 px-1 text-[11px] tabular-nums text-muted-foreground">
              {price(shape.hi)}
            </span>
            <span aria-hidden="true" className="absolute bottom-0 left-0 rounded bg-card/80 px-1 text-[11px] tabular-nums text-muted-foreground">
              {price(shape.lo)}
            </span>
          </>
        ) : (
          <p className="grid h-full place-items-center text-sm text-muted-foreground">No bars to draw yet.</p>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Faint last bar: still forming, so it can&apos;t signal. Dashed lines are the plan&apos;s entry, stop and target.</p>
    </section>
  );
}
