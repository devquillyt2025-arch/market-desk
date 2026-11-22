"use client";

/**
 * The views of the Commodities page as a tab strip, beside the line that says what is on the board: the contracts (that line is
 * its label), the natural gas desk and the long/short planner. The Natural gas tab carries a live preview - "Live" while MCX trades, the
 * opening gap while it is shut - so the answer is visible before the tab is opened. The selected pill glides between the two
 * (a shared layout animation that stands still for anyone who prefers less motion), and the arrow keys, Home and End move
 * between them as a tab strip should.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { FlameIcon, TargetIcon } from "@/components/icons";
import type { TabPreview } from "@/lib/natgasDesk";
import { formatMovePct } from "@/lib/watchlist";

import { DIRECTION, MoveArrow } from "./direction";
import type { DeskTab } from "./useDeskTab";

export const DESK_TABS: readonly DeskTab[] = ["contracts", "natural-gas", "planner"];
export const tabId = (tab: DeskTab) => `desk-tab-${tab}`;
export const panelId = (tab: DeskTab) => `desk-panel-${tab}`;

function Preview({ preview }: { preview: TabPreview }) {
  if (preview.kind === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-profit/10 px-2 py-0.5 text-[11px] font-semibold text-profit ring-1 ring-inset ring-profit/25">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-profit" />
        Live
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${DIRECTION[preview.direction].pill}`}>
      <span className="sr-only">{DIRECTION[preview.direction].label} </span>
      <MoveArrow direction={preview.direction} className="size-2" />
      {formatMovePct(preview.movePct)}
    </span>
  );
}

export default function DeskTabs({
  tab,
  onTab,
  summary,
  shortSummary,
  preview,
}: {
  tab: DeskTab;
  onTab: (tab: DeskTab) => void;
  /** What the board shows, e.g. "All sectors · 19 contracts" - the first tab's label. */
  summary: string;
  /** The same for a phone, where the strip has to fit one line: "All · 19". */
  shortSummary: string;
  preview: TabPreview | null;
}) {
  const reduce = useReducedMotion();
  const buttons = useRef(new Map<DeskTab, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = DESK_TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? DESK_TABS[(at + 1) % DESK_TABS.length] : event.key === "ArrowLeft" ? DESK_TABS[(at + DESK_TABS.length - 1) % DESK_TABS.length] : event.key === "Home" ? DESK_TABS[0] : event.key === "End" ? DESK_TABS[DESK_TABS.length - 1] : null;
    if (next === null) return;
    event.preventDefault();
    onTab(next);
    buttons.current.get(next)?.focus();
  }

  const labels: Record<DeskTab, ReactNode> = {
    contracts: (
      <>
        <span className="sm:hidden">{shortSummary}</span>
        <span className="hidden sm:inline">{summary}</span>
      </>
    ),
    "natural-gas": (
      <>
        <FlameIcon className="size-3.5" />
        <span>Natural gas</span>
        {preview && <Preview preview={preview} />}
      </>
    ),
    planner: (
      <>
        <TargetIcon className="size-3.5" />
        <span className="sm:hidden">Plan</span>
        <span className="hidden sm:inline">Trade plan</span>
      </>
    ),
  };

  return (
    <div role="tablist" aria-label="Commodities view" onKeyDown={onKeyDown} className="inline-flex max-w-full rounded-xl border border-border bg-card p-0.5">
      {DESK_TABS.map((key) => {
        const active = tab === key;
        return (
          <button
            key={key}
            ref={(el) => {
              if (el) buttons.current.set(key, el);
              else buttons.current.delete(key);
            }}
            type="button"
            role="tab"
            id={tabId(key)}
            aria-selected={active}
            aria-controls={panelId(key)}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(key)}
            className={`relative isolate flex min-h-9 min-w-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.span
                layoutId="desk-tab-pill"
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-lg bg-muted shadow-sm ring-1 ring-inset ring-border/60"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            {labels[key]}
          </button>
        );
      })}
    </div>
  );
}
