"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import LivePricingBanners from "@/components/LivePricingBanners";
import { AlertCircleIcon } from "@/components/icons";
import {
  BOARD_SYMBOLS,
  CATEGORIES,
  CATEGORY_LABELS,
  buildBoard,
  commodityCategory,
  mcxSessionStatus,
  pushTick,
  sortEntries,
  summarize,
  type BoardEntry,
  type BoardFilter,
  type BoardSort,
  type CommodityCategory,
} from "@/lib/commodityBoard";
import { isExpectedOpenItem } from "@/lib/expectedOpen";
import { commodityName } from "@/lib/mcxCommodities";
import { tabPreview } from "@/lib/natgasDesk";
import type { CommodityInstrument } from "@/lib/types";
import { useExpectedOpen } from "@/lib/useExpectedOpen";
import { useWatchlistQuotes, WATCHLIST_POLL_MS } from "@/lib/useWatchlistQuotes";
import { commodityItemKey, formatMovePct, moveDirection, type WatchlistItem } from "@/lib/watchlist";

import BoardToolbar from "./BoardToolbar";
import CommodityCard from "./CommodityCard";
import CommodityDetailModal from "./CommodityDetailModal";
import CommodityRow from "./CommodityRow";
import { DIRECTION } from "./direction";
import DeskTabs, { panelId, tabId } from "./DeskTabs";
import MarketPulse, { type Feed } from "./MarketPulse";
import NatgasSkeleton from "./NatgasSkeleton";
import { useBoardView } from "./useBoardView";
import { useDeskTab } from "./useDeskTab";

/** The natural gas desk is only needed once its tab is open, so its code is fetched then - the board loads without it. */
const NatgasDesk = dynamic(() => import("./NatgasDesk"), { loading: () => <NatgasSkeleton /> });
/** The long/short planner likewise. */
const PlannerDesk = dynamic(() => import("./PlannerDesk"), { loading: () => <NatgasSkeleton /> });

/** The board is the Watchlist's commodities, polled the same way: one request, the same token and offline handling, prices kept on this device. */
const BOARD_ITEMS: WatchlistItem[] = BOARD_SYMBOLS.map((symbol, index) => ({
  id: symbol,
  kind: "commodity",
  itemKey: commodityItemKey(symbol),
  symbol,
  name: commodityName(symbol),
  sortOrder: index,
}));

const STORAGE_KEY = "marketdesk:commodities-quotes";
const SPOTLIGHT_MS = 1800;
const NO_TRACE: readonly number[] = [];

// The clock for "is MCX open", in 30-second steps so a snapshot is stable between them. 0 on the server: no time, no claim about the session.
const CLOCK_MS = 30_000;
const subscribeClock = (onChange: () => void) => {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
};
const readClock = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS;
const serverClock = () => 0;

function BoardSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="h-[232px] list-none animate-pulse rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/2 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
          </div>
          <div className="mt-6 h-7 w-2/5 rounded bg-muted" />
          <div className="mt-8 h-1.5 rounded-full bg-muted" />
        </li>
      ))}
    </ul>
  );
}

function GroupHeader({ category, entries }: { category: CommodityCategory; entries: readonly BoardEntry[] }) {
  const summary = summarize(entries, category);
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{CATEGORY_LABELS[category]}</h2>
      <span className="text-xs text-muted-foreground">{summary.count} contracts</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      {summary.avgPct !== null && (
        <span className={`text-xs font-medium tabular-nums ${DIRECTION[moveDirection(summary.avgPct)].text}`}>
          {formatMovePct(summary.avgPct)} <span className="font-normal text-muted-foreground">avg</span>
        </span>
      )}
    </div>
  );
}

