/**
 * An index future inside the risk model, the What-if lab and the Simulate tab. A future is modelled as a call struck
 * at 0 that cost its entry price less the gap to the index (the basis) - so a short future is an unlimited loss on
 * the upside, a long call over it is its hedge, and its payoff at today's index is exactly the P&L the table shows.
 *
 * Fixtures: the What-if lab's coherent chain (Nifty 24,000, 14% vol, expiring Tuesday 10 Nov), and a future of that
 * expiry sold at 24,100 that trades at 24,060 - 60 points above the index, 40 points in profit for the short.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import { computePortfolioRow, futureGroupKey, type FutureQuotes, type PortfolioRow } from "@/lib/calculatePortfolio";
import { analyzeRisk, futureBasis, legPayoff, toLeg } from "@/lib/calculateRisk";
import { simulateFuture } from "@/lib/futureSimulator";
import {
  applyChanges,
  bookScale,
  buildComparisonCurve,
  builderChanges,
  describeChanges,
  evaluate,
  generateActions,
  livePrice,
  marginBasket,
  runLab,
} from "@/lib/whatIf";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import { CHAINS, EXPIRY, KEY, LOT, near, NOW, row, setup, shortCall, SPOT } from "@/lib/whatIfFixtures";

const ENTRY = 24100;
const LIVE = 24060;
const BASIS = LIVE - SPOT;

const quotes = (ltp = LIVE): FutureQuotes => ({
  [futureGroupKey("NIFTY", EXPIRY)]: { instrumentKey: "NSE_FO|FUT", ltp, prevClose: ltp - 20, oi: 5_000_000, volume: 100_000 },
});

/** A priced future: the fixture's entry shape with strike and CE/PE taken off, run through the real row maths. */
function future(over: { side?: "buy" | "sell"; lots?: number; entry?: number; live?: number; chains?: Record<string, UpstoxOptionChainResult | undefined> } = {}): PortfolioRow {
  const { side = "sell", lots = 2, entry = ENTRY, live = LIVE, chains = CHAINS } = over;
  const base = row({ strike_price: null, option_type: null, side, lots }, entry).entry;
  return computePortfolioRow(base, chains, undefined, quotes(live));
}

const hedgeCall = () => row({ strike_price: 24200, option_type: "CE", lots: 2, side: "buy" }, 20);

describe("a future's row, with its option chain loaded", () => {
  it("reads the index level and the at-the-money volatility off the chain of its own expiry", () => {
    const r = future();
    assert.equal(r.status, "ok");
    assert.equal(r.underlyingSpot, SPOT);
    assert.equal(r.nearbyIv, 14);
    assert.equal(r.iv, null); // still no volatility of its own
    assert.equal(r.delta, null);
  });

  it("is still priced from its own quote when no chain has loaded - just without an index read", () => {
    const r = future({ chains: {} });
    assert.equal(r.status, "ok");
    assert.equal(r.underlyingSpot, null);
    assert.equal(r.nearbyIv, null);
  });

  it("takes the gap to the index from the two prices", () => {
    near(futureBasis(future()) ?? NaN, BASIS);
    assert.equal(futureBasis(future({ chains: {} })), null);
  });
});

