/**
 * What the ticker across the top of every page shows, built from the three feeds behind it: the strip's own prices (crude, the
 * rupee, gas, gold), the world indices (Yahoo Finance) and Nifty / Bank Nifty / Sensex / GIFT Nifty / the Dow futures (Upstox).
 * Pure - no React, no network -
 * so the figures, the open-or-closed marks and the status line are tested on their own.
 */

import { formatAsOf, formatLevel } from "@/lib/format";
import { buildStrip, changeOf, isStale, type GlobalMarketId, type GlobalQuote } from "@/lib/globalMarkets";
import { tickerItemDef, TICKER_UPSTOX, type TickerNeeds, type TickerSource } from "@/lib/tickerPrefs";
import { isSessionOpen, worldIndexDef, type WorldQuote } from "@/lib/worldIndices";
import type { WatchQuote } from "@/lib/watchlist";

export type TickerEntry = {
  id: string;
  label: string;
  source: TickerSource;
  /** The price as shown, or null when the feed has none for it right now. */
  price: string | null;
  /** The move since the previous close in percent, rounded to what is shown (so a 0.004% wobble reads as flat); null without one. */
  percent: number | null;
  /** Trading as of the last fetch: false for a shut market, null when there is no price or the feed didn't say when it last traded. */
  open: boolean | null;
  /** The sentence for a tooltip: what it is, the day's range, how old the price is. */
  tooltip: string;
};

export type TickerSources = {
  markets: Partial<Record<GlobalMarketId, GlobalQuote>>;
  world: Readonly<Record<string, WorldQuote | undefined>>;
  upstox: Readonly<Record<string, WatchQuote | undefined>>;
  /** When each was fetched (ms) - ages are measured against that, not the clock: pure, and right when the data is old because the browser was offline. */
  at: { markets: number; world: number; upstox: number };
  upstoxTokenExpired: boolean;
};

function rounded(percent: number | null | undefined): number | null {
  // `+ 0` turns the -0 that rounding a tiny loss gives into 0.
  return percent === null || percent === undefined || !Number.isFinite(percent) ? null : Number(percent.toFixed(2)) + 0;
}

function tooltip(parts: { title: string; detail?: string | null; range?: string | null; asOf: number | null; open: boolean | null; reference: number }): string {
  const lines = [parts.detail ? `${parts.title} · ${parts.detail}` : parts.title];
  if (parts.range) lines.push(`Day range ${parts.range}`);
  if (parts.asOf !== null) lines.push(`Last updated ${formatAsOf(parts.asOf, parts.reference)}${parts.open === false ? " - the market is closed" : ""}`);
  return lines.join("\n");
}

