"use client";

/**
 * Simulate, for an index future - the "Simulate" tab on Live Portfolio when you hold one. The averaging simulator
 * next to it is about a bought option (premium, decay, the strike's volatility), none of which a future has, so this
 * answers the questions that do apply: "what if I added N lots at this price?" and "what if I exited N?" - the
 * blended average, where it breaks even, what an exit books, what the order costs - and then what that does to the
 * whole book. Read-only: it never places an order.
 *
 * The arithmetic of the order is lib/futureSimulator.ts; the odds, chart, ladder and margin check are the What-if
 * lab's (lib/whatIf.ts), run on the same book, so a hedge held beside the future is counted.
 */

import { useMemo, useState } from "react";

import { Reveal, Section, pillButton, tableHead, thinScroll } from "@/components/averaging/ui";
import MoveDetail from "@/components/whatif/MoveDetail";
import { money, signedMoney, TONE_TEXT, toneOf } from "@/components/whatif/shared";
import Select from "@/components/Select";
import Stepper from "@/components/Stepper";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { simulateFuture, type FutureOrder } from "@/lib/futureSimulator";
import { formatLevel } from "@/lib/format";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import { buildBook, buildUnderlyings, bookScale, evaluate, evaluateChanges, livePrice, type Book, type BookLeg } from "@/lib/whatIf";

