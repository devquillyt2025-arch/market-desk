import BrokerageCalculator from "@/components/BrokerageCalculator";

export default function Home() {
  return (
    // h locks the page to the viewport (minus <main>'s own vertical padding
    // plus, below lg, Sidebar's mobile top bar that sits above <main> too)
    // so BrokerageCalculator can flex-fill the remaining space below the
    // header instead of sizing to a fixed compact height and leaving dead
    // space beneath it on tall screens. Three tiers because the top bar
    // only exists below lg, and <main>'s own padding changes at sm.
    <div className="flex h-[calc(100dvh-125px)] min-h-0 flex-col gap-6 sm:h-[calc(100dvh-141px)] lg:h-[calc(100dvh-5rem)]">
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
