/**
 * Pure maths behind Live Portfolio's "RRR planner": given how much a market actually moves (its
 * volatility) and how long you will hold, which stop-and-target pairs - 2% : 4%, 5% : 10%, at 1:2 or 1:3
 * - play out the way they are drawn, and which are set up to fail. Nothing here reads a position, a price
 * or the network; the volatility comes in as a number (see volatility.ts for measuring it).
 *
 * The model: the trade's percentage profit and loss does a random walk with no drift whose daily size is
 * the volatility. A trade enters at 0, is stopped out if the price falls `stop` percent, wins if it rises `target` percent, and
 * is closed on the last day if neither happened. For that walk between two walls the chance of
 * each ending by any day has an exact series (the heat equation on an interval), solved below - no
 * simulation, so it is instant and repeatable.
 *
 * What it can and can't say. With no drift every pair has the same average result - nothing - before costs:
 * a 1:2 wins about a third of the time, a 1:3 about a quarter, and that is the whole of their difference
 * in value. Volatility decides something else: whether a pair even finishes. A stop smaller than a normal
 * day's swing is hit by ordinary movement; a target too far away for the days you'll hold is still
 * waiting when time runs out. "Fits" means neither is true. It is a statement about the fit between the
 * plan and the market, not a forecast of profit.
 */

// --- Tunables -------------------------------------------------------------------------------

/** A stop that a single ordinary day takes out this often is inside the market's noise. */
export const TIGHT_STOP_DAY1 = 0.1;
/**
 * A pair needs to win a certain share of the time to break even (1 ÷ (1 + RRR)). The clock cuts some of
 * those wins short: the winners that would have arrived after you must be out. If the share that does arrive
 * in time falls under this fraction of what the pair needs, the target is mostly out of reach for the days you
 * will hold and the pair is too slow.
 */
export const REACH_MIN = 0.6;

/** Reward for each ₹1 risked on the usual pairs: 1:1, 1:2, 1:3. */
export const RATIOS = [1, 2, 3];
/** Percent of price risked on the usual pairs: from a swing trade's 1% to a positional trade's 5%. */
export const STOP_SCALES = [1, 1.5, 2, 3, 4, 5];
/** Holding periods on offer, in trading days: a day up to about three months (60 sessions) for positional trades. */
export const HORIZONS = [1, 3, 5, 10, 20, 40, 60];

/** A session on the Indian exchanges runs 9:15 to 15:30. */
export const SESSION_HOURS = 6.25;
/**
 * The window in which ordinary noise should not be able to stop an intraday trade out: its first hour, as a
 * share of the session. (A swing trade is judged over its first day; an intraday one has no day to spare.)
 */
export const NOISE_INTRADAY = 1 / SESSION_HOURS;
/** Percent of price risked on intraday trades - a session moves about 0.8%, so a stop is a fraction of that. */
export const INTRADAY_SCALES = [0.25, 0.5, 0.75, 1, 1.5];
/** When an intraday trade may start, and how much of the session is left from then (a share of 6¼ hours). */
export const INTRADAY_STARTS = [
  { label: "9:15 open", left: 1 },
  { label: "10:30", left: 0.8 },
  { label: "12:00", left: 0.56 },
  { label: "1:30 pm", left: 0.32 },
];

/** Reward per ₹1 risked from half the risk to three times it - what the win-or-lose ranking runs over. */
export const LEADERBOARD_RATIOS = [0.5, 1, 1.5, 2, 3];
/** A pair whose chance of ending in profit is within this of 50% is called even odds. */
export const EVEN_BAND = 0.05;

/** Longest series tried; reached only for a near-motionless market or a huge span, where it still leaves the answer within a hair. */
const MAX_TERMS = 4000;
/** A term this small can't move a probability: stop adding. */
const NEGLIGIBLE = 1e-13;

// --- Barrier odds ---------------------------------------------------------------------------

