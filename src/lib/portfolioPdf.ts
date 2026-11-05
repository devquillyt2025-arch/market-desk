/**
 * Lays a PortfolioReport out as a formatted A4-landscape PDF: a header with
 * the as-of times, summary cards, the open-positions table with a totals row,
 * Greeks & market data, today's closed positions, then Risk & Probability on
 * its own page. Tables paginate with repeated headers; every page gets a
 * footer with page numbers.
 *
 * jsPDF and jspdf-autotable are imported on demand — they're sizeable and only
 * ever needed at the moment someone clicks "PDF", so the Live Portfolio page
 * itself doesn't carry them.
 *
 * Text is set in jsPDF's built-in Helvetica, which only covers Latin-1: it has
 * no ₹ (U+20B9), σ, ×, − or em dash. Amounts are therefore printed "Rs. 1,234"
 * and every string goes through `pdfText` first, so nothing renders as a
 * garbled glyph.
 */

import type { jsPDF } from "jspdf";

import {
  formatStampLong,
  type PortfolioReport,
  type ReportClosed,
  type ReportPosition,
  type ReportRisk,
} from "@/lib/portfolioExport";

type Rgb = [number, number, number];

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/** Lowest y a block may reach — leaves room for the footer. */
const BOTTOM = PAGE_H - 14;

const COLOR = {
  ink: [24, 27, 36] as Rgb,
  muted: [102, 110, 125] as Rgb,
  line: [223, 227, 234] as Rgb,
  panel: [246, 247, 250] as Rgb,
  accent: [106, 92, 240] as Rgb,
  profit: [4, 120, 87] as Rgb,
  loss: [185, 28, 28] as Rgb,
  warning: [180, 83, 9] as Rgb,
  noticeBg: [254, 247, 234] as Rgb,
  white: [255, 255, 255] as Rgb,
};

const MODEL_NOTE =
  "Odds use live implied volatility, zero drift, all indices moving together. At expiry, before brokerage; a guide, not a forecast.";

const SEVERITY_COLOR: Record<string, Rgb> = {
  Critical: COLOR.loss,
  Warning: COLOR.warning,
  Note: COLOR.muted,
};

// --- Text -------------------------------------------------------------------

const REPLACEMENTS: [RegExp, string][] = [
  [/₹/g, "Rs. "],
  [/[−–—]/g, "-"],
  [/σ/g, "SD"],
  [/[×]/g, "x"],
  [/[≥]/g, ">="],
  [/[≤]/g, "<="],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, "..."],
  [/·/g, "|"],
];

/** Makes a string safe for Helvetica: known symbols become ASCII, anything else outside Latin-1 becomes "?". */
export function pdfText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.replace(/[^\x20-\x7E -ÿ\n]/g, "?");
}

const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const grouped2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Rs. 68,640" / "-Rs. 1,234" — whole rupees, Indian digit grouping, like the app's formatINR. */
export function rs(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded < 0 ? "-" : ""}Rs. ${grouped.format(Math.abs(rounded))}`;
}

const price = (v: number | null) => (v == null ? "-" : v.toFixed(2));
const groupedPrice = (v: number | null) => (v == null ? "-" : grouped2.format(v));
const int = (v: number | null) => (v == null ? "-" : grouped.format(v));
const signed = (v: number, dp = 1) => `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
const pnlColor = (v: number | null): Rgb | undefined => (v == null || v === 0 ? undefined : v > 0 ? COLOR.profit : COLOR.loss);

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatDte(dte: number): string {
  if (dte < 0) return "Expired";
  if (dte === 0) return "Today";
  return `${dte}d`;
}

// --- Drawing helpers --------------------------------------------------------

type AutoTable = (doc: jsPDF, options: Record<string, unknown>) => void;

type Align = "left" | "right" | "center";

/** One table cell: plain text, or text with its own colour / weight. */
type Cell = string | { text: string; color?: Rgb; bold?: boolean };