describe("a future as a leg of the risk model", () => {
  const now = new Date(NOW);
  const today = "2026-11-05";

  it("is a call struck at 0 that cost the entry price less the basis", () => {
    const leg = toLeg(future(), now, today);
    assert.ok(leg);
    assert.equal(leg.isFuture, true);
    assert.equal(leg.isCall, true);
    assert.equal(leg.strike, 0);
    assert.equal(leg.isShort, true);
    near(leg.premium, ENTRY - BASIS);
    assert.equal(leg.qty, 2 * LOT);
    assert.equal(leg.sigma, 0.14);
    assert.equal(leg.groupKey, KEY);
    assert.equal(leg.ivEstimated, false);
  });

  it("pays today's mark-to-market at today's index level", () => {
    const r = future();
    const leg = toLeg(r, now, today)!;
    near(legPayoff(leg, SPOT), r.livePnl ?? NaN, 0.01); // (24,100 - 24,060) x qty
    near(legPayoff(leg, SPOT * 1.01), (ENTRY - BASIS - SPOT * 1.01) * 2 * LOT, 0.01);
  });

  it("is a long's payoff the other way round", () => {
    const r = future({ side: "buy", entry: 24000 });
    const leg = toLeg(r, now, today)!;
    near(legPayoff(leg, SPOT), r.livePnl ?? NaN, 0.01); // 24,060 - 24,000 = +60 a unit
    near(legPayoff(leg, SPOT - 100), (SPOT - 100 - (24000 - BASIS)) * 2 * LOT, 0.01);
  });

  it("is left out when there is no index level or no volatility to measure it by", () => {
    assert.equal(toLeg(future({ chains: {} }), now, today), null);
    assert.equal(toLeg({ ...future(), nearbyIv: null }, now, today), null);
    assert.equal(toLeg({ ...future(), status: "loading" }, now, today), null);
  });
});

describe("Risk & Probability with a future in the book", () => {
  const opts = { now: new Date(NOW), totalMargin: 100_000, unrealizedPnl: 0 };
  const qty = 2 * LOT;

  it("reads a lone short as an unlimited loss on the upside, centred on where it stands", () => {
    const r = future();
    const a = analyzeRisk([r], opts);
    assert.ok(a);
    assert.equal(a.maxLoss, null);
    assert.ok(a.maxProfit !== null && a.maxProfit > 0); // only if the index went to zero
    // No drift: the average outcome is today's profit or loss.
    near(a.expectedPnl, r.livePnl ?? NaN, 0.003 * SPOT * qty);
    assert.ok(a.pop > 0.45 && a.pop < 0.65, `pop ${a.pop}`);
    near(a.pnlPer1PctMove, -qty * SPOT * 0.01, 0.01); // one-for-one with the index, against a short
  });

  it("flags it as a future, with an index-level breakeven, and no option rules", () => {
    const a = analyzeRisk([future()], opts)!;
    const p = a.positions[0];
    assert.equal(p.isFuture, true);
    near(p.futureBasis ?? NaN, BASIS);
    near(p.breakeven, ENTRY - BASIS);
    assert.equal(p.thetaPerDay, null);
    assert.equal(p.ivEstimated, false);
    assert.equal(p.contract, "NIFTY FUT");
    const ids = a.warnings.map((w) => w.id);
    assert.ok(ids.includes("unlimited-loss"));
    assert.ok(ids.includes("directional"), "heavily short the market");
    for (const wrong of ["short-itm", "short-tested", "short-premium-doubled", "short-premium-rising", "short-expiry-day", "short-expiry-soon", "iv-estimated", "thin-oi"]) {
      assert.ok(!ids.includes(wrong), `${wrong} is an option rule`);
    }
  });

  it("names it a short future in the unlimited-loss warning", () => {
    const w = analyzeRisk([future()], opts)!.warnings.find((x) => x.id === "unlimited-loss")!;
    assert.match(w.detail, /short futures/);
    assert.match(w.detail, /NIFTY FUT/);
  });

  it("treats a call over a short future as its hedge, and caps the loss", () => {
    const a = analyzeRisk([future(), hedgeCall()], opts)!;
    assert.ok(a.maxLoss !== null);
    // Above 24,200 the call pays 1:1 against the future: (24,040 - 24,200 - 20) per unit, 2 lots each.
    near(a.maxLoss, (24200 + 20 - (ENTRY - BASIS)) * qty, 0.01);
    assert.ok(!a.warnings.some((w) => w.id === "unlimited-loss"));
    assert.equal(a.positions.find((p) => !p.isFuture)?.isHedge, true);
  });

  it("does not offer 'the index going to zero' as a short future's reward", () => {
    const alone = analyzeRisk([future()], opts)!;
    assert.equal(alone.maxProfitIsRemote, true);
    assert.equal(alone.rewardToRisk, null);
    // Hedged, the loss is capped - but the best case is still that same far-off one, and gives no honest ratio.
    const hedged = analyzeRisk([future(), hedgeCall()], opts)!;
    assert.ok(hedged.maxLoss !== null);
    assert.equal(hedged.maxProfitIsRemote, true);
    assert.equal(hedged.rewardToRisk, null);
  });

  it("reads an option-only book exactly as before", () => {
    const a = analyzeRisk([shortCall(), hedgeCall()], opts)!;
    assert.equal(a.maxProfitIsRemote, false);
    assert.ok(a.maxProfit !== null && a.maxProfit > 0);
  });

  it("does not warn the future's own side when it is long", () => {
    const a = analyzeRisk([future({ side: "buy", entry: 24000 })], opts)!;
    assert.ok(a.maxLoss !== null); // index to zero - remote, but finite
    assert.ok(!a.warnings.some((w) => w.id === "unlimited-loss"));
    assert.ok(a.pnlPer1PctMove > 0);
  });

  it("warns as it nears expiry - it is settled in cash, there is no gamma to speak of", () => {
    const onExpiry = analyzeRisk([future()], { ...opts, now: new Date("2026-11-10T05:00:00Z") })!;
    const w = onExpiry.warnings.find((x) => x.id === "future-expiry-soon");
    assert.ok(w);
    assert.equal(w.severity, "critical");
    assert.match(w.title, /expire today/);
    assert.ok(!onExpiry.warnings.some((x) => x.id === "short-expiry-day"));
    assert.ok(!analyzeRisk([future()], opts)!.warnings.some((x) => x.id === "future-expiry-soon")); // 5 days out
  });

  it("says why a future can't be analysed instead of dropping it silently", () => {
    const a = analyzeRisk([future(), future({ chains: {} })], opts)!;
    const w = a.warnings.find((x) => x.id === "excluded")!;
    assert.match(w.detail, /no option chain for the 2026-11-10 expiry/);
  });
});