export default function CommoditiesView() {
  const { quotes, tokenExpired, offline, loadError, lastPolledAt, loading, manualRefreshing, refresh } = useWatchlistQuotes(BOARD_ITEMS, WATCHLIST_POLL_MS, STORAGE_KEY);
  const [view, changeView] = useBoardView();
  const clock = useSyncExternalStore(subscribeClock, readClock, serverClock);
  const [tab, setTab] = useDeskTab();
  // Polled here, not in the desk, so the tab can preview the gap (or "Live") before it is opened.
  const expectedOpen = useExpectedOpen();

  const [filter, setFilter] = useState<BoardFilter>("all");
  const [sort, setSort] = useState<BoardSort>("default");
  /** The contract whose pop-up is open (lot size, open, volume), if any. */
  const [detail, setDetail] = useState<CommodityInstrument | null>(null);
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const spotlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
    },
    [],
  );

  const stale = tokenExpired || offline || loadError !== null;
  const loaded = Object.keys(quotes).length > 0;

  // Each new set of prices (a new `quotes` object, which every successful poll brings) adds a point to every contract's live trace. Worked
  // out while rendering (React's "adjust state when a prop changes" pattern), not in an effect, so a card never shows a new price without
  // its trace having caught up. Last-known prices held through an outage aren't a tick, so they add nothing.
  const [tracedFrom, setTracedFrom] = useState(quotes);
  const [traces, setTraces] = useState<Record<string, number[]>>({});
  if (quotes !== tracedFrom) {
    setTracedFrom(quotes);
    if (!stale) {
      setTraces((prev) => {
        const next = { ...prev };
        for (const symbol of BOARD_SYMBOLS) {
          const quote = quotes[commodityItemKey(symbol)] ?? quotes[symbol];
          if (quote) next[symbol] = pushTick(prev[symbol], quote.price);
        }
        return next;
      });
    }
  }

  const openDetail = useCallback((symbol: CommodityInstrument) => setDetail(symbol), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  /** From the strip or a leader at the top to the contract's own card: widen the filter if it hides it, scroll there, and ring it for a moment. */
  const jumpTo = useCallback(
    (symbol: CommodityInstrument) => {
    setTab("contracts");
    setFilter((current) => (current === "all" || current === commodityCategory(symbol) ? current : "all"));
    setSpotlight(symbol);
    if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
    spotlightTimer.current = setTimeout(() => setSpotlight(null), SPOTLIGHT_MS);
    // Two frames: the first lets a widened filter render, the second lets its layout settle before we measure.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.getElementById(`commodity-${symbol}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }),
    );
    },
    [setTab],
  );

  const session = useMemo(() => (clock === 0 ? null : mcxSessionStatus(clock)), [clock]);
  const feed: Feed = stale ? "paused" : !loaded ? "loading" : session?.open === false ? "closed" : "live";

  const board = useMemo(() => buildBoard(quotes), [quotes]);
  const shown = useMemo(() => sortEntries(filter === "all" ? board : board.filter((e) => commodityCategory(e.symbol) === filter), sort), [board, filter, sort]);
  /** Grouped by sector only when nothing narrows or reorders it; otherwise one list, so a ranking reads top to bottom. */
  const grouped = filter === "all" && sort === "default";

  const renderItems = (entries: readonly BoardEntry[]) => {
    const Item = view === "cards" ? CommodityCard : CommodityRow;
    const items = entries.map((entry, index) => (
      <Item
        key={entry.symbol}
        entry={entry}
        spark={traces[entry.symbol] ?? NO_TRACE}
        live={feed === "live"}
        stale={stale}
        spotlight={spotlight === entry.symbol}
        index={index}
        onOpen={openDetail}
      />
    ));
    return view === "cards" ? (
      <ul className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">{items}</ul>
    ) : (
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card">{items}</ul>
    );
  };

  // Read from the live board, so the pop-up's price and trace keep moving while it is open.
  const detailQuote = detail ? board.find((e) => e.symbol === detail)?.quote : undefined;

  const filterSummary = `${filter === "all" ? "All sectors" : CATEGORY_LABELS[filter]} · ${shown.length} contracts`;
  const filterShort = `${filter === "all" ? "All" : CATEGORY_LABELS[filter]} · ${shown.length}`;

  const natgasItem = expectedOpen.result?.items.find((item) => item.market === "NATURALGAS");
  const preview = tabPreview(expectedOpen.result, natgasItem && isExpectedOpenItem(natgasItem) ? natgasItem.movePct : null);
  /** MCX natural gas as the board has it - the desk shows it live while MCX trades. */
  const natgasQuote = board.find((e) => e.symbol === "NATURALGAS")?.quote;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col gap-6">
      <LivePricingBanners tokenExpired={tokenExpired} offline={offline} lastPricesAt={lastPolledAt} />

      {loadError && !tokenExpired && !offline && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-danger-fg">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">Couldn&apos;t refresh prices — {loadError}. Retrying automatically.</span>
        </div>
      )}

      <MarketPulse
        entries={board}
        feed={feed}
        closesAt={session?.closesAt ?? null}
        lastPolledAt={lastPolledAt}
        refreshing={manualRefreshing}
        onRefresh={() => void refresh()}
        filter={filter}
        onFilter={(next) => {
          setFilter(next);
          setTab("contracts");
        }}
        onJump={jumpTo}
      />

      <BoardToolbar
        leading={<DeskTabs tab={tab} onTab={setTab} summary={filterSummary} shortSummary={filterShort} preview={preview} />}
        controls={tab === "contracts"}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={changeView}
      />

      <motion.div
        key={tab}
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        {tab === "natural-gas" ? (
          <NatgasDesk state={expectedOpen} nowMs={clock} liveQuote={natgasQuote} />
        ) : tab === "planner" ? (
          <PlannerDesk nowMs={clock} />
        ) : (
          <>
            {loading ? (
              <BoardSkeleton />
            ) : grouped ? (
              <div className="flex flex-col gap-8">
                {CATEGORIES.map((category) => {
                  const entries = shown.filter((e) => commodityCategory(e.symbol) === category);
                  return (
                    <section key={category} aria-label={CATEGORY_LABELS[category]}>
                      <GroupHeader category={category} entries={board} />
                      {renderItems(entries)}
                    </section>
                  );
                })}
              </div>
            ) : (
              renderItems(shown)
            )}

            <p className="text-center text-xs text-muted-foreground">
              Prices from Upstox, refreshed every {WATCHLIST_POLL_MS / 1000} seconds. Each card is the current-month future; tap one for its lot.
            </p>
          </>
        )}
      </motion.div>

      <AnimatePresence>
        {detail && detailQuote && <CommodityDetailModal key={detail} symbol={detail} quote={detailQuote} spark={traces[detail] ?? NO_TRACE} live={feed === "live"} onClose={closeDetail} />}
      </AnimatePresence>
    </motion.div>
  );
}
