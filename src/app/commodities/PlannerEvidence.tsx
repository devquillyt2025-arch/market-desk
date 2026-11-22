"use client";

/**
 * What the evidence says about the rule behind the plans - and how little. A strip for the chosen timeframe and ratio, a grid of
 * every timeframe against every ratio from the replay (the plan rule run over this contract's completed sessions), the last few
 * flips and how each would have ended, and the earlier study. A verdict appears only with 100 counted plans over 30 sessions, and
 * even then it never says the rule works.
 */

import study from "@/lib/natgasPlanner/evidence.json";
import { RATIOS, TIMEFRAMES, type Timeframe } from "@/lib/natgasPlanner/config";
import type { PlannerResult } from "@/lib/natgasPlannerFeed";

import { inr, istStampLong, signedInr, tfLabel, tfWords } from "./plannerFormat";

const STATUS_WORD = { target: "Target", stop: "Stop", eod: "End of day" } as const;

export default function PlannerEvidence({ replay, tf, ratio }: { replay: PlannerResult["replay"]; tf: Timeframe; ratio: number }) {
  const cell = replay.timeframes.find((r) => r.tf === tf)?.byRatio[String(ratio)];
  const s = cell?.stats;
  const th = "pb-1.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <section aria-label="Evidence" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Evidence</h2>

      <p className="mt-2 text-sm">
        {s && s.n > 0 ? (
          <>
            Replaying this rule on the {tfWords(tf)} timeframe at 1:{ratio} over {replay.sessions} past sessions of this contract: <span className="font-semibold tabular-nums">{s.n} plans</span>, {s.winPct?.toFixed(0)}% reached the target, average{" "}
            <span className="font-semibold tabular-nums">{signedInr(s.avgNet ?? 0)}</span> a lot after costs{s.t !== null && <> (t = {s.t.toFixed(2)})</>}.
          </>
        ) : (
          <>No replayed plans for this timeframe and ratio yet.</>
        )}
      </p>
      {cell && <p className="mt-1 text-sm font-medium">{cell.verdict.text}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        A verdict needs 100 counted plans over 30 sessions. It is a replay on past data with the rule fixed in advance (1.5× ATR stops), not a forward test, and it says nothing about what comes next.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">Average net rupees per lot per trade, and the number of plans, for each timeframe and ratio in the replay</caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} pr-3 text-left`}>
                Avg net ₹ / lot
              </th>
              {RATIOS.map((r) => (
                <th key={r} scope="col" className={`${th} pr-2 tabular-nums ${r === ratio ? "text-foreground" : ""}`}>
                  1:{r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 tabular-nums">
            {TIMEFRAMES.map((t) => {
              const row = replay.timeframes.find((r) => r.tf === t);
              return (
                <tr key={t} className={t === tf ? "bg-accent/8" : ""}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-semibold">
                    {tfLabel(t)}
                  </th>
                  {RATIOS.map((r) => {
                    const c = row?.byRatio[String(r)];
                    return (
                      <td key={r} className={`py-1.5 pr-2 text-right ${t === tf && r === ratio ? "font-semibold" : ""}`}>
                        {c && c.stats.n > 0 ? signedInr(c.stats.avgNet ?? 0) : "–"}
                        <span className="block text-[11px] font-normal text-muted-foreground">{c?.stats.n ?? 0} plans</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="group mt-4 border-t border-border/60 pt-3">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Recent flips on the {tfWords(tf)} timeframe, and how each would have ended at 1:{ratio}
          <span aria-hidden="true" className="text-muted-foreground transition-transform duration-200 group-open:rotate-180">
            ⌄
          </span>
        </summary>
        {replay.recent.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No replayed flips yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-xs">
              <caption className="sr-only">The last replayed flips on this timeframe</caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 pr-3 text-left font-medium">
                    Bar
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-left font-medium">
                    Side
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    Entry
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-left font-medium">
                    Ended at
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    Net / lot
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 tabular-nums">
                {replay.recent.map((f) => {
                  const o = f.outcomes[String(ratio)];
                  return (
                    <tr key={f.barStart}>
                      <td className="py-1.5 pr-3">{istStampLong(f.barStart)}</td>
                      <td className="py-1.5 pr-3">{f.side === "long" ? "Long" : "Short"}</td>
                      <td className="py-1.5 pr-3 text-right">{f.entry.toFixed(2)}</td>
                      <td className="py-1.5 pr-3">{o ? STATUS_WORD[o.status] : "–"}</td>
                      <td className="py-1.5 text-right">{o ? signedInr(o.net) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <details className="group mt-3 border-t border-border/60 pt-3">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          {study.title}: {study.market}
          <span aria-hidden="true" className="text-muted-foreground transition-transform duration-200 group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            {study.data}. {study.method}
          </p>
          <p className="text-foreground">{study.headline}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] tabular-nums">
              <caption className="sr-only">The least-bad setup found on each timeframe in the earlier study</caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 pr-3 text-left font-medium">
                    Timeframe
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    Stop
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    Ratio
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    Net / lot / trade
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    t
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {study.leastBad.map((r) => (
                  <tr key={r.tf}>
                    <th scope="row" className="py-1 pr-3 text-left font-medium text-foreground">
                      {tfLabel(r.tf)}
                      {"proxy" in r && r.proxy ? <span className="ml-1 font-normal text-muted-foreground">(proxy: {r.proxy})</span> : null}
                    </th>
                    <td className="py-1 pr-3 text-right">{r.stopPct}%</td>
                    <td className="py-1 pr-3 text-right">1:{r.ratio}</td>
                    <td className="py-1 pr-3 text-right">{inr(r.net).replace("₹-", "-₹")}</td>
                    <td className="py-1 text-right">{r.t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>{study.caveat}</p>
        </div>
      </details>
    </section>
  );
}