type Column = { header: string; align?: Align; width?: number };

type Ctx = { doc: jsPDF; autoTable: AutoTable; newDoc: () => jsPDF; y: number };

function setColor(doc: jsPDF, color: Rgb, kind: "text" | "fill" | "draw" = "text") {
  if (kind === "text") doc.setTextColor(color[0], color[1], color[2]);
  else if (kind === "fill") doc.setFillColor(color[0], color[1], color[2]);
  else doc.setDrawColor(color[0], color[1], color[2]);
}

/** Starts a new page when the next block (`height` mm tall) wouldn't fit. */
function ensureSpace(ctx: Ctx, height: number) {
  if (ctx.y + height > BOTTOM) {
    ctx.doc.addPage();
    ctx.y = MARGIN + 2;
  }
}

/** Vertical room a section heading takes, including the gap above it when it isn't at the top of a page. */
const HEADING_H = 12;

function sectionHeading(ctx: Ctx, title: string, aside?: string, makeRoom = true) {
  if (makeRoom) ensureSpace(ctx, 28);
  if (ctx.y > MARGIN + 4) ctx.y += 3;
  const { doc } = ctx;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, COLOR.ink);
  doc.text(pdfText(title.toUpperCase()), MARGIN, ctx.y + 3);
  if (aside) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, COLOR.muted);
    doc.text(pdfText(aside), PAGE_W - MARGIN, ctx.y + 3, { align: "right" });
  }
  setColor(doc, COLOR.accent, "draw");
  doc.setLineWidth(0.5);
  doc.line(MARGIN, ctx.y + 5, MARGIN + 12, ctx.y + 5);
  setColor(doc, COLOR.line, "draw");
  doc.setLineWidth(0.2);
  doc.line(MARGIN + 12, ctx.y + 5, PAGE_W - MARGIN, ctx.y + 5);
  ctx.y += 9;
}

/** A row of equal-width stat cards: label, value (optionally coloured), small hint underneath. */
type Card = { label: string; value: string; color?: Rgb; hint?: string };

function drawCards(ctx: Ctx, cards: Card[], perRow: number, height = 17) {
  const { doc } = ctx;
  const gap = 3;
  const width = (CONTENT_W - gap * (perRow - 1)) / perRow;
  for (let start = 0; start < cards.length; start += perRow) {
    ensureSpace(ctx, height + gap);
    cards.slice(start, start + perRow).forEach((card, i) => {
      const x = MARGIN + i * (width + gap);
      setColor(doc, COLOR.panel, "fill");
      setColor(doc, COLOR.line, "draw");
      doc.setLineWidth(0.2);
      doc.roundedRect(x, ctx.y, width, height, 1.8, 1.8, "FD");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, COLOR.muted);
      doc.text(pdfText(card.label.toUpperCase()), x + 3.5, ctx.y + 4.8);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      setColor(doc, card.color ?? COLOR.ink);
      doc.text(pdfText(card.value), x + 3.5, ctx.y + 10.6);

      if (card.hint) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        setColor(doc, COLOR.muted);
        doc.text(pdfText(card.hint), x + 3.5, ctx.y + 14.6);
      }
    });
    ctx.y += height + gap;
  }
}

function toCellDef(cell: Cell, align: Align | undefined, extra?: { bold?: boolean }) {
  const base = typeof cell === "string" ? { text: cell } : cell;
  return {
    content: pdfText(base.text),
    styles: {
      halign: align ?? "left",
      ...(base.color ? { textColor: base.color } : {}),
      ...(base.bold || extra?.bold ? { fontStyle: "bold" } : {}),
    },
  };
}

type TableOptions = {
  columns: Column[];
  rows: Cell[][];
  /** A totals row, drawn bold on a shaded band. */
  footer?: Cell[];
  fontSize?: number;
};