type Props = {
  rows: PortfolioRow[] | null;
  chains: Record<string, UpstoxOptionChainResult | undefined>;
  nowMs: number | null;
  paused: boolean;
  /** The future being simulated; the first one held when null or no longer simulatable. */
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const EMPTY =
  "Nothing to simulate yet. A future needs a live price, plus the index level and volatility from the option chain of its own expiry - this fills in once those have loaded.";

export default function FutureSimulator({ rows, chains, nowMs, paused, selectedId, onSelect }: Props) {
  const book = useMemo(() => (rows && nowMs !== null ? buildBook(rows, nowMs) : null), [rows, nowMs]);
  const futures = book?.legs.filter((l) => l.isFuture) ?? [];
  const leg = futures.find((l) => l.id === selectedId) ?? futures[0];
  if (!book || !leg) {
    return <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">{EMPTY}</div>;
  }
  // Keyed by position, so switching starts from a clean lots and price rather than carrying them over.
  return <Body key={leg.id} book={book} leg={leg} futures={futures} chains={chains} nowMs={nowMs ?? 0} paused={paused} onSelect={onSelect} />;
}

const moneyOrDash = (n: number | null) => (n === null ? "—" : money(n));

function Body({
  book,
  leg,
  futures,
  chains,
  nowMs,
  paused,
  onSelect,
}: {
  book: Book;
  leg: BookLeg;
  futures: BookLeg[];
  chains: Props["chains"];
  nowMs: number;
  paused: boolean;
  onSelect: (id: string) => void;
}) {
  const [kind, setKind] = useState<FutureOrder["kind"]>("add");
  const [lots, setLots] = useState(1);
  /** Empty = the live price. */
  const [priceText, setPriceText] = useState("");

  const live = livePrice(leg);
  const typed = Number(priceText);
  const price = priceText.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed : live;
  const orderLots = kind === "exit" ? Math.min(lots, leg.lots) : lots;
  const side = leg.isShort ? "sell" : "buy";
  // The position's own entry price, from its index-terms premium: premium + basis is what it was entered at.
  const entryPrice = leg.premium + (leg.basis ?? 0);

  const sim = useMemo(
    () =>
      simulateFuture(
        { side, lots: leg.lots, lotSize: leg.lotSize, avgPrice: entryPrice, livePrice: live },
        { kind, lots: orderLots, price },
      ),
    [side, leg.lots, leg.lotSize, entryPrice, live, kind, orderLots, price],
  );

  // The same order, put to the what-if engine (which prices the future in index terms) for the odds, chart and margin.
  const unders = useMemo(() => buildUnderlyings(chains, nowMs), [chains, nowMs]);
  const base = useMemo(() => evaluate(book.legs), [book]);
  const scale = useMemo(() => bookScale(book, base), [book, base]);
  const verb = kind === "add" ? (leg.isShort ? "Sell" : "Buy") : leg.isShort ? "Buy back" : "Sell";
  const move = useMemo(() => {
    const indexPrice = price - (leg.basis ?? 0);
    return evaluateChanges({ book, unders, funds: null }, base, scale, {
      id: "future-sim",
      family: kind === "add" ? "add" : "reduce",
      bucket: "future-sim",
      headline: `${verb} ${orderLots} lot${orderLots === 1 ? "" : "s"}`,
      detail: `${leg.label} · at ₹${formatLevel(price)}`,
      changes: [kind === "add" ? { kind: "addLeg", legId: leg.id, lots: orderLots, price: indexPrice } : { kind: "reduce", legId: leg.id, lots: orderLots, price: indexPrice }],
    });
  }, [book, unders, base, scale, kind, leg, orderLots, price, verb]);

  const group = { key: leg.groupKey, spot: leg.spot, instrument: leg.instrument };
  const eps = Math.max(50, scale * 0.004);
  const tone = (a: number, b: number) => TONE_TEXT[toneOf(a, b, eps)];
  const pointsTone = (a: number, b: number) => TONE_TEXT[toneOf(a, b, 0.5, false)];
  const inProfit = sim.before.pnl >= 0;
  const away = sim.before.pointsToBreakeven;

  return (
    <div className="flex flex-col gap-6">
      <Reveal index={0} className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight">{leg.label}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {leg.isShort ? "Short" : "Long"} {leg.lots} lot{leg.lots === 1 ? "" : "s"} ({(leg.lots * leg.lotSize).toLocaleString("en-IN")} units) from ₹{formatLevel(entryPrice)} · trades at ₹{formatLevel(live)} ·{" "}
              <span className={inProfit ? "text-profit" : "text-danger-fg"}>{signedMoney(sim.before.pnl)}</span>
            </p>
          </div>
          {futures.length > 1 && (
            <div className="w-56">
              <Select size="sm" value={leg.id} onChange={onSelect} options={futures.map((f) => ({ value: f.id, label: f.label }))} />
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {away === 0
            ? "It is exactly at its entry price."
            : away > 0
              ? `It needs to move ${Math.abs(Math.round(away)).toLocaleString("en-IN")} points ${leg.isShort ? "down" : "up"} to get back to even.`
              : `It can move ${Math.abs(Math.round(away)).toLocaleString("en-IN")} points ${leg.isShort ? "up" : "down"} before it is back to even.`}{" "}
          A future has no premium or decay, so this works in points and lots, not the averaging maths used for options.
        </p>
        {paused && (
          <p className="text-sm text-warning" role="status">
            Live prices are paused, so these figures use the last prices seen.
          </p>
        )}
      </Reveal>

      <Reveal index={1}>
        <Section step={1} title="What if…" subtitle="Add more lots the way you are already positioned, or exit some — at the live price or one you choose.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div role="group" aria-label="Order" className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={kind === "add"} onClick={() => setKind("add")} className={pillButton(kind === "add")}>
                  {leg.isShort ? "Sell more lots" : "Buy more lots"}
                </button>
                <button type="button" aria-pressed={kind === "exit"} onClick={() => setKind("exit")} className={pillButton(kind === "exit")}>
                  {leg.isShort ? "Buy back lots" : "Sell lots"}
                </button>
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Lots <span className="font-normal">(1 lot = {leg.lotSize} units)</span>
                <Stepper value={lots} onChange={setLots} step={1} min={1} max={kind === "exit" ? leg.lots : 100} label="lots" large />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Price (₹)
                <span className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    placeholder={live.toFixed(2)}
                    aria-label="Price"
                    className="w-32 rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                  {priceText.trim() !== "" && (
                    <button type="button" onClick={() => setPriceText("")} className="text-xs font-medium text-accent hover:underline">
                      Use live
                    </button>
                  )}
                </span>
              </label>
            </div>
            {kind === "exit" && leg.lots > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
                {[...new Set([1, Math.ceil(leg.lots / 2), leg.lots])].map((n) => (
                  <button key={n} type="button" onClick={() => setLots(n)} className={pillButton(lots === n)}>
                    {n === leg.lots ? `All ${n}` : `${n} lot${n === 1 ? "" : "s"}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Section>
      </Reveal>

      <Reveal index={2}>
        <Section step={2} title="What changes" subtitle={`${verb} ${sim.lots} lot${sim.lots === 1 ? "" : "s"} at ₹${formatLevel(price)}, against the position as it stands.`}>
          <div className={`relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">The position before and after the order</caption>
              <thead>
                <tr className="border-b border-border text-right">
                  <th scope="col" className={`${tableHead} text-left`}>Measure</th>
                  <th scope="col" className={tableHead}>Now</th>
                  <th scope="col" className={tableHead}>After</th>
                  <th scope="col" className={`${tableHead} hidden sm:table-cell`}>Change</th>
                </tr>
              </thead>
              <tbody>
                <Line label="Lots" before={String(sim.before.lots)} after={String(sim.after.lots)} />
                <Line label="Average price" before={sim.before.lots > 0 ? `₹${formatLevel(sim.before.avgPrice)}` : "—"} after={sim.after.lots > 0 ? `₹${formatLevel(sim.after.avgPrice)}` : "—"} />
                <Line
                  label="Profit or loss at the live price"
                  before={money(sim.before.pnl)}
                  after={money(sim.after.pnl)}
                  change={signedMoney(sim.after.pnl - sim.before.pnl)}
                  className={tone(sim.before.pnl, sim.after.pnl)}
                />
                <Line
                  label="Break-even (points from the live price)"
                  hint="The average price is where the position is back to even. Negative means it is already in profit by that many points."
                  before={sim.before.lots > 0 ? signedPoints(sim.before.pointsToBreakeven) : "—"}
                  after={sim.after.lots > 0 ? signedPoints(sim.after.pointsToBreakeven) : "—"}
                  className={pointsTone(sim.before.pointsToBreakeven, sim.after.pointsToBreakeven)}
                  change={sim.before.lots > 0 && sim.after.lots > 0 ? signedPoints(sim.after.pointsToBreakeven - sim.before.pointsToBreakeven) : ""}
                />
                <Line
                  label="Per 100-point move in the index"
                  before={moneyOrDash(sim.before.lots > 0 ? sim.before.per100Points : null)}
                  after={moneyOrDash(sim.after.lots > 0 ? sim.after.per100Points : null)}
                  change={signedMoney(sim.after.per100Points - sim.before.per100Points)}
                  hint="What a 100-point rise in the index adds to or takes off the position (negative for a short)."
                />
                {kind === "exit" && <Line label="Booked by this exit" before="" after={money(sim.booked)} className={sim.booked >= 0 ? "text-profit" : "text-danger-fg"} hint="Before brokerage and taxes." />}
                <Line label="Brokerage and taxes on this order" before="" after={money(sim.charges)} hint="Estimated, at the futures rates." />
              </tbody>
            </table>
          </div>
        </Section>
      </Reveal>

      <Reveal index={3}>
        <MoveDetail title="What it does to your whole book" subtitle={`${verb} ${sim.lots} lot${sim.lots === 1 ? "" : "s"} · ${move.action.detail}`} move={move} base={base} scale={scale} book={book} group={group} />
        <p className="mt-4 text-xs text-muted-foreground">
          The future is measured against the index with its gap to it (₹{Math.round(leg.basis ?? 0)} today) held where it is, and it uses the at-the-money volatility of its expiry. See the note under Risk &amp; Probability.
        </p>
      </Reveal>
    </div>
  );
}

const signedPoints = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("en-IN")} pts`;

function Line({ label, before, after, change = "", hint, className = "" }: { label: string; before: string; after: string; change?: string; hint?: string; className?: string }) {
  return (
    <tr className="border-b border-border text-right last:border-0">
      <th scope="row" title={hint} className="px-2.5 py-2 text-left font-normal text-muted-foreground">
        {label}
      </th>
      <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{before}</td>
      <td className={`whitespace-nowrap px-2.5 py-2 font-mono font-semibold tabular-nums ${className}`}>{after}</td>
      <td className={`hidden whitespace-nowrap px-2.5 py-2 font-mono tabular-nums sm:table-cell ${className}`}>{change}</td>
    </tr>
  );
}
