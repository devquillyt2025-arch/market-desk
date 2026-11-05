import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { analyzeRisk, normCdf, yearsToExpiry } from "@/lib/calculateRisk";
import { DEFAULT_LOT_SIZES, type TradeEntry } from "@/lib/types";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import {
  applyChanges,
  buildBook,
  builderChanges,
  describeChanges,
  buildComparisonCurve,
  buildMoveTable,
  buildUnderlyings,
  evaluate,
  generateActions,
  highlights,
  marginBasket,
  rankMoves,
  runLab,
  RISK_BUDGET,
  type Change,
  type Underlying,
} from "@/lib/whatIf";

const NOW = Date.parse("2026-11-05T05:00:00Z"); // Thursday 10:30 IST
const EXPIRY = "2026-11-10";
const KEY = `NIFTY|${EXPIRY}`;
const SPOT = 24000;
const LOT = DEFAULT_LOT_SIZES.NIFTY;

// --- fixtures: a coherent option chain (zero-rate Black-Scholes at 14% vol) -----------------

function bs(strike: number, isCall: boolean, ivPct = 14): number {
  const t = yearsToExpiry(EXPIRY, new Date(NOW));
  const sd = (ivPct / 100) * Math.sqrt(t);
  const d1 = (Math.log(SPOT / strike) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  return isCall ? SPOT * normCdf(d1) - strike * normCdf(d2) : strike * normCdf(-d2) - SPOT * normCdf(-d1);
}

function chain(): UpstoxOptionChainResult {
  const data = [];
  for (let strike = 23000; strike <= 25000; strike += 50) {
    const leg = (isCall: boolean) => ({
      instrument_key: `NSE_FO|${strike}${isCall ? "C" : "P"}`,
      market_data: { ltp: Math.round(bs(strike, isCall) * 20) / 20 || 0.05, oi: 200_000, volume: 1000 },
      option_greeks: { iv: 14, delta: isCall ? 0.5 : -0.5, gamma: 0.001, theta: -10, vega: 8 },
    });
    data.push({ strike_price: strike, underlying_spot_price: SPOT, call_options: leg(true), put_options: leg(false) });
  }
  return { status: "success", data };
}

const CHAINS = { [KEY]: chain() };

function ltpOf(strike: number, isCall: boolean): number {
  return Math.round(bs(strike, isCall) * 20) / 20;
}

let seq = 0;
function entry(over: Partial<TradeEntry>): TradeEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: null,
    entry_date: "2026-11-02",
    instrument: "NIFTY",
    strike_price: 24000,
    option_type: "CE",
    expiry_date: EXPIRY,
    closing_date: null,
    lots: 4,
    side: "buy",
    buy_price: 180,
    sell_price: 180,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-02T04:00:00Z",
    updated_at: "2026-11-02T04:00:00Z",
    ...over,
  };
}

function row(over: Partial<TradeEntry>, entryPrice: number): PortfolioRow {
  const e = entry({ ...over, buy_price: entryPrice, sell_price: entryPrice });
  const isCall = e.option_type === "CE";
  const ltp = ltpOf(e.strike_price!, isCall);
  return {
    entry: e,
    entryPrice,
    status: "ok",
    instrumentKey: `NSE_FO|${e.strike_price}${isCall ? "C" : "P"}`,
    liveLtp: ltp,
    livePnl: 0,
    prevClose: ltp,
    delta: isCall ? 0.5 : -0.5,
    gamma: 0.001,
    theta: -10,
    vega: 8,
    oi: 200_000,
    iv: 14,
    volume: 1000,
    underlyingSpot: SPOT,
    nearbyIv: 14,
    brokerageIfClosed: 40,
    stale: false,
    asOf: null,
  };
}

const longCall = () => row({ strike_price: 24000, option_type: "CE", lots: 4, side: "buy" }, 180);
const shortCall = () => row({ strike_price: 24200, option_type: "CE", lots: 2, side: "sell" }, 90);

function setup(rows: PortfolioRow[], funds: number | null = null) {
  const book = buildBook(rows, NOW);
  const unders = buildUnderlyings(CHAINS, NOW);
  return { book, unders, funds, focusKey: KEY };
}

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// --- the chain ---------------------------------------------------------------------------------

