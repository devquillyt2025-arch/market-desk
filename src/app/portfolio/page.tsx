import type { Metadata } from "next";

import PortfolioView from "./PortfolioView";

export const metadata: Metadata = {
  title: "Live Portfolio",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