/** The report's house style for a table; `startY` is supplied per run. */
function tableConfig({ columns, rows, footer, fontSize = 7.6 }: TableOptions): Record<string, unknown> {
  const columnStyles: Record<number, Record<string, unknown>> = {};
  columns.forEach((col, i) => {
    columnStyles[i] = { halign: col.align ?? "left", ...(col.width ? { cellWidth: col.width } : {}) };
  });
  return {
    margin: { left: MARGIN, right: MARGIN, top: MARGIN + 2, bottom: 16 },
    theme: "plain",
    head: [columns.map((col) => toCellDef(col.header.toUpperCase(), col.align))],
    body: rows.map((row) => row.map((cell, i) => toCellDef(cell, columns[i].align))),
    foot: footer ? [footer.map((cell, i) => toCellDef(cell, columns[i].align, { bold: true }))] : undefined,
    showFoot: "lastPage",
    columnStyles,
    styles: {
      font: "helvetica",
      fontSize,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.6, right: 1.6 },
      textColor: COLOR.ink,
      lineColor: COLOR.line,
      lineWidth: { bottom: 0.15 },
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: COLOR.panel,
      textColor: COLOR.muted,
      fontStyle: "bold",
      fontSize: fontSize - 0.9,
      lineColor: COLOR.line,
      lineWidth: { bottom: 0.3 },
    },
    footStyles: {
      fillColor: COLOR.panel,
      textColor: COLOR.ink,
      fontStyle: "bold",
      lineColor: COLOR.line,
      lineWidth: { top: 0.3 },
    },
    rowPageBreak: "avoid",
  };
}

/** Draws the table on `doc` from `startY` and reports where it ended and how many pages it spans. */
function runTable(doc: jsPDF, autoTable: AutoTable, config: Record<string, unknown>, startY: number) {
  const pagesBefore = doc.getNumberOfPages();
  autoTable(doc, { ...config, startY });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? startY;
  return { finalY, pages: doc.getNumberOfPages() - pagesBefore + 1 };
}

/** How many pages the table would span if it started at `startY` - worked out on a throwaway document. */
function pagesIfStartedAt(ctx: Ctx, config: Record<string, unknown>, startY: number): number {
  return runTable(ctx.newDoc(), ctx.autoTable, config, startY).pages;
}

/**
 * A titled, paginating table. A table that fits on one page is never split: if it won't fit in what's left
 * of this page, its heading and all of it move to the next, rather than leaving a heading (or a lone row)
 * stranded at the bottom. A table longer than a page flows across pages with its header repeated.
 * Advances `ctx.y` below it.
 */
function drawSectionTable(ctx: Ctx, { title, aside, ...table }: TableOptions & { title: string; aside?: string }) {
  const config = tableConfig(table);
  const gap = ctx.y > MARGIN + 4 ? 0 : -3; // the heading adds 3mm of air unless it opens a page
  if (pagesIfStartedAt(ctx, config, ctx.y + HEADING_H + gap) > 1) {
    const wholeOnNewPage = pagesIfStartedAt(ctx, config, MARGIN + 2 + HEADING_H - 3) === 1;
    // Long tables flow, but never start with less than a heading and a few rows left on the page.
    if (wholeOnNewPage) ensureSpace(ctx, BOTTOM - ctx.y + 1);
    else ensureSpace(ctx, 42);
  } else {
    ensureSpace(ctx, 0);
  }
  sectionHeading(ctx, title, aside, false);
  ctx.y = runTable(ctx.doc, ctx.autoTable, config, ctx.y).finalY + 6;
}

function drawNotices(ctx: Ctx, notices: string[]) {
  const { doc } = ctx;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const lines = notices.flatMap((n) => doc.splitTextToSize(pdfText(n), CONTENT_W - 9) as string[]);
  const lineH = 3.9;
  const height = lines.length * lineH + 5;
  ensureSpace(ctx, height + 4);
  setColor(doc, COLOR.noticeBg, "fill");
  setColor(doc, COLOR.warning, "draw");
  doc.setLineWidth(0.2);
  doc.roundedRect(MARGIN, ctx.y, CONTENT_W, height, 1.5, 1.5, "FD");
  setColor(doc, COLOR.warning);
  lines.forEach((line, i) => doc.text(line, MARGIN + 4, ctx.y + 4.6 + i * lineH));
  ctx.y += height + 5;
}

