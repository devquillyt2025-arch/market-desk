import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { analyzeRisk } from "@/lib/calculateRisk";
import {
  buildPortfolioCsv,
  buildPortfolioReport,
  csvCell,
  describeLiveData,
  exportFilename,
  type PortfolioFeedState,
  type PortfolioReport,
  type PortfolioReportInput,
} from "@/lib/portfolioExport";
import { buildPortfolioPdf, pdfText, rs } from "@/lib/portfolioPdf";
import { DEFAULT_LOT_SIZES, type TradeEntry } from "@/lib/types";
import type { UpstoxPosition } from "@/lib/upstox/types";

const NOW = Date.parse("2026-11-05T10:00:00+05:30");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

let seq = 0;
function entry(over: Partial<TradeEntry> = {}): TradeEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: null,
    entry_date: day(-1),
    instrument: "NIFTY",
    strike_price: 24500,
    option_type: "CE",
    expiry_date: day(2),
    closing_date: null,
    lots: 2,
    side: "sell",
    buy_price: 120,
    sell_price: 120,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-02T04:00:00Z",
    updated_at: "2026-11-02T04:00:00Z",
    ...over,
  };
}

/** A live-priced row: P&L worked out the way calculatePortfolio does (sell collects the premium, buy pays it). */
function liveRow(entryOver: Partial<TradeEntry>, entryPrice: number, ltp: number, over: Partial<PortfolioRow> = {}): PortfolioRow {
  const e = entry({ ...entryOver, buy_price: entryPrice, sell_price: entryPrice });
  const qty = e.lots * DEFAULT_LOT_SIZES[e.instrument];
  return {
    entry: e,
    entryPrice,
    status: "ok",
    instrumentKey: "NSE_FO|1",
    liveLtp: ltp,
    livePnl: (e.side === "sell" ? entryPrice - ltp : ltp - entryPrice) * qty,
    prevClose: entryPrice,
    delta: 0.31,
    gamma: 0.00042,
    theta: -7.4,
    vega: 6.1,
    oi: 482_300,
    iv: 13.8,
    volume: 1_204_500,
    underlyingSpot: 23_800,
    nearbyIv: 13.8,
    brokerageIfClosed: 184.37,
    stale: false,
    asOf: null,
    ...over,
  };
}

function untrackedRow(entryOver: Partial<TradeEntry> = {}): PortfolioRow {
  return {
    entry: entry({ strike_price: null, option_type: null, expiry_date: null, ...entryOver }),
    entryPrice: 80,
    status: "untracked",
    instrumentKey: null,
    liveLtp: null,
    livePnl: null,
    prevClose: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    oi: null,
    iv: null,
    volume: null,
    underlyingSpot: null,
    nearbyIv: null,
    brokerageIfClosed: null,
    stale: false,
    asOf: null,
  };
}

function closedPosition(over: Partial<UpstoxPosition> = {}): UpstoxPosition {
  return {
    instrumentKey: "NSE_FO|c1",
    instrument: "NIFTY",
    strike: 24000,
    optionType: "PE",
    expiry: day(2),
    lotSize: 65,
    quantity: 0,
    overnightQuantity: 0,
    averagePrice: null,
    buyQuantity: 130,
    buyValue: 130 * 52.4,
    sellQuantity: 130,
    sellValue: 130 * 71.15,
    dayBuyQuantity: 130,
    dayBuyValue: 130 * 52.4,
    daySellQuantity: 130,
    daySellValue: 130 * 71.15,
    lastPrice: 68.2,
    closePrice: 50,
    openedOn: null,
    ...over,
  };
}

const LIVE_FEED: PortfolioFeedState = {
  syncedAt: NOW - 45_000,
  pricesAt: NOW - 4_000,
  stalePricesAsOf: null,
  tokenExpired: false,
  offline: false,
  syncError: null,
  otherCount: 0,
};

