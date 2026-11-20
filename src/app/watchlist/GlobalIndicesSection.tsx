"use client";

import { formatLevel, pnlColorClass } from "@/lib/format";
import { buildGlobalTopRows, type GlobalTopRow } from "@/lib/globalIndicesTable";
import type { WatchlistQuotesState } from "@/lib/useWatchlistQuotes";
import type { WorldIndicesState } from "@/lib/useWorldIndices";
import { formatMove, moveDirection } from "@/lib/watchlist";

import { PulseRefresh } from "./PulseParts";
import { useTickFlash } from "./useTickFlash";

/** "17 Nov, 8:44 pm" - when it last traded. */
function formatTradeTime(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

/** The same for a phone, where the column is narrow: just "8:44 pm" when it is today's (the date adds nothing), the full text otherwise. */
function formatTradeTimeShort(ms: number, reference: number): string {
  const at = new Date(ms);
  return at.toDateString() === new Date(reference).toDateString() ? at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : formatTradeTime(ms);
}

const num = (value: number | null) => (value === null ? "—" : formatLevel(value));

type RowProps = {
  row: GlobalTopRow;
  /** When the prices on screen were fetched - "today" is judged against it. */
  reference: number;
  /** Why this row's source isn't updating, or null - a lapsed Upstox token, say. */
  problem: string | null;
  loading: boolean;
};

function IndexRow({ row, reference, problem, loading }: RowProps) {
  const flash = useTickFlash(row.price ?? undefined, problem !== null);
  const pct = row.changePct === null ? null : Number(row.changePct.toFixed(2));
  const direction = moveDirection(pct);
  const tone = pct === null ? "text-muted-foreground" : pnlColorClass(pct);

  return (
    <tr className={`border-t border-border/60 transition-colors duration-700 ${flash.on ? (flash.dir === "up" ? "bg-profit/10" : "bg-loss/15") : ""}`}>
      <td className="py-3 pr-2 sm:pr-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            title={row.country}
            className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-[11px] font-bold tracking-wide text-accent sm:flex"
          >
            {row.code}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{row.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {problem && row.price === null ? (
                <span className="text-warning-strong">{problem}</span>
              ) : row.asOf !== null ? (
                <>
                  {/* Said in words as well as a dot: colour alone is not a state. */}
                  <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${row.live ? "bg-profit" : "bg-muted-foreground/40"}`} />
                  <span className="sr-only">{row.live ? "Open" : "Closed"}</span>
                  <span className="whitespace-nowrap sm:hidden">{formatTradeTimeShort(row.asOf, reference)}</span>
                  <span className="hidden whitespace-nowrap sm:inline">{formatTradeTime(row.asOf)}</span>
                  {problem && <span className="text-warning-strong">· {problem}</span>}
                </>
              ) : (
                <span>{loading ? "Loading…" : "—"}</span>
              )}
            </p>
          </div>
        </div>
      </td>
      <td className="px-2 py-3 text-right font-mono font-semibold tabular-nums sm:px-3">
        {row.price !== null ? formatLevel(row.price) : loading ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted align-middle" /> : "—"}
      </td>
      <td className={`px-2 py-3 text-right font-mono tabular-nums sm:px-3 ${tone}`}>
        {row.change === null || row.changePct === null ? (
          "—"
        ) : (
          <>
            {formatMove(row.change)} ({Math.abs(Number(row.changePct.toFixed(2))).toFixed(2)}%)
            <span className="sr-only"> {direction === "up" ? "up" : direction === "down" ? "down" : "unchanged"}</span>
          </>
        )}
      </td>
      <td className="hidden px-3 py-3 text-right font-mono tabular-nums md:table-cell">{num(row.high)}</td>
      <td className="hidden px-3 py-3 text-right font-mono tabular-nums md:table-cell">{num(row.low)}</td>
      <td className="hidden px-3 py-3 text-right font-mono tabular-nums lg:table-cell">{num(row.open)}</td>
      <td className="hidden py-3 pl-3 text-right font-mono tabular-nums lg:table-cell">{num(row.previousClose)}</td>
    </tr>
  );
}

/**
 * The headline global indices, first on the Global markets tab: GIFT Nifty, the Dow and its futures, the S&P 500, the Nikkei,
 * Hang Seng, DAX, CAC 40, KOSPI and the FTSE 100 - last price, day's change, high, low, open and previous close, and when each
 * last traded. GIFT Nifty and the Dow futures come from Upstox (about a minute behind), the rest from Yahoo (up to 15 minutes);
 * see lib/globalIndicesTable.ts. Narrow screens drop columns - high and low from a tablet down, open and previous close from a
 * laptop down - rather than scroll sideways.
 */
export function GlobalIndicesSection({ world, upstox }: { world: WorldIndicesState; upstox: WatchlistQuotesState }) {
  const reference = Math.max(world.lastPolledAt ?? 0, upstox.lastPolledAt ?? 0);
  const rows = buildGlobalTopRows(world.quotes, upstox.quotes, reference);
  const loading = world.loading && upstox.loading;

  const yahooProblem = world.offline ? "Offline" : world.feedError !== null ? "Yahoo Finance unavailable" : null;
  const upstoxProblem = upstox.tokenExpired ? "Upstox token expired" : upstox.offline ? "Offline" : upstox.loadError !== null ? "Upstox unavailable" : null;
  const refreshing = world.refreshing || upstox.manualRefreshing;
  // Whether a failing source has anything on screen to fall back on - the message says "last prices seen" only when it does.
  const upstoxShown = rows.some((r) => r.source === "upstox" && r.price !== null);
  const yahooShown = rows.some((r) => r.source === "yahoo" && r.price !== null);

  return (
    <section aria-labelledby="global-indices-heading" className="rounded-3xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="global-indices-heading" className="text-base font-semibold">
            Global indices
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            GIFT Nifty and Dow futures from Upstox, about a minute behind · the rest from Yahoo Finance, up to 15 min behind
          </p>
        </div>
        <PulseRefresh
          lastPolledAt={reference || null}
          stale={yahooProblem !== null}
          refreshing={refreshing}
          onRefresh={() => void Promise.all([world.refresh(), upstox.refresh()])}
          label="Refresh global indices now"
          title="Syncs every 10-60 seconds"
        />
      </div>

      {(upstoxProblem || yahooProblem) && (
        <p role="status" className="mt-3 text-sm font-medium text-warning-strong">
          {upstoxProblem && `${upstoxProblem} - GIFT Nifty and Dow futures ${upstoxShown ? "are showing the last prices seen" : "can't be shown until it is back"}.`}
          {upstoxProblem && yahooProblem && " "}
          {yahooProblem && `${yahooProblem} - the other indices ${yahooShown ? "are showing the last levels seen" : "can't be shown until it is back"}.`}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table aria-label="Global indices" className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 pr-2 text-left font-semibold sm:pr-3">
                Index name
              </th>
              <th scope="col" className="px-2 pb-2 text-right font-semibold sm:px-3">
                Last traded
              </th>
              <th scope="col" className="px-2 pb-2 text-right font-semibold sm:px-3" title="Move since the previous close - for a market that is shut, its last session's">
                Day change
              </th>
              <th scope="col" className="hidden px-3 pb-2 text-right font-semibold md:table-cell">
                High
              </th>
              <th scope="col" className="hidden px-3 pb-2 text-right font-semibold md:table-cell">
                Low
              </th>
              <th scope="col" className="hidden px-3 pb-2 text-right font-semibold lg:table-cell">
                Open
              </th>
              <th scope="col" className="hidden pb-2 pl-3 text-right font-semibold lg:table-cell">
                Prev. close
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <IndexRow key={row.key} row={row} reference={reference} problem={row.source === "upstox" ? upstoxProblem : yahooProblem} loading={loading} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