describe("buildUnderlyings", () => {
  it("reads spot, the at-the-money strike and every quoted contract", () => {
    const [u] = buildUnderlyings(CHAINS, NOW);
    assert.equal(u.key, KEY);
    assert.equal(u.spot, SPOT);
    assert.equal(u.atm, 24000);
    assert.equal(u.lotSize, LOT);
    assert.equal(u.dte, 5);
    assert.ok(u.byContract.get("CE|24000"));
    assert.equal(u.byContract.get("CE|24000")?.instrumentKey, "NSE_FO|24000C");
  });

  it("leaves out chains that errored or whose expiry has passed", () => {
    const chains = { [KEY]: { error: "token_expired" }, "NIFTY|2026-11-03": chain() } as Record<string, UpstoxOptionChainResult>;
    assert.deepEqual(buildUnderlyings(chains, NOW), []);
  });

  it("skips contracts with no price", () => {
    const c = chain();
    if (!("data" in c)) throw new Error("fixture");
    c.data[0].call_options!.market_data!.ltp = 0;
    const [u] = buildUnderlyings({ [KEY]: c }, NOW);
    assert.equal(u.byContract.get("CE|23000"), undefined);
    assert.ok(u.byContract.get("PE|23000"));
  });
});

// --- the baseline matches the Risk tab ------------------------------------------------------------

describe("the baseline", () => {
  it("is the Risk & Probability tab's own read of the book", () => {
    const rows = [longCall(), shortCall()];
    const risk = analyzeRisk(rows, { now: new Date(NOW), totalMargin: null, unrealizedPnl: 0 });
    assert.ok(risk);
    const base = evaluate(buildBook(rows, NOW).legs);
    near(base.pop, risk.pop);
    near(base.expectedPnl, risk.expectedPnl, 1e-4);
    assert.equal(base.maxLoss, risk.maxLoss);
    assert.equal(base.maxProfit, risk.maxProfit);
  });

  it("counts positions it can't model instead of guessing", () => {
    const loading: PortfolioRow = { ...longCall(), status: "loading", liveLtp: null };
    assert.equal(buildBook([longCall(), loading], NOW).skipped, 1);
  });
});

// --- applying a move --------------------------------------------------------------------------------

describe("applyChanges", () => {
  it("selling 2 of 4 lots banks their P&L at the live price and keeps 2 running", () => {
    const { book, unders } = setup([longCall()]);
    const id = book.legs[0].id;
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: id, lots: 2 }]);
    const ltp = ltpOf(24000, true);
    near(applied.booked, (ltp - 180) * 2 * LOT, 1e-6);
    assert.equal(applied.legs.length, 1);
    assert.equal(applied.legs[0].lots, 2);
    assert.equal(applied.legs[0].qty, 2 * LOT);
    assert.ok(applied.charges > 0);
    near(applied.pnlOffset, applied.booked - applied.charges, 1e-9);
    near(applied.cash, ltp * 2 * LOT, 1e-6);
  });

  it("buying back a short books the opposite sign", () => {
    const { book, unders } = setup([shortCall()]);
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: book.legs[0].id, lots: 1 }]);
    const ltp = ltpOf(24200, true);
    near(applied.booked, (90 - ltp) * LOT, 1e-6);
    near(applied.cash, -ltp * LOT, 1e-6);
  });

  it("never exits more lots than are held", () => {
    const { book, unders } = setup([longCall()]);
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: book.legs[0].id, lots: 99 }]);
    assert.equal(applied.legs.length, 0);
    near(applied.booked, (ltpOf(24000, true) - 180) * 4 * LOT, 1e-6);
  });

  it("opening a new option enters it at the live price", () => {
    const { book, unders } = setup([longCall()]);
    const change: Change = { kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24100, lots: 2 };
    const applied = applyChanges(book, unders, [change]);
    const added = applied.legs.find((l) => !l.held);
    assert.ok(added);
    near(added.premium, ltpOf(24100, true));
    assert.equal(added.qty, 2 * LOT);
    near(applied.cash, -ltpOf(24100, true) * 2 * LOT, 1e-6);
  });

  it("flags a contract with no live quote rather than inventing one", () => {
    const { book, unders } = setup([longCall()]);
    const applied = applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 99999, lots: 1 }]);
    assert.equal(applied.problems.length, 1);
    assert.equal(applied.legs.length, 1);
  });
});

