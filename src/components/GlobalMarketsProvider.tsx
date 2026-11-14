"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { useGlobalMarkets, type GlobalMarketsState } from "@/lib/useGlobalMarkets";

const GlobalMarketsContext = createContext<GlobalMarketsState | null>(null);

/**
 * One poll of the global prices for the whole app, shared by the strip across the top and the Watchlist's Global markets
 * section - so they always show the same numbers, a manual refresh updates both, and the server is asked once, not once
 * per place. It sits in the root layout, so the poll runs through every page change, and stays off on the PIN screen.
 */
export function GlobalMarketsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const state = useGlobalMarkets(undefined, pathname !== "/lock");
  return <GlobalMarketsContext.Provider value={state}>{children}</GlobalMarketsContext.Provider>;
}

export function useGlobalMarketsContext(): GlobalMarketsState {
  const state = useContext(GlobalMarketsContext);
  if (!state) throw new Error("useGlobalMarketsContext must be used inside GlobalMarketsProvider.");
  return state;
}
