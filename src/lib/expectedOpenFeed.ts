/**
 * Server side of the expected MCX open (the arithmetic and rules are in expectedOpen.ts): gathers, for natural gas and
 * crude oil, MCX's last price and the time it last traded (Upstox), then the price of the NYMEX contract it follows at
 * that moment and now (Yahoo Finance).
 *
 * Only MCX's *front-month future* is asked of Upstox - one quote call for both - and when every market is trading, that
 * is all that happens: Yahoo is not touched while MCX is open.
 *
 * The NYMEX price at the moment MCX last traded can never change once it is known, so it is kept for good (a few numbers
 * a day) and fetched once, as a small window of 1-minute candles around that moment. The current NYMEX price is what
 * moves, and the whole result is shared for a few seconds between tabs so the polls don't each cost a round of requests.
 *
 * The Natural gas tab can ask about a natural gas future of its own choosing (see natgasContract.ts) instead of the front month: then
 * that contract's last price and the NYMEX month it follows are used, the list of futures comes back too, and whether MCX is trading
 * is still read off the front month (a thin far month can sit quiet while MCX trades). Each choice is kept and shared on its own.
 */

import {
  assembleExpectedOpen,
  EXPECTED_OPEN_MARKETS,
  lastScheduledCloseMs,
  nymexContractFor,
  parseMcxQuote,
  type ExpectedOpenError,
  type ExpectedOpenMarket,
  type ExpectedOpenResult,
  type MarketInput,
  type NatgasChoice,
  type UsdInr,
} from "@/lib/expectedOpen";
import { istDateString } from "@/lib/calculateStrategy";
import { fetchYahooChart } from "@/lib/globalMarketsFeed";
import { parseYahooCandles, parseYahooMeta, priceBefore } from "@/lib/globalMarkets";
import { contractMonthLabel } from "@/lib/mcxCommodities";
import type { ContractError, NatgasFuture } from "@/lib/natgasContract";
import { chooseContract, listNatgasFutures, resetContractChoice } from "@/lib/natgasContractFeed";
import { isUpstoxGetError, upstoxData, upstoxGet } from "@/lib/upstox/api";
import { getMcxContracts, isMcxError, type McxFuture } from "@/lib/upstox/mcx";

/** How long a whole result is reused. */
export const EXPECTED_OPEN_TTL_MS = 10_000;
/** Yahoo keeps 1-minute candles for about a month; asking further back than this would only fail. */
const MAX_REFERENCE_AGE_MS = 25 * 86_400_000;
const MAX_REFERENCES = 60;
/** The rupee barely moves in a minute, so one answer serves every poll for that long. */
const USD_INR_TTL_MS = 60_000;

type Quote = { price: number; lastTradeMs: number | null };

export type ExpectedOpenDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** The current-month future of each market, by MCX symbol. */
  getFutures?: () => Promise<Map<string, McxFuture> | { error: string; status: number }>;
  /** Upstox quotes for the given instrument keys, by key. */
  getQuotes?: (token: string, keys: string[]) => Promise<Map<string, Quote> | { error: string; status: number }>;
  /** Every natural gas future still listed - asked for only when a contract was chosen. */
  getNatgasFutures?: (todayIso: string) => Promise<NatgasFuture[] | ContractError>;
  /** Which of them a choice ("default", "auto" or a key) means. */
  chooseContract?: typeof chooseContract;
};

/** How many choices are kept at once: the listed futures and "auto", with room to spare. */
const MAX_CHOICES = 16;

const references = new Map<string, number>();
let usdInrCache: { at: number; value: UsdInr } | null = null;
/** The whole result, and the one being fetched, for each choice of natural gas contract ("" for none: the front month). */
const cached = new Map<string, { at: number; result: ExpectedOpenResult }>();
const inFlight = new Map<string, Promise<ExpectedOpenResult | ExpectedOpenError>>();

/** For tests: forget everything fetched. */
export function resetExpectedOpenFeed(): void {
  references.clear();
  usdInrCache = null;
  cached.clear();
  inFlight.clear();
  resetContractChoice();
}

async function defaultGetFutures() {
  const mcx = await getMcxContracts();
  return isMcxError(mcx) ? { error: mcx.error, status: mcx.status } : mcx.futures;
}