// --- evaluating ------------------------------------------------------------------------------------------

describe("evaluate", () => {
  it("a book fully exited has only the booked P&L left", () => {
    const { book, unders } = setup([longCall()]);
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: book.legs[0].id, lots: 4 }]);
    const out = evaluate(applied.legs, applied.pnlOffset);
    assert.equal(out.pop, applied.pnlOffset > 0 ? 1 : 0);
    near(out.expectedPnl, applied.pnlOffset, 1e-6);
    near(out.maxLoss ?? NaN, Math.max(-applied.pnlOffset, 0), 1e-6);
    near(out.p5, applied.pnlOffset, 1e-6);
  });

  it("adding lots at the live price raises the worst case by exactly the premium paid", () => {
    const { book, unders } = setup([longCall()]);
    const base = evaluate(book.legs);
    const applied = applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24000, lots: 2 }]);
    const next = evaluate(applied.legs, applied.pnlOffset);
    const premium = ltpOf(24000, true) * 2 * LOT;
    near((next.maxLoss ?? NaN) - (base.maxLoss ?? NaN), premium + applied.charges, 1e-6);
  });

  it("selling a naked call from a long-only book is open-ended; a call spread is not", () => {
    const { book, unders } = setup([longCall()]);
    const naked = evaluate(
      applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "sell", type: "CE", strike: 24500, lots: 6 }]).legs,
    );
    assert.equal(naked.maxLoss, null);
    const spreadApplied = applyChanges(book, unders, [
      { kind: "open", groupKey: KEY, side: "sell", type: "CE", strike: 24300, lots: 1 },
      { kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24400, lots: 1 },
    ]);
    const spread = evaluate(spreadApplied.legs, spreadApplied.pnlOffset);
    assert.notEqual(spread.maxLoss, null);
  });

  it("buying a farther call caps a short call's unlimited loss", () => {
    const { book, unders } = setup([shortCall()]);
    assert.equal(evaluate(book.legs).maxLoss, null);
    const applied = applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24500, lots: 2 }]);
    assert.notEqual(evaluate(applied.legs, applied.pnlOffset).maxLoss, null);
  });

  it("probability and spread are internally consistent", () => {
    const { book } = setup([longCall(), shortCall()]);
    const o = evaluate(book.legs);
    assert.ok(o.pop >= 0 && o.pop <= 1);
    assert.ok(o.p5 <= o.p95);
    assert.ok(o.avgWin === null || o.avgWin > 0);
    assert.ok(o.avgLoss === null || o.avgLoss < 0);
  });
});

// --- generating and ranking ---------------------------------------------------------------------------------

