import type { Metadata } from "next";
import CommoditiesView from "./CommoditiesView";

export const metadata: Metadata = {
  title: "MCX Commodities",
  description: "Live MCX futures commodity prices — Energy and Metals contracts exclusively.",
};

export default function CommoditiesPage() {
  return <CommoditiesView />;
}

