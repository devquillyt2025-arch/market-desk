"use client";

/**
 * The natural gas contract dropdown, the same on the Natural gas and Trade plan tabs: every future still listed, then "Most active
 * (auto)". One saved choice serves both tabs (see usePlannerPrefs), so picking here changes the other tab too.
 */

import { contractMonthLabel } from "@/lib/mcxCommodities";
import type { ContractPref, NatgasFuture } from "@/lib/natgasContract";

/** "Dec 2026 · expires 28 Dec". */
function optionText(future: NatgasFuture): string {
  const expires = new Date(`${future.expiry}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${contractMonthLabel(future.expiry)} · expires ${expires}`;
}

/** `hideLabel` keeps the "Contract" label for screen readers but not on the page, for a row that is short of room. `hint` is why this contract was picked ("the nearest with more than 3 days to run ..."): on hover and for screen readers, not printed on the page. */
export default function ContractSelect({ id, contracts, value, onChange, hint, hideLabel = false }: { id: string; contracts: readonly NatgasFuture[]; value: string; onChange: (next: ContractPref) => void; hint?: string; hideLabel?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-xs font-medium text-muted-foreground"}>
        Contract
      </label>
      <select
        id={id}
        value={value}
        title={hint}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value as ContractPref)}
        className="min-h-10 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 pointer-coarse:min-h-11"
      >
        {contracts.map((c) => (
          <option key={c.key} value={c.key}>
            {optionText(c)}
          </option>
        ))}
        <option value="auto">Most active (auto)</option>
      </select>
      {hint && (
        <span id={`${id}-hint`} className="sr-only">
          {hint}
        </span>
      )}
    </div>
  );
}
