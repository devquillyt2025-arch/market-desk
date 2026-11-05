/**
 * Everything Live Portfolio's CSV and PDF exports carry, as plain data. No
 * React, no DOM, no fetching: the page hands over what it already has on
 * screen (priced rows, margin, the risk read, today's squared-off positions)
 * and gets back one `PortfolioReport` that both renderers lay out — the CSV
 * writer here and the PDF writer in portfolioPdf.ts — so the two can never
 * disagree about a number.
 *
 * Numbers stay numbers (rounded, never pre-formatted) and "no value" stays
 * null: the CSV leaves those cells empty so a spreadsheet can still sum or
 * sort them, and the PDF decides how to print them.
 */

import { needsExpiryOnly, summariseClosedPosition, type PortfolioRow } from "@/lib/calculatePortfolio";
import type { RiskAnalysis, RiskSeverity, RiskVerdict } from "@/lib/calculateRisk";
import { round2 } from "@/lib/calculateTrade";
import { formatAsOf } from "@/lib/format";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES } from "@/lib/types";
import type { UpstoxPosition } from "@/lib/upstox/types";

// --- Report shape -----------------------------------------------------------

export type ReportPosition = {
  serial: number;
  /** yyyy-mm-dd. */
  entryDate: string;
  instrument: string;
  strike: number | null;
  optionType: "CE" | "PE" | null;
  /** "NIFTY 24500 CE" — what the table calls the instrument. */
  contract: string;
  /** yyyy-mm-dd, null while not set. */
  expiry: string | null;
  side: "Buy" | "Sell";
  lots: number;
  quantity: number;
  entryPrice: number;
  livePrice: number | null;
  prevClose: number | null;
  /** Current mark value in premium terms ((live price, else entry price) × quantity) — sums to the Total Value tile. */
  value: number;
  pnl: number | null;
  /** P&L as a percentage of the premium the position was opened at. */
  pnlPct: number | null;
  margin: number | null;
  brokerageIfClosed: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  /** Percent, as Upstox reports it. */
  iv: number | null;
  oi: number | null;
  volume: number | null;
  underlyingSpot: number | null;
  /** Plain-English state of the live data: "Live", "Last price (as of …)", "Expiry not set", … */
  liveData: string;
  remarks: string;
};

export type ReportClosed = {
  contract: string;
  expiry: string;
  lots: number;
  buyQuantity: number;
  sellQuantity: number;
  buyAvg: number | null;
  sellAvg: number | null;
  lastPrice: number | null;
  /** Realised, before charges. */
  pnl: number;
  charges: number | null;
  /** pnl less charges (charges unknown counts as nil). */
  netPnl: number;
};

export type ReportRiskPosition = {
  contract: string;
  side: "Buy" | "Sell" | "Buy (hedge)";
  expiry: string | null;
  daysToExpiry: number;
  chanceOfProfitPct: number;
  strike: number | null;
  moneyness: "ITM" | "OTM";
  /** How far the underlying sits from the strike, as a positive percentage. */
  moneynessPct: number;
  breakeven: number;
  breakevenMovePct: number;
  expectedMovePct: number;
  /** null = unlimited. */
  maxLoss: number | null;
  maxProfit: number | null;
  thetaPerDay: number | null;
  flag: "Critical" | "Warning" | "Note" | null;
  ivEstimated: boolean;
};

export type ReportRange = {
  instrument: string;
  expiry: string;
  daysToExpiry: number;
  spot: number;
  sigmaLow: number;
  sigmaHigh: number;
  breakevens: number[];
  pnlAtSpot: number;
};

export type ReportWarning = {
  severity: "Critical" | "Warning" | "Note";
  title: string;
  detail: string;
};

