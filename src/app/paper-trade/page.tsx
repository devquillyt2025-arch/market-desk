import type { Metadata } from "next";

import PaperTradeView from "./PaperTradeView";

export const metadata: Metadata = {
  title: "Paper Trade",
};

export default function PaperTradePage() {
  return <PaperTradeView />;
}
