"use client";

import Link from "next/link";

import { AlertCircleIcon } from "@/components/icons";
import { formatAsOf } from "@/lib/format";

type LivePricingBannersProps = {
  tokenExpired: boolean;
  offline: boolean;
  /**
   * When the prices still on screen were fetched — pass it whenever the screen
   * is holding last-known prices through the outage, so the banner can say so
   * (and from when) instead of leaving them looking live.
   */
  lastPricesAt?: number | null;
};

/** Token-expired/offline banners shared by every live-priced screen (Live Portfolio, Paper Trade, Heatmap, Analysis). */
export default function LivePricingBanners({ tokenExpired, offline, lastPricesAt = null }: LivePricingBannersProps) {
  const showingLast = lastPricesAt !== null ? ` Showing the last prices from ${formatAsOf(lastPricesAt)}.` : "";

  return (
    <>
      {tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">
            Your Upstox token has expired — add a new one to resume live pricing.{showingLast}
          </span>
          <Link
            href="/settings"
            className="shrink-0 whitespace-nowrap rounded-lg border border-loss/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-loss/10"
          >
            Add Token
          </Link>
        </div>
      )}

      {offline && !tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">
            No internet connection. Live pricing is paused — it&apos;ll resume automatically once you&apos;re back
            online.{showingLast}
          </span>
        </div>
      )}
    </>
  );
}