export type ReportRisk = {
  /** When the figures are from, in ms. */
  asOf: number;
  /** True while they are the last good read rather than current. */
  paused: boolean;
  verdict: string;
  criticalCount: number;
  warningCount: number;
  analysedCount: number;
  openCount: number;
  chanceOfProfitPct: number;
  nearestExpiry: string | null;
  nearestDaysToExpiry: number | null;
  /** null = unlimited. */
  maxLoss: number | null;
  maxProfit: number | null;
  /** ₹ risked per ₹1 of upside — null when one side is unbounded. */
  riskPerReward: number | null;
  expectedPnl: number;
  netThetaPerDay: number;
  pnlIfMarketRises1Pct: number;
  pnlIfMarketFalls1Pct: number;
  /** Share of the worst case the unrealized loss has used — null when not losing or unbounded. */
  worstCaseUsedPct: number | null;
  positions: ReportRiskPosition[];
  ranges: ReportRange[];
  warnings: ReportWarning[];
};

export type PortfolioReport = {
  /** ms since the epoch. */
  generatedAt: number;
  syncedAt: number | null;
  pricesAt: number | null;
  /** Things the reader must know to trust the numbers: stale prices, a failed sync, positions left out. */
  notices: string[];
  summary: {
    totalMargin: number | null;
    totalValue: number;
    unrealizedPnl: number;
    todayPnl: number | null;
    bookedToday: number;
    openPositions: number;
    totalLots: number;
    totalQuantity: number;
    brokerageIfClosed: number;
    closedTodayCount: number;
    closedTodayPnl: number | null;
  };
  positions: ReportPosition[];
  closedToday: ReportClosed[];
  risk: ReportRisk | null;
};

// --- Building ---------------------------------------------------------------

export type PortfolioFeedState = {
  syncedAt: number | null;
  pricesAt: number | null;
  /** When showing last-known prices through an outage, when those were fetched; null while live. */
  stalePricesAsOf: number | null;
  tokenExpired: boolean;
  offline: boolean;
  syncError: string | null;
  /** Upstox positions Live Portfolio doesn't track (stocks, futures, other indices). */
  otherCount: number;
};

export type PortfolioReportInput = {
  now: number;
  /** The open positions as the table shows them, in table order. */
  rows: PortfolioRow[];
  marginByEntryId: ReadonlyMap<string, number>;
  totalMargin: number | null;
  stats: { value: number; unrealizedPnl: number; todayPnl: number | null; bookedToday: number };
  closedToday: UpstoxPosition[];
  risk: { analysis: RiskAnalysis; asOf: number; paused: boolean } | null;
  feed: PortfolioFeedState;
};

