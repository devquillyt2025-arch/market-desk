/**
 * Sync Upstox's plan for Trade Entries, for an index future - the real Nifty Dec future closed on 18 Nov 2026
 * (2 lots, sold 17 Nov at 25,575, bought back 18 Nov at 25,400, +22,750): a future has no strike or CE/PE.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planTradeImport } from "@/lib/upstoxSync";
import type { TradeEntry } from "@/lib/types";
import type { UpstoxClosedTrade } from "@/lib/upstox/types";

const FUTURE_TRADE: UpstoxClosedTrade = {
  key: "NIFTY|2026-12-29|FUT||18-11-2026|17-11-2026",
  instrument: "NIFTY",
  strike: null,
  optionType: null,
  expiry: "2026-12-29",
  side: "sell",
  entryDate: "2026-11-17",
  closingDate: "2026-11-18",
  quantity: 130,
  lots: 2,
  buyPrice: 25400,
  sellPrice: 25575,
  pnl: 22750,
};

const REPORT = { from: "2026-04-01", to: "2027-03-31", trades: [FUTURE_TRADE] };

function journalFuture(over: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id: "e1",
    user_id: null,
    entry_date: "2026-11-17",
    instrument: "NIFTY",
    strike_price: null,
    option_type: null,
    expiry_date: "2026-12-29",
    closing_date: "2026-11-18",
    lots: 2,
    side: "sell",
    buy_price: 25400,
    sell_price: 25575,
    pnl: 22750,
    status: "squared_off",
    remarks: null,
    created_at: "2026-11-18T10:00:00Z",
    updated_at: "2026-11-18T10:00:00Z",
    ...over,
  };
}

describe("Sync Upstox for an index future", () => {
  it("offers a future the journal doesn't have as a new trade", () => {
    const { items, missing } = planTradeImport([], REPORT, "2026-11-20");
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "new");
    assert.equal(missing.length, 0);
  });

  it("recognises a future already in the journal", () => {
    const { items } = planTradeImport([journalFuture()], REPORT, "2026-11-20");
    assert.equal(items[0].kind, "same");
  });

  it("does not take a Nifty option of the same lots and prices for the future", () => {
    const option = journalFuture({ strike_price: 25400, option_type: "PE" });
    assert.equal(planTradeImport([option], REPORT, "2026-11-20").items[0].kind, "new");
  });

  it("keeps an entry's own expiry when the report couldn't date the future", () => {
    const undated = { ...REPORT, trades: [{ ...FUTURE_TRADE, expiry: null }] };
    assert.equal(planTradeImport([journalFuture()], undated, "2026-11-20").items[0].kind, "same");
    // ...but a wrong expiry is still flagged when the report does know it.
    const [item] = planTradeImport([journalFuture({ expiry_date: "2026-11-24" })], REPORT, "2026-11-20").items;
    assert.equal(item.kind, "update");
    assert.deepEqual(item.kind === "update" ? item.changes : [], ["expiry"]);
  });
});