// --- Sections ---------------------------------------------------------------

function drawHeader(ctx: Ctx, report: PortfolioReport) {
  const { doc } = ctx;
  setColor(doc, COLOR.accent, "fill");
  doc.rect(0, 0, PAGE_W, 2.2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  setColor(doc, COLOR.ink);
  doc.text("Live Portfolio", MARGIN, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, COLOR.muted);
  doc.text("MarketDesk  |  Open positions, live prices, risk & probability", MARGIN, 20.5);

  const meta: [string, string][] = [
    ["Generated", formatStampLong(report.generatedAt)],
    ["Prices as of", report.pricesAt ? formatStampLong(report.pricesAt) : "-"],
    ["Upstox synced", report.syncedAt ? formatStampLong(report.syncedAt) : "-"],
  ];
  meta.forEach(([label, value], i) => {
    const y = 9.5 + i * 4.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, COLOR.muted);
    doc.text(pdfText(label), PAGE_W - MARGIN - 62, y);
    doc.setFont("helvetica", "bold");
    setColor(doc, COLOR.ink);
    doc.text(pdfText(value), PAGE_W - MARGIN, y, { align: "right" });
  });

  setColor(doc, COLOR.line, "draw");
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 24.5, PAGE_W - MARGIN, 24.5);
  ctx.y = 29;
}

function drawSummary(ctx: Ctx, report: PortfolioReport) {
  const s = report.summary;
  sectionHeading(ctx, "Summary");
  drawCards(
    ctx,
    [
      { label: "Total Invested (Margin)", value: s.totalMargin === null ? "-" : rs(s.totalMargin), hint: "Blocked by Upstox" },
      { label: "Total Value", value: rs(s.totalValue), hint: "Open positions at current price" },
      {
        label: "Unrealized P&L",
        value: rs(s.unrealizedPnl),
        color: pnlColor(s.unrealizedPnl),
        hint: "Before brokerage",
      },
      {
        label: "Today's P&L",
        value: s.todayPnl === null ? "-" : rs(s.todayPnl),
        color: s.todayPnl === null ? undefined : pnlColor(s.todayPnl),
        hint: s.bookedToday !== 0 ? `incl. ${rs(s.bookedToday)} booked` : undefined,
      },
    ],
    4,
  );
  drawCards(
    ctx,
    [
      { label: "Open Positions", value: String(s.openPositions), hint: `${s.totalLots} lots | ${grouped.format(s.totalQuantity)} qty` },
      { label: "Brokerage if All Closed", value: rs(s.brokerageIfClosed), hint: "Round trip, at current prices" },
      {
        label: "Squared Off Today",
        value: String(s.closedTodayCount),
        hint: s.closedTodayPnl === null ? undefined : `Realised ${rs(s.closedTodayPnl)} before charges`,
      },
      {
        label: "Realised Today",
        value: s.closedTodayPnl === null ? "-" : rs(s.closedTodayPnl),
        color: s.closedTodayPnl === null ? undefined : pnlColor(s.closedTodayPnl),
        hint: "From positions closed today",
      },
    ],
    4,
  );
}

