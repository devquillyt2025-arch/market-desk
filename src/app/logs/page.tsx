import type { Metadata } from "next";

import LogsView from "./LogsView";

export const metadata: Metadata = {
  title: "Logs",
};

export default function LogsPage() {
  return <LogsView />;
}
