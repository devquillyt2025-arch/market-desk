import type { Metadata } from "next";

import TradeEntriesView from "./TradeEntriesView";

export const metadata: Metadata = {
  title: "Trade Entries",
};

export default function TradeEntriesPage() {
  return <TradeEntriesView />;
}
