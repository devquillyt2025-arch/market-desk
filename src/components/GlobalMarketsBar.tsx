"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useGlobalMarketsContext } from "@/components/GlobalMarketsProvider";
import { ChevronDownIcon } from "@/components/icons";
import { formatAsOf, formatPct, pnlColorClass } from "@/lib/format";
import { buildStrip, changeOf, isStale, marketsStatus, type StripItem } from "@/lib/globalMarkets";
import { GLOBAL_MARKETS_POLL_MS } from "@/lib/useGlobalMarkets";

const COLLAPSED_KEY = "marketdesk:global-markets-collapsed";
const STRIP_ID = "global-markets-strip";

/** What the tooltip says about one price: what it is, the day's range, and how old it is. */
function tileTitle(item: StripItem, reference: number, stale: boolean): string {
  const { quote } = item;
  if (!quote) return `${item.title} - no price from the feed right now`;
  const parts = [`${item.title} · ${item.unit}`];
  if (quote.dayHigh !== null && quote.dayLow !== null) {
    parts.push(`Day range ${item.format(quote.dayLow)} - ${item.format(quote.dayHigh)}`);
  }
  parts.push(`Last updated ${formatAsOf(quote.asOf, reference)}${stale ? " - the market may be closed" : ""}`);
  return parts.join("\n");
}

function Tile({ item, reference }: { item: StripItem; reference: number }) {
  const { quote } = item;
  const stale = quote ? isStale(quote, item.staleAfterMs, reference) : false;
  // The colour follows what is shown (rounded), so a move that rounds to 0.00% is neither green nor red. The sign says the same without it.
  const percent = quote ? changeOf(quote)?.percent : undefined;
  const shown = percent === undefined ? null : Number(percent.toFixed(2));

  return (
    <li title={tileTitle(item, reference, stale)} className={`flex shrink-0 items-baseline gap-1.5 ${stale ? "opacity-60" : ""}`}>
      <span className="text-muted-foreground">{item.label}</span>
      <span className="font-semibold tabular-nums text-foreground">{quote ? item.format(quote.price) : "—"}</span>
      {shown !== null && <span className={`tabular-nums ${pnlColorClass(shown)}`}>{formatPct(shown, 2)}</span>}
    </li>
  );
}

/** Stand-ins for the tiles until the first prices land, so the strip doesn't jump when they do. */
function SkeletonTile({ label }: { label: string }) {
  return (
    <li className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-3 w-14 animate-pulse self-center rounded bg-muted" />
    </li>
  );
}

function Bar() {
  const { quotes, offline, feedError, lastPolledAt, loading } = useGlobalMarketsContext();
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

  const items = buildStrip(quotes);
  // Ages are measured against the moment of the last fetch, not the clock: pure, and right when the data is old
  // because the browser was offline (the status then names that moment).
  const reference = lastPolledAt ?? 0;
  const { tone, tag, summary } = marketsStatus({ items, loading, offline, feedError, reference });
  const problem = tone === "problem";
  const status = problem && lastPolledAt ? `${summary} · prices from ${formatAsOf(lastPolledAt)}` : summary;
  // The tooltip also says the poll is running - the pulse on the dot shows each sync, this says how often.
  const syncNote = lastPolledAt ? `Syncs every ${GLOBAL_MARKETS_POLL_MS / 1000} s · last synced ${new Date(lastPolledAt).toLocaleTimeString("en-IN")}` : "";
  const dot = problem ? "bg-warning" : tone === "live" ? "bg-profit" : "bg-muted-foreground";

  return (
    <section
      aria-label="Global market prices"
      // top-0 on phones too: the mobile header scrolls away (its sticky wrapper is only as tall as itself), so there is nothing to tuck under.
      className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur print:hidden"
    >
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs sm:px-6 lg:px-10">
        <div className="flex shrink-0 items-center gap-2" title={[status, syncNote].filter(Boolean).join("\n")}>
          <span aria-hidden="true" className="relative flex size-2">
            {/* One ring each time a sync lands (the key restarts it) - the sign the numbers are being refreshed. */}
            {tone === "live" && lastPolledAt !== null && <span key={lastPolledAt} className={`sync-ping absolute inset-0 rounded-full ${dot}`} />}
            <span className={`relative size-2 rounded-full ${dot}`} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Global</span>
          {tag && <span className={`text-[11px] font-medium ${problem ? "text-warning" : "text-muted-foreground"}`}>· {tag}</span>}
          <span className="sr-only">{status}</span>
        </div>

        {collapsed ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{status}</span>
        ) : (
          // Scrolls sideways when the window is too narrow for every price; the fade on the right edge says there is more
          // (the padding keeps the last price clear of it once scrolled to the end).
          <ul
            id={STRIP_ID}
            className="flex min-w-0 flex-1 items-center gap-x-4 overflow-x-auto whitespace-nowrap pr-7 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {loading
              ? items.map((item) => <SkeletonTile key={item.key} label={item.label} />)
              : items.map((item) => <Tile key={item.key} item={item} reference={reference} />)}
          </ul>
        )}

        {!collapsed && (
          <span className={`hidden shrink-0 min-[1600px]:inline ${problem ? "text-warning" : "text-muted-foreground"}`}>{status}</span>
        )}
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
 * The global-prices strip, pinned to the top of every page so crude oil abroad can be watched while working
 * anywhere in the app. Absent on the PIN screen, where nothing should load until it is unlocked.
 */
export default function GlobalMarketsBar() {
  const pathname = usePathname();
  if (pathname === "/lock") return null;
  return <Bar />;
}