function input(rows: PortfolioRow[], over: Partial<PortfolioReportInput> = {}): PortfolioReportInput {
  const unrealizedPnl = rows.reduce((sum, r) => sum + (r.livePnl ?? 0), 0);
  const value = rows.reduce(
    (sum, r) => sum + (r.liveLtp ?? r.entryPrice) * r.entry.lots * DEFAULT_LOT_SIZES[r.entry.instrument],
    0,
  );
  const analysis = analyzeRisk(rows, { now: new Date(NOW), totalMargin: 100_000, unrealizedPnl });
  return {
    now: NOW,
    rows,
    marginByEntryId: new Map(rows.map((r) => [r.entry.id, 50_000])),
    totalMargin: 100_000,
    stats: { value, unrealizedPnl, todayPnl: -1234.5, bookedToday: 400 },
    closedToday: [],
    risk: analysis ? { analysis, asOf: NOW - 20_000, paused: false } : null,
    feed: LIVE_FEED,
    ...over,
  };
}

/** Two shorts and a hedge on one expiry, plus one position that can't be priced. */
function sampleReport(over: Partial<PortfolioReportInput> = {}): PortfolioReport {
  const rows = [
    liveRow({ strike_price: 24500, option_type: "CE", side: "sell" }, 120, 150),
    liveRow({ strike_price: 22500, option_type: "PE", side: "sell" }, 95, 60),
    liveRow({ strike_price: 25000, option_type: "CE", side: "buy" }, 30, 40),
    untrackedRow({ remarks: '=HYPERLINK("http://example.com","x")' }),
  ];
  return buildPortfolioReport(input(rows, over));
}

describe("csvCell", () => {
  it("writes numbers bare, including negatives, and null as an empty cell", () => {
    assert.equal(csvCell(-3900), "-3900");
    assert.equal(csvCell(0.00042), "0.00042");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(Number.NaN), "");
  });

  it("quotes commas, quotes and line breaks per RFC 4180", () => {
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell("plain"), "plain");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell("+cmd"), "'+cmd");
    assert.equal(csvCell("-2+3"), "'-2+3");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell('=HYPERLINK("u","x")'), `"'=HYPERLINK(""u"",""x"")"`);
  });

  it("spells booleans out", () => {
    assert.equal(csvCell(true), "Yes");
    assert.equal(csvCell(false), "No");
  });
});