/** The ticked prices as tiles, in the order they were ticked, whether or not their prices have arrived. */
export function buildTickerEntries(ids: readonly string[], sources: TickerSources): TickerEntry[] {
  const strip = new Map(buildStrip(sources.markets).map((item) => [item.key, item]));
  const entries: TickerEntry[] = [];

  for (const id of ids) {
    const def = tickerItemDef(id);
    if (!def) continue;
    const base = { id, label: def.label, source: def.source };
    const missing = (reason: string): TickerEntry => ({ ...base, price: null, percent: null, open: null, tooltip: `${def.title} - ${reason}` });

    if (def.source === "markets") {
      const item = strip.get(id);
      const quote = item?.quote;
      if (!item || !quote) {
        entries.push(missing("no price from the feed right now"));
        continue;
      }
      const open = !isStale(quote, item.staleAfterMs, sources.at.markets);
      const range = quote.dayHigh !== null && quote.dayLow !== null ? `${item.format(quote.dayLow)} - ${item.format(quote.dayHigh)}` : null;
      entries.push({
        ...base,
        price: item.format(quote.price),
        percent: rounded(changeOf(quote)?.percent),
        open,
        tooltip: tooltip({ title: item.title, detail: item.unit, range, asOf: quote.asOf, open, reference: sources.at.markets }),
      });
    } else if (def.source === "world") {
      const quote = sources.world[id];
      const index = worldIndexDef(id);
      if (!quote || !index) {
        entries.push(missing("no price from the feed right now"));
        continue;
      }
      const open = isSessionOpen(quote, index, sources.at.world);
      const change = quote.previousClose === null ? null : ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      const range = quote.dayHigh !== null && quote.dayLow !== null ? `${formatLevel(quote.dayLow)} - ${formatLevel(quote.dayHigh)}` : null;
      entries.push({
        ...base,
        price: formatLevel(quote.price),
        percent: rounded(change),
        open,
        tooltip: tooltip({ title: def.title, range, asOf: quote.asOf, open, reference: sources.at.world }),
      });
    } else {
      const instrument = TICKER_UPSTOX.find((item) => item.id === id);
      const quote = instrument ? sources.upstox[instrument.itemKey] : undefined;
      if (!quote) {
        entries.push(missing(sources.upstoxTokenExpired ? "Upstox token expired" : "no price from Upstox right now"));
        continue;
      }
      const asOf = quote.asOf ?? null;
      const open = asOf === null ? null : isSessionOpen({ asOf, sessionStart: null, sessionEnd: null }, {}, sources.at.upstox);
      const range = quote.high !== null && quote.low !== null ? `${formatLevel(quote.low)} - ${formatLevel(quote.high)}` : null;
      entries.push({
        ...base,
        price: formatLevel(quote.price),
        percent: rounded(quote.changePct),
        open,
        tooltip: tooltip({ title: def.title, range, asOf, open, reference: sources.at.upstox }),
      });
    }
  }
  return entries;
}

/** How one feed stands, as the hooks report it. */
export type FeedHealth = { offline: boolean; error: string | null; loading: boolean };

export type TickerStatus = {
  tone: "loading" | "live" | "closed" | "problem" | "empty";
  /** What to show beside the label at any width, so a problem or shut markets are never missed; null when all is well. */
  tag: "Offline" | "Feed down" | "Closed" | null;
  /** The sentence for a tooltip or a wide screen. */
  summary: string;
};

/**
 * How the ticker stands, in one line: the browser is offline, a feed it needs is down, every ticked market is shut, or all is
 * well. Only the feeds something is ticked for count - an Upstox token that lapsed overnight is no news to a ticker with no
 * Upstox price on it, and the Yahoo ones carry on.
 */
export function tickerStatus(input: { entries: readonly TickerEntry[]; needs: TickerNeeds; feeds: { markets: FeedHealth; world: FeedHealth; upstox: FeedHealth } }): TickerStatus {
  const { entries, needs, feeds } = input;
  if (entries.length === 0) return { tone: "empty", tag: null, summary: "No prices chosen" };

  const used: FeedHealth[] = [];
  if (needs.markets) used.push(feeds.markets);
  if (needs.world.length > 0) used.push(feeds.world);
  if (needs.upstox.length > 0) used.push(feeds.upstox);

  if (used.some((feed) => feed.offline)) return { tone: "problem", tag: "Offline", summary: "Offline" };
  if (used.some((feed) => feed.error)) return { tone: "problem", tag: "Feed down", summary: "Price feed unavailable" };

  const priced = entries.filter((entry) => entry.price !== null);
  if (priced.length === 0 && used.every((feed) => feed.loading)) return { tone: "loading", tag: null, summary: "Loading prices…" };
  if (priced.length > 0 && priced.every((entry) => entry.open === false)) return { tone: "closed", tag: "Closed", summary: "Markets closed · last prices" };

  const yahoo = needs.markets || needs.world.length > 0;
  const upstox = needs.upstox.length > 0;
  const summary = yahoo && upstox ? "Delayed 10–15 min · Yahoo Finance · Upstox up to 1 min" : yahoo ? "Delayed 10–15 min · Yahoo Finance" : "Up to 1 min behind · Upstox";
  return { tone: "live", tag: null, summary };
}
