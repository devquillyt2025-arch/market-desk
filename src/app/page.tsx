import BrokerageCalculator from "@/components/BrokerageCalculator";
import { PAGE_HEIGHT_LOCK_CLASS } from "@/lib/layout";

export default function Home() {
  return (
    // Locks the page to the viewport so BrokerageCalculator can flex-fill
    // the remaining space below the header instead of sizing to a fixed
    // compact height and leaving dead space beneath it on tall screens.
    <div className={`flex flex-col gap-6 ${PAGE_HEIGHT_LOCK_CLASS}`}>
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Brokerage Calculator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estimate brokerage, taxes, and net P&amp;L across delivery, intraday, futures, and options.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <BrokerageCalculator />
      </div>
    </div>
  );
}