export type Barrier = {
  /** Chance the target is hit first, within the holding period. */
  win: number;
  /** Chance the stop is hit first, within the holding period. */
  loss: number;
  /** Chance neither was hit by the last day: the trade is still open and is closed at whatever the price is. */
  open: number;
  /** Average days the trade lasts, counting an unfinished one as the full holding period. */
  days: number;
  /** Chance the stop is hit within the first stretch of the trade (a day, or an hour for intraday) - i.e. by ordinary noise. */
  stopEarly: number;
  /** Chance the trade ends in profit: the target hit, or still open at the end but ahead. */
  endsUp: number;
  /** Chance it ends in a loss: the stop hit, or still open at the end but behind. */
  endsDown: number;
  /** The typical profit of a trade that ends in profit, in percent of the entry price. */
  avgWin: number;
  /** The typical loss of a trade that ends in a loss, in percent of the entry price (a positive number). */
  avgLoss: number;
};

export type BarrierInput = {
  /** Standard deviation of one day's log return, as a fraction (0.008 = 0.8%). */
  dailySigma: number;
  /** Percent of price at risk: 2 means a stop 2% below the entry. */
  stopPct: number;
  /** Percent of price aimed for: 4 means a target 4% above the entry. */
  targetPct: number;
  /** Trading days held at most (less than 1 for an intraday trade that starts partway through the session). */
  days: number;
  /** How long a stop must survive ordinary noise, in trading days; 1 unless the trade is intraday. */
  noiseDays?: number;
};

/**
 * The walls as distances from the entry, in fractions of the entry price. The walk is the trade's
 * percentage profit and loss, which averages zero: that is what a fair market means, and it makes the
 * chance of reaching the target first, given unlimited time, exactly stop ÷ (stop + target) - the
 * break-even win rate of that RRR. (Measuring in log terms instead would hand a long trade a small
 * edge from nothing but the arithmetic.) `down` is the stop, `up` the target.
 */
function walls(stopPct: number, targetPct: number) {
  const down = stopPct / 100;
  const up = targetPct / 100;
  return { down, up, width: down + up };
}

/** Terms of the series at time `t` (days): each is a mode of the walk's density decaying at its own rate. */
function modes(dailySigma: number, width: number, t: number) {
  const v = (dailySigma * dailySigma) / 2;
  const out: { n: number; rate: number; decay: number }[] = [];
  for (let n = 1; n <= MAX_TERMS; n++) {
    const rate = v * ((n * Math.PI) / width) ** 2;
    const decay = Math.exp(-rate * t);
    if (decay < NEGLIGIBLE) break;
    out.push({ n, rate, decay });
  }
  return out;
}

/** Chance each wall has been hit first by day `t`, from the series: the long-run share each wall is bound to win, less what has yet to arrive. */
function hitByDay(dailySigma: number, down: number, up: number, t: number) {
  const width = down + up;
  let win = down / width; // the target is hit first with probability (distance to the stop) / (width), given unlimited time
  let loss = up / width;
  for (const { n, decay } of modes(dailySigma, width, t)) {
    const c = ((n % 2 === 1 ? 2 : -2) / (n * Math.PI)) * decay;
    win -= c * Math.sin((n * Math.PI * down) / width);
    loss -= c * Math.sin((n * Math.PI * up) / width);
  }
  return { win: Math.min(Math.max(win, 0), 1), loss: Math.min(Math.max(loss, 0), 1) };
}