function drawPositions(ctx: Ctx, report: PortfolioReport) {
  const { positions, summary } = report;
  if (positions.length === 0) {
    sectionHeading(ctx, "Open positions", "0 positions");
    drawEmpty(ctx, "No open positions on the Upstox account right now.");
    return;
  }

  const live = (p: ReportPosition) => p.liveData === "Live";
  drawSectionTable(ctx, {
    title: "Open positions",
    aside: `${positions.length} position${positions.length === 1 ? "" : "s"}`,
    columns: [
      { header: "#", align: "center", width: 7 },
      { header: "Date", width: 15 },
      { header: "Instrument", width: 33 },
      { header: "Expiry", width: 15 },
      { header: "Side", width: 11 },
      { header: "Lots", align: "right", width: 10 },
      { header: "Qty", align: "right", width: 11 },
      { header: "Entry", align: "right", width: 15 },
      { header: "Live LTP", align: "right", width: 16 },
      { header: "Value", align: "right", width: 21 },
      { header: "Live P&L", align: "right", width: 21 },
      { header: "P&L %", align: "right", width: 14 },
      { header: "Margin", align: "right", width: 21 },
      { header: "Brokerage", align: "right", width: 21 },
      { header: "Live data", width: 42 },
    ],
    rows: positions.map((p) => [
      String(p.serial),
      formatShortDate(p.entryDate),
      { text: p.contract, bold: true },
      formatShortDate(p.expiry),
      p.side,
      String(p.lots),
      int(p.quantity),
      price(p.entryPrice),
      price(p.livePrice),
      rs(p.value),
      { text: p.pnl === null ? "-" : rs(p.pnl), color: pnlColor(p.pnl), bold: true },
      { text: p.pnlPct === null ? "-" : signed(p.pnlPct), color: pnlColor(p.pnlPct) },
      p.margin === null ? "-" : rs(p.margin),
      p.brokerageIfClosed === null ? "-" : rs(p.brokerageIfClosed),
      { text: p.liveData, color: live(p) ? undefined : COLOR.warning },
    ]),
    footer:
      positions.length > 1
        ? [
            "",
            "",
            "Total",
            "",
            "",
            String(summary.totalLots),
            int(summary.totalQuantity),
            "",
            "",
            rs(summary.totalValue),
            { text: rs(summary.unrealizedPnl), color: pnlColor(summary.unrealizedPnl) },
            "",
            summary.totalMargin === null ? "-" : rs(summary.totalMargin),
            rs(summary.brokerageIfClosed),
            "",
          ]
        : undefined,
  });
}

function drawGreeks(ctx: Ctx, report: PortfolioReport) {
  if (report.positions.length === 0) return;
  drawSectionTable(ctx, {
    title: "Greeks & market data",
    aside: "Per share, as reported by Upstox",
    columns: [
      { header: "#", align: "center", width: 7 },
      { header: "Instrument", width: 34 },
      { header: "Expiry", width: 20 },
      { header: "Side", width: 14 },
      { header: "Delta", align: "right" },
      { header: "Gamma", align: "right" },
      { header: "Theta", align: "right" },
      { header: "Vega", align: "right" },
      { header: "IV %", align: "right" },
      { header: "Open interest", align: "right" },
      { header: "Volume", align: "right" },
      { header: "Prev close", align: "right" },
      { header: "Underlying", align: "right" },
    ],
    rows: report.positions.map((p) => [
      String(p.serial),
      { text: p.contract, bold: true },
      formatShortDate(p.expiry),
      p.side,
      p.delta === null ? "-" : p.delta.toFixed(3),
      p.gamma === null ? "-" : p.gamma.toFixed(5),
      p.theta === null ? "-" : p.theta.toFixed(2),
      p.vega === null ? "-" : p.vega.toFixed(2),
      p.iv === null ? "-" : p.iv.toFixed(2),
      int(p.oi),
      int(p.volume),
      price(p.prevClose),
      groupedPrice(p.underlyingSpot),
    ]),
  });
}