describe("the What-if book with a future in it", () => {
  const { book } = setup([future()]);
  const leg = book.legs[0];

  it("holds it as a future leg priced in index terms, with the basis kept apart", () => {
    assert.equal(book.legs.length, 1);
    assert.equal(leg.isFuture, true);
    assert.equal(leg.delta, 1);
    assert.equal(leg.theta, 0);
    assert.equal(leg.ltp, SPOT);
    near(leg.basis ?? NaN, BASIS);
    near(livePrice(leg), LIVE);
    assert.match(leg.label, /^Nifty future · 10 Nov$/);
  });

  it("counts no premium for it, so it can't drown the scale of a book it sits in", () => {
    assert.equal(book.premiumCapital, 0);
    const mixed = setup([future(), hedgeCall()]).book;
    assert.equal(mixed.premiumCapital, mixed.legs.find((l) => !l.isFuture)!.premium * mixed.legs.find((l) => !l.isFuture)!.qty);
  });

  it("does not stretch a long future's scale out to the index going to zero", () => {
    const longBook = setup([future({ side: "buy", entry: 24000 })]).book;
    const base = evaluate(longBook.legs);
    assert.ok(base.worstIsRemote);
    assert.ok(bookScale(longBook, base) < (base.maxLoss ?? 0) / 10);
  });

  it("books the profit shown in the table when lots are exited", () => {
    const a = applyChanges(book, [], [{ kind: "reduce", legId: leg.id, lots: 2 }]);
    const mtm = (ENTRY - LIVE) * 2 * LOT;
    near(a.booked, mtm, 0.01);
    near(a.cash, mtm, 0.01); // only the profit moves, not the contract's notional
    const fee = calculateBrokerage("FUTURES", [{ buyPrice: LIVE, sellPrice: 0 }], 2 * LOT).totalCharges;
    near(a.charges, fee, 0.001); // a buy-back, at the futures rates, at the real price
    assert.equal(a.legs.length, 0);
  });

  it("adds lots as a leg of their own, charged as a futures order, with no cash out", () => {
    const a = applyChanges(book, [], [{ kind: "addLeg", legId: leg.id, lots: 1 }]);
    assert.equal(a.legs.length, 2);
    const added = a.legs.find((l) => !l.held)!;
    assert.equal(added.isFuture, true);
    assert.equal(added.isShort, true);
    assert.equal(added.qty, LOT);
    assert.equal(added.premium, SPOT); // entered at the index-terms live price
    assert.equal(a.cash, 0);
    const fee = calculateBrokerage("FUTURES", [{ buyPrice: 0, sellPrice: LIVE }], LOT).totalCharges;
    near(a.charges, fee, 0.001);
    // The book it leaves is twice as exposed at the money, and the average moves to blend the two entries.
    near(evaluate(a.legs).pnlPer1Pct, -3 * LOT * SPOT * 0.01, 0.01);
  });

  it("takes a price of your own for an add or an exit, in index terms", () => {
    const a = applyChanges(book, [], [{ kind: "addLeg", legId: leg.id, lots: 1, price: SPOT + 10 }]);
    assert.equal(a.legs.find((l) => !l.held)!.premium, SPOT + 10);
    const e = applyChanges(book, [], [{ kind: "reduce", legId: leg.id, lots: 1, price: SPOT + 10 }]);
    near(e.booked, (ENTRY - BASIS - (SPOT + 10)) * LOT, 0.01);
  });

  it("refuses to add to a position that isn't a future, or isn't there", () => {
    const optionBook = setup([hedgeCall()]).book;
    assert.equal(applyChanges(optionBook, [], [{ kind: "addLeg", legId: optionBook.legs[0].id, lots: 1 }]).problems.length, 1);
    assert.equal(applyChanges(book, [], [{ kind: "addLeg", legId: "nope", lots: 1 }]).problems.length, 1);
  });

  it("asks Upstox's margin calculator for the future at its real price", () => {
    const { items, missing } = marginBasket(book.legs);
    assert.equal(missing, 0);
    assert.deepEqual(items, [{ instrument_key: "NSE_FO|FUT", quantity: 2 * LOT, transaction_type: "SELL", product: "D", price: LIVE }]);
  });

  it("draws its chart around the index, not down to zero", () => {
    const curve = buildComparisonCurve(book, applyChanges(book, [], []), KEY, SPOT)!;
    assert.ok(curve.points[0].level > SPOT * 0.5, `chart starts at ${curve.points[0].level}`);
    // At today's index the future is where the table says it is.
    const atSpot = curve.points.reduce((best, p) => (Math.abs(p.level - SPOT) < Math.abs(best.level - SPOT) ? p : best));
    near(atSpot.before ?? NaN, (ENTRY - LIVE) * 2 * LOT, 0.05 * LOT * 2 * 100);
  });

  it("builds and describes an 'add' row of the builder for a future", () => {
    const changes = builderChanges([{ id: "m1", kind: "add", legId: leg.id, lots: 2 }], book, null);
    assert.deepEqual(changes, [{ kind: "addLeg", legId: leg.id, lots: 2 }]);
    assert.equal(describeChanges(changes, book), "Sell 2 more lots of Nifty future · 10 Nov");
  });
});

