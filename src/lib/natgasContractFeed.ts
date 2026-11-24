/**
 * The Upstox side of choosing the natural gas future (the rules are in natgasContract.ts): which futures are listed, and - for "auto" -
 * which has had the most business. Server only.
 */

import { chooseActive, defaultFuture, type ActiveContract, type ContractChoice, type ContractError, type NatgasFuture } from "@/lib/natgasContract";
import { getMcxContracts, isMcxError } from "@/lib/upstox/mcx";
import { fetchDailyVolumes, isCandleError, type CandleDeps } from "@/lib/upstox/minuteCandles";

const DAY_MS = 86_400_000;

/** "NATURALGAS FUT 24 NOV 26" from an expiry date. */
function futureLabel(expiryIso: string): string {
  const [y, m, d] = expiryIso.split("-");
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(m) - 1] ?? m;
  return `NATURALGAS FUT ${d} ${month} ${y.slice(2)}`;
}

/** Every natural gas future that has not expired, soonest first. */
export async function listNatgasFutures(todayIso: string): Promise<NatgasFuture[] | ContractError> {
  const mcx = await getMcxContracts();
  if (isMcxError(mcx)) return { error: mcx.error, status: mcx.status };
  const out: NatgasFuture[] = [];
  for (const [key, c] of mcx.contracts) {
    if (c.instrument === "NATURALGAS" && c.strike === null && c.optionType === null && c.expiry >= todayIso) out.push({ key, expiry: c.expiry, label: futureLabel(c.expiry) });
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

let activeCache: { day: string; value: ActiveContract } | null = null;

/** For tests: forget the day's "most active" answer. */
export function resetContractChoice(): void {
  activeCache = null;
}

async function resolveActive(token: string, futures: readonly NatgasFuture[], today: string, deps: CandleDeps): Promise<ActiveContract | ContractError> {
  if (activeCache?.day === today) {
    const hit = futures.find((f) => f.key === activeCache!.value.key);
    if (hit) return activeCache.value;
  }
  const firstTwo = futures.slice(0, 2);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 8 * DAY_MS).toISOString().slice(0, 10);
  const perKey = new Map<string, Map<string, number>>();
  for (const f of firstTwo) {
    const r = await fetchDailyVolumes(token, f.key, from, today, deps);
    if (isCandleError(r)) {
      if (r.error === "token_expired") return { error: "token_expired", status: 401 };
      continue; // volumes are only a tie-break: fall back to the nearest expiry
    }
    perKey.set(f.key, r.volumes);
  }
  // The last session both contracts have a day for, before today.
  const days = [...new Set([...perKey.values()].flatMap((m) => [...m.keys()]))].filter((d) => d < today).sort();
  const day = days.at(-1);
  const volumes = new Map<string, number | null>(firstTwo.map((f) => [f.key, day ? (perKey.get(f.key)?.get(day) ?? null) : null]));
  const value = chooseActive(firstTwo, volumes);
  activeCache = { day: today, value };
  return value;
}

/** The contract for a choice - `selection` is a key, "auto", "default" or null - out of the futures still listed (at least one). */
export async function chooseContract(
  token: string,
  futures: readonly NatgasFuture[],
  selection: string | null,
  today: string,
  deps: CandleDeps = {},
): Promise<{ contract: ActiveContract; choice: ContractChoice } | ContractError> {
  if (selection && selection !== "auto" && selection !== "default") {
    const hit = futures.find((f) => f.key === selection);
    if (hit) return { contract: { ...hit, reason: "chosen by you" }, choice: "chosen" };
    // A contract that has expired since it was saved: fall through to the default rather than fail.
  }
  if (selection === "auto") {
    const contract = await resolveActive(token, futures, today, deps);
    return "error" in contract ? contract : { contract, choice: "auto" };
  }
  return { contract: defaultFuture(futures, today), choice: "default" };
}
