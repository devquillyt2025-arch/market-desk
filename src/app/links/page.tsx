import type { Metadata } from "next";

import LinksView from "./LinksView";

export const metadata: Metadata = {
  title: "Important Links",
};

export default function LinksPage() {
  return <LinksView />;
}