describe("generateActions", () => {
  it("offers the moves a trader would think of: sell 2 of 4, add 2, sell 2 calls, buy 4 calls", () => {
    const { book, unders } = setup([longCall()]);
    const id = book.legs[0].id;
    const ids = new Set(generateActions(book, unders, KEY).map((a) => a.id));
    assert.ok(ids.has(`reduce:${id}:2`), "sell 2 of 4");
    assert.ok(ids.has(`reduce:${id}:4`), "sell all");
    assert.ok(ids.has(`add:${id}:2`), "add 2 to 4");
    assert.ok([...ids].some((x) => /^sell:CE:\d+:2$/.test(x)), "sell 2 calls");
    assert.ok([...ids].some((x) => /^buy:CE:\d+:4$/.test(x)), "buy 4 calls");
    assert.ok([...ids].some((x) => x.startsWith("spread:")), "spreads");
    assert.ok(ids.has("book:flat"));
  });

  it("has unique ids and only offers contracts that have a quote", () => {
    const { book, unders } = setup([longCall(), shortCall()]);
    const actions = generateActions(book, unders, KEY);
    assert.equal(new Set(actions.map((a) => a.id)).size, actions.length);
    const lab = runLab({ book, unders, focusKey: KEY, funds: null });
    // Moves that leave exactly the same book (e.g. "sell all" and "square off everything" on one position) count once.
    assert.ok(lab.moves.length > 0 && lab.moves.length <= actions.length);
    const sigs = lab.moves.map((m) => `${Math.round(m.applied.pnlOffset)}|${m.applied.legs.map((l) => `${l.label}:${l.isShort}:${l.lots}`).sort().join(",")}`);
    assert.equal(new Set(sigs).size, sigs.length);
  });

  it("never proposes a fresh order on a contract that is already held — that is adding or exiting", () => {
    const { book, unders } = setup([longCall()]);
    const actions = generateActions(book, unders, KEY);
    const onHeld = actions.filter(
      (a) => (a.family === "buy" || a.family === "sell") && a.changes.some((c) => c.kind === "open" && c.type === "CE" && c.strike === 24000),
    );
    assert.deepEqual(onHeld, []);
    const spreadOnHeld = actions.filter(
      (a) => a.family === "spread" && a.changes.some((c) => c.kind === "open" && c.type === "CE" && c.strike === 24000),
    );
    assert.deepEqual(spreadOnHeld, []);
  });

  it("offers a protective wing beyond a held short strike", () => {
    const { book, unders } = setup([shortCall()]); // short 24200 CE
    const wings = generateActions(book, unders, KEY).filter(
      (a) => a.family === "buy" && a.changes.some((c) => c.kind === "open" && c.type === "CE" && c.strike >= 24500),
    );
    assert.ok(wings.length > 0, "a call far above the short strike should be on offer");
  });

  it("with no live chain, still offers exits but no new trades", () => {
    const { book } = setup([longCall()]);
    const actions = generateActions(book, [], null);
    assert.ok(actions.length > 0);
    assert.ok(actions.every((a) => a.family === "reduce" || a.family === "book"));
  });
});

describe("rankMoves", () => {
  function lab(rows: PortfolioRow[], funds: number | null = null) {
    return runLab({ ...setup(rows, funds) });
  }

  it("lists only moves that beat standing still, best first", () => {
    const { moves } = lab([longCall(), shortCall()]);
    for (const goal of ["balanced", "safer", "odds", "upside"] as const) {
      const ranked = rankMoves(moves, { goal, family: "all", allowOpenEnded: false });
      assert.ok(ranked.every((m) => m.score[goal] > 0));
      for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score[goal] >= ranked[i].score[goal]);
    }
  });

  it("keeps open-ended risk out unless asked", () => {
    // Long puts have no calls to cover a sold call, so any call sale is naked.
    const { moves } = lab([row({ strike_price: 23800, option_type: "PE", lots: 6, side: "buy" }, 120)]);
    const without = rankMoves(moves, { goal: "odds", family: "all", allowOpenEnded: false, limit: 500 });
    assert.ok(without.every((m) => !m.createsOpenEnded));
    const nakedCalls = moves.filter((m) => m.createsOpenEnded);
    assert.ok(nakedCalls.length > 0, "the generator does offer naked sells; they're just not recommended by default");
    const asked = rankMoves(moves, { goal: "odds", family: "all", allowOpenEnded: true, limit: 500 });
    assert.ok(asked.length >= without.length);
  });

  it("does not reward adding leverage: buying more of what you hold is not 'Best overall'", () => {
    const { moves } = lab([longCall()]);
    for (const m of rankMoves(moves, { goal: "balanced", family: "all", allowOpenEnded: false, limit: 500 })) {
      assert.ok(m.action.family !== "add" && m.action.family !== "buy", `${m.action.headline} should not rank as a balanced improvement`);
    }
  });

  it("keeps every goal but 'Cut my loss' inside the risk budget", () => {
    const { moves, base, scale } = lab([longCall()]);
    for (const goal of ["balanced", "odds", "upside"] as const) {
      for (const m of rankMoves(moves, { goal, family: "all", allowOpenEnded: true, limit: 500 })) {
        assert.ok(Math.max(base.p5 - m.outcome.p5, 0) / scale <= RISK_BUDGET + 1e-9, `${goal}: ${m.action.headline}`);
      }
    }
  });

  it("'Bigger upside' puts a larger good case first", () => {
    const { moves, base } = lab([longCall()]);
    const top = rankMoves(moves, { goal: "upside", family: "all", allowOpenEnded: false })[0];
    assert.ok(top);
    assert.ok(top.outcome.p95 > base.p95);
  });

  it("when nothing beats standing still, it says so by returning nothing", () => {
    // A long put that's underwater: every risk-cutting trade costs more upside than it saves.
    const longPut = row({ strike_price: 23800, option_type: "PE", lots: 6, side: "buy" }, 120);
    const { moves } = lab([longPut]);
    assert.deepEqual(rankMoves(moves, { goal: "balanced", family: "all", allowOpenEnded: false }), []);
  });

  it("'Cut my risk' on a naked short call puts a protective buy first", () => {
    const { moves } = lab([shortCall()]);
    const top = rankMoves(moves, { goal: "safer", family: "all", allowOpenEnded: false })[0];
    assert.ok(top, "something should cut the risk");
    assert.notEqual(top.outcome.maxLoss, null, "the top pick removes the unlimited loss");
    assert.ok(top.tags.some((t) => t.id === "cap"));
  });

  it("drops buys the funds can't cover and marks them", () => {
    const { moves } = lab([longCall()], 1000);
    const buys = moves.filter((m) => m.action.family === "buy");
    assert.ok(buys.length > 0);
    assert.ok(buys.every((m) => m.unaffordable));
    assert.equal(rankMoves(moves, { goal: "upside", family: "buy", allowOpenEnded: true, limit: 100 }).length, 0);
  });

  it("shows a spread of ideas across kinds of move, not one idea five times", () => {
    const { moves } = lab([longCall(), shortCall()]);
    const ranked = rankMoves(moves, { goal: "balanced", family: "all", allowOpenEnded: true });
    const perBucket = new Map<string, number>();
    for (const m of ranked) perBucket.set(m.action.bucket, (perBucket.get(m.action.bucket) ?? 0) + 1);
    assert.ok([...perBucket.values()].every((n) => n <= 2));
  });
});