describe("buildPortfolioReport", () => {
  it("carries every open position, in order, with its quantity and side", () => {
    const report = sampleReport();
    assert.equal(report.positions.length, 4);
    assert.deepEqual(
      report.positions.map((p) => p.serial),
      [1, 2, 3, 4],
    );
    const [shortCall] = report.positions;
    assert.equal(shortCall.contract, "NIFTY 24500 CE");
    assert.equal(shortCall.side, "Sell");
    assert.equal(shortCall.quantity, 2 * DEFAULT_LOT_SIZES.NIFTY);
    assert.equal(shortCall.entryPrice, 120);
    assert.equal(shortCall.livePrice, 150);
    assert.equal(shortCall.pnl, -3900);
    // -3900 on 120 × 130 of premium collected.
    assert.equal(shortCall.pnlPct, -25);
    assert.equal(shortCall.margin, 50_000);
  });

  it("keeps the headline numbers in step with the rows", () => {
    const report = sampleReport();
    assert.equal(report.summary.totalLots, report.positions.reduce((s, p) => s + p.lots, 0));
    assert.equal(report.summary.totalQuantity, report.positions.reduce((s, p) => s + p.quantity, 0));
    // Total Value is the live (else entry) mark across every open row, like the tile.
    assert.equal(report.summary.totalValue, report.positions.reduce((s, p) => s + p.value, 0));
    assert.equal(report.summary.unrealizedPnl, report.positions.reduce((s, p) => s + (p.pnl ?? 0), 0));
    assert.equal(report.summary.brokerageIfClosed, 184.37 * 3);
    assert.equal(report.summary.todayPnl, -1234.5);
    assert.equal(report.summary.bookedToday, 400);
  });

  it("leaves a position without live data blank rather than inventing numbers", () => {
    const report = sampleReport();
    const untracked = report.positions[3];
    assert.equal(untracked.livePrice, null);
    assert.equal(untracked.pnl, null);
    assert.equal(untracked.pnlPct, null);
    assert.equal(untracked.brokerageIfClosed, null);
    assert.equal(untracked.liveData, "Strike / CE-PE not set");
    // …but it still counts at its entry price in the total value, as on screen.
    assert.equal(untracked.value, 80 * 2 * DEFAULT_LOT_SIZES.NIFTY);
    assert.ok(report.notices.some((n) => n.includes("1 of 4 open positions has no live data")));
  });

  it("describes each live-data state in plain words", () => {
    const base = liveRow({}, 100, 90);
    assert.equal(describeLiveData(base), "Live");
    assert.match(describeLiveData({ ...base, stale: true, asOf: NOW - 3_600_000 }), /^Last price \(as of /);
    assert.equal(describeLiveData(untrackedRow()), "Strike / CE-PE not set");
    assert.equal(describeLiveData(untrackedRow({ strike_price: 24500, option_type: "CE" })), "Expiry not set");
    assert.equal(describeLiveData({ ...base, status: "error", errorMessage: "token_expired" }), "Paused - token expired");
    assert.equal(describeLiveData({ ...base, status: "error", errorMessage: "network_error" }), "Paused - no connection");
    assert.equal(describeLiveData({ ...base, status: "no_match" }), "No live data - check the expiry");
  });

  it("flags stale prices, an expired token, a failed sync and untracked positions in the notices", () => {
    const report = sampleReport({
      feed: { ...LIVE_FEED, stalePricesAsOf: NOW - 3 * 3_600_000, tokenExpired: true, syncError: "boom", otherCount: 2 },
    });
    const text = report.notices.join("\n");
    assert.match(text, /token has expired/);
    assert.match(text, /last ones seen/);
    assert.match(text, /Couldn't sync positions with Upstox: boom/);
    assert.match(text, /2 Upstox positions aren't included/);
    assert.equal(sampleReport().notices.some((n) => /expired|last ones seen/.test(n)), false);
  });

  it("works out each squared-off position the way the Closed Today table does", () => {
    const report = sampleReport({ closedToday: [closedPosition()] });
    const [closed] = report.closedToday;
    assert.equal(closed.contract, "NIFTY 24000 PE");
    assert.equal(closed.lots, 2);
    assert.equal(closed.buyAvg, 52.4);
    assert.equal(closed.sellAvg, 71.15);
    assert.equal(closed.pnl, 2437.5);
    assert.ok(closed.charges !== null && closed.charges > 0);
    assert.equal(closed.netPnl, Math.round((closed.pnl - closed.charges) * 100) / 100);
    assert.equal(report.summary.closedTodayCount, 1);
    assert.equal(report.summary.closedTodayPnl, 2437.5);
  });

  it("includes the risk read: figures, per-position rows, ranges and warnings", () => {
    const risk = sampleReport().risk;
    assert.ok(risk);
    assert.equal(risk.analysedCount, 3);
    assert.equal(risk.openCount, 4);
    assert.equal(risk.positions.length, 3);
    assert.ok(risk.ranges.length >= 1);
    assert.ok(risk.warnings.length >= 1);
    assert.ok(["High risk", "Elevated", "Comfortable"].includes(risk.verdict));
    const hedge = risk.positions.find((p) => p.contract === "NIFTY 25000 CE");
    assert.equal(hedge?.side, "Buy (hedge)");
    // The unpriced position is reported as left out, not silently dropped.
    assert.ok(risk.warnings.some((w) => w.title.includes("not analysed")));
  });

  it("has no risk section when nothing could be analysed", () => {
    const report = buildPortfolioReport(input([untrackedRow()]));
    assert.equal(report.risk, null);
  });
});

describe("buildPortfolioCsv", () => {
  const lines = (report: PortfolioReport) => buildPortfolioCsv(report).split("\r\n");

  it("lays the report out in titled sections with CRLF line endings", () => {
    const csv = buildPortfolioCsv(sampleReport({ closedToday: [closedPosition()] }));
    assert.ok(csv.includes("\r\n"));
    assert.ok(!/(?<!\r)\n/.test(csv), "a bare LF line ending slipped in");
    for (const heading of [
      "SUMMARY",
      "OPEN POSITIONS",
      "CLOSED TODAY",
      "RISK & PROBABILITY",
      "RISK BY POSITION",
      "RANGE AT EXPIRY",
      "WARNING SIGNS",
    ]) {
      assert.ok(lines(sampleReport({ closedToday: [closedPosition()] })).includes(heading), `missing ${heading}`);
    }
    assert.ok(csv.startsWith("MarketDesk - Live Portfolio\r\nGenerated,"));
  });

  it("gives every open position a row as wide as the header, with a totals row", () => {
    const report = sampleReport();
    const all = lines(report);
    const start = all.indexOf("OPEN POSITIONS");
    const header = all[start + 1];
    const body = all.slice(start + 2, start + 2 + report.positions.length);
    // Splitting on commas is exact for the header and for rows without a quoted cell; the one row with a quoted
    // remark (last column) is only checked to have at least as many commas as the header.
    const width = header.split(",").length;
    assert.equal(width, 27);
    for (const row of body) assert.ok(row.split(",").length >= width, row);
    assert.equal(body.filter((row) => !row.includes('"')).every((row) => row.split(",").length === width), true);
    const totals = all[start + 2 + report.positions.length];
    assert.ok(totals.startsWith("Total,"));
    assert.ok(totals.includes(`,${report.summary.unrealizedPnl},`));
  });

  it("keeps a negative P&L a bare number and neutralises a formula typed into remarks", () => {
    const csv = buildPortfolioCsv(sampleReport());
    assert.ok(csv.includes(",-3900,"));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://example.com"",""x"")"`));
    assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  });

  it("omits the closed and risk sections when there is nothing to show", () => {
    const csv = buildPortfolioCsv(buildPortfolioReport(input([untrackedRow()])));
    assert.ok(!csv.includes("CLOSED TODAY"));
    assert.ok(!csv.includes("RISK & PROBABILITY"));
    assert.ok(csv.includes("OPEN POSITIONS"));
  });

  it("writes unbounded risk as the word Unlimited rather than a number", () => {
    const rows = [liveRow({ strike_price: 24500, option_type: "CE", side: "sell" }, 120, 150)];
    const csv = buildPortfolioCsv(buildPortfolioReport(input(rows)));
    assert.match(csv, /Max Loss \(INR\),Unlimited/);
  });
});

describe("exportFilename", () => {
  it("names files by the device's own date", () => {
    const name = exportFilename("pdf", new Date(2026, 10, 5, 23, 59).getTime());
    assert.equal(name, "live-portfolio-2026-11-05.pdf");
    assert.equal(exportFilename("csv", new Date(2026, 0, 2, 0, 1).getTime()), "live-portfolio-2026-01-02.csv");
  });
});

describe("PDF", () => {
  it("swaps symbols Helvetica can't print for plain ASCII", () => {
    assert.equal(pdfText("₹5 — 1σ × 2 ≥ 1"), "Rs. 5 - 1SD x 2 >= 1");
    assert.equal(pdfText("it’s “quoted”…"), `it's "quoted"...`);
    // Anything else outside Latin-1 becomes a visible placeholder, never a garbled glyph.
    assert.equal(pdfText("日本"), "??");
    assert.equal(pdfText("café"), "café");
  });

  it("prints rupee amounts with Indian grouping and a Rs. prefix", () => {
    assert.equal(rs(68_640), "Rs. 68,640");
    assert.equal(rs(1_234_567), "Rs. 12,34,567");
    assert.equal(rs(-1_234.4), "-Rs. 1,234");
    assert.equal(rs(0), "Rs. 0");
  });

  it("builds a PDF file for a full report, and for one with no risk or closed section", async () => {
    for (const report of [
      sampleReport({ closedToday: [closedPosition()] }),
      buildPortfolioReport(input([untrackedRow()])),
      buildPortfolioReport(input([], { closedToday: [closedPosition()] })),
    ]) {
      const blob = await buildPortfolioPdf(report);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
      assert.ok(bytes.length > 2_000, `only ${bytes.length} bytes`);
    }
  });
});
