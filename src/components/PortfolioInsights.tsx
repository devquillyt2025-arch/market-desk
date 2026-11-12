"use client";

/**
 * The tabbed read-out under Live Portfolio's positions: "Risk & Probability"
 * (how bad can this get), "Simulate averaging" (what if I add lots),
 * "What-if lab" (what's the best thing to do with the whole book), "RRR planner"
 * (what win rate and reward-for-the-risk a plan needs - no positions involved) and
 * "Reward : Risk" (what pays the most for the risk). The tab
 * strip sits where the Risk panel's title used to, with its verdict pill and
 * warning count right beside it, so the existing read is unchanged and the
 * others sit next to it rather than over the page.
 */

import { useRef, useState, type KeyboardEvent } from "react";

import AveragingSimulator, { type SimulatorCandidate } from "@/components/AveragingSimulator";
import { thinScroll } from "@/components/averaging/ui";
import RewardRiskPanel from "@/components/RewardRiskPanel";
import RiskProbabilityPanel, { RiskHeaderBadges, RiskLiveStatus } from "@/components/RiskProbabilityPanel";
import RrrPlanner from "@/components/RrrPlanner";
import WhatIfLab from "@/components/WhatIfLab";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import type { RiskAnalysis } from "@/lib/calculateRisk";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";

export type InsightsTab = "risk" | "simulate" | "whatif" | "planner" | "rrr";

const TABS: { id: InsightsTab; label: string }[] = [
  { id: "risk", label: "Risk & Probability" },
  { id: "simulate", label: "Simulate averaging" },
  { id: "whatif", label: "What-if lab" },
  { id: "planner", label: "RRR planner" },
  { id: "rrr", label: "Reward : Risk" },
];

/** The one tab that works without any positions - the others read live prices. */
const PLANNER_ONLY = TABS.filter((t) => t.id === "planner");

type ModelInputs = {
  rows: PortfolioRow[] | null;
  chains: Record<string, UpstoxOptionChainResult | undefined>;
  nowMs: number | null;
  paused: boolean;
};

/**
 * The figures a heavy tab works on, held still while its tab is hidden. Both the What-if lab and Reward : Risk
 * try a thousand ideas on every change, so once opened they stay mounted - what was typed there survives a glance
 * at another tab - but only take in fresh prices while they are the tab on show, rather than re-trying every idea on
 * every poll behind your back. Updated during render (React's "adjust state when a prop changes" pattern).
 */
function useHeldWhileHidden(active: boolean, live: ModelInputs): ModelInputs {
  const [held, setHeld] = useState(live);
  if (active && (held.rows !== live.rows || held.chains !== live.chains || held.nowMs !== live.nowMs || held.paused !== live.paused)) {
    setHeld(live);
  }
  return held;
}

/** The "● Live · …" line beside the tab strip for the tabs that run on live prices. */
function LiveHint({ paused, children }: { paused: boolean; children: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${paused ? "bg-warning" : "animate-pulse bg-profit"}`} aria-hidden="true" />
      <span className={`font-semibold ${paused ? "text-warning" : "text-profit"}`}>{paused ? "Paused" : "Live"}</span>
      <span>· {children}</span>
    </span>
  );
}

type PortfolioInsightsProps = {
  tab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
  /** Whether any position is priced. Without one only the RRR planner is offered - nothing else has anything to read. */
  hasPositions: boolean;
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
  tab: requestedTab,
  onTabChange,
  hasPositions,
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
  const tabs = hasPositions ? TABS : PLANNER_ONLY;
  const tab = tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0].id;
  // The planner is only built once its tab has been opened, then kept mounted so what was typed there survives a glance elsewhere.
  const [plannerOpened, setPlannerOpened] = useState(tab === "planner");
  if (tab === "planner" && !plannerOpened) setPlannerOpened(true);
  // The simulator is only built once its tab has been opened, then kept mounted so the
  // lots and price typed there survive a glance back at the risk read.
  const [simulateOpened, setSimulateOpened] = useState(tab === "simulate");
  if (tab === "simulate" && !simulateOpened) setSimulateOpened(true);
  // The lab and Reward : Risk try a thousand ideas on every poll, so neither is built until its tab is first opened.
  const [labOpened, setLabOpened] = useState(tab === "whatif");
  if (tab === "whatif" && !labOpened) setLabOpened(true);
  const [rrrOpened, setRrrOpened] = useState(tab === "rrr");
  if (tab === "rrr" && !rrrOpened) setRrrOpened(true);
  const live = { rows, chains, nowMs, paused };
  const labInputs = useHeldWhileHidden(tab === "whatif", live);
  const rrrInputs = useHeldWhileHidden(tab === "rrr", live);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((t) => t.id === tab);
    let next: number;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onTabChange(tabs[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-2">
          {/* The tabs are wider than a phone: the strip scrolls sideways on its own rather than widening the page. */}
          <div
            role="tablist"
            aria-label="Portfolio insights"
            onKeyDown={handleKeyDown}
            className={`flex max-w-full items-center gap-5 overflow-x-auto pb-1 ${thinScroll}`}
          >
            {tabs.map((t, i) => {
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
          <LiveHint paused={paused}>{`${candidates.length} position${candidates.length === 1 ? "" : "s"} to simulate`}</LiveHint>
        )}
        {tab === "whatif" && <LiveHint paused={paused}>tries every exit, add, hedge and new trade</LiveHint>}
        {tab === "rrr" && <LiveHint paused={paused}>ranks every idea by reward for the risk</LiveHint>}
        {tab === "planner" && <span className="text-xs text-muted-foreground">Independent of your positions and live prices</span>}
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

      <div
        role="tabpanel"
        id="insights-panel-planner"
        aria-labelledby="insights-tab-planner"
        hidden={tab !== "planner"}
      >
        {plannerOpened && <RrrPlanner />}
      </div>

      <div
        role="tabpanel"
        id="insights-panel-rrr"
        aria-labelledby="insights-tab-rrr"
        hidden={tab !== "rrr"}
      >
        {rrrOpened && <RewardRiskPanel rows={rrrInputs.rows} chains={rrrInputs.chains} nowMs={rrrInputs.nowMs} paused={rrrInputs.paused} />}
      </div>
    </div>
  );
}
