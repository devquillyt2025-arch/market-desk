"use client";

import { ChevronDownIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import {
  EXPECTED_OPEN_LABELS,
  isExpectedOpenItem,
  type ExpectedOpenItem,
  type ExpectedOpenMarket,
  type ExpectedOpenUnavailable,
} from "@/lib/expectedOpen";
import { formatAsOf, formatLevel } from "@/lib/format";
import type { ExpectedOpenState } from "@/lib/useExpectedOpen";
import { formatMovePct, moveDirection } from "@/lib/watchlist";

export const UNAVAILABLE_TEXT: Record<ExpectedOpenUnavailable["reason"], string> = {
  no_contract: "MCX lists no contract for it right now.",
  no_mcx_price: "No MCX price yet.",
  waiting_for_close_price: "Waiting for NYMEX's price at MCX's close (its feed runs ~10 min behind).",
  no_global_price: "No NYMEX price right now.",
};

type Shown = (ExpectedOpenItem | ExpectedOpenUnavailable)[];

/**
 * What the panel would show, or null when it shows nothing: no answer yet (or the Upstox token has lapsed), MCX is trading,
 * or none of the markets asked for (`only`) is involved. The Watchlist asks first so it can lay itself out around the panel.
 */
export function visibleExpectedOpen(state: ExpectedOpenState, only?: readonly ExpectedOpenMarket[]): { items: Shown; reopensAt: number | null; quiet: boolean } | null {
  const { result } = state;
  if (!result || result.open) return null;
  const items = result.items.filter((item) => !only || only.includes(item.market));
  return items.length === 0 ? null : { items, reopensAt: result.reopensAt, quiet: result.quiet };
}

/** The accuracy claim, measured on 15 sessions (21 Oct to 12 Nov 2026): the estimate at 08:59 against MCX's real first trade. The one place it is written. */
export const ACCURACY =
  "Tested on 15 sessions (21 Oct to 12 Nov 2026), it missed MCX's real first trade by 0.18% on average for natural gas (worst 0.69%) and 0.12% for crude oil (worst 0.39%). An indication, not a promise.";

function reopenText(reopensAt: number | null, quiet: boolean): string {
  if (quiet) return "MCX isn't trading right now";
  if (reopensAt === null) return "MCX is closed";
  const when = new Date(reopensAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).replace(",", "");
  return `MCX opens ${when}`;
}

/** The move since MCX closed, as the one coloured chip on the row. */
function MoveChip({ movePct }: { movePct: number }) {
  const direction = moveDirection(movePct);
  const color = direction === "up" ? "text-profit" : direction === "down" ? "text-danger-fg" : "text-muted-foreground";
  const bg = direction === "up" ? "bg-profit/10" : direction === "down" ? "bg-loss/15" : "bg-muted";
  const Arrow = direction === "down" ? TrendingDownIcon : TrendingUpIcon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-sm font-semibold tabular-nums ${bg} ${color}`}>
      {direction === "flat" ? <span aria-hidden="true">–</span> : <Arrow className="size-3.5" />}
      {formatMovePct(movePct)}
      <span className="sr-only">{direction === "up" ? "up" : direction === "down" ? "down" : "unchanged"} since MCX closed</span>
    </span>
  );
}

/**
 * One line on a wide panel - name, `last → expected`, move - in the same three columns for every row, so the numbers line up
 * down the list. On a phone the move moves up beside the name and the numbers take the line below.
 */
function Row({ item }: { item: ExpectedOpenItem }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_5.5rem]">
      <div className="min-w-0">
        <p className="font-medium">{EXPECTED_OPEN_LABELS[item.market]}</p>
        <p className="text-xs text-muted-foreground">{item.contract.label.split(" ")[0]} contract</p>
      </div>
      <p className="col-span-2 row-start-2 whitespace-nowrap font-mono tabular-nums sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="text-sm text-muted-foreground">₹{formatLevel(item.mcxClose)}</span>
        <span aria-hidden="true" className="mx-2 text-muted-foreground">→</span>
        <span className="sr-only"> expected to open at </span>
        <span className="text-xl font-semibold">₹{formatLevel(item.expectedOpen)}</span>
      </p>
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        <MoveChip movePct={item.movePct} />
      </div>
    </li>
  );
}

type ExpectedOpenPanelProps = {
  state: ExpectedOpenState;
  /** Show only these markets (the Live Portfolio asks for the ones it holds). */
  only?: readonly ExpectedOpenMarket[];
  /** No box of its own - for when it sits inside a card already (the Watchlist's Global markets). */
  bare?: boolean;
  className?: string;
};

/**
 * "Expected MCX open": while MCX is shut, where natural gas and crude oil are likely to open, from NYMEX's move since MCX
 * last traded. The answer is two lines; how it is worked out is one click away rather than on screen all the time, and only
 * a warning that changes how far to trust the number (NYMEX is shut too) stays in view. Nothing at all while MCX is trading.
 */
export function ExpectedOpenPanel({ state, only, bare = false, className = "" }: ExpectedOpenPanelProps) {
  const shown = visibleExpectedOpen(state, only);
  if (!shown) return null;

  const ready = shown.items.filter(isExpectedOpenItem);
  const missing = shown.items.filter((item): item is ExpectedOpenUnavailable => !isExpectedOpenItem(item));
  const nymexShut = ready.filter((item) => item.nymex.stale);

  return (
    <section aria-label="Expected MCX open" className={`${bare ? "" : "rounded-2xl border border-border bg-card p-4 sm:p-5"} ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expected MCX open</h3>
        <span className="text-xs text-muted-foreground">{reopenText(shown.reopensAt, shown.quiet)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">Last MCX price → where it is likely to open</p>

      <ul className="mt-3 divide-y divide-border">
        {ready.map((item) => (
          <Row key={item.market} item={item} />
        ))}
        {missing.map((item) => (
          <li key={item.market} className="py-3 first:pt-0 last:pb-0">
            <p className="font-medium">{EXPECTED_OPEN_LABELS[item.market]}</p>
            <p className="text-xs text-muted-foreground">{UNAVAILABLE_TEXT[item.reason]}</p>
          </li>
        ))}
      </ul>

      {nymexShut.length > 0 && (
        <p className="mt-3 text-xs text-warning-strong">
          NYMEX is shut too, so this uses its last price (as of {formatAsOf(nymexShut[0].nymex.asOf)}). It updates when NYMEX reopens.
        </p>
      )}

      {ready.length > 0 && (
        <details className="group mt-3 text-xs text-muted-foreground">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-medium transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            How this is worked out
          </summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>MCX&apos;s last price, scaled by how far NYMEX has moved since MCX stopped trading. The rupee is assumed unchanged.</p>
            <ul className="space-y-0.5">
              {ready.map((item) => (
                <li key={item.market}>
                  <span className="font-medium text-foreground">{EXPECTED_OPEN_LABELS[item.market]}:</span> NYMEX {item.nymex.label}{" "}
                  {item.nymex.atClose.toLocaleString("en-US", { maximumFractionDigits: 3 })} → {item.nymex.now.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                  {item.mcxClosedAt !== null && `, since MCX last traded (${formatAsOf(item.mcxClosedAt)})`}. Price as of {formatAsOf(item.nymex.asOf)}.
                </li>
              ))}
            </ul>
            <p>NYMEX&apos;s feed runs about 10 minutes behind. {ACCURACY}</p>
          </div>
        </details>
      )}
    </section>
  );
}
