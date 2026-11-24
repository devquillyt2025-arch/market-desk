"use client";

/**
 * The Dashboard: one quick look at everything - what is happening (prices, positions), what has happened (the last 30 days, the
 * account) and what is about to happen (sessions, expiries, the MCX open, the risk ahead). It is figures, and a way into each tab;
 * nothing here is a place to act. Prices come from the same polling the Watchlist, Heatmap and Commodities use; positions, report and
 * ledger are read only while this page is open, and the report is taken from this device when it is recent. Nothing is written.
 */

import { useMemo } from "react";

import { signedMoney } from "@/app/commodities/natgasFormat";
import { useMcxClock } from "@/app/commodities/useMcxClock";
import { usePlannerPrefs } from "@/app/commodities/usePlannerPrefs";
import { useGlobalMarketsContext } from "@/components/GlobalMarketsProvider";
import LivePricingBanners from "@/components/LivePricingBanners";
import { buildBoard } from "@/lib/commodityBoard";
import { BOARD_ITEMS } from "@/lib/commodityBoardItems";
import { breadthOf, briefWindow, dailyBars, expiryLadder, exposureOf, fundsBrief, lastTrades, paperBrief, positionLines, reportBrief, sessionsAt } from "@/lib/dashboardBrief";
import { EXPECTED_OPEN_LABELS, isExpectedOpenItem, type ExpectedOpenItem, type ExpectedOpenMarket, type NatgasChoice } from "@/lib/expectedOpen";
import { formatAsOf, formatINR } from "@/lib/format";
import { buildStrip, changeOf, isStale } from "@/lib/globalMarkets";
import { localIsoDate } from "@/lib/localDate";
import { contractMonthLabel } from "@/lib/mcxCommodities";
import type { CommodityInstrument } from "@/lib/types";
import { useExpectedOpen } from "@/lib/useExpectedOpen";
import { useHeatmap } from "@/lib/useHeatmap";
import { usePnlCharges } from "@/lib/useUpstoxReport";
import { useWatchlistQuotes } from "@/lib/useWatchlistQuotes";
import { useWorldIndices, WORLD_INDICES_POLL_MS } from "@/lib/useWorldIndices";
import { GIFT_NIFTY, INDEX_SEEDS, type WatchlistItem } from "@/lib/watchlist";
import { isSessionOpen, worldIndexDef } from "@/lib/worldIndices";

import { AccountCard, QualityCard, ThirtyDaysCard, TradesCard } from "./DoneCards";
import Hero, { type Feed } from "./Hero";
import { ExpiriesCard, OpenCard, RiskCard, SessionsCard, type OpenRow } from "./NextCards";
import { CommoditiesCard, IndicesCard, PositionsCard, WorldCard, type IndexRow, type WorldTile } from "./NowCards";
import { BandHeader } from "./parts";
import { usePaperTrades, usePayments } from "./useAccountData";
import { useOpenPositions } from "./useOpenPositions";
import { useReportBrief } from "./useReportBrief";

// --- What the page polls ----------------------------------------------------------------

/** The three indices and GIFT Nifty, then the commodities board: one request, kept on this device under a key of its own. */
const INDEX_DEFS = [...INDEX_SEEDS, GIFT_NIFTY];
const QUOTE_ITEMS: WatchlistItem[] = [...INDEX_DEFS.map((seed, i) => ({ ...seed, id: seed.itemKey, sortOrder: i })), ...BOARD_ITEMS];
const QUOTES_KEY = "marketdesk:dashboard-quotes";
const QUOTES_POLL_MS = 10_000;
/** Breadth moves slowly next to a price: every 30 seconds is plenty. */
const BREADTH_POLL_MS = 30_000;

const WORLD_INDEX_TILES = [
  { id: "^GSPC", label: "S&P 500" },
  { id: "^IXIC", label: "Nasdaq" },
  { id: "^DJI", label: "Dow" },
  { id: "^FTSE", label: "FTSE" },
  { id: "^GDAXI", label: "DAX" },
  { id: "^N225", label: "Nikkei" },
  { id: "^HSI", label: "HSI" },
] as const;
const WORLD_IDS: readonly string[] = WORLD_INDEX_TILES.map((tile) => tile.id);
const WORLD_KEY = "marketdesk:dashboard-world";
const MARKET_TILES = [
  { key: "BRENT", label: "Brent" },
  { key: "WTI", label: "WTI" },
  { key: "GOLD", label: "Gold" },
  { key: "NATGAS", label: "Nat gas" },
  { key: "USDINR", label: "USD/INR" },
] as const;