function drawClosed(ctx: Ctx, closed: ReportClosed[]) {
  if (closed.length === 0) return;
  drawSectionTable(ctx, {
    title: "Closed today",
    aside: `${closed.length} squared off`,
    columns: [
      { header: "Instrument", width: 36 },
      { header: "Expiry", width: 22 },
      { header: "Lots", align: "right" },
      { header: "Buy avg", align: "right" },
      { header: "Sell avg", align: "right" },
      { header: "LTP", align: "right" },
      { header: "Realised P&L", align: "right" },
      { header: "Charges (est.)", align: "right" },
      { header: "Net P&L", align: "right" },
    ],
    rows: closed.map((c) => [
      { text: c.contract, bold: true },
      formatShortDate(c.expiry),
      String(c.lots),
      price(c.buyAvg),
      price(c.sellAvg),
      price(c.lastPrice),
      { text: rs(c.pnl), color: pnlColor(c.pnl), bold: true },
      c.charges === null ? "-" : rs(c.charges),
      { text: rs(c.netPnl), color: pnlColor(c.netPnl) },
    ]),
    footer:
      closed.length > 1
        ? [
            "Total",
            "",
            "",
            "",
            "",
            "",
            {
              text: rs(closed.reduce((s, c) => s + c.pnl, 0)),
              color: pnlColor(closed.reduce((s, c) => s + c.pnl, 0)),
            },
            rs(closed.reduce((s, c) => s + (c.charges ?? 0), 0)),
            {
              text: rs(closed.reduce((s, c) => s + c.netPnl, 0)),
              color: pnlColor(closed.reduce((s, c) => s + c.netPnl, 0)),
            },
          ]
        : undefined,
  });
}

function drawEmpty(ctx: Ctx, message: string) {
  const { doc } = ctx;
  ensureSpace(ctx, 14);
  setColor(doc, COLOR.line, "draw");
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.roundedRect(MARGIN, ctx.y, CONTENT_W, 10, 1.5, 1.5, "S");
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, COLOR.muted);
  doc.text(pdfText(message), PAGE_W / 2, ctx.y + 6.2, { align: "center" });
  ctx.y += 16;
}