export function barrierOdds({ dailySigma, stopPct, targetPct, days, noiseDays = 1 }: BarrierInput): Barrier {
  // A market that never moves never reaches either wall: every trade just sits open, and ends exactly where it began.
  if (!(dailySigma > 0)) return { win: 0, loss: 0, open: 1, days, stopEarly: 0, endsUp: 0, endsDown: 0, avgWin: 0, avgLoss: 0 };
  const { down, up, width } = walls(stopPct, targetPct);
  const end = hitByDay(dailySigma, down, up, days);
  const early = hitByDay(dailySigma, down, up, noiseDays);
  const open = Math.max(1 - end.win - end.loss, 0);

  // What is left in the trade at the end, from the same series: how much of the open share is ahead (and by how
  // much), and how long the trade lasted - the full wait until a wall is hit, less what lies beyond the holding period.
  let openAhead = 0;
  let openAheadSize = 0;
  let beyond = 0;
  for (const { n, rate, decay } of modes(dailySigma, width, days)) {
    const k = (n * Math.PI) / width;
    const sine = Math.sin(k * down);
    const sign = n % 2 === 0 ? 1 : -1; // (-1)^n
    openAhead += (2 / (n * Math.PI)) * sine * (Math.cos(k * down) - sign) * decay;
    openAheadSize += (2 / width) * sine * ((-up * sign) / k - sine / (k * k)) * decay;
    if (n % 2 === 1) beyond += ((4 / (n * Math.PI)) * sine * decay) / rate;
  }
  const untilHit = (down * up) / (dailySigma * dailySigma);

  const ahead = Math.min(Math.max(openAhead, 0), open);
  const endsUp = end.win + ahead;
  const endsDown = Math.max(1 - endsUp, 0);
  // A fair market pays out as much in wins as it takes in losses, so the total won is also the total lost.
  const winnings = Math.max(up * end.win + openAheadSize, 0);

  return {
    win: end.win,
    loss: end.loss,
    open,
    days: Math.min(Math.max(untilHit - beyond, 0), days),
    stopEarly: early.loss,
    endsUp,
    endsDown,
    avgWin: endsUp > 1e-12 ? (winnings / endsUp) * 100 : 0,
    avgLoss: endsDown > 1e-12 ? (winnings / endsDown) * 100 : 0,
  };
}

// --- The setups -------------------------------------------------------------------------------

/** How a pair sits in the market: neither problem, stopped out by noise, or too far to arrive in time. */
export type Fit = "fits" | "tight" | "slow";

export type Setup = {
  stopPct: number;
  targetPct: number;
  /** Reward per ₹1 risked: 2 is 1:2. */
  rrr: number;
  /** The win rate this RRR must reach to break even, before costs: 1 ÷ (1 + RRR). */
  breakEvenWin: number;
  /** The stop in units of one normal move: a day's, or a session's when the volatility given is intraday. */
  stopInMoves: number;
  /** How much of the win rate the pair needs arrives within the holding period: wins ÷ break-even win rate, 1 being all of it. */
  reach: number;
  odds: Barrier;
  fit: Fit;
  /** Whether it wins or loses more often, going by the chance of ending in profit. */
  standing: Standing;
  /** One the user asked about, rather than one of the usual scales. */
  custom: boolean;
};

/** Which way a pair leans: ends in profit clearly more often than not, clearly less often, or about as often as not. */
export type Standing = "wins" | "even" | "loses";

export function standingOf(odds: Barrier): Standing {
  if (odds.endsUp >= 0.5 + EVEN_BAND) return "wins";
  if (odds.endsUp <= 0.5 - EVEN_BAND) return "loses";
  return "even";
}

export function fitOf(odds: Barrier, breakEvenWin: number): Fit {
  if (odds.stopEarly >= TIGHT_STOP_DAY1) return "tight";
  if (odds.win / breakEvenWin < REACH_MIN) return "slow";
  return "fits";
}

export function breakEvenWinRate(rrr: number): number {
  return 1 / (1 + rrr);
}

export type PlannerInput = {
  dailySigma: number;
  days: number;
  /** How long a stop must survive ordinary noise, in trading days (see BarrierInput); 1 unless intraday. */
  noiseDays?: number;
  /** The sizes of stop to try, in percent; the usual swing scales unless given. */
  scales?: number[];
  /** The RRRs to try; 1:1, 1:2 and 1:3 unless given. */
  ratios?: number[];
  /** A stop of the user's own, added alongside the scales. */
  customStopPct?: number | null;
};

/** The target for a stop at a given RRR, rounded to a tidy figure (a 1% stop at 1:3 is a 3% target). */
const target = (stopPct: number, rrr: number) => Math.round(stopPct * rrr * 100) / 100;

function setup(dailySigma: number, days: number, noiseDays: number | undefined, stopPct: number, rrr: number, custom: boolean): Setup {
  const targetPct = target(stopPct, rrr);
  const odds = barrierOdds({ dailySigma, stopPct, targetPct, days, noiseDays });
  const breakEvenWin = breakEvenWinRate(rrr);
  return {
    stopPct,
    targetPct,
    rrr,
    breakEvenWin,
    stopInMoves: stopPct / 100 / dailySigma,
    reach: odds.win / breakEvenWin,
    odds,
    fit: fitOf(odds, breakEvenWin),
    standing: standingOf(odds),
    custom,
  };
}

