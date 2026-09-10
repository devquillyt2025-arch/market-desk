import TradeCalculator from "@/components/TradeCalculator";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade Calculator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build a multi-leg options-selling trade and see live P&amp;L as you type.
        </p>
      </div>
      <TradeCalculator />
    </div>
  );
}
