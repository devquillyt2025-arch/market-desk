/**
 * The Global indices table at the top of the Global markets tab: which ten rows, in what order, from which source, and how a
 * row is built from an Upstox quote or a Yahoo level. The figures are the real ones from 17 Nov 2026 around 20:50 IST.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGlobalTopRows,
  DOW_FUTURES_KEY,
  GLOBAL_TOP_TABLE,
  GLOBAL_TOP_UPSTOX_ITEMS,
  GLOBAL_TOP_YAHOO_IDS,
} from "@/lib/globalIndicesTable";
import { parseWatchRequest } from "@/lib/upstox/watchQuotes";
import { GIFT_NIFTY_KEY, type WatchQuote } from "@/lib/watchlist";
import { WORLD_INDICES, type WorldQuote } from "@/lib/worldIndices";

const NOW = Date.parse("2026-11-17T15:20:00Z"); // 20:50 IST

const GIFT: WatchQuote = {
  price: 25379.5,
  prevClose: 25378,
  change: 1.5,
  changePct: (1.5 / 25378) * 100,
  open: 25289,
  high: 25558.5,
  low: 25256.5,
  volume: null,
  asOf: Date.parse("2026-11-17T15:18:59Z"),
  contract: null,
};
const DOW_FUT: WatchQuote = {
  ...GIFT,
  price: 51206.1,
  prevClose: 51610.3,
  change: -404.2,
  changePct: (-404.2 / 51610.3) * 100,
  open: 51593.6,
  high: 51664.6,
  low: 51136,
  asOf: Date.parse("2026-11-17T15:18:56Z"),
};
const NIKKEI: WorldQuote = {
  id: "^N225",
  price: 58860.43,
  previousClose: 59662.02,
  asOf: Date.parse("2026-11-17T06:45:00Z"),
  dayHigh: 59369.14,
  dayLow: 58691.11,
  open: 59295.8,
  sessionStart: Date.parse("2026-11-17T00:00:00Z"),
  sessionEnd: Date.parse("2026-11-17T06:30:00Z"),
};

describe("the table's rows", () => {
  it("are ten, in the order of the Global indices list: GIFT Nifty first, then the Dow, its futures, the S&P 500 ...", () => {
    assert.equal(GLOBAL_TOP_TABLE.length, 10);
    const rows = buildGlobalTopRows({}, {}, NOW);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["GIFT Nifty", "Dow Jones", "Dow Futures", "S&P 500", "Nikkei 225", "Hang Seng", "DAX", "CAC 40", "KOSPI", "FTSE 100"],
    );
    assert.equal(new Set(rows.map((r) => r.key)).size, 10);
  });

  it("come from Upstox for GIFT Nifty and the Dow futures, and from Yahoo for the other eight", () => {
    const rows = buildGlobalTopRows({}, {}, NOW);
    assert.deepEqual(rows.filter((r) => r.source === "upstox").map((r) => r.name), ["GIFT Nifty", "Dow Futures"]);
    assert.equal(rows.filter((r) => r.source === "yahoo").length, 8);
    assert.equal(GLOBAL_TOP_YAHOO_IDS.size, 8);
  });

  it("name Yahoo indices that the world list really has, so the feed will quote them", () => {
    for (const id of GLOBAL_TOP_YAHOO_IDS) assert.ok(WORLD_INDICES.some((d) => d.id === id), id);
  });

  it("send the server only keys it will agree to quote", () => {
    assert.deepEqual(GLOBAL_TOP_UPSTOX_ITEMS.map((i) => i.itemKey), [GIFT_NIFTY_KEY, DOW_FUTURES_KEY]);
    const parsed = parseWatchRequest({ items: GLOBAL_TOP_UPSTOX_ITEMS.map(({ itemKey, kind, symbol }) => ({ itemKey, kind, symbol })) });
    assert.ok(parsed !== null && parsed.length === 2);
    assert.equal(new Set(GLOBAL_TOP_UPSTOX_ITEMS.map((i) => i.id)).size, 2);
  });
});

describe("building a row", () => {
  const rows = buildGlobalTopRows({ "^N225": NIKKEI }, { [GIFT_NIFTY_KEY]: GIFT, [DOW_FUTURES_KEY]: DOW_FUT }, NOW);
  const byKey = (key: string) => rows.find((r) => r.key === key)!;

  it("takes an Upstox quote as it is: price, change, range, open, previous close and when it traded", () => {
    const gift = byKey("gift");
    assert.deepEqual(
      [gift.price, gift.previousClose, gift.change, gift.high, gift.low, gift.open, gift.asOf],
      [25379.5, 25378, 1.5, 25558.5, 25256.5, 25289, GIFT.asOf],
    );
    assert.ok(Math.abs((gift.changePct ?? 0) - 0.00591) < 1e-4);
    const dow = byKey("dow-futures");
    assert.deepEqual([dow.price, dow.change, dow.open, dow.previousClose], [51206.1, -404.2, 51593.6, 51610.3]);
  });

  it("works a Yahoo index's move out from its previous close", () => {
    const nikkei = byKey("^N225");
    assert.equal(nikkei.name, "Nikkei 225");
    assert.equal(nikkei.code, "JP");
    assert.ok(Math.abs((nikkei.change ?? 0) - (58860.43 - 59662.02)) < 1e-9);
    assert.ok(Math.abs((nikkei.changePct ?? 0) - (-801.59 / 59662.02) * 100) < 1e-4);
    assert.deepEqual([nikkei.high, nikkei.low, nikkei.open, nikkei.previousClose], [59369.14, 58691.11, 59295.8, 59662.02]);
  });

  it("calls a market live when it traded within the last 40 minutes (and Yahoo's window is on), shut otherwise", () => {
    assert.equal(byKey("gift").live, true); // traded a minute ago
    assert.equal(byKey("dow-futures").live, true);
    assert.equal(byKey("^N225").live, false); // Tokyo closed hours ago
    assert.equal(buildGlobalTopRows({}, { [GIFT_NIFTY_KEY]: { ...GIFT, asOf: NOW - 2 * 3_600_000 } }, NOW)[0].live, false);
  });

  it("leaves a row empty, not zero, while its source has nothing for it", () => {
    for (const key of ["^DJI", "^GSPC", "^FTSE"]) {
      const row = byKey(key);
      assert.deepEqual(
        [row.price, row.change, row.changePct, row.high, row.low, row.open, row.previousClose, row.asOf, row.live],
        [null, null, null, null, null, null, null, null, null],
        key,
      );
      assert.ok(row.name.length > 0);
    }
  });

  it("copes with an Upstox quote saved before trade times were kept, and a Yahoo level saved before opens were", () => {
    const old = { ...GIFT } as Partial<WatchQuote>;
    delete old.asOf;
    const noOpen = { ...NIKKEI } as Partial<WorldQuote>;
    delete noOpen.open;
    const built = buildGlobalTopRows({ "^N225": noOpen as WorldQuote }, { [GIFT_NIFTY_KEY]: old as WatchQuote }, NOW);
    assert.deepEqual([built[0].asOf, built[0].live, built[0].price], [null, null, 25379.5]);
    assert.equal(built.find((r) => r.key === "^N225")!.open, null);
  });

  it("gives no move for a Yahoo index without a previous close", () => {
    const row = buildGlobalTopRows({ "^N225": { ...NIKKEI, previousClose: null } }, {}, NOW).find((r) => r.key === "^N225")!;
    assert.deepEqual([row.price, row.change, row.changePct], [58860.43, null, null]);
  });
});
