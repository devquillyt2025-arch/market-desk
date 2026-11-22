"use client";

/**
 * The "Tabs" button at the right end of Live Portfolio's insight tab strip: a small menu that switches the two optional
 * tabs - the What-if lab and the RRR planner - on or off. It sits beside the tabs it controls rather than in Settings,
 * and at the right edge, so the menu opens inward and stays on screen however narrow the page is.
 */

import { useEffect, useId, useRef, useState } from "react";

import { SettingsIcon } from "@/components/icons";
import Switch from "@/components/Switch";
import { alignForMenu } from "@/lib/alignForMenu";
import { OPTIONAL_INSIGHTS_TABS, type InsightsTabPrefs, type OptionalInsightsTab } from "@/lib/insightsTabPrefs";

export default function InsightsTabsMenu({
  prefs,
  onChange,
}: {
  prefs: InsightsTabPrefs;
  onChange: (id: OptionalInsightsTab, shown: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Which edge of the button the menu hangs from, chosen as it opens so it stays on screen (see menuAlign).
  const [align, setAlign] = useState<"left" | "right">("right");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const hidden = OPTIONAL_INSIGHTS_TABS.filter((t) => !prefs[t.id]).length;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) setAlign(alignForMenu(rootRef.current, 320));
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-controls={menuId}
        title="Choose which insight tabs to show"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <SettingsIcon className="size-3.5" />
        Tabs
        {hidden > 0 && <span className="text-warning">· {hidden} hidden</span>}
      </button>

      {open && (
        <div
          id={menuId}
          role="group"
          aria-label="Insight tabs to show"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-[calc(100%+6px)] z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 shadow-lg`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show these tabs</p>
          <ul className="mt-2 flex flex-col gap-3">
            {OPTIONAL_INSIGHTS_TABS.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id={`${menuId}-${t.id}`} className="text-sm font-medium text-foreground">
                    {t.label}
                  </p>
                  <p id={`${menuId}-${t.id}-hint`} className="mt-0.5 text-xs text-muted-foreground">
                    {t.hint}
                  </p>
                </div>
                <Switch
                  checked={prefs[t.id]}
                  onChange={(next) => onChange(t.id, next)}
                  labelledBy={`${menuId}-${t.id}`}
                  describedBy={`${menuId}-${t.id}-hint`}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
            Risk &amp; Probability, Simulate and Reward : Risk are always shown while you hold a position. A hidden tab
            isn&apos;t built, so it does no work in the background. Saved on this device.
          </p>
        </div>
      )}
    </div>
  );
}