describe("the What-if lab's ideas for a future", () => {
  const input = setup([future()]);
  const actions = generateActions(input.book, input.unders, input.focusKey);

  it("offers exits and adds of the future itself", () => {
    const ids = actions.map((a) => a.id);
    assert.ok(ids.some((id) => id.startsWith("reduce:")));
    const adds = actions.filter((a) => a.family === "add");
    assert.ok(adds.length > 0);
    for (const a of adds) assert.equal(a.changes[0].kind, "addLeg");
    assert.match(adds[0].detail, /at ₹24,?060\.00/);
  });

  it("offers options to hedge it with - priced off the chain of its expiry", () => {
    assert.ok(actions.some((a) => a.family === "buy" && a.changes[0].kind === "open"));
    assert.ok(actions.some((a) => a.family === "spread"));
  });

  it("finds that buying a call puts a ceiling on a short future's loss", () => {
    const lab = runLab(input);
    assert.equal(lab.base.maxLoss, null);
    const hedges = lab.moves.filter((m) => m.action.family === "buy" && m.outcome.maxLoss !== null);
    assert.ok(hedges.length > 0, "some call purchase caps the loss");
    assert.ok(hedges.every((m) => m.tags.some((t) => t.id === "cap")));
    // And the ideas are sized against the book's real scale - the 1-in-20 case - not the premium of one lot.
    assert.ok(lab.scale > 1000);
  });

  it("is offered no option-chain trades when the chain hasn't loaded, only exits and adds of the future", () => {
    const lab = runLab({ ...input, unders: [] });
    assert.ok(lab.moves.length > 0);
    assert.ok(lab.moves.every((m) => m.action.family === "reduce" || m.action.family === "add" || m.action.family === "book"));
  });
});