// --- words, chart, margin -----------------------------------------------------------------------------------

describe("outcome flags", () => {
  it("flags a worst case that only exists if the index went to zero", () => {
    const { book, unders } = setup([shortCall()]);
    const hedged = applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24500, lots: 2 }]);
    const withPut = applyChanges(
      { ...book, legs: [...hedged.legs] },
      unders,
      [{ kind: "open", groupKey: KEY, side: "sell", type: "PE", strike: 23600, lots: 2 }],
    );
    const out = evaluate(withPut.legs, hedged.pnlOffset + withPut.pnlOffset);
    assert.notEqual(out.maxLoss, null);
    assert.equal(out.worstIsRemote, true);
    assert.equal(evaluate(setup([longCall()]).book.legs).worstIsRemote, false);
  });

  it("the 1-in-100 case is never better than the 1-in-20 case", () => {
    const o = evaluate(setup([longCall(), shortCall()]).book.legs);
    assert.ok(o.p1 <= o.p5 && o.p5 <= o.p95);
  });
});

describe("highlights", () => {
  it("says what changed in plain terms", () => {
    const { book, unders } = setup([shortCall()]);
    const lab = runLab({ book, unders, focusKey: KEY, funds: null });
    const protect = lab.moves.find((m) => m.action.id.startsWith("buy:CE:") && m.outcome.maxLoss !== null);
    assert.ok(protect);
    const lines = highlights(protect, lab.base, lab.scale);
    assert.ok(lines.some((l) => /unlimited/i.test(l.text)));
  });
});

describe("buildComparisonCurve", () => {
  it("draws before and after for the group, with the booked P&L riding along", () => {
    const { book, unders } = setup([longCall()]);
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: book.legs[0].id, lots: 2 }]);
    const curve = buildComparisonCurve(book, applied, KEY, SPOT);
    assert.ok(curve);
    const atSpot = curve.points.reduce((best, p) => (Math.abs(p.level - SPOT) < Math.abs(best.level - SPOT) ? p : best));
    const ltp = ltpOf(24000, true);
    // Far below the strike every call is worthless: before loses all 4 lots' premium, after loses 2 lots' and banks the rest.
    const far = curve.points[0];
    near(far.before ?? NaN, -180 * 4 * LOT, 1e-6);
    near(far.after ?? NaN, -180 * 2 * LOT + applied.pnlOffset, 1e-6);
    assert.ok(atSpot.before !== null && atSpot.after !== null);
    assert.ok(ltp > 0);
  });

  it("has no 'before' line for a group the book doesn't hold", () => {
    const { book, unders } = setup([longCall()]);
    const other = { ...unders[0], key: "BANKNIFTY|2026-11-10" } as Underlying;
    const applied = applyChanges(book, [unders[0], other], []);
    assert.equal(buildComparisonCurve(book, applied, other.key, SPOT), null);
  });
});

