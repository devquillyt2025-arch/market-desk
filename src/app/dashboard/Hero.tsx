"use client";

/**
 * The top of the Dashboard: four figures that say where things stand - what the open positions are making right now, what today
 * made, what the last 30 days netted, and what the account is worth - with the feed's state and a refresh beside the date.
 * Its glow takes the colour of today (or, before today has a figure, of the open book): green, red, or the app's violet.
 */

import Link from "next/link";

import AnimatedNumber from "@/components/averaging/AnimatedNumber";
import { RefreshIcon } from "@/components/icons";
import { signedMoney } from "@/app/commodities/natgasFormat";
import { formatAsOf, formatINR, pnlColorClass } from "@/lib/format";

import { NA, TITLE } from "./parts";

export type Feed = "loading" | "live" | "paused";

type Kpi = {
  label: string;
  href: string;
  value: number | null;
  format: (n: number) => string;
  /** Colour the figure by its sign. */
  signed: boolean;
  /** A line of figures beneath. */
  sub: string | null;
};

type Props = {
  /** "Tue, 24 Nov" - empty until the page has hydrated. */
  date: string;
  feed: Feed;
  /** When the prices were last fetched (ms). */
  tick: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  live: Kpi["value"];
  liveSub: string | null;
  today: number | null;
  todaySub: string | null;
  month: number | null;
  monthSub: string | null;
  equity: number | null;
  equitySub: string | null;
};

const PILL = {
  live: { label: "Live", dot: "bg-profit" },
  paused: { label: "Paused", dot: "bg-warning" },
  loading: { label: "Connecting", dot: "bg-muted-foreground animate-pulse" },
} as const;

function FeedPill({ feed, tick }: { feed: Feed; tick: number | null }) {
  const pill = PILL[feed];
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs backdrop-blur-md">
      <span className="relative flex size-2 shrink-0">
        {feed === "live" && <span key={tick ?? 0} className={`sync-ping absolute inset-0 rounded-full ${pill.dot}`} />}
        <span className={`relative size-2 rounded-full ${pill.dot}`} />
      </span>
      <span className={`font-semibold ${feed === "paused" ? "text-warning-strong" : ""}`}>{pill.label}</span>
      {tick !== null && <span className="truncate tabular-nums text-muted-foreground">{formatAsOf(tick)}</span>}
    </span>
  );
}

/** The colour a figure's glow takes: its sign, or violet while it has none. */
function glow(value: number | null): string {
  return value === null || value === 0 ? "var(--accent)" : value > 0 ? "var(--profit)" : "var(--danger-fg)";
}

export default function Hero(props: Props) {
  const kpis: Kpi[] = [
    { label: "Live", href: "/portfolio", value: props.live, format: signedMoney, signed: true, sub: props.liveSub },
    { label: "Today", href: "/portfolio", value: props.today, format: signedMoney, signed: true, sub: props.todaySub },
    { label: "30 days", href: "/reports", value: props.month, format: signedMoney, signed: true, sub: props.monthSub },
    { label: "Equity", href: "/payment", value: props.equity, format: formatINR, signed: false, sub: props.equitySub },
  ];

  return (
    <section aria-labelledby="dashboard-title" className="relative rounded-3xl border border-border bg-card">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
        <div className="absolute -left-28 -top-32 size-[28rem] rounded-full opacity-[0.2] blur-3xl transition-colors duration-1000" style={{ background: glow(props.today ?? props.live) }} />
        <div className="absolute -right-24 -top-36 size-80 rounded-full bg-accent opacity-[0.12] blur-3xl" />
      </div>

      <div className="relative flex items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex min-w-0 items-baseline gap-3">
          {/* On a phone the top bar already says it; the heading stays for screen readers. */}
          <h1 id="dashboard-title" className="sr-only text-xl font-semibold tracking-tight sm:not-sr-only sm:text-2xl">
            Dashboard
          </h1>
          {props.date && <span className="truncate text-sm font-medium tabular-nums text-muted-foreground sm:font-normal">{props.date}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <FeedPill feed={props.feed} tick={props.tick} />
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            aria-label="Refresh prices"
            title="Refresh now"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <RefreshIcon className={`size-4 ${props.refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-2 border-t border-border/70 lg:grid-cols-4 sm:mt-5">
        {kpis.map((kpi, i) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className={`group/kpi relative flex min-w-0 flex-col gap-1.5 px-4 py-4 transition-colors hover:bg-muted/50 sm:px-6 sm:py-5 ${i % 2 === 1 ? "border-l border-border/70" : ""} ${i >= 2 ? "border-t border-border/70 lg:border-t-0" : ""} ${i > 0 ? "lg:border-l lg:border-border/70" : ""} ${i === 0 ? "rounded-bl-3xl" : ""} ${i === 3 ? "rounded-br-3xl" : ""}`}
          >
            <span className={TITLE}>{kpi.label}</span>
            <span className={`block truncate text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-[2.25rem] ${kpi.signed && kpi.value !== null ? pnlColorClass(kpi.value) : ""}`}>
              {kpi.value === null ? <NA /> : <AnimatedNumber value={kpi.value} format={kpi.format} />}
            </span>
            <span className="block min-h-4 truncate text-xs tabular-nums text-muted-foreground">{kpi.sub ?? " "}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