async function defaultGetQuotes(token: string, keys: string[]) {
  const result = await upstoxGet(token, `/v2/market-quote/quotes?${new URLSearchParams({ instrument_key: keys.join(",") })}`);
  if (isUpstoxGetError(result)) return { error: result.error, status: result.status };
  const data = upstoxData(result.body);
  const out = new Map<string, Quote>();
  if (data && typeof data === "object") {
    // Matched on each entry's own instrument_token: the response's object key is Upstox's own format to change.
    for (const entry of Object.values(data as Record<string, { instrument_token?: string }>)) {
      const parsed = parseMcxQuote(entry);
      if (entry?.instrument_token && parsed) out.set(entry.instrument_token, parsed);
    }
  }
  return out;
}

/**
 * Rupees per dollar, kept for a minute. A failed fetch gives the last good rate (its `asOf` says how old) rather than none: a rate a
 * little old is far better for showing prices in rupees than no rate.
 */
async function usdInrNow(nowMs: number, fetchImpl: typeof fetch): Promise<UsdInr | null> {
  if (usdInrCache && nowMs - usdInrCache.at < USD_INR_TTL_MS) return usdInrCache.value;
  const meta = parseYahooMeta(await fetchYahooChart("INR=X", "?interval=1d&range=1d", fetchImpl));
  if (!meta || !(meta.price > 0)) return usdInrCache?.value ?? null;
  usdInrCache = { at: nowMs, value: { rate: meta.price, asOf: meta.asOf } };
  return usdInrCache.value;
}

/**
 * The NYMEX contract's price at `closeMs`, or null while it isn't known yet - Yahoo runs ~10 minutes behind, so for a
 * few minutes after MCX closes the candles for that moment haven't arrived. Only a found price is kept.
 */
async function nymexAtClose(symbol: string, closeMs: number, nowMs: number, fetchImpl: typeof fetch): Promise<number | null> {
  const key = `${symbol}@${closeMs}`;
  const known = references.get(key);
  if (known !== undefined) return known;
  if (nowMs - closeMs > MAX_REFERENCE_AGE_MS) return null;

  const from = Math.floor(closeMs / 1000) - 1800;
  const to = Math.floor(closeMs / 1000) + 600;
  const body = await fetchYahooChart(symbol, `?interval=1m&period1=${from}&period2=${to}`, fetchImpl);
  const price = priceBefore(parseYahooCandles(body), closeMs);
  if (price === null) return null;

  if (references.size >= MAX_REFERENCES) references.delete(references.keys().next().value as string);
  references.set(key, price);
  return price;
}

type Resolved = Required<Pick<ExpectedOpenDeps, "fetchImpl" | "now" | "getFutures" | "getQuotes" | "getNatgasFutures" | "chooseContract">>;
type Picked = Omit<NatgasChoice, "last">;

/** The natural gas future a choice means, and the futures it was made from; null when none is listed (the answer is then "no contract", as ever). */
async function pickNatgas(token: string, deps: Resolved, choice: string, nowMs: number): Promise<Picked | ContractError | null> {
  const today = istDateString(nowMs);
  const listed = await deps.getNatgasFutures(today);
  if ("error" in listed) return listed;
  if (listed.length === 0) return null;
  const chosen = await deps.chooseContract(token, listed, choice, today, { now: deps.now });
  return "error" in chosen ? chosen : { contracts: listed, contract: chosen.contract, choice: chosen.choice };
}