/** Every stop at every RRR (plus the user's own stop), smallest stop first and within a stop the smallest RRR first. */
export function buildSetups({ dailySigma, days, noiseDays, scales = STOP_SCALES, ratios = RATIOS, customStopPct }: PlannerInput): Setup[] {
  const custom = customStopPct != null && customStopPct > 0 && !scales.includes(customStopPct) ? customStopPct : null;
  const stops = custom === null ? scales : [...scales, custom].sort((a, b) => a - b);
  return stops.flatMap((stop) => ratios.map((rrr) => setup(dailySigma, days, noiseDays, stop, rrr, stop === custom)));
}

/**
 * One stop at a range of RRRs, from the one most likely to end in profit to the one most likely to end in a
 * loss. A smaller reward for the risk wins more often and a bigger one loses more often, but the wins of the
 * first are small and its losses big (and the reverse), so the average stays near zero in a fair market -
 * which is why the typical win and loss sit beside the odds.
 */
export function buildLeaderboard({
  dailySigma,
  days,
  noiseDays,
  stopPct,
  ratios = LEADERBOARD_RATIOS,
}: Pick<PlannerInput, "dailySigma" | "days" | "noiseDays" | "ratios"> & { stopPct: number }): Setup[] {
  return ratios.map((rrr) => setup(dailySigma, days, noiseDays, stopPct, rrr, false)).sort((a, b) => b.odds.endsUp - a.odds.endsUp || a.rrr - b.rrr);
}

/**
 * The pair to go with: among those that fit, the biggest reward for the risk (it lets you be wrong
 * more often), and at that RRR the widest stop that still finishes on time (the least exposed to
 * noise). Null when nothing fits.
 */
export function bestFit(setups: Setup[]): Setup | null {
  const fits = setups.filter((s) => s.fit === "fits");
  if (fits.length === 0) return null;
  return fits.reduce((best, s) => (s.rrr > best.rrr || (s.rrr === best.rrr && s.stopPct > best.stopPct) ? s : best));
}

/** How far a pair is from fitting: 0 is fine, bigger is worse. Used only to pick the closest when none fits. */
function misfit(s: Setup): number {
  return Math.max(s.odds.stopEarly / TIGHT_STOP_DAY1, REACH_MIN / Math.max(s.reach, 1e-9));
}

/** The best stop for one RRR: the widest that fits, else the one that misses fitting by least. Null when that RRR has no setup. */
export function bestForRatio(setups: Setup[], rrr: number): Setup | null {
  const own = setups.filter((s) => s.rrr === rrr);
  if (own.length === 0) return null;
  const fits = own.filter((s) => s.fit === "fits");
  if (fits.length > 0) return fits.reduce((a, b) => (b.stopPct > a.stopPct ? b : a));
  return own.reduce((a, b) => (misfit(b) < misfit(a) ? b : a));
}

/** The shortest holding period on offer at which some stop at this RRR would fit; null when none of them would. */
export function daysToFit(dailySigma: number, rrr: number, customStopPct?: number | null): number | null {
  for (const days of HORIZONS) {
    const setups = buildSetups({ dailySigma, days, customStopPct }).filter((s) => s.rrr === rrr);
    if (setups.some((s) => s.fit === "fits")) return days;
  }
  return null;
}

/** "1:2" - risk first, as traders write it. */
export function rrrLabel(rrr: number): string {
  return `1:${Number(rrr.toFixed(2))}`;
}

/** "2% : 4%" for a stop of 2 and a target of 4. */
export function pairLabel(stopPct: number, targetPct: number): string {
  return `${Number(stopPct.toFixed(2))}% : ${Number(targetPct.toFixed(2))}%`;
}

/** How far the market typically wanders in the time you'll hold - one standard deviation over `days` trading days, in percent. */
export function expectedMovePct(dailySigma: number, days: number): number {
  return dailySigma * Math.sqrt(days) * 100;
}
