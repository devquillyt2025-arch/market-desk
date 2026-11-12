"use client";

/**
 * RRR planner - the tab beside What-if lab on Live Portfolio. It has nothing to do with your positions: it
 * answers "given how much this market actually moves, which reward-for-the-risk and which size of stop and
 * target should I plan - 1:2 or 1:3, 2% : 4% or 5% : 10%?" - for a trade held a few days, or for one opened
 * and closed within today's session.
 *
 * It measures the volatility of the chosen index from its own daily history (or takes one you type; for an
 * intraday trade it uses the move from a session's open to its close), then works out for every usual
 * stop-and-target pair how often it hits the target, hits the stop, or is still open when you have to be out,
 * and says which pairs fit that market: too tight (ordinary movement stops you out) or too slow (the target
 * rarely arrives in time). A second view runs the RRRs from the one most likely to end in profit to the one most
 * likely to end in a loss, because winning more often and making more are not the same thing.
 *
 * All the maths is in lib/rrrPlanner.ts and lib/volatility.ts. The choices are remembered on this device.
 */

import { useMemo, useState } from "react";

import { Reveal, Section, eyebrow, pillButton, tableHead, thinScroll } from "@/components/averaging/ui";
import LoadingState from "@/components/LoadingState";
import Stepper from "@/components/Stepper";
import { formatLevel } from "@/lib/format";
import {
  bestFit,
  bestForRatio,
  buildLeaderboard,
  buildSetups,
  daysToFit,
  expectedMovePct,
  HORIZONS,
  INTRADAY_SCALES,
  INTRADAY_STARTS,
  NOISE_INTRADAY,
  pairLabel,
  RATIOS,
  REACH_MIN,
  rrrLabel,
  SESSION_HOURS,
  STOP_SCALES,
  TIGHT_STOP_DAY1,
  type Barrier,
  type Fit,
  type Setup,
  type Standing,
} from "@/lib/rrrPlanner";
import { loadPlannerPrefs, savePlannerPrefs, type PlannerPrefs } from "@/lib/rrrPlannerPrefs";
import { INDEX_INSTRUMENTS, INSTRUMENT_LABELS } from "@/lib/types";
import { useVolatility } from "@/lib/useVolatility";
import { dailyFromAnnualPct, TRADING_DAYS, VOLATILITY_WINDOWS } from "@/lib/volatility";

const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const dayCount = (n: number) => `${n} trading day${n === 1 ? "" : "s"}`;
/** "2026-11-06" as "6 Nov 2026". */
const formatDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WINDOW_LABELS: Record<number, string> = { 20: "Last month", 60: "Last 3 months", 250: "Last year" };

/** What the planner is looking at, for the wording: a few days' hold, or a trade out by the close. */
type Ctx = {
  intraday: boolean;
  /** Trading days held at most (a share of one for an intraday trade). */
  days: number;
  /** Where an intraday trade starts, e.g. "10:30". */
  start: string;
  /** The index level the figures run up to, for turning percentages into points. */
  lastClose: number | null;
};

/** "5 trading days", "the full session", "the rest of the session from 12:00". */
function holdText(c: Ctx): string {
  if (!c.intraday) return dayCount(c.days);
  return c.days === 1 ? "the full session" : `the rest of the session from ${c.start}`;
}
const unit = (c: Ctx) => (c.intraday ? "a session" : "a day");
/** How long a trade lasts, in the unit that suits: hours for an intraday trade. */
const lasts = (days: number, c: Ctx) => (c.intraday ? `${(days * SESSION_HOURS).toFixed(1)} hours` : `${days.toFixed(1)} days`);
/** Index points for a percentage of price, when the level is known. */
const points = (p: number, c: Ctx) => (c.lastClose === null ? null : Math.round((p / 100) * c.lastClose));

const FIT: Record<Fit, { label: string; chip: string }> = {
  fits: { label: "Fits", chip: "bg-profit/10 text-profit" },
  tight: { label: "Too tight", chip: "bg-loss/15 text-danger-fg" },
  slow: { label: "Too slow", chip: "bg-warning/10 text-warning" },
};

