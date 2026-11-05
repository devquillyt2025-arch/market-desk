"use client";

/**
 * The tabbed read-out under Live Portfolio's positions: "Risk & Probability"
 * (how bad can this get), "Simulate averaging" (what if I add lots) and
 * "What-if lab" (what's the best thing to do with the whole book). The tab
 * strip sits where the Risk panel's title used to, with its verdict pill and
 * warning count right beside it, so the existing read is unchanged and the
 * others sit next to it rather than over the page.
 */

import { useRef, useState, type KeyboardEvent } from "react";

import AveragingSimulator, { type SimulatorCandidate } from "@/components/AveragingSimulator";
import { thinScroll } from "@/components/averaging/ui";
import RiskProbabilityPanel, { RiskHeaderBadges, RiskLiveStatus } from "@/components/RiskProbabilityPanel";
import WhatIfLab from "@/components/WhatIfLab";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import type { RiskAnalysis } from "@/lib/calculateRisk";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";

export type InsightsTab = "risk" | "simulate" | "whatif";

const TABS: { id: InsightsTab; label: string }[] = [
  { id: "risk", label: "Risk & Probability" },
  { id: "simulate", label: "Simulate averaging" },
  { id: "whatif", label: "What-if lab" },
];

type PortfolioInsightsProps = {
  tab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
  /** The Risk & Probability read: null while nothing is priced yet. */
  analysis: RiskAnalysis | null;
  asOf: number | null;
  /** True while polling is paused and the figures are the last good read. */
  paused: boolean;
  candidates: SimulatorCandidate[];
  selectedId: string | null;
  onSelectCandidate: (id: string) => void;
  /** When the simulator's prices are from. */
  nowMs: number | null;
  /** The priced positions and the option chains they came from - what the What-if lab works on. */
  rows: PortfolioRow[] | null;
  chains: Record<string, UpstoxOptionChainResult | undefined>;
};

export default function PortfolioInsights({
  tab,
  onTabChange,
  analysis,
  asOf,
  paused,
  candidates,
  selectedId,
  onSelectCandidate,
  nowMs,
  rows,
  chains,
}: PortfolioInsightsProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // The simulator is only built once its tab has been opened, then kept mounted so the
  // lots and price typed there survive a glance back at the risk read.
  const [simulateOpened, setSimulateOpened] = useState(tab === "simulate");
  if (tab === "simulate" && !simulateOpened) setSimulateOpened(true);
  // The lab tries a thousand moves on every poll, so it isn't built until its tab is first opened.
  const [labOpened, setLabOpened] = useState(tab === "whatif");
  if (tab === "whatif" && !labOpened) setLabOpened(true);
  // Once opened it stays mounted, so what was typed there survives a glance at another tab - but it
  // only takes in fresh prices while it is the tab on show, rather than re-trying every move on every
  // poll behind your back. Updated during render (React's "adjust state when a prop changes" pattern).
  const [labInputs, setLabInputs] = useState({ rows, chains, nowMs, paused });
  if (tab === "whatif" && (labInputs.rows !== rows || labInputs.chains !== chains || labInputs.nowMs !== nowMs || labInputs.paused !== paused)) {
    setLabInputs({ rows, chains, nowMs, paused });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.findIndex((t) => t.id === tab);
    let next: number;
    if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    onTabChange(TABS[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-2">
          {/* Three tabs are wider than a phone: the strip scrolls sideways on its own rather than widening the page. */}
          <div
            role="tablist"
            aria-label="Portfolio insights"
            onKeyDown={handleKeyDown}
            className={`flex max-w-full items-center gap-5 overflow-x-auto pb-1 ${thinScroll}`}
          >
            {TABS.map((t, i) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  id={`insights-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`insights-panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onTabChange(t.id)}
                  className={`-mb-px whitespace-nowrap border-b-2 pb-1 text-sm font-semibold uppercase tracking-wide transition-colors ${
                    active
                      ? "border-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {tab === "risk" && analysis && <RiskHeaderBadges analysis={analysis} />}
        </div>

        {tab === "risk" && analysis && <RiskLiveStatus analysis={analysis} asOf={asOf} paused={paused} />}
        {tab === "simulate" && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`size-2 shrink-0 rounded-full ${paused ? "bg-warning" : "animate-pulse bg-profit"}`}
              aria-hidden="true"
            />
            <span className={`font-semibold ${paused ? "text-warning" : "text-profit"}`}>{paused ? "Paused" : "Live"}</span>
            <span>
              · {candidates.length} position{candidates.length === 1 ? "" : "s"} to simulate
            </span>
          </span>
        )}
        {tab === "whatif" && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`size-2 shrink-0 rounded-full ${paused ? "bg-warning" : "animate-pulse bg-profit"}`}
              aria-hidden="true"
            />
            <span className={`font-semibold ${paused ? "text-warning" : "text-profit"}`}>{paused ? "Paused" : "Live"}</span>
            <span>· tries every exit, add, hedge and new trade</span>
          </span>
        )}
      </div>

      <div
        role="tabpanel"
        id="insights-panel-risk"
        aria-labelledby="insights-tab-risk"
        hidden={tab !== "risk"}
      >
        <RiskProbabilityPanel analysis={analysis} asOf={asOf} paused={paused} showHeader={false} />
      </div>

      <div
        role="tabpanel"
        id="insights-panel-simulate"
        aria-labelledby="insights-tab-simulate"
        hidden={tab !== "simulate"}
      >
        {simulateOpened && (
          <AveragingSimulator
            candidates={candidates}
            selectedId={selectedId}
            onSelect={onSelectCandidate}
            nowMs={nowMs}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="insights-panel-whatif"
        aria-labelledby="insights-tab-whatif"
        hidden={tab !== "whatif"}
      >
        {labOpened && <WhatIfLab rows={labInputs.rows} chains={labInputs.chains} nowMs={labInputs.nowMs} paused={labInputs.paused} />}
      </div>
    </div>
  );
}
