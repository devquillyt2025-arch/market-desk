"use client";

import Link from "next/link";

import { AlertCircleIcon } from "@/components/icons";

/** Token-expired/offline banners shared by every live-priced positions table (Live Portfolio, Paper Trade). */
export default function LivePricingBanners({ tokenExpired, offline }: { tokenExpired: boolean; offline: boolean }) {
  return (
    <>
      {tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">Your Upstox token has expired. Live pricing is paused until it&apos;s updated.</span>
          <Link
            href="/settings"
            className="shrink-0 whitespace-nowrap rounded-lg border border-loss/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-loss/10"
          >
            Update Token
          </Link>
        </div>
      )}

      {offline && !tokenExpired && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">
            No internet connection. Live pricing is paused — it&apos;ll resume automatically once you&apos;re back
            online.
          </span>
        </div>
      )}
    </>
  );
}
