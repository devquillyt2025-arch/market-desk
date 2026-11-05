"use client";

/**
 * Everything about one move, in the order a trader asks it: what it does in plain words, the
 * before-and-after numbers behind that, the picture, the exact figures at each index level, and
 * - on request - what Upstox says it does to the margin blocked.
 */

import { useMemo, useState } from "react";

import BeforeAfterChart from "@/components/averaging/BeforeAfterChart";
import { Section, tableHead, thinScroll } from "@/components/averaging/ui";
import { AlertCircleIcon, CheckCircleIcon } from "@/components/icons";
import { compactMoney, money, percent, signedMoney, TagChip, TONE_TEXT, toneOf, type Tone } from "@/components/whatif/shared";
import { formatINR, formatLevel, pnlColorClass } from "@/lib/format";
import { INSTRUMENT_LABELS, type Instrument } from "@/lib/types";
import { fetchMargin } from "@/lib/upstox/client";
import {
  buildComparisonCurve,
  buildMoveTable,
  highlights,
  marginBasket,
  type Book,
  type BookLeg,
  type Evaluated,
  type Outcome,
} from "@/lib/whatIf";

export type ChartGroup = { key: string; spot: number; instrument: Instrument };

type Row = { label: string; hint?: string; before: string; after: string; change: string; tone: Tone };

function rows(move: Evaluated, base: Outcome, scale: number): Row[] {
  const o = move.outcome;
  const eps = Math.max(50, scale * 0.004);
  const rupees = (label: string, b: number | null, a: number | null, hint?: string): Row => {
    const text = (v: number | null) => (v === null ? "—" : money(v));
    return {
      label,
      hint,
      before: text(b),
      after: text(a),
      change: b === null || a === null ? "" : signedMoney(a - b),
      tone: b === null || a === null ? "neutral" : toneOf(b, a, eps),
    };
  };

  // Worst case: lower is better, and "unlimited" is worse than any number.
  const worst = (v: number | null) => (v === null ? Infinity : v);
  const worstText = (v: number | null, remote: boolean) => (v === null ? "Unlimited" : `${money(v)}${remote ? "*" : ""}`);
  const worstRow: Row = {
    label: "Worst case at expiry",
    hint: "The most the book could lose if the index ended anywhere. For a sold put that is the index going to zero, which is why a very large figure carries a star.",
    before: worstText(base.maxLoss, base.worstIsRemote),
    after: worstText(o.maxLoss, o.worstIsRemote),
    change: base.maxLoss !== null && o.maxLoss !== null && !o.worstIsRemote ? signedMoney(-(o.maxLoss - base.maxLoss)) : "",
    tone: worst(base.maxLoss) === worst(o.maxLoss) ? "neutral" : worst(o.maxLoss) < worst(base.maxLoss) ? "good" : "bad",
  };
  const bestRow: Row = {
    label: "Best case at expiry",
    before: base.maxProfit === null ? "Unlimited" : money(base.maxProfit),
    after: o.maxProfit === null ? "Unlimited" : money(o.maxProfit),
    change: base.maxProfit !== null && o.maxProfit !== null ? signedMoney(o.maxProfit - base.maxProfit) : "",
    tone:
      base.maxProfit === null && o.maxProfit === null
        ? "neutral"
        : base.maxProfit === null
          ? "bad"
          : o.maxProfit === null
            ? "good"
            : toneOf(base.maxProfit, o.maxProfit, eps),
  };

  return [
    {
      label: "Chance of ending in profit",
      hint: "Market-implied, at expiry, before brokerage — the same model as the Risk & Probability tab.",
      before: percent(base.pop),
      after: percent(o.pop),
      change: `${o.pop - base.pop > 0 ? "+" : o.pop - base.pop < 0 ? "−" : ""}${Math.abs(Math.round((o.pop - base.pop) * 100))} pts`,
      tone: toneOf(base.pop, o.pop, 0.005),
    },
    rupees("Expected P&L", base.expectedPnl, o.expectedPnl, "The average outcome across the whole range. In a fairly priced market a trade can't lift this much — it reshapes the outcomes instead."),
    rupees("A typical win", base.avgWin, o.avgWin, "The average P&L across the outcomes that make money."),
    rupees("A typical loss", base.avgLoss, o.avgLoss, "The average P&L across the outcomes that lose money."),
    rupees("Bad case · 1 in 20", base.p5, o.p5, "The result 19 times out of 20 will be better than."),
    rupees("Really bad case · 1 in 100", base.p1, o.p1),
    rupees("Good case · 1 in 20", base.p95, o.p95, "The result only 1 time in 20 beats."),
    worstRow,
    bestRow,
    rupees("If the index doesn't move", base.pnlFlat, o.pnlFlat, "P&L at expiry with the index finishing exactly where it is now."),
    rupees("Time decay per day", base.thetaPerDay, o.thetaPerDay, "Positive means time is paying you; negative means it is costing you."),
    {
      label: "P&L for a 1% index move",
      hint: "From the summed delta, so a rough guide for small moves.",
      before: money(base.pnlPer1Pct),
      after: money(o.pnlPer1Pct),
      change: signedMoney(o.pnlPer1Pct - base.pnlPer1Pct),
      tone: "neutral",
    },
  ];
}

