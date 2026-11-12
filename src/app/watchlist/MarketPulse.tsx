"use client";

import { RefreshIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import { formatAsOf } from "@/lib/format";

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
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-sm" title={`${name} trades ${hours}, Monday to Friday`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${open ? "bg-profit shadow-[0_0_8px_var(--profit)]" : "bg-muted-foreground/50"}`} />
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{open ? "Open" : "Closed"}</span>
    </span>
  );
}

/**
 * The strip under the page header: which exchanges are open (they close at different times - crude trades into the night, the
 * indices stop mid-afternoon), how the whole list is doing as a bar of up / flat / down, and when the numbers are from.
 */
export function MarketPulse({ nseOpen, mcxOpen, breadth, lastPolledAt, stale, refreshing, onRefresh }: MarketPulseProps) {
  const share = (n: number) => (breadth.total === 0 ? 0 : (n / breadth.total) * 100);
  const summary = `${breadth.up} up, ${breadth.flat} flat, ${breadth.down} down`;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <SessionPill name="NSE" open={nseOpen} hours="9:15 am to 3:30 pm" />
        <SessionPill name="MCX" open={mcxOpen} hours="9:00 am to 11:30 pm" />
      </div>

      <div className="min-w-[14rem] flex-1">
        <div role="img" aria-label={`Today: ${summary}`} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
          {breadth.total > 0 && (
            <>
              <span className="bg-profit transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.up)}%` }} />
              <span className="bg-muted-foreground/40 transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.flat)}%` }} />
              <span className="bg-danger-fg transition-[flex-basis] duration-500" style={{ flexBasis: `${share(breadth.down)}%` }} />
            </>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
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

      <div className="flex items-center gap-2">
        {lastPolledAt !== null &&
          (stale ? (
            <span className="whitespace-nowrap text-xs font-medium text-warning">Last prices {formatAsOf(lastPolledAt)}</span>
          ) : (
            <span className="whitespace-nowrap text-xs text-muted-foreground">Updated {new Date(lastPolledAt).toLocaleTimeString("en-IN")}</span>
          ))}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh now"
          title="Refresh now"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
