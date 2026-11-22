import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOARD_SYMBOLS,
  CATEGORIES,
  SPARK_MAX,
  boardMood,
  buildBoard,
  byMoveDescending,
  commodityCategory,
  commodityTone,
  lotFacts,
  mcxSessionStatus,
  moveIntensity,
  pushTick,
  rangeGauge,
  sortEntries,
  sparkShape,
  summarize,
  topMovers,
  type BoardEntry,
} from "@/lib/commodityBoard";
import { COMMODITY_INSTRUMENTS, type CommodityInstrument } from "@/lib/types";
import { commodityItemKey, type WatchQuote } from "@/lib/watchlist";

function quote(price: number, changePct: number | null, extra: Partial<WatchQuote> = {}): WatchQuote {
  return {
    price,
    prevClose: changePct === null ? null : price / (1 + changePct / 100),
    change: changePct === null ? null : price - price / (1 + changePct / 100),
    changePct,
    open: null,
    high: null,
    low: null,
    volume: null,
    contract: null,
    ...extra,
  };
}

function entry(symbol: CommodityInstrument, changePct: number | null): BoardEntry {
  return { symbol, quote: quote(100, changePct) };
}

const at = (iso: string) => Date.parse(iso);

describe("sectors and looks", () => {
  it("puts every contract the app lists into a sector, energy first and base metals last", () => {
    assert.equal(BOARD_SYMBOLS.length, COMMODITY_INSTRUMENTS.length);
    for (const symbol of BOARD_SYMBOLS) assert.ok(CATEGORIES.includes(commodityCategory(symbol)), symbol);
    assert.equal(commodityCategory("CRUDEOIL"), "energy");
    assert.equal(commodityCategory("NATGASMINI"), "energy");
    assert.equal(commodityCategory("ELECDMBL"), "energy");
    assert.equal(commodityCategory("GOLDPETAL"), "precious");
    assert.equal(commodityCategory("SILVER100"), "precious");
    assert.equal(commodityCategory("ALUMINI"), "base");
    const order = BOARD_SYMBOLS.map(commodityCategory);
    assert.deepEqual(order, [...order].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)));
  });

  it("gives every contract a metal to be struck from", () => {
    for (const symbol of BOARD_SYMBOLS) {
      const tone = commodityTone(symbol);
      assert.match(tone.surface, /^linear-gradient\(/, symbol);
      assert.match(tone.ink, /^#[0-9a-f]{6}$/i, symbol);
      assert.match(tone.glow, /^#[0-9a-f]{6}$/i, symbol);
    }
    assert.equal(commodityTone("GOLD"), commodityTone("GOLDM"), "mini and full-size share a metal");
    assert.notEqual(commodityTone("GOLD"), commodityTone("SILVER"));
  });
});

describe("the lot", () => {
  it("values a gold lot by the kilogram it is, not the grams written on the small ones", () => {
    // Gold is quoted per 10 g; a lot is 1 kg = 100 of those. Gold Ten is one of them (10 g), Gold Guinea one 8 g quote.
    assert.equal(lotFacts("GOLD", 150_000).lotValue, 15_000_000);
    assert.equal(lotFacts("GOLDM", 150_000).lotValue, 1_500_000);
    assert.equal(lotFacts("GOLDTEN", 150_000).lotValue, 150_000);
    assert.equal(lotFacts("GOLDGUINEA", 120_000).lotValue, 120_000);
    assert.equal(lotFacts("GOLD", 150_000).contractSize, "1 kg");
  });

  it("uses the same multiplier every P&L figure in the app uses", () => {
    assert.equal(lotFacts("CRUDEOIL", 6_000).perRupee, 100);
    assert.equal(lotFacts("NATURALGAS", 300).lotValue, 375_000);
    assert.equal(lotFacts("COPPER", 900).lotValue, 2_250_000);
  });

  it("doesn't guess a contract size it doesn't know", () => {
    assert.equal(lotFacts("ELECDMBL", 5).contractSize, null);
    assert.equal(lotFacts("ELECDMBL", 5).lotValue, 5_000);
  });
});

describe("the board", () => {
  it("lines the quotes up with the contracts, whichever way they are keyed", () => {
    const board = buildBoard({ [commodityItemKey("GOLD")]: quote(1, 1), SILVER: quote(2, -1) });
    assert.equal(board.length, BOARD_SYMBOLS.length);
    assert.equal(board.find((e) => e.symbol === "GOLD")?.quote?.price, 1);
    assert.equal(board.find((e) => e.symbol === "SILVER")?.quote?.price, 2);
    assert.equal(board.find((e) => e.symbol === "COPPER")?.quote, undefined);
  });

  it("counts how a sector and the whole board are doing, and their average move", () => {
    const board: BoardEntry[] = [
      entry("CRUDEOIL", 1),
      entry("NATURALGAS", -3),
      { symbol: "ELECDMBL", quote: undefined },
      entry("GOLD", 0.001), // rounds to flat as shown
      entry("COPPER", 2),
    ];
    const energy = summarize(board, "energy");
    assert.deepEqual({ ...energy, avgPct: Math.round((energy.avgPct ?? 0) * 100) / 100 }, { count: 3, quoted: 2, up: 1, down: 1, flat: 0, avgPct: -1 });
    const all = summarize(board, "all");
    assert.deepEqual([all.count, all.quoted, all.up, all.down, all.flat], [5, 4, 2, 1, 1]);
    assert.equal(summarize(board, "precious").flat, 1);
  });

  it("has no average until something is quoted", () => {
    const empty = summarize([{ symbol: "GOLD", quote: undefined }], "all");
    assert.equal(empty.avgPct, null);
    assert.equal(empty.quoted, 0);
  });

  it("names the biggest riser and faller - and none when the whole board is flat", () => {
    const { gainer, loser } = topMovers([entry("CRUDEOIL", 0.4), entry("GOLD", 1.2), entry("SILVER", -0.8), entry("COPPER", -0.2)]);
    assert.equal(gainer?.symbol, "GOLD");
    assert.equal(loser?.symbol, "SILVER");
    const flat = topMovers([entry("GOLD", 0), entry("SILVER", 0.001)]);
    assert.deepEqual([flat.gainer, flat.loser], [null, null]);
  });

  it("gives a tie to the first listed (the full-size contract), not the mini behind it", () => {
    assert.equal(topMovers([entry("GOLD", 1), entry("GOLDM", 1)]).gainer?.symbol, "GOLD");
  });
});

describe("the board's mood", () => {
  it("leans a way only once the average move is big enough to mean something", () => {
    assert.equal(boardMood(0.6), "up");
    assert.equal(boardMood(-0.6), "down");
    assert.equal(boardMood(-0.07), "flat", "a near-flat market isn't painted red");
    assert.equal(boardMood(0.149), "flat");
    assert.equal(boardMood(0.15), "up");
    assert.equal(boardMood(null), "flat");
  });
});

describe("sorting", () => {
  const board: BoardEntry[] = [
    entry("CRUDEOIL", 0.5),
    { symbol: "NATURALGAS", quote: undefined },
    entry("GOLD", 2),
    entry("SILVER", -1),
    entry("COPPER", 0.5),
  ];

  it("keeps the listed order by default", () => {
    assert.deepEqual(sortEntries(board, "default").map((e) => e.symbol), ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER", "COPPER"]);
  });

  it("ranks the biggest risers first, ties in listed order, the unquoted last", () => {
    assert.deepEqual(sortEntries(board, "gainers").map((e) => e.symbol), ["GOLD", "CRUDEOIL", "COPPER", "SILVER", "NATURALGAS"]);
  });

  it("ranks the biggest fallers first, the unquoted still last", () => {
    assert.deepEqual(sortEntries(board, "losers").map((e) => e.symbol), ["SILVER", "CRUDEOIL", "COPPER", "GOLD", "NATURALGAS"]);
  });

  it("doesn't reorder the list it was given", () => {
    const before = board.map((e) => e.symbol);
    sortEntries(board, "gainers");
    assert.deepEqual(board.map((e) => e.symbol), before);
  });

  it("orders the mosaic strip from the strongest riser to the strongest faller", () => {
    assert.deepEqual(byMoveDescending(board).map((e) => e.symbol), ["GOLD", "CRUDEOIL", "COPPER", "SILVER", "NATURALGAS"]);
  });
});

describe("mosaic colour", () => {
  it("scales a move against the biggest one, never fainter than a floor", () => {
    assert.equal(moveIntensity(2, 2), 1);
    assert.equal(moveIntensity(-1, 2), 0.5);
    assert.equal(moveIntensity(0.1, 2), 0.28);
  });

  it("leaves a flat or missing move uncoloured", () => {
    assert.equal(moveIntensity(0, 2), 0);
    assert.equal(moveIntensity(0.001, 2), 0);
    assert.equal(moveIntensity(null, 2), 0);
  });

  it("still colours a move when the whole board has barely moved", () => {
    assert.equal(moveIntensity(0.05, 0), 0.5);
  });
});

describe("market hours", () => {
  it("is open through a weekday, into the night", () => {
    assert.equal(mcxSessionStatus(at("2026-11-23T10:00:00+05:30")).open, true); // a Monday
    assert.equal(mcxSessionStatus(at("2026-11-23T23:40:00+05:30")).open, true);
  });

  it("says when tonight's session ends: 23:55 once US clocks have gone back", () => {
    assert.equal(mcxSessionStatus(at("2026-11-23T10:00:00+05:30")).closesAt, "23:55");
    assert.equal(mcxSessionStatus(at("2026-07-14T10:00:00+05:30")).closesAt, "23:30");
  });

  it("is closed after the close, before the open, and at the weekend", () => {
    assert.equal(mcxSessionStatus(at("2026-11-23T23:56:00+05:30")).open, false);
    assert.equal(mcxSessionStatus(at("2026-11-23T08:30:00+05:30")).open, false);
    assert.equal(mcxSessionStatus(at("2026-11-21T12:00:00+05:30")).open, false); // a Saturday
  });

  it("reads the date in India, not where the clock is", () => {
    // 23:00 UTC on a Sunday is already 04:30 on Monday in India - before the open, but a weekday.
    assert.equal(mcxSessionStatus(at("2026-11-22T23:00:00Z")).open, false);
    // 04:00 UTC on a Monday is 09:30 in India: open.
    assert.equal(mcxSessionStatus(at("2026-11-23T04:00:00Z")).open, true);
  });
});

describe("the live trace", () => {
  it("keeps the latest ticks and drops the oldest", () => {
    assert.deepEqual(pushTick(undefined, 5), [5]);
    assert.deepEqual(pushTick([1, 2, 3], 4, 3), [2, 3, 4]);
    let history: number[] | undefined;
    for (let i = 0; i < SPARK_MAX + 25; i++) history = pushTick(history, i);
    assert.equal(history?.length, SPARK_MAX);
    assert.equal(history?.[SPARK_MAX - 1], SPARK_MAX + 24);
  });

  it("draws nothing until there are two prices", () => {
    assert.equal(sparkShape([], 100, 40), null);
    assert.equal(sparkShape([5], 100, 40), null);
  });

  it("draws a line from the left edge to the right, rising prices rising on the screen", () => {
    const shape = sparkShape([100, 101, 102, 103], 100, 40, 2, 0);
    assert.ok(shape);
    assert.ok(shape.line.startsWith("M2.0,"));
    assert.equal(shape.end.x, 98);
    const startY = Number(shape.line.slice(1).split(",")[1].split(/[A-Z]/)[0]);
    assert.ok(shape.end.y < startY, "the end is higher up the box (smaller y) than the start");
    assert.equal(shape.end.y, 2);
    assert.ok(shape.area.endsWith("Z"));
  });

  it("sits a flat trace in the middle as a flat line", () => {
    const shape = sparkShape([50, 50, 50], 100, 40, 2);
    assert.ok(shape);
    assert.ok(Math.abs(shape.end.y - 20) < 1e-6, `expected the middle of a 40px box, was ${shape.end.y}`);
  });

  it("won't stretch a tiny wobble into a crash", () => {
    const wobble = sparkShape([1000, 1000.05, 1000], 100, 40, 2);
    assert.ok(wobble);
    const middle = Number(wobble.line.match(/Q[\d.]+,([\d.]+)/)?.[1]);
    assert.ok(Math.abs(middle - 20) < 4, `a 0.005% wobble stays near the middle, was ${middle}`);
  });
});

describe("the day-range gauge", () => {
  it("places the price and yesterday's close between today's low and high", () => {
    const gauge = rangeGauge(quote(150, 1, { low: 100, high: 200, prevClose: 125 }));
    assert.deepEqual(gauge, { price: 0.5, reference: 0.25, direction: "up" });
  });

  it("pins a close outside today's range to the nearest edge (a gap)", () => {
    assert.equal(rangeGauge(quote(150, 1, { low: 100, high: 200, prevClose: 60 }))?.reference, 0);
  });

  it("has no gauge without a range", () => {
    assert.equal(rangeGauge(quote(150, 1)), null);
    assert.equal(rangeGauge(quote(150, 1, { low: 100, high: 100 })), null);
  });

  it("has no reference without a previous close", () => {
    const q = quote(150, null, { low: 100, high: 200 });
    assert.equal(rangeGauge(q)?.reference, null);
    assert.equal(rangeGauge(q)?.direction, "flat");
  });
});
