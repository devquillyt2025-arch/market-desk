"use client";

import { TrendingDownIcon, TrendingUpIcon } from "@/components/icons";

import { PulseRefresh, StatusPill } from "./PulseParts";

type Breadth = { up: number; down: number; flat: number; total: number };

type MarketPulseProps = {
  nseOpen: boolean;
  mcxOpen: boolean;
  breadth: Breadth;
  /** When the prices on screen were fetched, or null before the first. */
  lastPolledAt: number | null;
  /** The prices are the last ones seen, not live. */
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
};

/** Open or closed, said in words as well as a dot - colour alone is not a state. */
function SessionPill({ name, open, hours }: { name: string; open: boolean; hours: string }) {
  return (
    <StatusPill dot={open ? "bg-profit shadow-[0_0_8px_var(--profit)]" : "bg-muted-foreground/50"} title={`${name} trades ${hours}, Monday to Friday`}>
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{open ? "Open" : "Closed"}</span>
    </StatusPill>
  );
}

/**
 * The status line along the bottom of the Watchlist's header card, one row: which exchanges are open (they close at different
 * times - crude trades into the night, the indices stop mid-afternoon), how the whole list is doing as a bar of up / flat /
 * down with its counts beside it, and when the numbers are from. No card of its own - the header card holds it.
 */
export function MarketPulse({ nseOpen, mcxOpen, breadth, lastPolledAt, stale, refreshing, onRefresh }: MarketPulseProps) {
  const share = (n: number) => (breadth.total === 0 ? 0 : (n / breadth.total) * 100);
  const summary = `${breadth.up} up, ${breadth.flat} flat, ${breadth.down} down`;

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SessionPill name="NSE" open={nseOpen} hours="9:15 am to 3:30 pm" />
        <SessionPill name="MCX" open={mcxOpen} hours="9:00 am to 11:55 pm (11:30 pm in US summer time)" />
      </div>

      <div className="flex min-w-[15rem] flex-1 items-center gap-3">
        <div role="img" aria-label={`Today: ${summary}`} className="flex h-2 min-w-16 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
          {breadth.total > 0 && (
            <>
              <span className="bg-profit transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.up)}%` }} />
              <span className="bg-muted-foreground/40 transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.flat)}%` }} />
              <span className="bg-danger-fg transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.down)}%` }} />
            </>
          )}
        </div>
        <p className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-profit">
            <TrendingUpIcon className="size-3.5" />
            {breadth.up} up
          </span>
          <span>– {breadth.flat} flat</span>
          <span className="inline-flex items-center gap-1 text-danger-fg">
            <TrendingDownIcon className="size-3.5" />
            {breadth.down} down
          </span>
        </p>
      </div>

      <div className="ml-auto">
        <PulseRefresh lastPolledAt={lastPolledAt} stale={stale} refreshing={refreshing} onRefresh={onRefresh} label="Refresh now" />
      </div>
    </div>
  );
}
