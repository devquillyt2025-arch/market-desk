"use client";

/**
 * Today in IST on one line each: when MCX trades, when NYMEX trades or is on its break, and a pin for now on both, so "who is
 * awake" is one glance. Every figure is also written out beside its bar - the bars are never the only way to read it.
 */

import { useMemo, type ReactNode } from "react";

import { dayBars, istStamp, nymexOutlook, sessionHours, type DaySegment } from "@/lib/natgasDesk";

import { clockText } from "./natgasFormat";

const DAY = 1440;
const pct = (minutes: number) => `${(minutes / DAY) * 100}%`;
const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border-strong)_3px_5px)]";

function Segments({ segments, className }: { segments: readonly DaySegment[]; className: string }) {
  return segments.map((s) => <span key={s.from} aria-hidden="true" className={`absolute inset-y-0 ${className}`} style={{ left: pct(s.from), width: pct(s.to - s.from) }} />);
}

function Row({ title, hours, status, nowLeft, children }: { title: string; hours: string; status: string; nowLeft: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold">{title}</span>
        <span className="truncate text-muted-foreground">
          <span className="tabular-nums">{hours}</span> · <span className="font-medium text-foreground">{status}</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-muted ring-1 ring-inset ring-border/70">
        <div className="absolute inset-0 overflow-hidden rounded-full">{children}</div>
        <span aria-hidden="true" className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_2px_var(--card)]" style={{ left: `${nowLeft}%` }} />
      </div>
    </div>
  );
}

export default function SessionClock({ nowMs, mcxOpen }: { nowMs: number; mcxOpen: boolean }) {
  const bars = useMemo(() => dayBars(nowMs), [nowMs]);
  const hours = useMemo(() => sessionHours(nowMs), [nowMs]);
  const outlook = useMemo(() => nymexOutlook(nowMs), [nowMs]);
  const weekend = bars.mcx.length === 0;
  const nymexStatus = outlook.state === "trading" ? "trading now" : outlook.state === "break" ? "on its break now" : "shut now";
  const day = new Date(`${bars.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const nowLeft = (bars.nowMinute / DAY) * 100;
  const first = bars.nymexTrading[0];
  const nymexHours =
    bars.nymexBreak.length > 0 ? `break ${hours.nymex.breakFrom} – ${hours.nymex.breakTo}` : !first ? "closed today" : first.from === 0 ? `trades until ${clockText(first.to)}` : `opens ${clockText(first.from)}`;

  return (
    <section aria-label="Trading hours today in IST" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Trading hours · IST</h3>
        <span className="text-xs text-muted-foreground">
          {day} · now <span className="font-semibold tabular-nums text-foreground">{clockText(bars.nowMinute)}</span>
        </span>
      </div>

      <div className="mt-4 space-y-5">
        <Row title="MCX" hours={weekend ? "closed today" : `${hours.mcx.opens} – ${hours.mcx.closes}`} status={mcxOpen ? "trading now" : "shut now"} nowLeft={nowLeft}>
          <Segments segments={bars.mcx} className="rounded-full bg-accent" />
        </Row>
        <Row title="NYMEX" hours={nymexHours} status={nymexStatus} nowLeft={nowLeft}>
          <Segments segments={bars.nymexTrading} className="bg-foreground/70" />
          <Segments segments={bars.nymexBreak} className={HATCH} />
        </Row>
      </div>

      <div aria-hidden="true" className="relative mt-2 h-4 text-[11px] tabular-nums text-muted-foreground">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {weekend
          ? `Weekend: MCX is closed all day. NYMEX ${outlook.state === "trading" ? "is still trading" : "is shut"}${outlook.at ? ` until ${istStamp(outlook.at, nowMs)}` : ""}.`
          : "The hatched stretch is NYMEX's daily break."}
      </p>
    </section>
  );
}
