import type { Metadata } from "next";

import BrokerageCalculator from "@/components/BrokerageCalculator";

export const metadata: Metadata = {
  title: "Brokerage Calculator",
};

export default function BrokeragePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brokerage Calculator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estimate brokerage, taxes, and net P&amp;L across delivery, intraday, futures, and options.
        </p>
      </div>
      <BrokerageCalculator />
    </div>
  );
}