function drawRisk(ctx: Ctx, risk: ReportRisk) {
  const { doc } = ctx;
  doc.addPage();
  ctx.y = MARGIN + 2;

  sectionHeading(
    ctx,
    "Risk & probability",
    `${risk.analysedCount} of ${risk.openCount} position${risk.openCount === 1 ? "" : "s"} analysed | as of ${formatStampLong(risk.asOf)}${risk.paused ? " (last good read)" : ""}`,
  );

  // Verdict pill + warning counts, straight under the heading.
  const verdictColor =
    risk.verdict === "High risk" ? COLOR.loss : risk.verdict === "Elevated" ? COLOR.warning : COLOR.profit;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const pillW = doc.getTextWidth(pdfText(risk.verdict.toUpperCase())) + 7;
  setColor(doc, verdictColor, "fill");
  doc.roundedRect(MARGIN, ctx.y, pillW, 6, 3, 3, "F");
  setColor(doc, COLOR.white);
  doc.text(pdfText(risk.verdict.toUpperCase()), MARGIN + pillW / 2, ctx.y + 4.2, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, COLOR.muted);
  doc.text(
    `${risk.criticalCount} critical  |  ${risk.warningCount} warning${risk.warningCount === 1 ? "" : "s"}`,
    MARGIN + pillW + 4,
    ctx.y + 4.2,
  );
  // The model's caveat sits on the same line, so the risk page keeps its room for the tables.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  setColor(doc, COLOR.muted);
  doc.text(pdfText(MODEL_NOTE), PAGE_W - MARGIN, ctx.y + 4.2, { align: "right" });
  ctx.y += 9;

  const pop = risk.chanceOfProfitPct;
  drawCards(
    ctx,
    [
      {
        label: "Chance of Profit",
        value: `${pop.toFixed(0)}%`,
        color: pop >= 50 ? COLOR.profit : pop < 30 ? COLOR.loss : COLOR.warning,
        hint: "At expiry, market-implied",
      },
      {
        label: "Nearest Expiry",
        value: risk.nearestDaysToExpiry === null ? "-" : formatDte(risk.nearestDaysToExpiry),
        color: risk.nearestDaysToExpiry !== null && risk.nearestDaysToExpiry <= 0 ? COLOR.loss : undefined,
        hint: risk.nearestExpiry ? formatDate(risk.nearestExpiry) : undefined,
      },
      {
        label: "Max Loss",
        value: risk.maxLoss === null ? "Unlimited" : `-${rs(risk.maxLoss)}`,
        color: COLOR.loss,
        hint: risk.worstCaseUsedPct !== null ? `${risk.worstCaseUsedPct}% of the worst case already used` : "Worst case at expiry",
      },
      {
        label: "Max Profit",
        value: risk.maxProfit === null ? "Unlimited" : rs(risk.maxProfit),
        color: COLOR.profit,
        hint: "Best case at expiry",
      },
      {
        label: "Risk : Reward",
        value: risk.riskPerReward === null ? "-" : `${risk.riskPerReward.toFixed(1)} : 1`,
        color: risk.riskPerReward !== null && risk.riskPerReward > 2 ? COLOR.warning : undefined,
        hint: risk.riskPerReward === null ? "One side is unbounded" : "Rs. risked per Rs. 1 of upside",
      },
    ],
    5,
  );
  drawCards(
    ctx,
    [
      { label: "Expected P&L", value: rs(risk.expectedPnl), color: pnlColor(risk.expectedPnl), hint: "Probability-weighted, at expiry" },
      {
        label: "Net Theta / Day",
        value: rs(risk.netThetaPerDay),
        color: pnlColor(risk.netThetaPerDay),
        hint: risk.netThetaPerDay >= 0 ? "Time decay is paying you" : "Time decay is costing you",
      },
      { label: "Market +1%", value: rs(risk.pnlIfMarketRises1Pct), color: pnlColor(risk.pnlIfMarketRises1Pct), hint: "P&L change if the index rises 1%" },
      { label: "Market -1%", value: rs(risk.pnlIfMarketFalls1Pct), color: pnlColor(risk.pnlIfMarketFalls1Pct), hint: "P&L change if the index falls 1%" },
      {
        label: "Worst Case Used",
        value: risk.worstCaseUsedPct === null ? "-" : `${risk.worstCaseUsedPct}%`,
        hint: "Unrealized loss vs max loss",
      },
    ],
    5,
  );

  drawSectionTable(ctx, {
    title: "Risk by position",
    columns: [
      { header: "Position", width: 31 },
      { header: "Side", width: 20 },
      { header: "Expiry", align: "right", width: 15 },
      { header: "Chance of profit", align: "right" },
      { header: "Moneyness", align: "right" },
      { header: "Breakeven", align: "right" },
      { header: "1 SD move", align: "right", width: 17 },
      { header: "Max loss", align: "right" },
      { header: "Max profit", align: "right" },
      { header: "Theta / day", align: "right" },
      { header: "Flag", width: 16 },
    ],
    rows: risk.positions.map((p) => [
      { text: p.contract + (p.ivEstimated ? " *" : ""), bold: true },
      p.side,
      { text: formatDte(p.daysToExpiry), color: p.daysToExpiry <= 0 ? COLOR.loss : p.daysToExpiry <= 2 ? COLOR.warning : undefined },
      {
        text: `${p.chanceOfProfitPct.toFixed(0)}%`,
        color: p.chanceOfProfitPct >= 50 ? COLOR.profit : p.chanceOfProfitPct < 30 ? COLOR.loss : COLOR.warning,
      },
      `${p.moneyness} ${p.moneynessPct.toFixed(1)}%`,
      `${p.breakeven.toFixed(0)} (${signed(p.breakevenMovePct)})`,
      `+/-${p.expectedMovePct.toFixed(1)}%`,
      { text: p.maxLoss === null ? "Unlimited" : rs(p.maxLoss), color: p.maxLoss === null ? COLOR.loss : undefined },
      p.maxProfit === null ? "Unlimited" : rs(p.maxProfit),
      { text: p.thetaPerDay === null ? "-" : rs(p.thetaPerDay), color: pnlColor(p.thetaPerDay) },
      { text: p.flag ?? "-", color: p.flag ? SEVERITY_COLOR[p.flag] : undefined, bold: !!p.flag },
    ]),
  });
  if (risk.positions.some((p) => p.ivEstimated)) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, COLOR.muted);
    doc.text("* Implied volatility estimated (Upstox sent none for this strike) - odds are approximate.", MARGIN, ctx.y - 3);
    ctx.y += 3;
  }

  if (risk.ranges.length > 0) {
    drawSectionTable(ctx, {
      title: "Range at expiry",
      aside: "Where each underlying must settle for the book to profit",
      columns: [
        { header: "Underlying", width: 28 },
        { header: "Expiry", width: 24 },
        { header: "Days left", align: "right" },
        { header: "Spot", align: "right" },
        { header: "1 SD low", align: "right" },
        { header: "1 SD high", align: "right" },
        { header: "Breakevens", align: "right" },
        { header: "P&L if settles at spot", align: "right" },
      ],
      rows: risk.ranges.map((g) => [
        { text: g.instrument, bold: true },
        formatDate(g.expiry),
        formatDte(g.daysToExpiry),
        groupedPrice(g.spot),
        groupedPrice(g.sigmaLow),
        groupedPrice(g.sigmaHigh),
        g.breakevens.length === 0 ? "-" : g.breakevens.map((b) => grouped.format(Math.round(b))).join("  /  "),
        { text: rs(g.pnlAtSpot), color: pnlColor(g.pnlAtSpot), bold: true },
      ]),
    });
  }

  if (risk.warnings.length === 0) {
    sectionHeading(ctx, "Warning signs");
    drawEmpty(ctx, "Nothing is flashing. No short strikes under pressure, no expiry-day exposure, and the odds aren't stacked against the book.");
  } else {
    drawSectionTable(ctx, {
      title: "Warning signs",
      columns: [
        { header: "Severity", width: 20 },
        { header: "Warning", width: 62 },
        { header: "Detail" },
      ],
      rows: risk.warnings.map((w) => [
        { text: w.severity, color: SEVERITY_COLOR[w.severity], bold: true },
        { text: w.title, bold: true },
        w.detail,
      ]),
    });
  }
}

