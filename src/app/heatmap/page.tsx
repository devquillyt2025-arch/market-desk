import type { Metadata } from "next";

import HeatmapView from "./HeatmapView";

export const metadata: Metadata = {
  title: "Heatmap",
};

export default function HeatmapPage() {
  return <HeatmapView />;
}