// --- Margin ---------------------------------------------------------------------------------

type MarginState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; before: number; after: number; hedged: boolean }
  | { status: "error"; message: string };

async function basketMargin(legs: BookLeg[]): Promise<{ value: number; hedged: boolean } | { error: string }> {
  const { items, missing } = marginBasket(legs);
  if (missing > 0) return { error: "Some contracts have no instrument key yet, so Upstox can't price the basket." };
  if (items.length === 0) return { value: 0, hedged: true };
  const result = await fetchMargin(items);
  if ("error" in result) return { error: result.error === "token_expired" ? "The Upstox token has expired." : "Upstox couldn't work out the margin just now." };
  if (result.finalMargin !== null) return { value: result.finalMargin, hedged: true };
  return { value: result.margins.reduce((acc, m) => acc + (m.total_margin ?? 0), 0), hedged: false };
}

function MarginCheck({ book, move }: { book: Book; move: Evaluated }) {
  const [state, setState] = useState<MarginState>({ status: "idle" });
  const sells = move.applied.legs.some((l) => l.isShort);

  async function check() {
    setState({ status: "loading" });
    try {
      const [before, after] = await Promise.all([basketMargin(book.legs), basketMargin(move.applied.legs)]);
      if ("error" in before) return setState({ status: "error", message: before.error });
      if ("error" in after) return setState({ status: "error", message: after.error });
      setState({ status: "done", before: before.value, after: after.value, hedged: before.hedged && after.hedged });
    } catch {
      setState({ status: "error", message: "Couldn't reach Upstox." });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Margin Upstox would block</p>
          <p className="text-xs text-muted-foreground">
            {sells ? "This move sells options, which block margin on top of the premium." : "Buying options blocks little beyond the premium."} Asks Upstox for the whole book, before and after.
          </p>
        </div>
        <button
          type="button"
          onClick={check}
          disabled={state.status === "loading"}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted active:scale-95 disabled:cursor-wait disabled:opacity-60 sm:min-h-9"
        >
          {state.status === "loading" ? "Checking…" : state.status === "done" ? "Check again" : "Check margin"}
        </button>
      </div>
      {state.status === "done" && (
        <p className="font-mono text-sm tabular-nums" aria-live="polite">
          {formatINR(state.before)} → <span className="font-semibold">{formatINR(state.after)}</span>{" "}
          <span className={state.after > state.before ? "text-warning" : "text-profit"}>
            ({state.after >= state.before ? "+" : "−"}
            {formatINR(Math.abs(state.after - state.before))})
          </span>
          {!state.hedged && <span className="ml-2 font-sans text-xs text-muted-foreground">sum of each contract, no hedge benefit</span>}
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-warning" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

// --- The move -------------------------------------------------------------------------------

export default function MoveDetail({
  title,
  subtitle,
  move,
  base,
  scale,
  book,
  group,
}: {
  title: string;
  subtitle: string;
  move: Evaluated;
  base: Outcome;
  scale: number;
  book: Book;
  group: ChartGroup | null;
}) {
  const lines = useMemo(() => highlights(move, base, scale), [move, base, scale]);
  const table = useMemo(() => rows(move, base, scale), [move, base, scale]);
  const curve = useMemo(() => (group ? buildComparisonCurve(book, move.applied, group.key, group.spot) : null), [book, move, group]);
  const ladder = useMemo(() => (group ? buildMoveTable(book, move.applied, group.key, group.instrument, group.spot) : []), [book, move, group]);
  const indexName = group ? INSTRUMENT_LABELS[group.instrument] : "Index";
  const remote = base.worstIsRemote || move.outcome.worstIsRemote;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5">
        <div>
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {move.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {move.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        {lines.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.text} className="flex items-start gap-2.5 text-sm">
                {line.tone === "good" ? (
                  <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-profit" />
                ) : line.tone === "bad" ? (
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-danger-fg" />
                ) : (
                  <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                )}
                <span>
                  {line.tone === "good" && <span className="sr-only">Better: </span>}
                  {line.tone === "bad" && <span className="sr-only">Worse: </span>}
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">This barely changes anything measurable.</p>
        )}
        {move.applied.problems.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-warning" role="alert">
            {move.applied.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      <Section title="The numbers, before and after" subtitle="Where the book stands now, and where it would land. Hover a label for what it means.">
        <div className={`relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Measures of the book before and after this move</caption>
            <thead>
              <tr className="border-b border-border text-right">
                <th scope="col" className={`${tableHead} text-left`}>Measure</th>
                <th scope="col" className={tableHead}>Now</th>
                <th scope="col" className={tableHead}>After</th>
                <th scope="col" className={`${tableHead} hidden sm:table-cell`}>Change</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.label} className="border-b border-border text-right last:border-0">
                  <th scope="row" title={r.hint} className="px-2.5 py-2 text-left font-normal text-muted-foreground">
                    {r.label}
                  </th>
                  <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{r.before}</td>
                  <td className={`whitespace-nowrap px-2.5 py-2 font-mono font-semibold tabular-nums ${TONE_TEXT[r.tone]}`}>{r.after}</td>
                  <td className={`hidden whitespace-nowrap px-2.5 py-2 font-mono tabular-nums sm:table-cell ${TONE_TEXT[r.tone]}`}>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {remote && (
          <p className="text-xs text-muted-foreground">
            * A theoretical worst case — it needs the index to fall to zero. The 1-in-100 line is the better guide to a very bad day.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {move.applied.cash === 0
            ? "No cash changes hands today."
            : move.applied.cash > 0
              ? `${money(move.applied.cash)} comes in today`
              : `${money(-move.applied.cash)} goes out today`}
          {move.applied.cash !== 0 && `, with about ${formatINR(move.applied.charges)} of brokerage and taxes`}
          {" · "}everything else is held to expiry.
        </p>
      </Section>

      <Section title="Profit or loss at expiry, before vs after" subtitle="Hover or touch the chart for exact figures.">
        <div className="rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
          {curve && group ? (
            <BeforeAfterChart
              curve={curve}
              spot={group.spot}
              indexName={indexName}
              labels={{ subject: "this move", after: "After this move", before: "Now — as it stands" }}
            />
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing to chart yet.</p>
          )}
        </div>
      </Section>

      {ladder.length > 0 && group && (
        <Section title="Profit or loss at each index level" subtitle="At expiry, with the chance the index finishes above each level.">
          <div className={`@container relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
            <table className="w-full border-collapse text-xs @min-[34rem]:text-sm">
              <caption className="sr-only">Profit or loss at expiry at {indexName} levels around the current price, before and after this move</caption>
              <thead>
                <tr className="border-b border-border text-right">
                  <th scope="col" className={`${tableHead} text-left`}>{indexName}</th>
                  <th scope="col" className={tableHead}>Chance above</th>
                  <th scope="col" className={tableHead}>Now</th>
                  <th scope="col" className={tableHead}>After</th>
                  <th scope="col" className={`${tableHead} hidden @min-[34rem]:table-cell`}>Change</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((r) => {
                  const change = r.after - r.before;
                  return (
                    <tr key={r.offset} className={`border-b border-border text-right last:border-0 ${r.offset === 0 ? "bg-muted/50 font-semibold" : ""}`}>
                      <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left font-mono font-normal tabular-nums text-muted-foreground">
                        {formatLevel(r.level)}
                        {r.offset === 0 && <span className="ml-2 font-sans text-[11px]">now</span>}
                      </th>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono tabular-nums text-muted-foreground">{percent(r.chanceAbove)}</td>
                      <td className={`whitespace-nowrap px-2.5 py-1.5 font-mono tabular-nums ${pnlColorClass(r.before)}`}>{compactMoney(r.before)}</td>
                      <td className={`whitespace-nowrap px-2.5 py-1.5 font-mono font-semibold tabular-nums ${pnlColorClass(r.after)}`}>{compactMoney(r.after)}</td>
                      <td className={`hidden whitespace-nowrap px-2.5 py-1.5 font-mono tabular-nums @min-[34rem]:table-cell ${change > 0.5 ? "text-profit" : change < -0.5 ? "text-danger-fg" : "text-muted-foreground"}`}>
                        {signedMoney(change)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <MarginCheck book={book} move={move} />
    </div>
  );
}
