"use client";

/**
 * MCX and NYMEX side by side, in both currencies: MCX in rupees, NYMEX in dollars, and NYMEX again in rupees (dollars times the
 * USD/INR rate) so the two can be compared without doing any sums. It is one real table - the rows line up across the three, and
 * it stays small on a phone - styled so each column reads as a table of its own.
 *
 * Under it, what the rupee columns rest on (the rate, and the small premium MCX normally carries over NYMEX) and a box for a NYMEX
 * price of your own, for anyone who can see it live (the feed runs about ten minutes behind).
 */

import { useId, useState, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { istStamp, type DeskFigures, type NymexState } from "@/lib/natgasDesk";
import { formatMovePct, moveDirection } from "@/lib/watchlist";

import { DIRECTION } from "./direction";
import { dollars, old, rupees, signedDollars, signedRupees } from "./natgasFormat";

type Tone = "live" | "break" | "shut" | "info";

const PILL: Record<Tone, string> = {
  live: "bg-profit/10 text-profit ring-profit/25",
  break: "bg-warning/10 text-warning-strong ring-warning/30",
  shut: "bg-muted text-muted-foreground ring-border",
  info: "bg-accent/10 text-accent ring-accent/25",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${PILL[tone]}`}>{children}</span>;
}

// One cell's look. Cells on the same column share a left and right border; the head rounds the top and the last row the bottom.
const CELL = "border-x border-border bg-card px-2.5 align-top sm:px-4";
const HEAD = `${CELL} rounded-t-2xl border-t pb-2.5 pt-3.5 text-left font-normal`;
const ROW = `${CELL} border-t border-t-border/60 py-3`;
const LAST = "rounded-b-2xl border-b border-b-border";
const LABEL = "py-3 pr-1 text-left align-top text-xs font-normal leading-snug text-muted-foreground";

/** `short` is what fits a phone's ~90px column; the full form shows from the `sm` breakpoint. */
function Both({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

function Head({ tile, tone, title, sub, pill }: { tile: string; tone: "accent" | "neutral" | "soft"; title: ReactNode; sub: ReactNode; pill: ReactNode }) {
  const tileStyle = tone === "accent" ? "bg-accent/12 text-accent ring-accent/30" : tone === "soft" ? "bg-accent-soft/15 text-accent-soft ring-accent-soft/30" : "bg-foreground/8 text-foreground ring-border";
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`hidden size-8 shrink-0 place-items-center rounded-lg text-sm font-bold ring-1 ring-inset sm:grid ${tileStyle}`}>
          {tile}
        </span>
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
        </div>
      </div>
      <div className="mt-2">{pill}</div>
    </>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{children}</span>;

export function MarketTable({ figures, nymexState, nowMs }: { figures: DeskFigures; nymexState: NymexState; nowMs: number }) {
  const f = figures;
  const direction = moveDirection(f.movePct);
  const change = f.nymexNow - f.nymexAtClose;
  const changeColour = DIRECTION[direction].text;
  const hasRate = f.rate !== null && f.nymexAtCloseInr !== null && f.nymexNowInr !== null;
  const changeInr = hasRate ? f.nymexNowInr! - f.nymexAtCloseInr! : null;
  const nymexPill = f.typed ? <Pill tone="info">Your price</Pill> : <Pill tone={nymexState === "trading" ? "live" : nymexState === "break" ? "break" : "shut"}>{nymexState === "trading" ? "Trading" : nymexState === "break" ? "On break" : "Shut"}</Pill>;
  const dash = <span className="text-muted-foreground">–</span>;
  const noRate = <span className="text-xs text-muted-foreground">No USD/INR rate right now</span>;

  return (
    <table className="w-full table-fixed border-separate border-spacing-x-1.5 sm:border-spacing-x-3">
      <caption className="sr-only">MCX natural gas in rupees, NYMEX natural gas in dollars, and NYMEX in rupees</caption>
      <colgroup>
        <col className="w-[4.1rem] sm:w-[5.5rem]" />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <td aria-hidden="true" />
          <th scope="col" className={HEAD}>
            <Head tile="₹" tone="accent" title="MCX" sub="India · ₹" pill={<Pill tone="shut">Shut</Pill>} />
          </th>
          <th scope="col" className={HEAD}>
            <Head tile="$" tone="neutral" title="NYMEX" sub={<Both short={`$ · ${f.nymexLabel}`} full={`outside · $ · ${f.nymexLabel}`} />} pill={nymexPill} />
          </th>
          <th scope="col" className={HEAD}>
            <Head tile="₹" tone="soft" title={<Both short="NYMEX ₹" full="NYMEX in ₹" />} sub={f.rate !== null ? `$ × ₹${f.rate.toFixed(2)}` : "needs USD/INR"} pill={<Pill tone="info">Converted</Pill>} />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className={LABEL}>
            When MCX closed
          </th>
          <td className={`${ROW} text-sm font-medium tabular-nums`}>{rupees(f.mcxClose)}</td>
          <td className={`${ROW} text-sm font-medium tabular-nums`}>{dollars(f.nymexAtClose)}</td>
          <td className={`${ROW} text-sm font-medium tabular-nums`}>{hasRate ? rupees(f.nymexAtCloseInr!) : noRate}</td>
        </tr>
        <tr>
          <th scope="row" className={`${LABEL} !text-foreground font-medium`}>
            Now
          </th>
          <td className={`${ROW} text-base font-semibold tabular-nums sm:text-lg`}>
            {rupees(f.mcxClose)}
            <Sub>shut, no new price</Sub>
          </td>
          <td className={`${ROW} text-base font-semibold tabular-nums sm:text-lg`}>
            {dollars(f.nymexNow)}
            <Sub>{f.typed ? "typed by you" : f.nymexShut ? "its last price" : "latest"}</Sub>
          </td>
          <td className={`${ROW} text-base font-semibold tabular-nums sm:text-lg`}>
            {hasRate ? rupees(f.nymexNowInr!) : dash}
            {hasRate && <Sub>at ₹{f.rate!.toFixed(2)} per $</Sub>}
          </td>
        </tr>
        <tr>
          <th scope="row" className={LABEL}>
            Change since
          </th>
          <td className={`${ROW} text-sm tabular-nums`}>{dash}</td>
          <td className={`${ROW} text-sm font-semibold tabular-nums ${changeColour}`}>
            {signedDollars(change)}
            <Sub>{formatMovePct(f.movePct)}</Sub>
          </td>
          <td className={`${ROW} text-sm font-semibold tabular-nums ${changeColour}`}>
            {changeInr !== null ? signedRupees(changeInr) : dash}
            {changeInr !== null && <Sub>{formatMovePct(f.movePct)}</Sub>}
          </td>
        </tr>
        <tr>
          <th scope="row" className={LABEL}>
            Price from
          </th>
          <td className={`${ROW} ${LAST} text-xs tabular-nums`}>
            {f.mcxClosedAt === null ? (
              "time not given"
            ) : (
              <>
                {istStamp(f.mcxClosedAt, nowMs)}
                <Sub>{old(nowMs - f.mcxClosedAt)}</Sub>
              </>
            )}
          </td>
          <td className={`${ROW} ${LAST} text-xs tabular-nums`}>
            {istStamp(f.nymexAsOf, nowMs)}
            <Sub>{old(nowMs - f.nymexAsOf)}</Sub>
          </td>
          <td className={`${ROW} ${LAST} text-xs tabular-nums`}>
            {f.rate !== null && f.rateAsOf !== null ? (
              <>
                rate {istStamp(f.rateAsOf, nowMs)}
                <Sub>{old(nowMs - f.rateAsOf)}</Sub>
              </>
            ) : (
              dash
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** What the rupee column rests on, and the small premium MCX normally carries - so a mismatch between the two rupee columns is not a surprise. */
export function ConversionNote({ figures, nowMs }: { figures: DeskFigures; nowMs: number }) {
  const f = figures;
  if (f.rate === null || f.rateAsOf === null) {
    return <p className="mt-3 text-xs leading-relaxed text-muted-foreground">The rupee column needs the USD/INR rate, which isn&apos;t available right now. The expected open above doesn&apos;t depend on it.</p>;
  }
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
      NYMEX in ₹ is its dollar price × ₹{f.rate.toFixed(2)} per $ (USD/INR, {istStamp(f.rateAsOf, nowMs)}).
      {f.premiumPct !== null && (
        <>
          {" "}
          MCX was {f.premiumPct >= 0 ? "dearer" : "cheaper"} than that by <span className="font-medium text-foreground tabular-nums">{formatMovePct(Math.abs(f.premiumPct)).replace("+", "")}</span> when it closed, so the two rupee columns won&apos;t match to the paisa. The expected
          open moves MCX by NYMEX&apos;s change and keeps that gap.
        </>
      )}
    </p>
  );
}

/** A NYMEX price of your own. `onUse` resolves to an error message to show, or null when the price was taken. */
export function OwnPrice({ contractLabel, active, nowMs, feedPrice, onUse, onClear }: { contractLabel: string; active: { price: number; at: number } | null; nowMs: number; feedPrice: number; onUse: (text: string) => string | null; onClear: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="mt-3 text-xs text-muted-foreground">
      {active && (
        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-accent/10 px-3 py-2.5 text-foreground">
          <span>
            Using your NYMEX price <span className="font-semibold tabular-nums">{dollars(active.price)}</span>, typed at {istStamp(active.at, nowMs)}.
          </span>
          <button type="button" onClick={onClear} className="min-h-6 rounded font-medium text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11">
            Back to the feed
          </button>
        </p>
      )}
      <details className="group">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded font-medium transition-colors hover:text-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon className="size-3.5 transition-transform duration-200 group-open:rotate-180" />
          {active ? "Change my NYMEX price" : "Seen NYMEX live elsewhere? Use your own price"}
        </summary>
        <form
          className="mt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const message = onUse(draft);
            setProblem(message);
            if (message === null) setDraft("");
          }}
        >
          <label htmlFor={id} className="block leading-relaxed">
            NYMEX {contractLabel} right now, in dollars. The feed says {dollars(feedPrice)} but runs about 10 minutes behind.
          </label>
          <div className="mt-2 flex max-w-sm gap-2">
            <div className="relative min-w-0 flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                $
              </span>
              <input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={feedPrice.toFixed(3)}
                aria-invalid={problem !== null}
                aria-describedby={problem ? `${id}-problem` : undefined}
                className="w-full rounded-xl border border-border bg-background py-2.5 pl-7 pr-3 text-base tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30 sm:text-sm"
              />
            </div>
            <button type="submit" className="min-h-11 shrink-0 rounded-xl bg-accent-solid px-5 text-sm font-semibold text-accent-foreground transition-[opacity,transform] hover:opacity-90 active:scale-95 motion-reduce:active:scale-100">
              Use
            </button>
          </div>
          {problem && (
            <p id={`${id}-problem`} role="alert" className="mt-2 text-sm text-danger-fg">
              {problem}
            </p>
          )}
        </form>
      </details>
    </div>
  );
}