async function build(token: string, deps: Resolved, choice: string | null): Promise<ExpectedOpenResult | ExpectedOpenError> {
  const futures = await deps.getFutures();
  if ("error" in futures) return { error: futures.error };

  const nowMs = deps.now();
  const picked = choice === null ? null : await pickNatgas(token, deps, choice, nowMs);
  if (picked && "error" in picked) return { error: picked.error };

  // Each market's contract: its front month, except natural gas when a future was chosen. The front month is still quoted then, because
  // it is the one that says whether MCX is trading.
  const front = futures.get("NATURALGAS");
  const futureOf = new Map<ExpectedOpenMarket, { key: string; expiry: string } | undefined>(
    EXPECTED_OPEN_MARKETS.map((m) => [m, m === "NATURALGAS" && picked ? picked.contract : futures.get(m)]),
  );
  const keys = [...new Set([...futureOf.values(), front].flatMap((f) => (f ? [f.key] : [])))];
  const quoted = keys.length > 0 ? await deps.getQuotes(token, keys) : new Map<string, Quote>();
  if (!(quoted instanceof Map)) return { error: quoted.error };
  const withChoice = (result: ExpectedOpenResult): ExpectedOpenResult => (picked ? { ...result, natgas: { ...picked, last: quoted.get(picked.contract.key) ?? null } } : result);

  // First pass, with no NYMEX prices yet: all it settles is which markets are shut (from the clock and the last trade).
  const gathered = EXPECTED_OPEN_MARKETS.map((market): MarketInput => {
    const future = futureOf.get(market);
    if (!future) return { market, contract: null, mcx: null, nymex: null };
    const contract = { label: contractMonthLabel(future.expiry), expiry: future.expiry };
    const mcx = quoted.get(future.key) ?? null;
    const nymex = nymexContractFor(market, future.expiry);
    const stateLastTradeMs = market === "NATURALGAS" && picked && front ? (quoted.get(front.key)?.lastTradeMs ?? null) : undefined;
    return { market, contract, mcx, stateLastTradeMs, nymex: nymex ? { ...nymex, atClose: null, now: null } : null };
  });

  // Yahoo is only asked about the markets that are shut - while MCX trades, none of it is touched.
  const shut = assembleExpectedOpen(nowMs, gathered);
  const needed = new Set(shut.items.map((item) => item.market));
  if (needed.size === 0) return withChoice(shut);

  const withNymex = Promise.all(
    gathered.map(async (input): Promise<MarketInput> => {
      if (!needed.has(input.market) || !input.mcx || !input.nymex) return input;
      // The moment MCX last traded; the scheduled close if Upstox didn't say (otherwise this would wait for ever).
      const closeMs = input.mcx.lastTradeMs ?? lastScheduledCloseMs(nowMs);
      const [atClose, current] = await Promise.all([
        nymexAtClose(input.nymex.symbol, closeMs, nowMs, deps.fetchImpl),
        fetchYahooChart(input.nymex.symbol, "?interval=1d&range=1d", deps.fetchImpl).then(parseYahooMeta),
      ]);
      return { ...input, nymex: { ...input.nymex, atClose, now: current ? { price: current.price, asOf: current.asOf } : null } };
    }),
  );
  // The rupee rate is asked alongside, once for all markets: the desk shows NYMEX's dollars in rupees too.
  const [filled, usdInr] = await Promise.all([withNymex, usdInrNow(nowMs, deps.fetchImpl)]);
  return withChoice(assembleExpectedOpen(nowMs, filled, usdInr));
}

/**
 * Where natural gas and crude oil are expected to open, or an error from Upstox ("token_expired" when its token has lapsed).
 * `choice`: for natural gas, "default", "auto" or an instrument key (see natgasContract.ts); null for the front month.
 */
export async function getExpectedOpen(token: string, deps: ExpectedOpenDeps = {}, choice: string | null = null): Promise<ExpectedOpenResult | ExpectedOpenError> {
  const resolved: Resolved = {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? Date.now,
    getFutures: deps.getFutures ?? defaultGetFutures,
    getQuotes: deps.getQuotes ?? defaultGetQuotes,
    getNatgasFutures: deps.getNatgasFutures ?? listNatgasFutures,
    chooseContract: deps.chooseContract ?? chooseContract,
  };
  const key = choice ?? "";
  const held = cached.get(key);
  if (held && resolved.now() - held.at < EXPECTED_OPEN_TTL_MS) return held.result;
  const running = inFlight.get(key);
  if (running) return running;

  const run = build(token, resolved, choice)
    .then((result) => {
      // Only a good result is shared; an Upstox error (a lapsed token) should be retried on the next poll.
      if (!("error" in result)) {
        if (cached.size >= MAX_CHOICES && !cached.has(key)) cached.delete(cached.keys().next().value as string);
        cached.set(key, { at: resolved.now(), result });
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, run);
  return run;
}
