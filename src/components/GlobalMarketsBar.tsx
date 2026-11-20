"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useGlobalMarketsContext } from "@/components/GlobalMarketsProvider";
import { ChevronDownIcon } from "@/components/icons";
import TickerEditMenu from "@/components/TickerEditMenu";
import TickerTrack from "@/components/TickerTrack";
import { formatAsOf } from "@/lib/format";
import { tickerNeeds } from "@/lib/tickerPrefs";
import { buildTickerEntries, tickerStatus } from "@/lib/tickerStrip";
import { useTickerPrefs } from "@/lib/useTickerPrefs";
import { useWatchlistQuotes } from "@/lib/useWatchlistQuotes";
import { useWorldIndices } from "@/lib/useWorldIndices";
import type { WatchlistItem } from "@/lib/watchlist";

const COLLAPSED_KEY = "marketdesk:global-markets-collapsed";
const STRIP_ID = "global-markets-strip";

/** Kept apart from the Watchlist's own saved prices, or the two would overwrite each other. */
const UPSTOX_STORAGE_KEY = "marketdesk:ticker-quotes";
const WORLD_STORAGE_KEY = "marketdesk:ticker-world";
/** GIFT Nifty and the Dow futures are about a minute behind at Upstox - a poll every 15 s loses nothing, and the ticker is on every page. */
const UPSTOX_POLL_MS = 15_000;

function Bar() {
  const markets = useGlobalMarketsContext();
  const [prefs, savePrefs] = useTickerPrefs();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Defaulting to expanded and syncing from localStorage only after mount avoids a hydration mismatch.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      // localStorage may be unavailable (private browsing, disabled storage); default stays expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        // Nothing to recover - the toggle still applies for this load.
      }
      return next;
    });
  }

  // Only the feeds something is ticked for are polled: the strip's own prices are polled app-wide (the Watchlist shares them), the
  // world indices are asked for by id, and Upstox is asked only when GIFT Nifty or the Dow futures is ticked.
  const needs = useMemo(() => tickerNeeds(prefs.ids), [prefs.ids]);
  const world = useWorldIndices(undefined, true, { ids: needs.world, storageKey: WORLD_STORAGE_KEY });
  const upstoxItems = useMemo<WatchlistItem[] | null>(
    () => (needs.upstox.length === 0 ? null : needs.upstox.map((item, i) => ({ id: `ticker-${item.id}`, kind: "index", itemKey: item.itemKey, symbol: item.symbol, name: item.name, sortOrder: i + 1 }))),
    [needs.upstox],
  );
  const upstox = useWatchlistQuotes(upstoxItems, UPSTOX_POLL_MS, UPSTOX_STORAGE_KEY);

  // Ages are measured against the moment each feed was last fetched, not the clock: pure, and right when the data is old because
  // the browser was offline (the status then names that moment).
  const at = { markets: markets.lastPolledAt ?? 0, world: world.lastPolledAt ?? 0, upstox: upstox.lastPolledAt ?? 0 };
  const entries = buildTickerEntries(prefs.ids, { markets: markets.quotes, world: world.quotes, upstox: upstox.quotes, at, upstoxTokenExpired: upstox.tokenExpired });
  const { tone, tag, summary } = tickerStatus({
    entries,
    needs,
    feeds: {
      markets: { offline: markets.offline, error: markets.feedError, loading: markets.loading },
      world: { offline: world.offline, error: world.feedError, loading: world.loading },
      // A lapsed token isn't a load error in the hook, but a ticker with Nifty / GIFT Nifty on it shouldn't read "live" while those tiles are blank.
      upstox: { offline: upstox.offline, error: upstox.tokenExpired ? "Upstox token expired" : upstox.loadError, loading: upstox.loading },
    },
  });
  const problem = tone === "problem";
  const lastSync = Math.max(needs.markets ? at.markets : 0, needs.world.length > 0 ? at.world : 0, needs.upstox.length > 0 ? at.upstox : 0) || null;
  const status = problem && lastSync ? `${summary} · prices from ${formatAsOf(lastSync)}` : summary;
  // The tooltip also says the poll is running - the pulse on the dot shows each sync, this says how often.
  const syncNote = lastSync ? `Prices sync every 15–60 s · last synced ${new Date(lastSync).toLocaleTimeString("en-IN")}` : "";
  const dot = problem ? "bg-warning" : tone === "live" ? "bg-profit" : "bg-muted-foreground";

  return (
    <section
      aria-label="Global market prices"
      // top-0 on phones too: the mobile header scrolls away (its sticky wrapper is only as tall as itself), so there is nothing to tuck under.
      className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur print:hidden"
    >
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs sm:gap-3 sm:px-6 lg:px-10">
        <div className="flex shrink-0 items-center gap-2" title={[status, syncNote].filter(Boolean).join("\n")}>
          <span aria-hidden="true" className="relative flex size-2">
            {/* One ring each time a sync lands (the key restarts it) - the sign the numbers are being refreshed. */}
            {tone === "live" && lastSync !== null && <span key={lastSync} className={`sync-ping absolute inset-0 rounded-full ${dot}`} />}
            <span className={`relative size-2 rounded-full ${dot}`} />
          </span>
          {/* On a phone the dot (and a problem tag) is enough: the buttons at the right take 44px each there, and the prices need the room. */}
          <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">Global</span>
          {tag && (
            <span className={`text-[11px] font-medium ${problem ? "text-warning-strong" : "text-muted-foreground"}`}>
              <span className="hidden sm:inline">· </span>
              {tag}
            </span>
          )}
          <span className="sr-only">{status}</span>
        </div>

        {collapsed ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{status}</span>
        ) : entries.length === 0 ? (
          <span id={STRIP_ID} className="min-w-0 flex-1 truncate text-muted-foreground">
            No prices chosen. Use the pencil to pick some.
          </span>
        ) : (
          <span id={STRIP_ID} className="contents">
            <TickerTrack entries={entries} loading={{ markets: markets.loading, world: world.loading, upstox: upstox.loading }} loop={prefs.loop} speed={prefs.speed} />
          </span>
        )}

        {!collapsed && entries.length > 0 && (
          <span className={`hidden shrink-0 min-[1600px]:inline ${problem ? "text-warning-strong" : "text-muted-foreground"}`}>{status}</span>
        )}
        {!collapsed && <TickerEditMenu prefs={prefs} save={savePrefs} />}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : STRIP_ID}
          aria-label={collapsed ? "Show global prices" : "Hide global prices"}
          title={collapsed ? "Show global prices" : "Hide global prices"}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-9"
        >
          <ChevronDownIcon className={`size-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>
    </section>
  );
}

/**
 * The ticker pinned to the top of every page: crude oil abroad, the world's indices and GIFT Nifty, whichever the reader has ticked
 * (the pencil edits the list), so they can be watched while working anywhere in the app. Absent on the PIN screen, where nothing
 * should load until it is unlocked.
 */
export default function GlobalMarketsBar() {
  const pathname = usePathname();
  if (pathname === "/lock") return null;
  return <Bar />;
}
