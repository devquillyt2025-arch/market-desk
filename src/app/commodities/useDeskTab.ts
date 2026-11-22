/**
 * Which view the Commodities page shows: the contracts, the natural gas desk or the long/short planner. It lives in the address
 * (`#natural-gas`, `#planner`), so a view can be bookmarked and shared and a reload comes back to it - and nothing else needs to know. The server and the first
 * client render both say "contracts" (a hash never reaches the server); the store then moves a deep link over to the desk.
 */

import { useCallback, useSyncExternalStore } from "react";

export type DeskTab = "contracts" | "natural-gas" | "planner";

const HASH: Record<Exclude<DeskTab, "contracts">, string> = { "natural-gas": "#natural-gas", planner: "#planner" };
const CHANGED = "marketdesk:desk-tab";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

const read = (): DeskTab => (window.location.hash === HASH["natural-gas"] ? "natural-gas" : window.location.hash === HASH.planner ? "planner" : "contracts");
const readOnServer = (): DeskTab => "contracts";

export function useDeskTab(): [DeskTab, (tab: DeskTab) => void] {
  const tab = useSyncExternalStore(subscribe, read, readOnServer);
  const select = useCallback((next: DeskTab) => {
    // replaceState, not a new history entry: switching a tab shouldn't make Back step through them. Next.js folds it into its router.
    window.history.replaceState(null, "", next === "contracts" ? `${window.location.pathname}${window.location.search}` : HASH[next]);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [tab, select];
}
