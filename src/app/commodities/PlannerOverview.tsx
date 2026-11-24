"use client";

/**
 * The nine timeframes at a glance, as one strip of cards - read from Heikin Ashi bars in one strip and from plain candles in another. Each card is also the button that points the signal, plan and chart at that
 * timeframe, and shows what its latest completed bar says: the signal if the bar just flipped, always the bar's colour and how many bars ago
 * it last flipped (0 when this is the flip), and the ATR (a Candles card with a signal also gets the stop and target at 1:2). The card itself is tinted green
 * or red with its bar (the word and an arrow say it too, so colour is never alone); the chosen one gets an accent ring. Nothing here
 * ranks the timeframes. One row when there is room for nine cards (about 880px of strip, measured on the strip itself, not the screen), otherwise three by three.
 */

import type { ReactNode } from "react";

import { ClockIcon } from "@/components/icons";
import { formatLevel } from "@/lib/format";
import { DEFAULT_ATR_MULT, TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import { makePlan } from "@/lib/natgasPlanner/plan";
import type { TfOverview } from "@/lib/natgasPlanner/signals";

import { DIRECTION, MoveArrow } from "./direction";
import { agoText, tfLabel } from "./plannerFormat";
import { useSecondClock } from "./useSecondClock";

/** A label on the left and its figure on the right, so the numbers of the nine cards line up across the strip. */
function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-x-1 whitespace-nowrap text-[13px] leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">
        {children}
        {hint && <span className="sr-only"> {hint}</span>}
      </span>
    </span>
  );
}

function barsAgo(n: number | null): string {
  return n === null ? "–" : `${n} ${n === 1 ? "bar" : "bars"}`;
}

/** How a card is painted by its bar's colour - written out in full so Tailwind sees every class. */
const TINT = {
  green: { card: "border-profit/50 bg-profit/[0.16] hover:bg-profit/20", value: "text-profit", pill: "bg-profit text-background" },
  red: { card: "border-danger-fg/50 bg-danger-fg/[0.16] hover:bg-danger-fg/20", value: "text-danger-fg", pill: "bg-danger-fg text-background" },
  none: { card: "border-border bg-background hover:border-border-strong hover:bg-muted/40", value: "", pill: "" },
} as const;

function Card({ o, active, entry, candle, onSelect }: { o: TfOverview; active: boolean; entry: number | null; candle: boolean; onSelect: (tf: Timeframe) => void }) {
  // Only the Candles cards carry a stop and target; the Heikin Ashi cards are the colour, the flip and the ATR.
  const plan = candle && o.direction && entry ? makePlan({ side: o.direction, entry, atr: o.atr, atrMult: DEFAULT_ATR_MULT, ratio: 2, riskBudget: 0 }) : null;
  const colour = o.green === null ? null : o.green ? "green" : "red";
  const tint = TINT[colour ?? "none"];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(o.tf)}
      className={`flex min-h-11 flex-1 flex-col gap-2 rounded-xl border p-3 text-left @min-[55rem]:p-2.5 @6xl:p-3 transition-[background-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${tint.card} ${
        active ? "shadow-md ring-2 ring-accent" : ""
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold tabular-nums">{tfLabel(o.tf)}</span>
        {colour === null ? (
          <span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-border-strong" />
        ) : (
          <span aria-hidden="true" className={tint.value}>
            <MoveArrow direction={colour === "green" ? "up" : "down"} className="size-3" />
          </span>
        )}
      </span>

      {o.direction ? (
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tint.pill || `ring-1 ring-inset ${DIRECTION[o.direction === "long" ? "up" : "down"].pill}`}`}>
          <MoveArrow direction={o.direction === "long" ? "up" : "down"} />
          {o.direction === "long" ? "Long" : "Short"}
          <span className="sr-only"> signal, fresh</span>
        </span>
      ) : (
        <span className="text-[13px] leading-6 text-muted-foreground">No signal</span>
      )}

      {candle && o.lastOpen !== null && o.lastHigh !== null && o.lastLow !== null && o.lastClose !== null && (
        <span className="flex flex-col border-b border-current/10 pb-2">
          <Row label="O" hint="open">
            {formatLevel(o.lastOpen)}
          </Row>
          <Row label="H" hint="high">
            {formatLevel(o.lastHigh)}
          </Row>
          <Row label="L" hint="low">
            {formatLevel(o.lastLow)}
          </Row>
          <Row label="C" hint="close">
            {formatLevel(o.lastClose)}
          </Row>
        </span>
      )}

      <span className="mt-auto flex flex-col">
        {plan && (
          <>
            <Row label="SL" hint="stop">
              {formatLevel(plan.stop)}
            </Row>
            <Row label="T" hint="target">
              {formatLevel(plan.target)}
            </Row>
          </>
        )}
        <Row label="Bar">
          <span className={`font-medium ${tint.value}`}>{colour ?? "–"}</span>
        </Row>
        <Row label="Flip" hint="since the last flip">
          {barsAgo(o.barsSinceFlip)}
        </Row>
        <Row label="ATR">{o.atr === null ? "–" : o.atr.toFixed(2)}</Row>
      </span>
    </button>
  );
}