function drawFooters(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    setColor(doc, COLOR.line, "draw");
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 10, PAGE_W - MARGIN, PAGE_H - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, COLOR.muted);
    doc.text("MarketDesk  |  Live Portfolio report", MARGIN, PAGE_H - 6);
    doc.text("Indicative figures, before brokerage unless stated. Not investment advice.", PAGE_W / 2, PAGE_H - 6, { align: "center" });
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 6, { align: "right" });
  }
}

// --- Entry point ------------------------------------------------------------

/** Renders the report to a PDF file. Loads the PDF libraries on first use. */
export async function buildPortfolioPdf(report: PortfolioReport): Promise<Blob> {
  const [{ jsPDF: JsPdf }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const newDoc = () => new JsPdf({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const doc = newDoc();
  doc.setProperties({
    title: "Live Portfolio",
    subject: `Live Portfolio report, ${formatStampLong(report.generatedAt)}`,
    creator: "MarketDesk",
  });

  const ctx: Ctx = { doc, autoTable: autoTableModule.default as unknown as AutoTable, newDoc, y: MARGIN };
  drawHeader(ctx, report);
  if (report.notices.length > 0) drawNotices(ctx, report.notices);
  drawSummary(ctx, report);
  drawPositions(ctx, report);
  drawGreeks(ctx, report);
  drawClosed(ctx, report.closedToday);
  if (report.risk) drawRisk(ctx, report.risk);
  drawFooters(doc);

  return doc.output("blob");
}
