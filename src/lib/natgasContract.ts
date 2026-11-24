/**
 * Which MCX natural gas future the natural gas tabs are about. Both the Trade plan and the Natural gas tab offer every future still
 * listed, and one saved choice serves both:
 *
 *   "default"  the nearest contract with more than ROLL_DAYS days to run (so Dec-26 while Nov-26 expires tomorrow, and it moves on by itself)
 *   "auto"     the one with the most business in the last completed session, of the first two
 *   MCX_FO|n   an Upstox instrument key: exactly that contract (one no longer listed falls back to the default)
 *
 * The rules, pure and safe to import from the page. The parts that read Upstox are in natgasContractFeed.ts.
 */

import { contractMonthLabel } from "@/lib/mcxCommodities";

const DAY_MS = 86_400_000;

/** Which future: "default", "auto", or an Upstox instrument key. */
export type ContractPref = "default" | "auto" | `MCX_FO|${string}`;

/** What a saved choice or a request may carry for the contract: anything else is refused (the key is only ever an Upstox instrument key). */
export function parseContractPref(value: unknown): ContractPref | null {
  return typeof value === "string" && (value === "default" || value === "auto" || /^MCX_FO\|\d+$/.test(value)) ? (value as ContractPref) : null;
}

export type NatgasFuture = { key: string; expiry: string; label: string };
export type ActiveContract = NatgasFuture & { reason: string };
/** How the contract was picked: by the default rule, by volume (auto), or by the user. */
export type ContractChoice = "default" | "auto" | "chosen";

export type ContractError = { error: string; status?: number };

/**
 * Of the first two unexpired contracts, the one with the larger traded volume over the last completed session; the nearer one when
 * the volumes are unknown or level. Exported for testing.
 */
export function chooseActive(futures: readonly NatgasFuture[], volumes: ReadonlyMap<string, number | null>): ActiveContract {
  const [near, next] = futures;
  if (!next) return { ...near, reason: "the only contract listed" };
  const a = volumes.get(near.key);
  const b = volumes.get(next.key);
  if (a == null || b == null) return { ...near, reason: "nearest expiry (volumes unavailable)" };
  const n = (v: number) => v.toLocaleString("en-IN");
  return b > a
    ? { ...next, reason: `more business than ${contractMonthLabel(near.expiry)} in the last session (${n(b)} vs ${n(a)})` }
    : { ...near, reason: `more business than ${contractMonthLabel(next.expiry)} in the last session (${n(a)} vs ${n(b)})` };
}

/** A contract with this many days or fewer to run is about to expire: the default moves on to the next one (volume leaves it first). */
export const ROLL_DAYS = 3;

/**
 * The contract opened on when none has been chosen: the nearest one with more than ROLL_DAYS days to run, so while the front month is
 * about to expire it is the next month, and it moves on by itself as months pass. Exported for testing.
 */
export function defaultFuture(futures: readonly NatgasFuture[], todayIso: string): ActiveContract {
  const daysLeft = (f: NatgasFuture) => Math.round((Date.parse(`${f.expiry}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / DAY_MS);
  const pick = futures.find((f) => daysLeft(f) > ROLL_DAYS) ?? futures[0];
  const nearest = futures[0];
  if (pick.key === nearest.key) return { ...pick, reason: "the nearest contract" };
  const left = Math.max(daysLeft(nearest), 0);
  return { ...pick, reason: `the nearest with more than ${ROLL_DAYS} days to run - ${contractMonthLabel(nearest.expiry)} expires in ${left} ${left === 1 ? "day" : "days"}` };
}

/** What the dropdown shows: the choice made, or - while it is the default or no longer listed - the contract the default turned out to be. */
export function shownContract(pref: ContractPref, listed: readonly { key: string }[], resolvedKey: string): string {
  if (pref === "auto") return "auto";
  if (pref !== "default" && listed.some((c) => c.key === pref)) return pref;
  return resolvedKey;
}