/**
 * Under each card: how long ago its latest completed candle closed, counting on every second and starting again when the next one closes -
 * on a 5-minute card that is 0 sec to 5 min, on a 1-minute card never more than a minute. (A new candle reaches the page with the next
 * refresh, so after its bin has really ended this can read a few seconds past the timeframe until then.)
 */
function SinceClose({ now, end }: { now: number; end: number | null }) {
  if (now === 0 || end === null) return <p aria-hidden="true" className="min-h-5" />;
  const text = agoText(now - end);
  return (
    <p className="flex min-h-5 items-center justify-center gap-1 whitespace-nowrap text-[13px] tabular-nums text-muted-foreground" title="When the latest completed candle closed">
      <ClockIcon className="size-3 shrink-0" />
      <span className="sr-only">Latest candle closed </span>
      {text}
    </p>
  );
}

/** When the cards above were worked out, counting up second by second - so a feed that has stalled shows as it does. */
function Updated({ at, now }: { at: number | null; now: number }) {
  if (at === null || now === 0) return null;
  return <p className="mt-2.5 text-[13px] tabular-nums text-muted-foreground">Updated {agoText(now - at)}</p>;
}

export function TimeframeStrip({
  title,
  legend,
  timeframes,
  selected,
  onSelect,
  entry,
  updatedAt,
  candle = false,
  className = "",
}: {
  /** What the cards are read from: "Heikin Ashi" or "Candles". */
  title: string;
  legend: string;
  timeframes: readonly TfOverview[];
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  entry: number | null;
  /** When these cards were worked out (ms); the line under them says how long ago. */
  updatedAt: number | null;
  /** Show each card's candle - its open, high, low and close - which only the Candles strip does. */
  candle?: boolean;
  className?: string;
}) {
  const now = useSecondClock();
  return (
    <div className={`@container ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{legend}</p>
      </div>
      <div role="group" aria-label={`${title} timeframe`} className="grid grid-cols-3 gap-2 @min-[55rem]:grid-cols-9">
        {TIMEFRAMES.map((tf) => {
          const o = timeframes.find((t) => t.tf === tf);
          // A timeframe the server sent nothing for still gets its card, so the nine are always there to pick from.
          const shown: TfOverview = o ?? { tf, green: null, barsSinceFlip: null, fresh: false, direction: null, atr: null, lastOpen: null, lastHigh: null, lastLow: null, lastClose: null, lastBarEnd: null, lastHa: null };
          return (
            <div key={tf} className="flex flex-col gap-1.5">
              <Card o={shown} active={tf === selected} entry={entry} candle={candle} onSelect={onSelect} />
              <SinceClose now={now} end={shown.lastBarEnd} />
            </div>
          );
        })}
      </div>
      <Updated at={updatedAt} now={now} />
    </div>
  );
}
