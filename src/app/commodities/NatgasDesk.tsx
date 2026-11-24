"use client";

/**
 * The Natural gas tab, top to bottom: which markets are open, the answer (where MCX is expected to open and why), MCX and NYMEX
 * in rupees and dollars side by side, what the open does to the positions held, and today's hours in IST.
 *
 * While MCX trades there is nothing to estimate: measured on 19 sessions in Oct-Nov 2026, MCX follows NYMEX within the same
 * minute, so NYMEX adds nothing to the price already on screen. The tab says so, shows that live price, and waits for the close.
 *
 * The contract can be chosen (any natural gas future still listed, or the one with the most business) - the same choice as on the
 * Trade plan tab. The estimate then compares that contract's own last price with the NYMEX month it follows.
 * Loaded on demand (the Commodities page imports it lazily), so none of this costs anything until the tab is opened.
 */

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import AnimatedNumber from "@/components/averaging/AnimatedNumber";
import { ACCURACY, UNAVAILABLE_TEXT } from "@/components/ExpectedOpenPanel";
import { ChevronDownIcon } from "@/components/icons";
import { isExpectedOpenItem } from "@/lib/expectedOpen";
import { formatAsOf } from "@/lib/format";
import { contractMonthLabel } from "@/lib/mcxCommodities";
import { shownContract, type ContractPref } from "@/lib/natgasContract";
import {
  CLEAR_GAP_FROM_PCT,
  contractMonthShort,
  deskFigures,
  istStamp,
  NO_GAP_BELOW_PCT,
  nymexOutlook,
  oldPriceNote,
  parseNymexInput,
  positionsAtOpen,
  sessionHours,
  TYPICAL_MISS_PCT,
  windowRows,
  type GapSignal,
} from "@/lib/natgasDesk";
import type { ExpectedOpenState } from "@/lib/useExpectedOpen";
import { formatMovePct, moveDirection, type WatchQuote } from "@/lib/watchlist";

import ContractSelect from "./ContractSelect";
import { DIRECTION, MoveArrow } from "./direction";
import { ConversionNote, MarketTable, OwnPrice } from "./NatgasTables";
import NatgasPositions from "./NatgasPositions";
import NatgasSkeleton from "./NatgasSkeleton";
import { rupees, signedRupees, until } from "./natgasFormat";
import { ChangePill } from "./parts";
import SessionClock from "./SessionClock";
import { useNatgasBook } from "./useNatgasBook";

/** The edge of the answer takes the gap's colour, violet while there is none. */
const EDGE = { up: "var(--profit)", down: "var(--danger-fg)", flat: "var(--accent)" } as const;

type Tone = "live" | "break" | "shut";

function Chip({ tone, label, detail }: { tone: Tone; label: string; detail: string }) {
  const dot = tone === "live" ? "bg-profit" : tone === "break" ? "bg-warning" : "bg-muted-foreground";
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-semibold">{label}</span>
      <span className="truncate text-muted-foreground">{detail}</span>
    </span>
  );
}

