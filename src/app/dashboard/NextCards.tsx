"use client";

/** What is about to happen: when each market opens or closes, what expires and when, where MCX is expected to open, and what the book risks from here. Figures only. */

import type { RiskAnalysis, RiskVerdict } from "@/lib/calculateRisk";
import { compactDuration, dayLabel, type ExpiryStep, type Session } from "@/lib/dashboardBrief";
import { rupees, signedMoney } from "@/app/commodities/natgasFormat";

import { Card, Money, Move, NA, Skeleton, Stat } from "./parts";

// --- Sessions ---------------------------------------------------------------------------

const SESSION_LABELS: Record<Session["id"], string> = { NSE: "NSE", MCX: "MCX", NYSE: "NYSE" };

export function SessionsCard({ sessions, now, index }: { sessions: readonly Session[] | null; now: number; index: number }) {
  return (
    <Card title="Sessions" index={index}>
      <ul className="flex flex-col gap-3.5">
        {sessions === null
          ? [0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-10 w-full" />
              </li>
            ))
          : sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  {s.open ? <span role="img" aria-label="open" className="size-2 rounded-full bg-profit" /> : <span role="img" aria-label="shut" className="size-2 rounded-full border-[1.5px] border-muted-foreground/70" />}
                  <span className="text-sm font-semibold">{SESSION_LABELS[s.id]}</span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-semibold leading-tight tabular-nums">{compactDuration(s.at - now)}</span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                    {s.open ? "closes" : "opens"} {s.clock}
                  </span>
                </span>
              </li>
            ))}
      </ul>
    </Card>
  );
}

// --- Expiries ---------------------------------------------------------------------------

/** How soon, as the colour of its bar: tomorrow or sooner is red, within three days amber, else the app's violet. */
function urgency(days: number): { bar: string; text: string } {
  if (days <= 1) return { bar: "bg-danger-fg", text: "text-danger-fg" };
  if (days <= 3) return { bar: "bg-warning", text: "text-warning-strong" };
  return { bar: "bg-accent", text: "" };
}

const HORIZON_DAYS = 45;

export function ExpiriesCard({ steps, index }: { steps: readonly ExpiryStep[] | null; index: number }) {
  return (
    <Card title="Expiries" href="/portfolio" index={index}>
      {steps === null ? (
        <>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </>
      ) : steps.length === 0 ? (
        <span className="text-2xl font-semibold text-muted-foreground">—</span>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {steps.map((step) => {
            const tone = urgency(step.days);
            return (
              <li key={step.date}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold tabular-nums">{dayLabel(step.date)}</span>
                  <span className={`text-lg font-semibold leading-tight tabular-nums ${tone.text}`}>{step.days}d</span>
                </span>
                <span className="mt-1 flex items-center gap-3">
                  <span aria-hidden="true" className="relative block h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${Math.max(6, (1 - Math.min(step.days, HORIZON_DAYS) / HORIZON_DAYS) * 100)}%` }} />
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{step.lots} lots</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// --- The open ---------------------------------------------------------------------------

export type OpenRow = {
  key: string;
  name: string;
  /** The contract month, "Dec 2026". */
  contract: string | null;
  /** MCX's last price. */
  price: number | null;
  /** MCX's move on the day. */
  changePct: number | null;
  /** Where MCX is expected to open (while it is shut) and the NYMEX move behind it. */
  expected: { open: number; movePct: number } | null;
};

export function OpenCard({ rows, index }: { rows: readonly OpenRow[]; index: number }) {
  return (
    <Card title="MCX open" href="/commodities#natural-gas" index={index}>
      <ul className="flex flex-col gap-3.5">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-muted-foreground">
                {row.name}
                {row.contract && <span className="ml-1.5 tabular-nums">{row.contract}</span>}
              </span>
              <Move pct={row.changePct} className="text-xs" />
            </span>
            <span className="mt-0.5 block text-xl font-semibold leading-tight tabular-nums">{row.price === null ? <NA /> : rupees(row.price)}</span>
            {row.expected && (
              <span className="mt-1 flex items-baseline justify-between gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  Open <span aria-hidden="true">≈</span>
                  <span className="sr-only">expected</span> <span className="font-semibold text-foreground">{rupees(row.expected.open)}</span>
                </span>
                <Move pct={row.expected.movePct} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Risk -------------------------------------------------------------------------------

const VERDICT: Record<RiskVerdict, { label: string; className: string }> = {
  high: { label: "High", className: "bg-danger-fg/10 text-danger-fg ring-danger-fg/25" },
  elevated: { label: "Elevated", className: "bg-warning/10 text-warning-strong ring-warning/30" },
  comfortable: { label: "Comfortable", className: "bg-profit/10 text-profit ring-profit/25" },
};

export function RiskCard({ risk, index }: { risk: RiskAnalysis | null; index: number }) {
  const verdict = risk ? VERDICT[risk.verdict] : null;
  return (
    <Card
      title="Risk"
      href="/portfolio"
      index={index}
      meta={verdict && <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${verdict.className}`}>{verdict.label}</span>}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Stat label="Chance of profit">{risk ? <span className="text-lg">{Math.round(risk.pop * 100)}%</span> : <NA />}</Stat>
        <Stat label="Theta / day">{risk ? <Money value={risk.netThetaPerDay} /> : <NA />}</Stat>
        <Stat label="Market +1%">{risk ? <Money value={risk.pnlPer1PctMove} /> : <NA />}</Stat>
        <Stat label="Market −1%">{risk ? <Money value={-risk.pnlPer1PctMove} /> : <NA />}</Stat>
        <Stat label="Max loss">{risk ? risk.maxLoss === null ? <span className="text-danger-fg">∞</span> : <span className="text-danger-fg">{signedMoney(-risk.maxLoss)}</span> : <NA />}</Stat>
        <Stat label="Max profit">{risk ? risk.maxProfit === null ? <span className="text-profit">∞</span> : risk.maxProfitIsRemote ? <NA /> : <Money value={risk.maxProfit} /> : <NA />}</Stat>
      </dl>
    </Card>
  );
}
