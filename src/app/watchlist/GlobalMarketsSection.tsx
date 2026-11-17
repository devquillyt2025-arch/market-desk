"use client";

import { ExpectedOpenPanel, visibleExpectedOpen } from "@/components/ExpectedOpenPanel";
import { useGlobalMarketsContext } from "@/components/GlobalMarketsProvider";
import { formatAsOf, pnlColorClass } from "@/lib/format";
import { buildStrip, changeOf, isStale, marketsStatus, type StripItem } from "@/lib/globalMarkets";
import { useExpectedOpen } from "@/lib/useExpectedOpen";
import { dayRangePosition, formatMovePct, formatRangeValue, moveDirection } from "@/lib/watchlist";

import { useTickFlash } from "./useTickFlash";

/** A price this much older than the freshest one gets its own "as of" - the rest share the header's "Updated". */
const OLDER_THAN_GROUP_MS = 30 * 60_000;

type GlobalRowProps = {
  item: StripItem;
  /** When the prices on screen were fetched - ages are measured from it. */
  reference: number;
  /** The freshest price's time, to spot the ones that lag it. */
  freshest: number;
  /** The prices are the last ones seen (offline, feed down): a change in them is a refresh, not a tick. */
  quiet: boolean;
  loading: boolean;
};

/** One global market: what it is, its price, today's move, and where the price sits in the day's range. */
function GlobalRow({ item, reference, freshest, quiet, loading }: GlobalRowProps) {
  const { quote } = item;
  const flash = useTickFlash(quote?.price, quiet);
  const stale = quote ? isStale(quote, item.staleAfterMs, reference) : false;
  const lagging = quote ? freshest - quote.asOf > OLDER_THAN_GROUP_MS : false;
  const percent = quote ? changeOf(quote)?.percent : undefined;
  const shown = percent === undefined ? null : Number(percent.toFixed(2));
  const rangePos = quote ? dayRangePosition(quote.dayLow, quote.dayHigh, quote.price) : null;
  const direction = moveDirection(shown);
  const fill = direction === "down" ? "bg-danger-fg/70" : direction === "up" ? "bg-profit/70" : "bg-muted-foreground/50";

  // Under the name: what a derived price is made of, and - only for a price older than the rest - when it is from.
  const notes = [item.key === "WTI_INR" ? "WTI × USD/INR" : null, quote && (stale || lagging) ? `${stale ? "last price" : "as of"} ${formatAsOf(quote.asOf, reference)}` : null].filter(Boolean);

  return (
    // A stale row isn't dimmed (that put the figures at ~3:1 contrast, and they are read most when markets are shut); its amber "last price …" note says it.
    <tr className={`border-t border-border/60 transition-colors duration-700 first:border-t-0 ${flash.on ? (flash.dir === "up" ? "bg-profit/10" : "bg-loss/15") : ""}`}>
      <td className="py-2.5 pr-3" title={item.title}>
        <p className="font-medium">
          {item.label} <span className="ml-1 text-xs font-normal text-muted-foreground">{item.unit}</span>
        </p>
        {notes.length > 0 && <p className={`text-xs ${stale ? "text-warning-strong" : "text-muted-foreground"}`}>{notes.join(" · ")}</p>}
      </td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
        {quote ? item.format(quote.price) : loading ? <span className="inline-block h-3 w-14 animate-pulse rounded bg-muted align-middle" /> : "—"}
      </td>
      <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${shown === null ? "text-muted-foreground" : pnlColorClass(shown)}`}>
        {shown === null ? "—" : formatMovePct(shown)}
        {shown !== null && <span className="sr-only"> {direction === "up" ? "up" : direction === "down" ? "down" : "unchanged"} today</span>}
      </td>
      <td className="hidden py-2.5 pl-3 md:table-cell">
        {rangePos !== null && quote?.dayLow != null && quote.dayHigh != null ? (
          <div
            role="img"
            aria-label={`Today's range ${formatRangeValue(quote.dayLow)} to ${formatRangeValue(quote.dayHigh)}; the price is ${Math.round(rangePos * 100)}% of the way up`}
            className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground"
          >
            <span className="w-12 text-right">{formatRangeValue(quote.dayLow)}</span>
            <div className="relative h-1.5 min-w-16 flex-1 rounded-full bg-muted">
              <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${rangePos * 100}%` }} />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow transition-[left] duration-500"
                style={{ left: `${rangePos * 100}%` }}
              />
            </div>
            <span className="w-12">{formatRangeValue(quote.dayHigh)}</span>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Crude oil abroad, the rupee, and the other commodities held on MCX, under the Watchlist's header. They sit apart from the
 * list below on purpose: that list is saved to the database, sortable and made of Upstox instruments, while these come from
 * a public feed (~10 minutes delayed) and are the same on every device. The numbers are the strip's own - one shared poll -
 * so this shows the same prices, and a refresh here refreshes both.
 *
 * One card, no boxes inside it. While MCX is shut, "Expected MCX open" takes the left of the card - it is what matters then -
 * and the prices sit in a table on the right; while MCX trades the table has the whole width.
 */
export function GlobalMarketsSection() {
  const { quotes, offline, feedError, lastPolledAt, loading } = useGlobalMarketsContext();
  const expectedOpen = useExpectedOpen();
  const items = buildStrip(quotes);
  const reference = lastPolledAt ?? 0;
  const problem = marketsStatus({ items, loading, offline, feedError, reference }).tone === "problem";
  const freshest = Math.max(0, ...items.map((item) => item.quote?.asOf ?? 0));
  const withExpectedOpen = visibleExpectedOpen(expectedOpen) !== null;

  return (
    <section aria-labelledby="global-markets-heading" className="rounded-3xl border border-border bg-card p-4 sm:p-6">
      {/* The tab above already says "Global markets", and the header card carries the feed status and refresh; the heading stays for screen readers. */}
      <h2 id="global-markets-heading" className="sr-only">
        Global markets
      </h2>

      <div className={`grid gap-x-8 gap-y-6 ${withExpectedOpen ? "lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)]" : ""}`}>
        {/* While MCX is shut: where natural gas and crude oil are expected to open. Nothing while it trades. */}
        <ExpectedOpenPanel state={expectedOpen} bare />

        <div className={withExpectedOpen ? "lg:border-l lg:border-border lg:pl-8" : ""}>
          <table aria-label="Global prices" className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="pb-2 pr-3 text-left font-semibold">
                  Market
                </th>
                <th scope="col" className="px-3 pb-2 text-right font-semibold">
                  Now
                </th>
                <th scope="col" className="px-3 pb-2 text-right font-semibold">
                  Today
                </th>
                <th scope="col" className="hidden pb-2 pl-3 text-left font-semibold md:table-cell">
                  Day range
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <GlobalRow key={item.key} item={item} reference={reference} freshest={freshest} quiet={problem} loading={loading} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