describe("buildMoveTable", () => {
  it("lists 13 levels around now, with the same offset applied to every 'after'", () => {
    const { book, unders } = setup([longCall()]);
    const applied = applyChanges(book, unders, [{ kind: "reduce", legId: book.legs[0].id, lots: 4 }]);
    const rows = buildMoveTable(book, applied, KEY, "NIFTY", SPOT);
    assert.equal(rows.length, 13);
    assert.ok(rows.every((r) => Math.abs(r.after - applied.pnlOffset) < 1e-6));
    assert.equal(rows[6].offset, 0);
  });
});

describe("marginBasket", () => {
  it("nets a contract held both ways and flags legs it can't key", () => {
    const { book } = setup([longCall(), shortCall()]);
    const basket = marginBasket(book.legs);
    assert.equal(basket.missing, 0);
    assert.equal(basket.items.length, 2);
    const sell = basket.items.find((i) => i.transaction_type === "SELL");
    assert.equal(sell?.quantity, 2 * LOT);

    const noKey = { ...book.legs[0], instrumentKey: null };
    assert.equal(marginBasket([noKey]).missing, 1);
    const offset = { ...book.legs[0], isShort: true, id: "x" };
    assert.equal(marginBasket([book.legs[0], offset]).items.length, 0);
  });
});

describe("builderChanges", () => {
  it("turns the builder's rows into the same changes the ranked moves use", () => {
    const { book, unders } = setup([longCall()]);
    const id = book.legs[0].id;
    const changes = builderChanges(
      [
        { id: "a", kind: "reduce", legId: id, lots: 2 },
        { id: "b", kind: "add", legId: id, lots: 1 },
        { id: "c", kind: "open", side: "sell", type: "CE", strike: 24400, lots: 2 },
      ],
      book,
      unders[0],
    );
    assert.deepEqual(changes, [
      { kind: "reduce", legId: id, lots: 2 },
      { kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24000, lots: 1 },
      { kind: "open", groupKey: KEY, side: "sell", type: "CE", strike: 24400, lots: 2 },
    ]);
  });

  it("skips incomplete rows and positions that are gone", () => {
    const { book, unders } = setup([longCall()]);
    const changes = builderChanges(
      [
        { id: "a", kind: "reduce", legId: "gone", lots: 1 },
        { id: "b", kind: "open", side: "buy", type: "CE", strike: null, lots: 1 },
        { id: "c", kind: "open", side: "buy", type: "CE", strike: 24100, lots: 0 },
      ],
      book,
      unders[0],
    );
    assert.deepEqual(changes, []);
  });

  it("says the mix in words", () => {
    const { book } = setup([longCall()]);
    const text = describeChanges(
      [
        { kind: "reduce", legId: book.legs[0].id, lots: 2 },
        { kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24400, lots: 4 },
      ],
      book,
    );
    assert.equal(text, "Sell 2 lots of Nifty 24000 CE + buy 4 lots of Nifty 24400 CE");
    assert.equal(describeChanges([], book), "Nothing chosen yet");
  });

  it("a mix evaluates as the sum of its parts' cash flows", () => {
    const { book, unders } = setup([longCall()]);
    const id = book.legs[0].id;
    const a = applyChanges(book, unders, [{ kind: "reduce", legId: id, lots: 2 }]);
    const b = applyChanges(book, unders, [{ kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24400, lots: 4 }]);
    const both = applyChanges(book, unders, [
      { kind: "reduce", legId: id, lots: 2 },
      { kind: "open", groupKey: KEY, side: "buy", type: "CE", strike: 24400, lots: 4 },
    ]);
    near(both.cash, a.cash + b.cash, 1e-6);
    near(both.charges, a.charges + b.charges, 1e-6);
  });
});