describe("simulating an order on a future", () => {
  const short = { side: "sell" as const, lots: 2, lotSize: LOT, avgPrice: ENTRY, livePrice: LIVE };

  it("reads the position as it stands", () => {
    const { before } = simulateFuture(short, { kind: "add", lots: 0, price: LIVE });
    assert.equal(before.qty, 2 * LOT);
    assert.equal(before.avgPrice, ENTRY);
    near(before.pnl, (ENTRY - LIVE) * 2 * LOT, 0.01);
    assert.equal(before.per100Points, -100 * 2 * LOT); // a short loses on a rise
    assert.equal(before.pointsToBreakeven, -40); // already 40 points in profit
  });

  it("blends the average when lots are added, and charges the order at the futures rates", () => {
    const sim = simulateFuture(short, { kind: "add", lots: 1, price: LIVE });
    near(sim.after.avgPrice, Math.round(((2 * ENTRY + LIVE) / 3) * 100) / 100, 0.001);
    assert.equal(sim.after.lots, 3);
    near(sim.after.pnl, (sim.after.avgPrice - LIVE) * 3 * LOT, 3 * LOT * 0.005); // the average shown is rounded to the paisa; the P&L is not
    assert.equal(sim.booked, 0);
    near(sim.charges, calculateBrokerage("FUTURES", [{ buyPrice: 0, sellPrice: LIVE }], LOT).totalCharges, 0.001);
    assert.ok(sim.after.pointsToBreakeven > sim.before.pointsToBreakeven); // less cushion: the new lot is at a worse price
  });

  it("books the profit of an exit and leaves the average of what is left alone", () => {
    const sim = simulateFuture(short, { kind: "exit", lots: 1, price: LIVE });
    near(sim.booked, (ENTRY - LIVE) * LOT, 0.01);
    assert.equal(sim.after.lots, 1);
    assert.equal(sim.after.avgPrice, ENTRY);
    near(sim.charges, calculateBrokerage("FUTURES", [{ buyPrice: LIVE, sellPrice: 0 }], LOT).totalCharges, 0.001); // a short is closed by buying
  });

  it("cannot exit more than is held, and leaves nothing behind when it all goes", () => {
    const sim = simulateFuture(short, { kind: "exit", lots: 9, price: LIVE });
    assert.equal(sim.lots, 2);
    assert.equal(sim.after.lots, 0);
    assert.equal(sim.after.pnl, 0);
    assert.equal(sim.after.avgPrice, 0);
  });

  it("works the other way round for a long", () => {
    const long = { side: "buy" as const, lots: 1, lotSize: LOT, avgPrice: 24000, livePrice: LIVE };
    const sim = simulateFuture(long, { kind: "exit", lots: 1, price: LIVE + 20 });
    near(sim.before.pnl, 60 * LOT, 0.01);
    assert.equal(sim.before.pointsToBreakeven, -60);
    near(sim.booked, 80 * LOT, 0.01);
    near(sim.charges, calculateBrokerage("FUTURES", [{ buyPrice: 0, sellPrice: LIVE + 20 }], LOT).totalCharges, 0.001); // a long is closed by selling
  });
});