const STANDING: Record<Standing, { label: string; chip: string }> = {
  wins: { label: "Wins more often", chip: "bg-profit/10 text-profit" },
  even: { label: "Even odds", chip: "bg-muted text-muted-foreground" },
  loses: { label: "Loses more often", chip: "bg-loss/15 text-danger-fg" },
};

/** Why a pair got its verdict, in the market's own numbers. */
function reason(s: Setup, c: Ctx): string {
  const noise = c.intraday ? "Ordinary movement in the first hour alone" : "An ordinary day";
  if (s.fit === "tight") return `${noise} hits this stop ${pct(s.odds.stopEarly)} of the time — it is inside the ${c.intraday ? "" : "day-to-day "}noise (the limit is ${pct(TIGHT_STOP_DAY1)}).`;
  if (s.fit === "slow") return `Only ${pct(Math.min(s.reach, 1))} of the wins this pair needs arrive within ${holdText(c)} (it needs at least ${pct(REACH_MIN)}).`;
  return `${noise} hits the stop ${pct(s.odds.stopEarly)} of the time, and ${pct(Math.min(s.reach, 1))} of the wins it needs arrive within ${holdText(c)}.`;
}

function FitChip({ fit }: { fit: Fit }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${FIT[fit].chip}`}>{FIT[fit].label}</span>;
}

/** Wins, losses and trades still open as one bar, so the shape of a pair reads before its numbers do. */
function OutcomeBar({ odds }: { odds: Barrier }) {
  return (
    <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="bg-profit" style={{ width: `${odds.win * 100}%` }} />
      <div className="bg-danger-fg" style={{ width: `${odds.loss * 100}%` }} />
      <div className="bg-muted-foreground/40" style={{ width: `${odds.open * 100}%` }} />
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** "0.5% : 1%" with its index points underneath when the level is known. */
function PairText({ setup, c }: { setup: Setup; c: Ctx }) {
  const stop = points(setup.stopPct, c);
  const target = points(setup.targetPct, c);
  return (
    <>
      <span className="font-mono font-semibold text-foreground">{pairLabel(setup.stopPct, setup.targetPct)}</span>
      {stop !== null && target !== null && (
        <span className="text-muted-foreground"> (≈ {stop.toLocaleString("en-IN")} : {target.toLocaleString("en-IN")} points)</span>
      )}
    </>
  );
}

/** One RRR's best pair for this market, side by side with the others so 1:2 and 1:3 can be weighed at a glance. */
function RatioCard({ setup, best, c, swingSigma, customStopPct }: { setup: Setup; best: Setup | null; c: Ctx; swingSigma: number; customStopPct: number | null }) {
  const picked = best !== null && best.rrr === setup.rrr && best.stopPct === setup.stopPct;
  // When a pair doesn't fit, the days of holding (overnight, if this is an intraday trade) at which a stop of this RRR would.
  const need = setup.fit === "fits" ? null : daysToFit(swingSigma, setup.rrr, customStopPct);
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border bg-background p-4 shadow-sm ${picked ? "border-accent ring-2 ring-accent/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums">{rrrLabel(setup.rrr)}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            best size: <PairText setup={setup} c={c} />
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <FitChip fit={setup.fit} />
          {picked && <span className="whitespace-nowrap rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Best pick</span>}
        </div>
      </div>
      <OutcomeBar odds={setup.odds} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Figure label="Hits the target" value={pct(setup.odds.win)} hint={`needs ${pct(setup.breakEvenWin)} to break even`} />
        <Figure label="Hits the stop" value={pct(setup.odds.loss)} />
        <Figure label="Still open" value={pct(setup.odds.open)} hint={c.intraday ? "closed at the 3:30 close" : `closed on day ${c.days}`} />
        <Figure label="Takes on average" value={lasts(setup.odds.days, c)} />
      </dl>
      <p className="text-xs text-muted-foreground">
        {reason(setup, c)}
        {need !== null && ` ${c.intraday ? "Held overnight for" : "Hold"} about ${dayCount(need)}${setup.fit === "tight" ? ", with a wider stop," : ""} and a ${rrrLabel(setup.rrr)} fits.`}
        {setup.fit !== "fits" && need === null && " It doesn't fit at any holding period offered."}
      </p>
    </div>
  );
}

/**
 * One stop, the RRRs from most likely to end in profit to most likely to end in a loss. Beside the odds sit the
 * typical win and the typical loss, because they are what the odds are paid for with.
 */
function Leaderboard({ rows, c }: { rows: Setup[]; c: Ctx }) {
  return (
    <div className={`relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Each RRR at one stop, from the one most likely to end in profit to the one most likely to end in a loss</caption>
        <thead>
          <tr className="border-b border-border text-right">
            <th scope="col" className={`${tableHead} text-left`}>RRR</th>
            <th scope="col" className={`${tableHead} text-left`}>Stop : target</th>
            <th scope="col" className={tableHead}>Ends in profit</th>
            <th scope="col" className={tableHead}>Ends in loss</th>
            <th scope="col" className={tableHead}>Typical win</th>
            <th scope="col" className={tableHead}>Typical loss</th>
            <th scope="col" className={tableHead}>Hits target</th>
            <th scope="col" className={`${tableHead} text-left`}>Leans</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.rrr} className="border-b border-border text-right last:border-0">
              <th scope="row" className="whitespace-nowrap px-2.5 py-2 text-left font-mono font-semibold tabular-nums">{rrrLabel(s.rrr)}</th>
              <td className="whitespace-nowrap px-2.5 py-2 text-left font-mono tabular-nums">{pairLabel(s.stopPct, s.targetPct)}</td>
              <td className="px-2.5 py-2">
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono font-semibold tabular-nums text-profit">{pct(s.odds.endsUp)}</span>
                  <div aria-hidden="true" className="flex h-1 w-16 overflow-hidden rounded-full bg-danger-fg">
                    <div className="bg-profit" style={{ width: `${s.odds.endsUp * 100}%` }} />
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 font-mono font-semibold tabular-nums text-danger-fg">{pct(s.odds.endsDown)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                {s.odds.avgWin.toFixed(2)}%
                {points(s.odds.avgWin, c) !== null && <span className="ml-1 text-xs text-muted-foreground">{points(s.odds.avgWin, c)} pts</span>}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">
                {s.odds.avgLoss.toFixed(2)}%
                {points(s.odds.avgLoss, c) !== null && <span className="ml-1 text-xs text-muted-foreground">{points(s.odds.avgLoss, c)} pts</span>}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{pct(s.odds.win)}</td>
              <td className="px-2.5 py-2 text-left">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STANDING[s.standing].chip}`}>{STANDING[s.standing].label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RrrPlanner() {
  // Mounts only once this tab is chosen, so it runs in the browser - localStorage is there to read.
  const [prefs, setPrefs] = useState(loadPlannerPrefs);
  // The stop the win-or-lose ranking is run at; null follows the pick.
  const [rankStop, setRankStop] = useState<number | null>(null);
  const volatility = useVolatility(prefs.instrument);

  function update(patch: Partial<PlannerPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePlannerPrefs(next);
  }

  const { instrument, intraday, manualAnnualPct, customStopPct } = prefs;
  const indexName = INSTRUMENT_LABELS[instrument];
  const data = volatility.status === "ok" ? volatility.data : null;
  // The look-back chosen, or the longest one the index has history for.
  const measured = data ? (data.windows.find((w) => w.days === prefs.window) ?? data.windows[data.windows.length - 1]) : null;

  // The volatility to plan with: one typed by hand (taken as a day's move either way), else the measured one - a
  // session's open-to-close for an intraday trade (a day's, close to close, if there are no opens to measure it from).
  const swingSigma = manualAnnualPct !== null ? dailyFromAnnualPct(manualAnnualPct) : (measured?.daily ?? null);
  const dailySigma = manualAnnualPct !== null ? swingSigma : intraday ? (measured?.intraday ?? measured?.daily ?? null) : (measured?.daily ?? null);
  const noOpens = intraday && manualAnnualPct === null && measured !== null && measured.intraday === null;

  const days = intraday ? prefs.intradayLeft : prefs.days;
  const scales = intraday ? INTRADAY_SCALES : STOP_SCALES;
  const noiseDays = intraday ? NOISE_INTRADAY : 1;
  const start = INTRADAY_STARTS.find((s) => s.left === prefs.intradayLeft)?.label ?? INTRADAY_STARTS[0].label;
  // Points are the index's own: a volatility typed by hand may be a stock's, so its figures stay in percent.
  const ctx: Ctx = { intraday, days, start, lastClose: manualAnnualPct === null ? (data?.lastClose ?? null) : null };

  const setups = useMemo(() => (dailySigma === null ? [] : buildSetups({ dailySigma, days, noiseDays, scales, customStopPct })), [dailySigma, days, noiseDays, scales, customStopPct]);
  const best = useMemo(() => bestFit(setups), [setups]);
  const stops = useMemo(() => [...new Set(setups.map((s) => s.stopPct))], [setups]);
  const leaderStop = rankStop !== null && stops.includes(rankStop) ? rankStop : (best?.stopPct ?? bestForRatio(setups, RATIOS[0])?.stopPct ?? null);
  const leaderboard = useMemo(
    () => (dailySigma === null || leaderStop === null ? [] : buildLeaderboard({ dailySigma, days, noiseDays, stopPct: leaderStop })),
    [dailySigma, days, noiseDays, leaderStop],
  );

  const annualPct = dailySigma === null ? null : dailySigma * Math.sqrt(TRADING_DAYS) * 100;
  const wander = dailySigma === null ? null : expectedMovePct(dailySigma, days);
  const normalPoints = dailySigma !== null ? points(dailySigma * 100, ctx) : null;

  const higher = best ? RATIOS.find((r) => r > best.rrr) : undefined;
  const higherBest = higher !== undefined ? bestForRatio(setups, higher) : null;
  const higherNeed = higher !== undefined && higherBest && higherBest.fit !== "fits" && swingSigma !== null ? daysToFit(swingSigma, higher, customStopPct) : null;
  const oneToOneNeed = swingSigma !== null ? daysToFit(swingSigma, RATIOS[0], customStopPct) : null;
  const heldOvernight = intraday ? "Held overnight for" : "Hold";

  const mostLikelyToWin = leaderboard[0];
  const mostLikelyToLose = leaderboard[leaderboard.length - 1];
  // Past a point a bigger target is too far to be reached and the odds stop changing: those RRRs share the end of the list.
  const tied = (a: Setup, b: Setup) => Math.abs(a.odds.endsUp - b.odds.endsUp) < 0.005;
  const winners = leaderboard.filter((r) => tied(r, mostLikelyToWin));
  const losers = leaderboard.filter((r) => tied(r, mostLikelyToLose));
  const rrrList = (rows: Setup[]) => (rows.length === 1 ? rrrLabel(rows[0].rrr) : `${rows.slice(0, -1).map((r) => rrrLabel(r.rrr)).join(", ")} and ${rrrLabel(rows[rows.length - 1].rrr)}`);

  return (
    <div className="flex flex-col gap-6">
      <Reveal index={0}>
        <p className="text-sm text-muted-foreground">
          Pick an index and how long you&apos;d hold — a few days, or just today. It measures how much that market actually moves, then shows which reward-for-the-risk and which size of stop and target — 1:2 or 1:3, 2% : 4% or 5% : 10% —
          fit that movement, and which RRRs win more often and which lose more often. It doesn&apos;t use your positions.
        </p>
      </Reveal>

      <Reveal index={1}>
        <Section step={1} title="The market" subtitle="Volatility is how far the market typically moves. It is measured from the index's own daily history.">
          <div role="group" aria-label="Index" className="flex flex-wrap gap-2">
            {INDEX_INSTRUMENTS.map((i) => (
              <button key={i} type="button" aria-pressed={instrument === i} onClick={() => update({ instrument: i })} className={pillButton(instrument === i)}>
                {INSTRUMENT_LABELS[i]}
              </button>
            ))}
          </div>

          {volatility.status === "loading" && manualAnnualPct === null && <LoadingState className="h-24" label={`Measuring ${indexName}'s volatility…`} />}

          {volatility.status === "error" && (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-background p-4 text-sm">
              <p className="font-medium">Couldn&apos;t measure {indexName}&apos;s volatility.</p>
              <p className="text-muted-foreground">
                {volatility.message}
                {volatility.tokenExpired && " Add today's token in Settings, then try again — or type a volatility yourself."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={volatility.retry} className={pillButton(false)}>
                  Try again
                </button>
                {manualAnnualPct === null && (
                  <button type="button" onClick={() => update({ manualAnnualPct: 15 })} className={pillButton(false)}>
                    Type a volatility myself
                  </button>
                )}
              </div>
            </div>
          )}

          {data && (
            <div className="flex flex-col gap-2">
              <span id="rp-window-label" className={eyebrow}>
                Measured over
              </span>
              <div role="group" aria-labelledby="rp-window-label" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {VOLATILITY_WINDOWS.map((w) => {
                  const v = data.windows.find((x) => x.days === w);
                  const selected = manualAnnualPct === null && measured?.days === w;
                  const used = v ? (intraday ? (v.intraday ?? v.daily) : v.daily) : null;
                  const other = v ? (intraday ? { value: v.daily, label: "close to close" } : v.intraday !== null ? { value: v.intraday, label: "inside a session" } : null) : null;
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={selected}
                      disabled={!v}
                      onClick={() => update({ window: w, manualAnnualPct: null })}
                      className={`flex flex-col items-start gap-0.5 rounded-xl border bg-background p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong"
                      }`}
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {WINDOW_LABELS[w]} · {w} sessions
                      </span>
                      <span className="font-mono text-lg font-semibold tabular-nums">{used !== null ? `${(used * 100).toFixed(2)}% ${unit(ctx)}` : "not enough history"}</span>
                      {v && (
                        <span className="text-xs text-muted-foreground">
                          {other ? `${(other.value * 100).toFixed(2)}% ${other.label} · ` : ""}
                          {(v.annual * 100).toFixed(1)}% a year
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {indexName} closed at <span className="font-mono">{formatLevel(data.lastClose)}</span> on {formatDay(data.asOf)}; the figures run up to that close.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span id="rp-days-label" className={eyebrow}>
              Hold at most
            </span>
            <div role="group" aria-labelledby="rp-days-label" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={intraday} onClick={() => update({ intraday: true })} className={pillButton(intraday)}>
                Intraday
              </button>
              {HORIZONS.map((d) => (
                <button key={d} type="button" aria-pressed={!intraday && prefs.days === d} onClick={() => update({ intraday: false, days: d })} className={pillButton(!intraday && prefs.days === d)}>
                  {d} {d === 1 ? "day" : "days"}
                </button>
              ))}
            </div>
            {intraday && (
              <div className="mt-1 flex flex-col gap-1.5">
                <span id="rp-start-label" className="text-xs font-medium text-muted-foreground">
                  Opening the trade at — closed by 3:30 pm
                </span>
                <div role="group" aria-labelledby="rp-start-label" className="flex flex-wrap gap-2">
                  {INTRADAY_STARTS.map((s) => (
                    <button key={s.label} type="button" aria-pressed={prefs.intradayLeft === s.left} onClick={() => update({ intradayLeft: s.left })} className={pillButton(prefs.intradayLeft === s.left)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Try my own stop (%)</span>
              <div className="flex items-center gap-2">
                <Stepper id="rp-stop" label="my own stop in percent" value={customStopPct ?? NaN} onChange={(v) => update({ customStopPct: v })} step={intraday ? 0.25 : 0.5} min={0.1} max={50} precision={2} width="w-16" placeholder={intraday ? "e.g. 0.6" : "e.g. 2.5"} large />
                {customStopPct !== null && (
                  <button type="button" onClick={() => update({ customStopPct: null })} className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input
                  type="checkbox"
                  checked={manualAnnualPct !== null}
                  onChange={(e) => update({ manualAnnualPct: e.target.checked ? Math.round((measured?.annual ?? 0.15) * 1000) / 10 : null })}
                  className="size-4 accent-[var(--accent-solid)]"
                />
                <span>Use my own volatility</span>
              </label>
              {manualAnnualPct !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Stepper id="rp-vol" label="annual volatility in percent" value={manualAnnualPct} onChange={(v) => update({ manualAnnualPct: v })} step={0.5} min={1} max={200} precision={1} width="w-16" large />
                  <span>% a year</span>
                </div>
              )}
            </div>
          </div>

          {noOpens && <p className="text-xs text-warning">This index&apos;s history has no opening prices, so a session&apos;s move is taken as a full day&apos;s, close to close.</p>}
          {manualAnnualPct === null && !intraday && (
            <p className="text-xs text-muted-foreground">
              Bigger pairs like 4% : 8% or 5% : 10% suit stocks and longer holds better than an index. Trading a stock? It usually moves more than the index — tick &ldquo;Use my own volatility&rdquo; and type its yearly volatility.
            </p>
          )}

          {dailySigma !== null && annualPct !== null && wander !== null && (
            <p className="text-sm">
              {manualAnnualPct !== null
                ? `At the volatility you typed, a normal ${intraday ? "session" : "day"} moves`
                : intraday
                  ? `${indexName} has been moving, from the open to the close in a typical session,`
                  : `${indexName} has been moving`}{" "}
              <strong className="font-semibold">{(dailySigma * 100).toFixed(2)}%</strong>
              {normalPoints !== null && <span> (about {normalPoints.toLocaleString("en-IN")} points)</span>} — {annualPct.toFixed(1)}% a year. Over {holdText(ctx)} it typically wanders about{" "}
              <strong className="font-semibold">±{wander.toFixed(1)}%</strong>
              {points(wander, ctx) !== null && <span> ({points(wander, ctx)?.toLocaleString("en-IN")} points)</span>}, so a stop or target much beyond that rarely gets reached in time, and one much inside the early noise gets hit by ordinary movement.
            </p>
          )}
        </Section>
      </Reveal>

      {dailySigma !== null && (
        <>
          <Reveal index={2}>
            <Section
              step={2}
              title={intraday ? "What to go for today" : "Which to go with"}
              subtitle={`1:1, 1:2 and 1:3, each at the size of stop that suits ${manualAnnualPct !== null ? "this volatility" : indexName} over ${holdText(ctx)}.`}
            >
              {best ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-4 sm:p-5">
                  <p className="text-lg font-semibold tracking-tight">
                    {intraday ? "Today:" : "Go with"} {rrrLabel(best.rrr)} — risk {best.stopPct}%, aim for {best.targetPct}%
                    {points(best.stopPct, ctx) !== null && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (≈ {points(best.stopPct, ctx)?.toLocaleString("en-IN")} points risked, {points(best.targetPct, ctx)?.toLocaleString("en-IN")} aimed for)
                      </span>
                    )}
                  </p>
                  <p className="text-sm">
                    A {best.stopPct}% stop is {best.stopInMoves.toFixed(1)} normal {intraday ? "sessions" : "days"} of movement away, so ordinary movement {intraday ? "in the first hour" : "on the first day"} knocks you out {pct(best.odds.stopEarly)} of the time.
                    Held up to {holdText(ctx)}, {pct(best.odds.win)} of these trades hit the target, {pct(best.odds.loss)} hit the stop and {pct(best.odds.open)} are still open and get closed at the market. It needs {pct(best.breakEvenWin)}{" "}
                    wins to break even.
                  </p>
                  {higher !== undefined && higherBest && higherBest.fit !== "fits" && (
                    <p className="text-sm text-muted-foreground">
                      {rrrLabel(higher)} is {higherBest.fit === "tight" ? "too tight" : "too slow"} here: {reason(higherBest, ctx).charAt(0).toLowerCase()}
                      {reason(higherBest, ctx).slice(1)}{" "}
                      {higherNeed !== null
                        ? `${heldOvernight} about ${dayCount(higherNeed)}${higherBest.fit === "tight" ? ", with a wider stop," : ""} and a ${rrrLabel(higher)} fits.`
                        : "It doesn't fit at any holding period offered."}
                    </p>
                  )}
                  {higher === undefined && <p className="text-sm text-muted-foreground">That is the biggest reward for the risk offered here, so you can be wrong {pct(1 - best.breakEvenWin)} of the time and still break even.</p>}
                </div>
              ) : (
                <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-border bg-background p-4 text-sm sm:p-5">
                  <p className="font-medium">Nothing fits this market for {holdText(ctx)}.</p>
                  <p className="text-muted-foreground">
                    Every pair is either inside the early noise or too far away to arrive in time.{" "}
                    {intraday && ctx.days < 1 ? "Try an earlier start. " : ""}
                    {oneToOneNeed !== null ? `${heldOvernight} about ${dayCount(oneToOneNeed)} and a 1:1 starts to fit.` : "Try a longer holding period or a higher volatility."}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {RATIOS.map((r) => {
                  const s = bestForRatio(setups, r);
                  return s && swingSigma !== null ? <RatioCard key={r} setup={s} best={best} c={ctx} swingSigma={swingSigma} customStopPct={customStopPct} /> : null;
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                None of these has an edge on its own: a 1:2 wins about a third of the time and a 1:3 about a quarter, and that is the whole of what the reward buys. What the volatility decides is whether a pair finishes the way it is drawn.
              </p>
            </Section>
          </Reveal>

          {leaderStop !== null && mostLikelyToWin && mostLikelyToLose && (
            <Reveal index={3}>
              <Section
                step={3}
                title="Most likely to win → most likely to lose"
                subtitle={`Every RRR at one stop, held up to ${holdText(ctx)}, from the one that ends in profit most often to the one that ends in a loss most often.`}
              >
                <div className="flex flex-col gap-1.5">
                  <span id="rp-rank-label" className={eyebrow}>
                    At a stop of
                  </span>
                  <div role="group" aria-labelledby="rp-rank-label" className="flex flex-wrap gap-2">
                    {stops.map((s) => (
                      <button key={s} type="button" aria-pressed={leaderStop === s} onClick={() => setRankStop(s)} className={pillButton(leaderStop === s)}>
                        {s}%{points(s, ctx) !== null && <span className="font-mono text-xs opacity-70">{points(s, ctx)} pts</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {winners.length === leaderboard.length ? (
                  <p className="text-sm">
                    Every one of these ends in profit about as often ({pct(mostLikelyToWin.odds.endsUp)}): at this stop even the smallest target is too far to change the odds. Try a smaller stop.
                  </p>
                ) : (
                  <p className="text-sm">
                    Most likely to win: <strong className="font-semibold">{rrrList(winners)}</strong>, ending in profit {pct(mostLikelyToWin.odds.endsUp)} of the time. Most likely to lose:{" "}
                    <strong className="font-semibold">{rrrList(losers)}</strong>, {losers.length > 1 ? "each " : ""}ending in a loss {pct(mostLikelyToLose.odds.endsDown)} of the time.
                    {losers.length > 1 &&
                      ` Past ${rrrLabel(losers[0].rrr)} the target is too far to be reached in time (hit ${pct(losers[0].odds.win)} of the time or less), so a bigger one changes nothing.`}
                  </p>
                )}

                <Leaderboard rows={leaderboard} c={ctx} />

                <div className="rounded-xl border border-border bg-background p-3.5 text-sm text-muted-foreground">
                  <p>
                    <strong className="font-medium text-foreground">Winning more often is not making more money.</strong> In every row the chance of a profit times the typical win equals the chance of a loss times the typical loss, so each one averages out
                    to nothing before costs — and costs make every one a little negative. The RRRs that win more often win small and lose big; the ones that lose more often lose small and win big. Which to choose depends on whether you can read
                    direction well enough to beat the odds shown, which the volatility can&apos;t tell you.
                  </p>
                  <p className="mt-2">&ldquo;Ends in profit&rdquo; counts a trade still open at the close if it is ahead, and &ldquo;ends in loss&rdquo; one that is behind.</p>
                </div>
              </Section>
            </Reveal>
          )}

          <Reveal index={4}>
            <Section step={4} title="Every pair" subtitle={`Percent of price you risk : percent you aim for, held up to ${holdText(ctx)}. Green is the target, red the stop, grey still open.`}>
              <div className={`relative overflow-x-auto rounded-xl border border-border bg-background ${thinScroll}`}>
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Each stop-and-target pair with how often it hits the target, hits the stop or is still open, and whether it fits the market</caption>
                  <thead>
                    <tr className="border-b border-border text-right">
                      <th scope="col" className={`${tableHead} text-left`}>Stop : target</th>
                      <th scope="col" className={`${tableHead} text-left`}>RRR</th>
                      <th scope="col" className={tableHead}>Stop is</th>
                      <th scope="col" className={tableHead}>Hits target</th>
                      <th scope="col" className={tableHead}>Hits stop</th>
                      <th scope="col" className={tableHead}>Still open</th>
                      <th scope="col" className={tableHead}>{intraday ? "Avg hours" : "Avg days"}</th>
                      <th scope="col" className={`${tableHead} text-left`}>Fit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setups.map((s) => {
                      const isBest = best === s;
                      return (
                        <tr key={`${s.stopPct}-${s.rrr}`} title={reason(s, ctx)} className={`border-b border-border text-right last:border-0 ${isBest ? "bg-accent/10" : ""}`}>
                          <th scope="row" className="whitespace-nowrap px-2.5 py-2 text-left font-mono font-semibold tabular-nums">
                            {pairLabel(s.stopPct, s.targetPct)}
                            {s.custom && <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-accent">yours</span>}
                            {isBest && <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-accent">best</span>}
                          </th>
                          <td className="whitespace-nowrap px-2.5 py-2 text-left font-mono tabular-nums">{rrrLabel(s.rrr)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{s.stopInMoves.toFixed(1)}× {unit(ctx)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">{pct(s.odds.win)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums">{pct(s.odds.loss)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{pct(s.odds.open)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-muted-foreground">{intraday ? (s.odds.days * SESSION_HOURS).toFixed(1) : s.odds.days.toFixed(1)}</td>
                          <td className="px-2.5 py-2 text-left">
                            <FitChip fit={s.fit} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </Reveal>
        </>
      )}

      <details className="rounded-xl border border-border bg-background p-4 text-sm">
        <summary className={`cursor-pointer ${eyebrow}`}>How these numbers are made</summary>
        <div className="mt-3 flex flex-col gap-2 text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Volatility</strong> is the standard deviation of the index&apos;s daily moves over the look-back you pick — {WINDOW_LABELS[20].toLowerCase()}, 3 months or a year of sessions — scaled to a year with the square
            root of {TRADING_DAYS}. A short look-back follows the market&apos;s recent mood; a long one is steadier. For an <strong className="font-medium text-foreground">intraday</strong> trade it is measured from each session&apos;s open to its
            close instead, because the gap between yesterday&apos;s close and today&apos;s open is a move an intraday trade never sits through. The session is taken as 9:15 to 15:30 (6¼ hours) with movement spread evenly across it, so a later start
            has proportionally less time; in practice the open and the close are busier than the middle.
          </p>
          <p>
            For each pair the trade&apos;s profit and loss is treated as a random walk with no drift whose size is that volatility: it is stopped out if it falls to the stop, wins if it rises to the target, and is closed on the last day or at the close if
            neither has happened. The chances come from the exact solution of that walk (no sampling), and they agree with a simulation. Percentages are of the entry price, so the same pair works for an index, a stock or an option&apos;s underlying.
          </p>
          <p>
            <strong className="font-medium text-foreground">Too tight</strong> means ordinary movement stops the trade out: the stop is hit {pct(TIGHT_STOP_DAY1)} or more of the time within the first day (the first hour, intraday).{" "}
            <strong className="font-medium text-foreground">Too slow</strong> means less than {pct(REACH_MIN)} of the wins the pair needs to break even arrive before you must be out. <strong className="font-medium text-foreground">Fits</strong> is
            neither. The pick is the biggest reward for the risk among those that fit — it lets you be wrong most often — at the widest stop that still fits. Those two limits are rules of thumb, not laws.
          </p>
          <p>
            <strong className="font-medium text-foreground">Ends in profit and ends in loss</strong> count every trade by where it finishes: a trade that reaches the target or the stop finishes there, and one still open when you must be out finishes wherever the
            price is. They add to 100%. The typical win and loss are the averages of those two groups.
          </p>
          <p>
            <strong className="font-medium text-foreground">What this can&apos;t tell you.</strong> It assumes a fairly priced market, where no pair beats another on average: the reward you aim for only changes how often you win. A trend you can
            see, or a level that holds, is the thing that gives a pair an edge, and that is yours to judge. Real markets also gap past stops and have fatter tails than this walk, so a stop can lose more than planned. Costs and slippage are not in
            the figures. This is arithmetic, not a forecast or advice.
          </p>
        </div>
      </details>
    </div>
  );
}