function SignalPill({ signal }: { signal: GapSignal }) {
  const style = DIRECTION[signal.direction];
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${style.pill}`}>
      <MoveArrow direction={signal.direction} />
      {signal.headline}
    </span>
  );
}

/** What sits under the status row. While another contract's answer is on its way the old one stays up, dimmed - never shown as the new one's. */
function Body({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <div className={`space-y-3 transition-opacity ${pending ? "pointer-events-none opacity-50" : ""}`} aria-busy={pending}>
      {children}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 max-w-prose text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border/60 first:border-t-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-2 pb-4 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

function Details({ nowMs, nymexLabel }: { nowMs: number; nymexLabel: string | null }) {
  const rows = useMemo(() => windowRows(nowMs), [nowMs]);
  const hours = useMemo(() => sessionHours(nowMs), [nowMs]);
  return (
    <section aria-label="Details" className="rounded-2xl border border-border bg-card px-4 sm:px-5">
      <Disclosure title="The whole week, in IST">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-xs">
            <caption className="sr-only">What the expected open does through the week</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="pb-1 pr-3 text-left font-medium">
                  When
                </th>
                <th scope="col" className="pb-1 pr-3 text-left font-medium">
                  MCX
                </th>
                <th scope="col" className="pb-1 pr-3 text-left font-medium">
                  NYMEX
                </th>
                <th scope="col" className="pb-1 text-left font-medium">
                  Expected open
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.when}>
                  <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left text-xs font-medium text-foreground">
                    {r.when}
                  </th>
                  <td className="py-1.5 pr-3">{r.mcx}</td>
                  <td className="py-1.5 pr-3">{r.nymex}</td>
                  <td className="py-1.5">{r.estimate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          MCX hours come from the app&apos;s own market clock; NYMEX&apos;s are CME&apos;s published Globex schedule{hours.summer ? " (US summer time)" : " (US winter time)"}. Exchange holidays are in neither - on a part-day MCX holiday it
          can open as late as 17:00.
        </p>
      </Disclosure>
      <Disclosure title="How this is worked out">
        <p>
          MCX&apos;s last price, scaled by how far NYMEX has moved since MCX stopped trading. The rupee is assumed unchanged. MCX&apos;s natural gas month follows the NYMEX month after it, so that is the contract used
          {nymexLabel ? ` (${nymexLabel})` : ""}.
        </p>
        <p>{ACCURACY}</p>
        <p>
          The label grades the move against that typical miss of {TYPICAL_MISS_PCT}%: under {NO_GAP_BELOW_PCT}% is no clear gap, up to {CLEAR_GAP_FROM_PCT}% leaning, and {CLEAR_GAP_FROM_PCT}% or more a clear gap. The label describes the opening gap only, not the day. In a test over 19 sessions (27 Oct
          to 20 Nov 2026) MCX and its options followed NYMEX within about a minute while both were trading, which is why this tab goes quiet then.
        </p>
      </Disclosure>
    </section>
  );
}

type DeskProps = {
  state: ExpectedOpenState;
  nowMs: number;
  liveQuote: WatchQuote | undefined;
  /** The saved choice of contract (shared with the Trade plan tab) and how to change it. */
  contract: ContractPref;
  onContract: (next: ContractPref) => void;
};

export default function NatgasDesk({ state, nowMs, liveQuote, contract, onContract }: DeskProps) {
  const result = state.result;
  const natgas = result?.items.find((item) => item.market === "NATURALGAS");
  /** Which future the answer is for, and the futures to pick from (absent while there is no answer, or none is listed). */
  const choice = result?.natgas ?? null;
  const ready = natgas && isExpectedOpenItem(natgas) ? natgas : null;
  /** MCX is shut but the estimate can't be made yet (no price, no contract): the reason is shown instead. */
  const unavailable = natgas && !isExpectedOpenItem(natgas) ? natgas : null;
  const mcxShut = Boolean(result && !result.open && natgas);
  const book = useNatgasBook(mcxShut && ready !== null);
  const [typed, setTyped] = useState<{ price: number; at: number; symbol: string } | null>(null);

  // A price typed for one NYMEX month means nothing for the next one (the contract rolls), so it is only used with its own.
  const own = ready && typed && typed.symbol === ready.nymex.symbol ? typed : null;
  const usdInr = result?.usdInr ?? null;
  const figures = useMemo(() => (ready ? deskFigures(ready, own, usdInr) : null), [ready, own, usdInr]);
  const outlook = useMemo(() => nymexOutlook(nowMs), [nowMs]);
  const atMs = result?.reopensAt ?? nowMs;
  const positions = useMemo(() => (figures && book.rows ? positionsAtOpen(book.rows, figures.movePct, nowMs, Math.max(atMs, nowMs)) : null), [figures, book.rows, nowMs, atMs]);

  if (nowMs === 0) return <NatgasSkeleton />;
  if (state.tokenExpired) {
    return (
      <Notice title="Upstox needs a fresh token">
        <p>
          MCX&apos;s last price comes from Upstox, and its token has lapsed. Paste a new one in{" "}
          <Link href="/settings" className="font-medium text-accent underline-offset-2 hover:underline">
            Settings
          </Link>{" "}
          and this tab fills in by itself.
        </p>
      </Notice>
    );
  }
  if (result === null) return <NatgasSkeleton />;

  const hours = sessionHours(nowMs);
  const reopensAt = result.reopensAt;
  const when = outlook.at === null ? null : istStamp(outlook.at, nowMs);
  const mcxChip: { tone: Tone; detail: string } = !mcxShut
    ? { tone: "live", detail: `trading until ${hours.mcx.closes}` }
    : reopensAt !== null
      ? { tone: "shut", detail: `shut, opens ${istStamp(reopensAt, nowMs)} (in ${until(reopensAt - nowMs)})` }
      : { tone: "shut", detail: "isn't trading right now" };
  const nymexChip: { tone: Tone; detail: string } =
    outlook.state === "trading"
      ? { tone: "live", detail: when ? `trading, next stop ${when}` : "trading" }
      : outlook.state === "break"
        ? { tone: "break", detail: when ? `on break until ${when}` : "on break" }
        : { tone: "shut", detail: when ? `shut until ${when}` : "shut" };
  const status = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {choice && (
          <ContractSelect
            id="desk-contract"
            contracts={choice.contracts}
            value={shownContract(contract, choice.contracts, choice.contract.key)}
            onChange={onContract}
            hint={`${choice.contract.label}: ${choice.contract.reason}. The Trade plan tab follows the same choice.`}
          />
        )}
        <Chip tone={mcxChip.tone} label="MCX" detail={mcxChip.detail} />
        <Chip tone={nymexChip.tone} label="NYMEX" detail={nymexChip.detail} />
      </div>
      {state.lastPolledAt !== null && <span className="text-xs tabular-nums text-muted-foreground">Updated {formatAsOf(state.lastPolledAt, nowMs)}</span>}
    </div>
  );

  function applyOwnPrice(text: string): string | null {
    if (!ready) return null;
    const parsed = parseNymexInput(text, ready.nymex.now, ready.nymex.label);
    if (!parsed.ok) return parsed.message;
    setTyped({ price: parsed.price, at: Date.now(), symbol: ready.nymex.symbol });
    return null;
  }

  // ---- MCX is trading
  if (!mcxShut) {
    const month = choice ? contractMonthLabel(choice.contract.expiry) : null;
    // The board's live price is the front month's. Any other contract's comes with the answer: up to 30 seconds old, with when it traded.
    const onBoard = !choice || choice.contract.key === choice.contracts[0]?.key;
    const other = onBoard ? null : choice.last;
    return (
      <div className="space-y-3">
        {status}
        <Body pending={state.pending}>
          <section aria-label="Natural gas: MCX is trading" className="rounded-2xl border border-l-[3px] border-border bg-card px-4 py-4 sm:px-5" style={{ borderLeftColor: EDGE.flat }}>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">MCX natural gas{month ? ` · ${month}` : ""} · trading now</h2>
            {onBoard && liveQuote ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">
                  <AnimatedNumber value={liveQuote.price} format={rupees} />
                </span>
                <ChangePill quote={liveQuote} />
              </p>
            ) : other ? (
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">{rupees(other.price)}</span>
                <span className="text-xs text-muted-foreground">{other.lastTradeMs !== null ? `last traded ${istStamp(other.lastTradeMs, nowMs)}` : "last price"}</span>
              </p>
            ) : (
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">Trading until {hours.mcx.closes}</p>
            )}
            <p className="mt-3 text-sm text-muted-foreground">MCX follows NYMEX within the same minute, so there is nothing to estimate while it trades.</p>
          </section>
          <SessionClock nowMs={nowMs} mcxOpen />
          <Details nowMs={nowMs} nymexLabel={null} />
        </Body>
      </div>
    );
  }

  // ---- MCX is shut, but no estimate yet
  if (!ready || !figures) {
    return (
      <div className="space-y-3">
        {status}
        <Body pending={state.pending}>
          <section aria-label="Natural gas: no estimate yet" className="rounded-2xl border border-l-[3px] border-border bg-card px-4 py-4 sm:px-5" style={{ borderLeftColor: EDGE.flat }}>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Natural gas · expected MCX open</h2>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight">No estimate yet</p>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{unavailable ? UNAVAILABLE_TEXT[unavailable.reason] : "Waiting for prices."}</p>
          </section>
          <SessionClock nowMs={nowMs} mcxOpen={false} />
        </Body>
      </div>
    );
  }

  // ---- MCX is shut and there is an estimate
  const direction = moveDirection(figures.movePct);
  const oldPrice = oldPriceNote(figures.mcxClosedAt, nowMs);
  return (
    <div className="space-y-3">
      {status}
      <Body pending={state.pending}>
        <section aria-label="Natural gas: expected MCX open" className="rounded-2xl border border-l-[3px] border-border bg-card px-4 py-4 sm:px-5" style={{ borderLeftColor: EDGE[direction] }}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Expected MCX open{figures.typed && " · from your NYMEX price"}</h2>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">
                  <AnimatedNumber value={figures.expectedOpen} format={rupees} />
                </span>
                <span className={`text-sm font-semibold tabular-nums ${DIRECTION[direction].text}`}>
                  {signedRupees(figures.changeRupees)} · {formatMovePct(figures.movePct)}
                </span>
              </p>
            </div>
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <SignalPill signal={figures.signal} />
              <p className="text-xs tabular-nums text-muted-foreground">
                Likely range {rupees(figures.low)} – {rupees(figures.high)}
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
            {figures.signal.detail}
          </p>
          <p className="sr-only" aria-live="polite">
            {`Expected MCX open ${rupees(figures.expectedOpen)}, ${formatMovePct(figures.movePct)} from MCX's last price. ${figures.signal.headline}.`}
          </p>
        </section>

        <section aria-label="MCX and NYMEX natural gas, in rupees and dollars">
          <div className="-mx-1.5 sm:-mx-3">
            <MarketTable figures={figures} nymexState={outlook.state} nowMs={nowMs} mcxMonth={contractMonthShort(ready.contract.expiry)} />
          </div>
          {oldPrice && <p className="mt-3 text-xs text-warning-strong">{oldPrice}</p>}
          {figures.nymexShut && (
            <p className="mt-3 text-xs text-warning-strong">
              NYMEX is shut too: this is its last price, from {istStamp(figures.nymexAsOf, nowMs)}.
            </p>
          )}
          <ConversionNote figures={figures} nowMs={nowMs} />
          <OwnPrice contractLabel={ready.nymex.label} active={own} nowMs={nowMs} feedPrice={ready.nymex.now} onUse={applyOwnPrice} onClear={() => setTyped(null)} />
        </section>

        {book.held !== null && book.held > 0 && <NatgasPositions result={positions} held={book.held} />}

        <SessionClock nowMs={nowMs} mcxOpen={false} />
        <Details nowMs={nowMs} nymexLabel={ready.nymex.label} />
      </Body>
    </div>
  );
}