const OPEN_MARKETS: readonly { market: ExpectedOpenMarket; symbol: CommodityInstrument }[] = [
  { market: "NATURALGAS", symbol: "NATURALGAS" },
  { market: "CRUDEOIL", symbol: "CRUDEOIL" },
];

const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";

export default function DashboardView() {
  const clock = useMcxClock();
  const prices = useWatchlistQuotes(QUOTE_ITEMS, QUOTES_POLL_MS, QUOTES_KEY);
  const heatmap = useHeatmap("NIFTY", "1D", BREADTH_POLL_MS);
  const world = useWorldIndices(WORLD_INDICES_POLL_MS, true, { ids: WORLD_IDS, storageKey: WORLD_KEY });
  const markets = useGlobalMarketsContext();
  const book = useOpenPositions();
  const report = useReportBrief();
  const payments = usePayments();
  const paperTrades = usePaperTrades();
  const [prefs] = usePlannerPrefs();
  // Not until the page has hydrated (the clock reads 0 till then): the saved contract is only known from then.
  const expectedOpen = useExpectedOpen(clock !== 0, undefined, prefs.contract);

  const span = useMemo(() => briefWindow(), []);
  const today = useMemo(() => localIsoDate(), []);
  const charges = usePnlCharges("ALL", span.from, span.to, report.trades !== null);
  const chargesIn = charges.charges !== null;

  // --- Now ----------------------------------------------------------------------------
  const quotes = prices.quotes;
  const board = useMemo(() => buildBoard(quotes), [quotes]);
  const indexRows: IndexRow[] = INDEX_DEFS.map((def) => ({ key: def.itemKey, name: def.name, quote: quotes[def.itemKey] }));
  const breadth = useMemo(() => breadthOf(heatmap.quotes), [heatmap.quotes]);

  const worldTiles: WorldTile[] = useMemo(() => {
    const indices = WORLD_INDEX_TILES.map(({ id, label }) => {
      const quote = world.quotes[id];
      const def = worldIndexDef(id);
      return {
        key: id,
        label,
        title: def?.name ?? label,
        level: quote ? whole.format(quote.price) : "—",
        pct: quote ? (changeOf(quote)?.percent ?? null) : null,
        open: quote !== undefined && def !== undefined && clock !== 0 && isSessionOpen(quote, def, clock),
      };
    });
    const strip = buildStrip(markets.quotes);
    const rest = MARKET_TILES.map(({ key, label }) => {
      const item = strip.find((s) => s.key === key);
      const quote = item?.quote ?? null;
      return {
        key,
        label,
        title: item?.title ?? label,
        level: quote && item ? item.format(quote.price) : "—",
        pct: quote ? (changeOf(quote)?.percent ?? null) : null,
        open: quote !== null && item !== undefined && clock !== 0 && !isStale(quote, item.staleAfterMs, clock),
      };
    });
    return [...indices, ...rest];
  }, [world.quotes, markets.quotes, clock]);

  const lines = useMemo(() => (book.rows ? positionLines(book.rows) : null), [book.rows]);
  const exposure = useMemo(() => (book.rows ? exposureOf(book.rows) : null), [book.rows]);

  // --- Done ---------------------------------------------------------------------------
  const trades = report.trades;
  const summary = useMemo(() => (trades ? reportBrief(trades, charges.charges?.total ?? null) : null), [trades, charges.charges]);
  const bars = useMemo(() => (trades ? dailyBars(trades, today) : null), [trades, today]);
  const recent = useMemo(() => (trades ? lastTrades(trades) : null), [trades]);
  const funds = useMemo(() => (trades && payments ? fundsBrief(trades, payments) : null), [trades, payments]);
  const paper = useMemo(() => (paperTrades ? paperBrief(paperTrades) : null), [paperTrades]);

  // --- Next ---------------------------------------------------------------------------
  const sessions = useMemo(() => (clock === 0 ? null : sessionsAt(clock)), [clock]);
  const expiries = useMemo(() => (book.entries && clock !== 0 ? expiryLadder(book.entries, clock) : null), [book.entries, clock]);
  const openRows: OpenRow[] = OPEN_MARKETS.map(({ market, symbol }) => {
    const quote = board.find((entry) => entry.symbol === symbol)?.quote;
    const result = expectedOpen.result;
    const item = result && !result.open ? result.items.find((i): i is ExpectedOpenItem => i.market === market && isExpectedOpenItem(i)) : undefined;
    // The natural gas row follows the contract picked on the Natural gas tab: its own price. The board's day move is the front month's, so it shows only when that is the one.
    const choice: NatgasChoice | null = market === "NATURALGAS" ? (result?.natgas ?? null) : null;
    const onBoard = !choice || choice.contract.key === choice.contracts[0]?.key;
    return {
      key: market,
      name: EXPECTED_OPEN_LABELS[market],
      contract: item?.contract.label ?? (onBoard ? (quote?.contract?.label ?? null) : choice ? contractMonthLabel(choice.contract.expiry) : null),
      price: onBoard ? (quote?.price ?? null) : (choice?.last?.price ?? null),
      changePct: onBoard ? (quote?.changePct ?? null) : null,
      expected: item ? { open: item.expectedOpen, movePct: item.movePct } : null,
    };
  });

  // --- The top ------------------------------------------------------------------------
  const stale = prices.tokenExpired || prices.offline || prices.loadError !== null;
  const feed: Feed = stale ? "paused" : Object.keys(quotes).length === 0 ? "loading" : "live";
  const priced = book.rows !== null && (book.rows.length === 0 || book.rows.some((row) => row.livePnl != null));
  const lots = (book.entries ?? []).reduce((sum, entry) => sum + entry.lots, 0);
  const month = summary ? (chargesIn ? summary.netPnl : summary.totalPnl) : null;

  return (
    <div className="flex flex-col gap-7">
      <LivePricingBanners tokenExpired={prices.tokenExpired || book.tokenExpired} offline={prices.offline} lastPricesAt={prices.lastPolledAt} />

      <Hero
        date={clock === 0 ? "" : new Date(clock).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
        feed={feed}
        tick={prices.lastPolledAt}
        refreshing={prices.manualRefreshing}
        onRefresh={() => void prices.refresh()}
        live={priced && book.stats ? book.stats.unrealizedPnl : null}
        liveSub={book.entries ? `${book.entries.length} pos · ${lots} lots` : null}
        today={book.stats?.todayPnl ?? null}
        todaySub={book.stats ? `Booked ${signedMoney(book.stats.bookedToday)}` : null}
        month={month}
        monthSub={summary ? `${Math.round(summary.winRatePct)}% win · ${summary.totalTrades}` : null}
        equity={funds?.equity ?? null}
        equitySub={funds ? `Capital ${formatINR(funds.capital)}` : null}
      />

      <div className="flex flex-col gap-3">
        <BandHeader band="now" label="Now" tick={prices.lastPolledAt} />
        <div className={GRID}>
          <IndicesCard rows={indexRows} breadth={breadth} index={1} />
          <CommoditiesCard entries={board} index={2} />
          <WorldCard tiles={worldTiles} index={3} />
          <PositionsCard lines={lines} margin={book.margin} exposure={exposure} loaded={book.entries !== null} index={4} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <BandHeader band="done" label="Done" meta={report.fetchedAt !== null ? formatAsOf(report.fetchedAt) : undefined} />
        <div className={GRID}>
          <ThirtyDaysCard summary={summary} chargesIn={chargesIn} bars={bars} loading={report.loading} index={5} />
          <QualityCard summary={summary} index={6} />
          <TradesCard lines={recent} loading={report.loading} index={7} />
          <AccountCard funds={funds} paper={paper} index={8} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <BandHeader band="next" label="Next" />
        <div className={GRID}>
          <SessionsCard sessions={sessions} now={clock} index={9} />
          <ExpiriesCard steps={expiries} index={10} />
          <OpenCard rows={openRows} index={11} />
          <RiskCard risk={book.risk} index={12} />
        </div>
      </div>
    </div>
  );
}
