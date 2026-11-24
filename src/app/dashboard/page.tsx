import type { Metadata } from "next";

import DashboardView from "./DashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "A quick look at the market, your positions and your reports.",
};

export default function DashboardPage() {
  return <DashboardView />;
}
