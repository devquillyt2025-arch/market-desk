/**
 * Which of Live Portfolio's insight tabs are shown - pure, no React. Two of the five are optional: the What-if lab (it
 * tries a thousand ideas on every price update) and the RRR planner (it has nothing to do with the positions). The
 * other three - Risk & Probability, Simulate and Reward : Risk - are always there once a position is held. The choice is a per-device
 * convenience, kept in localStorage like the Analysis strategy and the averaging figures; it never goes to Supabase.
 */

export type OptionalInsightsTab = "whatif" | "planner";
export type InsightsTabPrefs = Record<OptionalInsightsTab, boolean>;

/** Everything on, as the tabs have always been. */
export const DEFAULT_INSIGHTS_TAB_PREFS: InsightsTabPrefs = { whatif: true, planner: true };

export const OPTIONAL_INSIGHTS_TABS: { id: OptionalInsightsTab; label: string; hint: string }[] = [
  { id: "whatif", label: "What-if lab", hint: "Tries every exit, add, hedge and new trade on your positions" },
  { id: "planner", label: "RRR planner", hint: "The win rate and reward for the risk a plan needs - no positions involved" },
];

/** Reads what was saved. Anything missing or unreadable stays on: a tab is only ever hidden by an explicit `false`. */
export function parseInsightsTabPrefs(raw: string | null | undefined): InsightsTabPrefs {
  if (!raw) return DEFAULT_INSIGHTS_TAB_PREFS;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return DEFAULT_INSIGHTS_TAB_PREFS;
    const { whatif, planner } = v as Record<string, unknown>;
    return { whatif: whatif !== false, planner: planner !== false };
  } catch {
    return DEFAULT_INSIGHTS_TAB_PREFS;
  }
}

export function serializeInsightsTabPrefs(prefs: InsightsTabPrefs): string {
  return JSON.stringify({ whatif: prefs.whatif, planner: prefs.planner });
}

/**
 * Whether a tab is on the strip. With no priced position the RRR planner is the only tab with anything to show, and the
 * "Tabs" setting still decides whether it is: switched off, nothing is shown at all (the strip is empty, just the menu
 * to switch it back on). The others wait for a position.
 */
export function isInsightsTabShown(id: string, hasPositions: boolean, prefs: InsightsTabPrefs): boolean {
  if (!hasPositions) return id === "planner" && prefs.planner;
  if (id === "whatif") return prefs.whatif;
  if (id === "planner") return prefs.planner;
  return true;
}
