import type { Metadata } from "next";

import AnalysisView from "./AnalysisView";

export const metadata: Metadata = {
  title: "Analysis",
};

export default function AnalysisPage() {
  return <AnalysisView />;
}