/** Rounds to `dp` places; null and non-finite stay "no value". Kills float noise like 0.1 + 0.2. */
function round(value: number | null | undefined, dp: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

const VERDICT_LABELS: Record<RiskVerdict, string> = {
  high: "High risk",
  elevated: "Elevated",
  comfortable: "Comfortable",
};

const SEVERITY_LABELS: Record<RiskSeverity, "Critical" | "Warning" | "Note"> = {
  critical: "Critical",
  warning: "Warning",
  info: "Note",
};

/** What the Live Data column says about a row — no dashes or fancy punctuation, so it prints the same everywhere. */
export function describeLiveData(row: PortfolioRow): string {
  switch (row.status) {
    case "ok":
      return row.stale && row.asOf != null ? `Last price (as of ${formatAsOf(row.asOf)})` : row.stale ? "Last price" : "Live";
    case "untracked":
      return needsExpiryOnly(row.entry) ? "Expiry not set" : "Strike / CE-PE not set";
    case "loading":
      return "Loading";
    case "error":
      return row.errorMessage === "token_expired"
        ? "Paused - token expired"
        : row.errorMessage === "network_error"
          ? "Paused - no connection"
          : "Couldn't load live data";
    case "no_match":
      return "No live data - check the expiry";
  }
}

function buildPosition(row: PortfolioRow, serial: number, margin: number | null): ReportPosition {
  const { entry } = row;
  const quantity = entry.lots * DEFAULT_LOT_SIZES[entry.instrument];
  const premium = row.entryPrice * quantity;
  return {
    serial,
    entryDate: entry.entry_date,
    instrument: entry.instrument,
    strike: entry.strike_price,
    optionType: entry.option_type,
    contract: describeEntryContract(entry),
    expiry: entry.expiry_date,
    side: entry.side === "sell" ? "Sell" : "Buy",
    lots: entry.lots,
    quantity,
    entryPrice: round2(row.entryPrice),
    livePrice: round(row.liveLtp, 2),
    prevClose: round(row.prevClose, 2),
    value: round2((row.liveLtp ?? row.entryPrice) * quantity),
    pnl: round(row.livePnl, 2),
    pnlPct: row.livePnl != null && premium > 0 ? round((row.livePnl / premium) * 100, 1) : null,
    margin: round(margin, 2),
    brokerageIfClosed: round(row.brokerageIfClosed, 2),
    delta: round(row.delta, 4),
    gamma: round(row.gamma, 6),
    theta: round(row.theta, 4),
    vega: round(row.vega, 4),
    iv: round(row.iv, 2),
    oi: row.oi,
    volume: row.volume,
    underlyingSpot: round(row.underlyingSpot, 2),
    liveData: describeLiveData(row),
    remarks: entry.remarks ?? "",
  };
}

function buildClosed(position: UpstoxPosition): ReportClosed {
  const { buyAvg, sellAvg, pnl, charges } = summariseClosedPosition(position);
  return {
    contract: describeEntryContract({
      instrument: position.instrument,
      strike_price: position.strike,
      option_type: position.optionType,
    }),
    expiry: position.expiry,
    lots: round2(position.buyQuantity / position.lotSize),
    buyQuantity: position.buyQuantity,
    sellQuantity: position.sellQuantity,
    buyAvg,
    sellAvg,
    lastPrice: round(position.lastPrice, 2),
    pnl,
    charges: round(charges, 2),
    netPnl: round2(pnl - (charges ?? 0)),
  };
}

function buildRisk(input: NonNullable<PortfolioReportInput["risk"]>): ReportRisk {
  const { analysis, asOf, paused } = input;
  return {
    asOf,
    paused,
    verdict: VERDICT_LABELS[analysis.verdict],
    criticalCount: analysis.warnings.filter((w) => w.severity === "critical").length,
    warningCount: analysis.warnings.filter((w) => w.severity === "warning").length,
    analysedCount: analysis.analysedCount,
    openCount: analysis.openCount,
    chanceOfProfitPct: round(analysis.pop * 100, 1) ?? 0,
    nearestExpiry: analysis.nearestExpiry,
    nearestDaysToExpiry: analysis.nearestDte,
    maxLoss: round(analysis.maxLoss, 2),
    maxProfit: round(analysis.maxProfit, 2),
    riskPerReward: analysis.rewardToRisk && analysis.rewardToRisk > 0 ? round(1 / analysis.rewardToRisk, 2) : null,
    expectedPnl: round2(analysis.expectedPnl),
    netThetaPerDay: round2(analysis.netThetaPerDay),
    pnlIfMarketRises1Pct: round2(analysis.pnlPer1PctMove),
    pnlIfMarketFalls1Pct: round2(-analysis.pnlPer1PctMove || 0),
    worstCaseUsedPct: round(analysis.drawdownUsedPct, 0),
    positions: analysis.positions.map((p) => ({
      contract: p.contract,
      side: p.row.entry.side === "sell" ? "Sell" : p.isHedge ? "Buy (hedge)" : "Buy",
      expiry: p.row.entry.expiry_date,
      daysToExpiry: p.dte,
      chanceOfProfitPct: round(p.pop * 100, 1) ?? 0,
      strike: p.row.entry.strike_price,
      moneyness: p.itmPct > 0 ? "ITM" : "OTM",
      moneynessPct: round(Math.abs(p.itmPct), 1) ?? 0,
      breakeven: round(p.breakeven, 2) ?? 0,
      breakevenMovePct: round(p.breakevenMovePct, 1) ?? 0,
      expectedMovePct: round(p.expectedMovePct, 1) ?? 0,
      maxLoss: round(p.maxLoss, 2),
      maxProfit: round(p.maxProfit, 2),
      thetaPerDay: round(p.thetaPerDay, 2),
      flag: p.flag ? SEVERITY_LABELS[p.flag] : null,
      ivEstimated: p.ivEstimated,
    })),
    ranges: analysis.gauges.map((g) => ({
      instrument: g.instrument,
      expiry: g.expiry,
      daysToExpiry: g.dte,
      spot: round(g.spot, 2) ?? 0,
      sigmaLow: round(g.sigmaLow, 2) ?? 0,
      sigmaHigh: round(g.sigmaHigh, 2) ?? 0,
      breakevens: g.breakevens.map((b) => round(b, 2) ?? 0),
      pnlAtSpot: round2(g.pnlAtSpot),
    })),
    warnings: analysis.warnings.map((w) => ({
      severity: SEVERITY_LABELS[w.severity],
      title: w.title,
      detail: w.detail,
    })),
  };
}

function buildNotices(input: PortfolioReportInput): string[] {
  const { feed, rows, risk } = input;
  const notices: string[] = [];
  if (feed.tokenExpired) {
    notices.push("The Upstox token has expired, so live prices are paused. Add today's token to resume them.");
  } else if (feed.offline) {
    notices.push("There is no connection to Upstox right now, so live prices are paused.");
  }
  if (feed.stalePricesAsOf !== null) {
    notices.push(
      `Prices and P&L are the last ones seen, as of ${formatAsOf(feed.stalePricesAsOf, input.now)} - not current.`,
    );
  }
  if (feed.syncError) notices.push(`Couldn't sync positions with Upstox: ${feed.syncError}.`);

  const withoutLiveData = rows.filter((r) => r.status !== "ok").length;
  if (withoutLiveData > 0) {
    notices.push(
      `${withoutLiveData} of ${rows.length} open position${rows.length === 1 ? "" : "s"} ${withoutLiveData === 1 ? "has" : "have"} no live data (see the Live Data column); their P&L, brokerage and risk figures are left out.`,
    );
  }
  if (feed.otherCount > 0) {
    notices.push(
      `${feed.otherCount} Upstox position${feed.otherCount === 1 ? " isn't" : "s aren't"} included - Live Portfolio tracks Nifty, Bank Nifty and Sensex options only.`,
    );
  }
  if (risk?.paused) {
    notices.push(`Risk & Probability shows the last good read, as of ${formatAsOf(risk.asOf, input.now)}.`);
  }
  return notices;
}

export function buildPortfolioReport(input: PortfolioReportInput): PortfolioReport {
  const { rows, marginByEntryId, totalMargin, stats } = input;
  const positions = rows.map((row, i) => buildPosition(row, i + 1, marginByEntryId.get(row.entry.id) ?? null));
  const closedToday = input.closedToday.map(buildClosed);

  return {
    generatedAt: input.now,
    syncedAt: input.feed.syncedAt,
    pricesAt: input.feed.pricesAt,
    notices: buildNotices(input),
    summary: {
      totalMargin: round(totalMargin, 2),
      totalValue: round2(stats.value),
      unrealizedPnl: round2(stats.unrealizedPnl),
      todayPnl: round(stats.todayPnl, 2),
      bookedToday: round2(stats.bookedToday),
      openPositions: positions.length,
      totalLots: positions.reduce((sum, p) => sum + p.lots, 0),
      totalQuantity: positions.reduce((sum, p) => sum + p.quantity, 0),
      brokerageIfClosed: round2(positions.reduce((sum, p) => sum + (p.brokerageIfClosed ?? 0), 0)),
      closedTodayCount: closedToday.length,
      closedTodayPnl: closedToday.length > 0 ? round2(closedToday.reduce((sum, c) => sum + c.pnl, 0)) : null,
    },
    positions,
    closedToday,
    risk: input.risk ? buildRisk(input.risk) : null,
  };
}

// --- Shared formatting ------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** yyyy-mm-dd in the device's own timezone. */
export function localIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "2026-11-05 15:42:10" — device timezone, unambiguous and sortable. */
export function formatStampIso(ms: number): string {
  const d = new Date(ms);
  return `${localIsoDate(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "05 Nov 2026, 3:42 pm" — for a person reading the PDF. */
export function formatStampLong(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "live-portfolio-2026-11-05.csv" — same naming as the JSON export always had. */
export function exportFilename(ext: "csv" | "pdf" | "json", now: number): string {
  return `live-portfolio-${localIsoDate(now)}.${ext}`;
}

// --- CSV --------------------------------------------------------------------

type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV field per RFC 4180. Text that a spreadsheet would run as a formula
 * (starts with = + - @ or a control character) gets a leading apostrophe so a
 * remark like "=HYPERLINK(...)" typed into a position can't execute when the
 * file is opened. Numbers are written bare — a negative P&L must stay a number.
 */
export function csvCell(value: CsvCell): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = (cells: CsvCell[]) => cells.map(csvCell).join(",");

function unlimitedOr(value: number | null): number | string {
  return value === null ? "Unlimited" : value;
}

/**
 * The whole report as one spreadsheet-friendly CSV: a title block, then each
 * section (summary, open positions, closed today, risk) under its own heading
 * and header row, separated by a blank line. Amounts are in rupees but carry no
 * currency symbol so they stay numeric; each header names its unit instead.
 */
export function buildPortfolioCsv(report: PortfolioReport): string {
  const lines: string[] = [];
  const blank = () => lines.push("");
  const add = (...cells: CsvCell[]) => lines.push(csvLine(cells));
  const section = (title: string, header: CsvCell[], body: CsvCell[][], footer?: CsvCell[]) => {
    blank();
    add(title);
    add(...header);
    for (const row of body) add(...row);
    if (footer) add(...footer);
  };

  const { summary } = report;
  add("MarketDesk - Live Portfolio");
  add("Generated", formatStampIso(report.generatedAt));
  add("Prices as of", report.pricesAt ? formatStampIso(report.pricesAt) : "");
  add("Upstox synced", report.syncedAt ? formatStampIso(report.syncedAt) : "");
  for (const notice of report.notices) add("Note", notice);

  section(
    "SUMMARY",
    ["Metric", "Value"],
    [
      ["Total Invested (Margin) (INR)", summary.totalMargin],
      ["Total Value (INR)", summary.totalValue],
      ["Unrealized P&L (INR)", summary.unrealizedPnl],
      ["Today's P&L (INR)", summary.todayPnl],
      ["Of which booked today (INR)", summary.bookedToday],
      ["Open Positions", summary.openPositions],
      ["Total Lots", summary.totalLots],
      ["Total Quantity", summary.totalQuantity],
      ["Brokerage if All Closed (INR)", summary.brokerageIfClosed],
      ["Positions Squared Off Today", summary.closedTodayCount],
      ["Realised P&L Today, before charges (INR)", summary.closedTodayPnl],
    ],
  );

  section(
    "OPEN POSITIONS",
    [
      "#",
      "Entry Date",
      "Instrument",
      "Strike",
      "Type",
      "Expiry",
      "Side",
      "Lots",
      "Quantity",
      "Entry Price",
      "Live LTP",
      "Prev Close",
      "Value (INR)",
      "Live P&L (INR)",
      "P&L % of Premium",
      "Margin (INR)",
      "Brokerage if Closed (INR)",
      "Delta",
      "Gamma",
      "Theta (per share per day)",
      "Vega",
      "IV %",
      "Open Interest",
      "Volume",
      "Underlying Spot",
      "Live Data",
      "Remarks",
    ],
    report.positions.map((p) => [
      p.serial,
      p.entryDate,
      p.instrument,
      p.strike,
      p.optionType,
      p.expiry,
      p.side,
      p.lots,
      p.quantity,
      p.entryPrice,
      p.livePrice,
      p.prevClose,
      p.value,
      p.pnl,
      p.pnlPct,
      p.margin,
      p.brokerageIfClosed,
      p.delta,
      p.gamma,
      p.theta,
      p.vega,
      p.iv,
      p.oi,
      p.volume,
      p.underlyingSpot,
      p.liveData,
      p.remarks,
    ]),
    report.positions.length > 1
      ? [
          "Total",
          "",
          "",
          "",
          "",
          "",
          "",
          summary.totalLots,
          summary.totalQuantity,
          "",
          "",
          "",
          summary.totalValue,
          summary.unrealizedPnl,
          "",
          summary.totalMargin,
          summary.brokerageIfClosed,
        ]
      : undefined,
  );

  if (report.closedToday.length > 0) {
    const closed = report.closedToday;
    section(
      "CLOSED TODAY",
      [
        "Instrument",
        "Expiry",
        "Lots",
        "Buy Quantity",
        "Sell Quantity",
        "Buy Avg",
        "Sell Avg",
        "LTP",
        "Realised P&L (INR)",
        "Charges, est. (INR)",
        "Net P&L (INR)",
      ],
      closed.map((c) => [
        c.contract,
        c.expiry,
        c.lots,
        c.buyQuantity,
        c.sellQuantity,
        c.buyAvg,
        c.sellAvg,
        c.lastPrice,
        c.pnl,
        c.charges,
        c.netPnl,
      ]),
      closed.length > 1
        ? [
            "Total",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            round2(closed.reduce((s, c) => s + c.pnl, 0)),
            round2(closed.reduce((s, c) => s + (c.charges ?? 0), 0)),
            round2(closed.reduce((s, c) => s + c.netPnl, 0)),
          ]
        : undefined,
    );
  }

  const risk = report.risk;
  if (risk) {
    section(
      "RISK & PROBABILITY",
      ["Metric", "Value"],
      [
        ["Risk Verdict", risk.verdict],
        ["Critical Warnings", risk.criticalCount],
        ["Warnings", risk.warningCount],
        ["Positions Analysed", `${risk.analysedCount} of ${risk.openCount}`],
        ["Figures As Of", formatStampIso(risk.asOf)],
        ["Figures Are Last Good Read (paused)", risk.paused],
        ["Chance of Profit at Expiry %", risk.chanceOfProfitPct],
        ["Nearest Expiry", risk.nearestExpiry],
        ["Days to Nearest Expiry", risk.nearestDaysToExpiry],
        ["Max Loss (INR)", unlimitedOr(risk.maxLoss)],
        ["Max Profit (INR)", unlimitedOr(risk.maxProfit)],
        ["Risk : Reward (risk per 1 of reward)", risk.riskPerReward],
        ["Expected P&L at Expiry (INR)", risk.expectedPnl],
        ["Net Theta per Day (INR)", risk.netThetaPerDay],
        ["P&L if Market Rises 1% (INR)", risk.pnlIfMarketRises1Pct],
        ["P&L if Market Falls 1% (INR)", risk.pnlIfMarketFalls1Pct],
        ["Share of Worst Case Already Used %", risk.worstCaseUsedPct],
      ],
    );

    section(
      "RISK BY POSITION",
      [
        "Position",
        "Side",
        "Expiry",
        "Days to Expiry",
        "Chance of Profit %",
        "Strike",
        "Moneyness",
        "Distance from Strike %",
        "Breakeven",
        "Breakeven Move %",
        "1 SD Move %",
        "Max Loss (INR)",
        "Max Profit (INR)",
        "Theta per Day (INR)",
        "IV Estimated",
        "Flag",
      ],
      risk.positions.map((p) => [
        p.contract,
        p.side,
        p.expiry,
        p.daysToExpiry,
        p.chanceOfProfitPct,
        p.strike,
        p.moneyness,
        p.moneynessPct,
        p.breakeven,
        p.breakevenMovePct,
        p.expectedMovePct,
        unlimitedOr(p.maxLoss),
        unlimitedOr(p.maxProfit),
        p.thetaPerDay,
        p.ivEstimated,
        p.flag,
      ]),
    );

    if (risk.ranges.length > 0) {
      section(
        "RANGE AT EXPIRY",
        [
          "Underlying",
          "Expiry",
          "Days to Expiry",
          "Spot",
          "1 SD Low",
          "1 SD High",
          "Breakevens",
          "P&L if Settles at Spot (INR)",
        ],
        risk.ranges.map((g) => [
          g.instrument,
          g.expiry,
          g.daysToExpiry,
          g.spot,
          g.sigmaLow,
          g.sigmaHigh,
          g.breakevens.join(" / "),
          g.pnlAtSpot,
        ]),
      );
    }

    if (risk.warnings.length > 0) {
      section(
        "WARNING SIGNS",
        ["Severity", "Warning", "Detail"],
        risk.warnings.map((w) => [w.severity, w.title, w.detail]),
      );
    }

    blank();
    add(
      "Probabilities use each option's live implied volatility, zero drift, and assume all indices move together. Figures are at expiry and exclude brokerage - a guide to what to watch, not a forecast.",
    );
  }

  return lines.join("\r\n");
}
