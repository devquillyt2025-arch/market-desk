"use client";

import { RefreshIcon } from "@/components/icons";
import { formatAsOf } from "@/lib/format";

import { StatusPill, type Feed } from "./MarketPulse";

/** Whether MCX is live, when the prices last arrived, and a way to ask again - the one line of the old header the board itself still needs. */
export default function BoardStatus({
  feed,
  closesAt,
  hasPrices,
  lastPolledAt,
  refreshing,
  onRefresh,
}: {
  feed: Feed;
  closesAt: string | null;
  hasPrices: boolean;
  lastPolledAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <StatusPill feed={feed} closesAt={closesAt} hasPrices={hasPrices} tick={lastPolledAt} />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {lastPolledAt !== null && (
          <span className="tabular-nums">
            <span className="hidden sm:inline">Updated </span>
            {formatAsOf(lastPolledAt)}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh prices"
          title="Refresh now"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 pointer-coarse:size-11"
        >
          <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
