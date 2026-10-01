"use client";

/**
 * Option-chain picker — a Sensibull-style strike ladder for adding legs by
 * tapping Buy/Sell on a contract instead of typing strike, type and price.
 * Shared by the Analysis tab (adds legs to a strategy) and by Live Portfolio
 * and Paper Trade (adds open positions), which is why it only reports what
 * was picked and leaves the consequences to `onDone`.
 */

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { XIcon } from "@/components/icons";
import LivePricingBanners from "@/components/LivePricingBanners";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/Select";
import { expiryCloseMs, istDateString, upcomingWeeklyExpiries, type LegSide, type LegType } from "@/lib/calculateStrategy";
import { formatCompactINR } from "@/lib/format";
import type { PickedLeg } from "@/lib/strategyTransfer";
import { INSTRUMENTS, INSTRUMENT_LABELS, type Instrument } from "@/lib/types";
import { fetchExpiries, fetchOptionChain } from "@/lib/upstox/client";
import { isUpstoxOptionChainError, type UpstoxOptionChainStrike, type UpstoxOptionLeg } from "@/lib/upstox/types";

const POLL_MS = 10_000;
const INSTRUMENT_OPTIONS = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_LABELS[i] }));

type View = "ltp" | "oi" | "greeks";
const VIEWS: { id: View; label: string }[] = [
  { id: "ltp", label: "LTP" },
  { id: "oi", label: "OI" },
  { id: "greeks", label: "Greeks" },
];

type Selected = Omit<PickedLeg, "ltp"> & { ltp: number | null };

type Props = {
  initialInstrument: Instrument;
  initialExpiry?: string;
  /** Analysis only: picking under a different underlying replaces the legs already on screen. */
  replaceWarning?: boolean;
  doneLabel: (count: number) => string;
  onDone: (instrument: Instrument, legs: PickedLeg[]) => void;
  onClose: () => void;
};

const legKey = (expiry: string, strike: number, type: LegType) => `${expiry}|${strike}|${type}`;

const num = (v: number | undefined | null, digits = 2) => (v == null ? "–" : v.toFixed(digits));

/** "06 Oct", with a two-digit year once it's not this year's — the list runs years out. */
function formatExpiry(iso: string, today: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(iso.slice(0, 4) !== today.slice(0, 4) ? { year: "2-digit" as const } : {}),
    timeZone: "UTC",
  });
}

function legOf(row: UpstoxOptionChainStrike, type: LegType): UpstoxOptionLeg | undefined {
  return type === "CE" ? row.call_options : row.put_options;
}

export default function OptionChainPicker({
  initialInstrument,
  initialExpiry,
  replaceWarning,
  doneLabel,
  onDone,
  onClose,
}: Props) {
  const [instrument, setInstrument] = useState<Instrument>(initialInstrument);
  const [pickedExpiry, setPickedExpiry] = useState<string | null>(initialExpiry ?? null);
  const [view, setView] = useState<View>("ltp");
  const [expiriesByInstrument, setExpiriesByInstrument] = useState<Partial<Record<Instrument, string[]>>>({});
  const [chains, setChains] = useState<Record<string, UpstoxOptionChainStrike[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, Selected>>({});
  // Touch screens have no hover, so tapping a cell pins its Buy/Sell buttons open.
  const [pinned, setPinned] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());
  const today = istDateString(nowMs);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atmRef = useRef<HTMLDivElement>(null);
  const scrolledForRef = useRef<string | null>(null);
  const expiriesRequestedRef = useRef<Set<Instrument>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // --- Expiries --------------------------------------------------------------

  useEffect(() => {
    if (expiriesRequestedRef.current.has(instrument)) return;
    expiriesRequestedRef.current.add(instrument);
    // Not cancelled on cleanup: the answer is keyed by instrument, so it's valid whenever it lands — and the
    // request guard above means a discarded answer (strict-mode remount) would never be asked for again.
    // A failed lookup leaves an empty list, which falls back to the weekly pattern below.
    void fetchExpiries(instrument).then((result) => {
      setExpiriesByInstrument((prev) => ({ ...prev, [instrument]: "error" in result ? [] : result.expiries }));
    });
  }, [instrument]);

  const expiries = useMemo(() => {
    // An expiry is gone once its 15:30 IST close has passed, even though today's date still matches.
    const listed = (expiriesByInstrument[instrument] ?? []).filter((e) => expiryCloseMs(e) > nowMs);
    return listed.length > 0 ? listed : upcomingWeeklyExpiries(today, instrument, nowMs);
  }, [expiriesByInstrument, instrument, today, nowMs]);
  const expiry = pickedExpiry && expiries.includes(pickedExpiry) ? pickedExpiry : expiries[0];

  // --- Chain: load now, then keep LTPs fresh ---------------------------------

  const chainKey = `${instrument}|${expiry}`;
  useEffect(() => {
    let cancelled = false;
    let stop = false;

    async function load() {
      let outcome: { rows: UpstoxOptionChainStrike[] } | { error: string };
      try {
        const result = await fetchOptionChain(instrument, expiry);
        outcome = isUpstoxOptionChainError(result) ? { error: result.error } : { rows: result.data };
      } catch {
        outcome = { error: "network_error" };
      }
      if (cancelled) return;
      if ("error" in outcome) {
        // A known-bad token won't fix itself between ticks — stop retrying (closing and reopening the picker retries).
        if (outcome.error === "token_expired") stop = true;
        setErrors((prev) => ({ ...prev, [chainKey]: outcome.error }));
      } else {
        setChains((prev) => ({ ...prev, [chainKey]: outcome.rows }));
        setErrors((prev) => {
          if (!(chainKey in prev)) return prev;
          const { [chainKey]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        });
      }
    }

    void load();
    const id = setInterval(() => {
      if (!stop && !document.hidden) void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [instrument, expiry, chainKey]);

  const rows = useMemo(
    () => [...(chains[chainKey] ?? [])].filter((r) => r.strike_price != null).sort((a, b) => a.strike_price! - b.strike_price!),
    [chains, chainKey],
  );
  const spot = rows.find((r) => (r.underlying_spot_price ?? 0) > 0)?.underlying_spot_price ?? null;
  const atmStrike = useMemo(() => {
    if (spot === null || rows.length === 0) return null;
    return rows.reduce((best, r) => (Math.abs(r.strike_price! - spot) < Math.abs(best - spot) ? r.strike_price! : best), rows[0].strike_price!);
  }, [rows, spot]);
  const maxOi = useMemo(() => {
    let call = 1;
    let put = 1;
    for (const r of rows) {
      call = Math.max(call, r.call_options?.market_data?.oi ?? 0);
      put = Math.max(put, r.put_options?.market_data?.oi ?? 0);
    }
    return { CE: call, PE: put };
  }, [rows]);

  // Open on the money, once per chain — not on every price refresh.
  useEffect(() => {
    if (rows.length === 0 || scrolledForRef.current === chainKey) return;
    scrolledForRef.current = chainKey;
    const box = scrollRef.current;
    const atm = atmRef.current;
    if (box && atm) box.scrollTop = atm.offsetTop - box.clientHeight / 2 + atm.clientHeight / 2;
  }, [rows, chainKey]);

  const status = errors[chainKey];
  const loading = rows.length === 0 && !status;

  // --- Selection -------------------------------------------------------------

  function pick(row: UpstoxOptionChainStrike, type: LegType, side: LegSide) {
    const strike = row.strike_price!;
    const key = legKey(expiry, strike, type);
    const ltp = legOf(row, type)?.market_data?.ltp;
    setSelected((prev) => {
      if (prev[key]?.side === side) {
        const { [key]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      }
      return {
        ...prev,
        [key]: { side, type, strike, expiry, lots: prev[key]?.lots ?? 1, ltp: ltp != null && ltp > 0 ? ltp : null },
      };
    });
  }

  function setLots(key: string, lots: number) {
    setSelected((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], lots: Math.max(1, lots) } } : prev));
  }

  function removeLeg(key: string) {
    setSelected((prev) => {
      const { [key]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
  }

  function handleInstrumentChange(next: Instrument) {
    if (next === instrument) return;
    setInstrument(next);
    setPickedExpiry(null);
    setSelected({}); // a pick belongs to one underlying
  }

  function handleDone() {
    // Prefer the freshest cached price for each pick over the one seen when it was tapped.
    const legs: PickedLeg[] = Object.values(selected).map((leg) => {
      const fresh = chains[`${instrument}|${leg.expiry}`]
        ?.find((r) => r.strike_price === leg.strike);
      const ltp = fresh ? legOf(fresh, leg.type)?.market_data?.ltp : undefined;
      return { ...leg, ltp: ltp != null && ltp > 0 ? ltp : leg.ltp };
    });
    onDone(instrument, legs);
  }

  const selectedList = Object.entries(selected);
  const expiryOptions = expiries.map((e) => ({ value: e, label: formatExpiry(e, today) }));

  // --- Cells -----------------------------------------------------------------

  function renderSide(row: UpstoxOptionChainStrike, type: LegType) {
    const strike = row.strike_price!;
    const leg = legOf(row, type);
    const key = legKey(expiry, strike, type);
    const chosen = selected[key]?.side;
    const oi = leg?.market_data?.oi ?? 0;
    const itm = spot !== null && (type === "CE" ? strike < spot : strike > spot);
    const g = leg?.option_greeks;
    const isCall = type === "CE";
    const barPct = Math.round((oi / maxOi[type]) * 70);

    const bar = (
      <span
        aria-hidden="true"
        className={`absolute inset-y-1.5 ${isCall ? "right-0 rounded-l-full bg-loss/20" : "left-0 rounded-r-full bg-profit/20"}`}
        style={{ width: `${barPct}%` }}
      />
    );
    const delta = (
      <span className={`w-10 shrink-0 text-xs text-muted-foreground ${isCall ? "" : "text-right"}`}>{num(g?.delta)}</span>
    );
    const ltpText = (
      <span className={`w-16 shrink-0 font-mono tabular-nums ${isCall ? "" : "text-right"}`}>{num(leg?.market_data?.ltp)}</span>
    );

    let content: React.ReactNode;
    if (view === "greeks") {
      const cells = [num(g?.delta), num(g?.gamma, 4), num(g?.theta, 1), num(g?.vega, 1)];
      content = (
        <span className={`flex w-full items-center gap-1 font-mono text-xs tabular-nums ${isCall ? "" : "flex-row-reverse"}`}>
          {cells.map((c, i) => (
            <span key={i} className="min-w-0 flex-1 truncate text-center">
              {c}
            </span>
          ))}
        </span>
      );
    } else if (view === "oi") {
      const volume = (
        <span className={`w-14 shrink-0 text-xs text-muted-foreground ${isCall ? "" : "text-right"}`}>
          {formatCompactINR(leg?.market_data?.volume ?? 0)}
        </span>
      );
      const oiText = (
        <span className={`w-16 shrink-0 font-mono tabular-nums ${isCall ? "" : "text-right"}`}>{formatCompactINR(oi)}</span>
      );
      content = isCall ? (
        <>
          {volume}
          {oiText}
        </>
      ) : (
        <>
          {oiText}
          {volume}
        </>
      );
    } else {
      content = isCall ? (
        <>
          {delta}
          {ltpText}
        </>
      ) : (
        <>
          {ltpText}
          {delta}
        </>
      );
    }

    const showButtons = chosen !== undefined || pinned === key;
    const buttonBase = "h-6 w-7 rounded border text-xs font-semibold transition-colors";
    return (
      <div
        onClick={() => setPinned((p) => (p === key ? null : key))}
        className={`group/cell relative flex h-10 min-w-0 cursor-pointer items-center px-2 ${isCall ? "" : "justify-end"} ${
          itm ? "bg-warning/10" : ""
        }`}
      >
        {view !== "greeks" && bar}
        <span className={`relative flex w-full items-center ${isCall ? "" : "justify-end"} ${view === "greeks" ? "" : "gap-1"}`}>
          {content}
        </span>
        <span
          className={`absolute top-1/2 z-10 flex -translate-y-1/2 gap-1 ${isCall ? "right-1" : "left-1"} ${
            showButtons ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100"
          }`}
        >
          {(["buy", "sell"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-label={`${side === "buy" ? "Buy" : "Sell"} ${strike} ${type}`}
              aria-pressed={chosen === side}
              onClick={(e) => {
                e.stopPropagation();
                pick(row, type, side);
              }}
              className={`${buttonBase} ${
                chosen === side
                  ? side === "buy"
                    ? "border-info bg-info text-white"
                    : "border-danger-fg bg-danger-fg text-white"
                  : `border-border bg-card hover:bg-muted ${side === "buy" ? "text-info" : "text-danger-fg"}`
              }`}
            >
              {side === "buy" ? "B" : "S"}
            </button>
          ))}
        </span>
      </div>
    );
  }

  // Header cells reuse the data cells' widths so each label sits over its numbers.
  const spacer = "min-w-0 flex-1";
  const headerCells: Record<View, { call: [string, string][]; put: [string, string][] }> = {
    ltp: {
      call: [["Delta", "w-10 shrink-0"], ["LTP", "w-16 shrink-0"], ["OI", `${spacer} text-right`]],
      put: [["OI", `${spacer}`], ["LTP", "w-16 shrink-0 text-right"], ["Delta", "w-10 shrink-0 text-right"]],
    },
    oi: {
      call: [["Volume", "w-14 shrink-0"], ["OI", "w-16 shrink-0"], ["", spacer]],
      put: [["", spacer], ["OI", "w-16 shrink-0 text-right"], ["Volume", "w-14 shrink-0 text-right"]],
    },
    greeks: {
      call: [["Delta", `${spacer} text-center`], ["Gamma", `${spacer} text-center`], ["Theta", `${spacer} text-center`], ["Vega", `${spacer} text-center`]],
      put: [["Vega", `${spacer} text-center`], ["Theta", `${spacer} text-center`], ["Gamma", `${spacer} text-center`], ["Delta", `${spacer} text-center`]],
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Option chain"
        className="glass-panel flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="w-36">
            <Select value={instrument} onChange={handleInstrumentChange} options={INSTRUMENT_OPTIONS} />
          </div>
          <div className="text-sm font-semibold">
            {spot !== null ? <span className="font-mono tabular-nums">{spot.toFixed(2)}</span> : <span className="text-muted-foreground">Spot —</span>}
          </div>
          <div className="w-28">
            <Select value={expiry ?? ""} onChange={setPickedExpiry} options={expiryOptions} />
          </div>
          <div role="tablist" className="flex overflow-hidden rounded-lg border border-border">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {(status === "token_expired" || status === "network_error") && (
          <div className="shrink-0 px-4 pt-3">
            <LivePricingBanners tokenExpired={status === "token_expired"} offline={status === "network_error"} />
          </div>
        )}

        {/* Ladder */}
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <div className="min-w-[560px]">
            <div className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_4.5rem_3rem_minmax(0,1fr)] border-b border-border bg-card text-xs text-muted-foreground">
              <div className="flex items-center gap-1 px-2 py-2">
                {headerCells[view].call.map(([label, cls], i) => (
                  <span key={i} className={`truncate ${cls}`}>
                    {label}
                  </span>
                ))}
              </div>
              <div className="py-2 text-center">Strike</div>
              <div className="py-2 text-center">IV</div>
              <div className="flex items-center gap-1 px-2 py-2">
                {headerCells[view].put.map(([label, cls], i) => (
                  <span key={i} className={`truncate ${cls}`}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {loading ? (
              <LoadingState className="h-48" label="Loading option chain…" />
            ) : rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {status === "token_expired"
                  ? "Reconnect Upstox in Settings to see the option chain."
                  : `Couldn't load the ${formatExpiry(expiry ?? today, today)} chain.`}
              </p>
            ) : (
              rows.map((row) => {
                const strike = row.strike_price!;
                const isAtm = strike === atmStrike;
                const iv = row.call_options?.option_greeks?.iv ?? row.put_options?.option_greeks?.iv;
                return (
                  <div
                    key={strike}
                    ref={isAtm ? atmRef : undefined}
                    className={`grid grid-cols-[minmax(0,1fr)_4.5rem_3rem_minmax(0,1fr)] border-b border-border/50 text-sm ${
                      isAtm ? "bg-accent/10" : ""
                    }`}
                  >
                    {renderSide(row, "CE")}
                    <div className="flex items-center justify-center bg-muted/50">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                          isAtm ? "bg-accent text-accent-foreground" : ""
                        }`}
                      >
                        {strike}
                      </span>
                    </div>
                    <div className="flex items-center justify-center bg-muted/30 font-mono text-xs tabular-nums text-muted-foreground">
                      {iv ? iv.toFixed(1) : "–"}
                    </div>
                    {renderSide(row, "PE")}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selection */}
        {selectedList.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-border px-4 py-2">
            {selectedList.map(([key, leg]) => (
              <div key={key} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs">
                <span
                  className={`flex size-5 items-center justify-center rounded font-bold ${
                    leg.side === "buy" ? "bg-info/20 text-info" : "bg-danger-fg/15 text-danger-fg"
                  }`}
                >
                  {leg.side === "buy" ? "B" : "S"}
                </span>
                <span className="font-medium">
                  {formatExpiry(leg.expiry, today)} {leg.strike} {leg.type}
                </span>
                <span className="font-mono text-muted-foreground">@{leg.ltp ?? "–"}</span>
                <button
                  type="button"
                  aria-label="Fewer lots"
                  onClick={() => setLots(key, leg.lots - 1)}
                  className="flex size-5 items-center justify-center rounded border border-border hover:bg-muted"
                >
                  −
                </button>
                <span className="w-8 text-center font-mono tabular-nums">{leg.lots}L</span>
                <button
                  type="button"
                  aria-label="More lots"
                  onClick={() => setLots(key, leg.lots + 1)}
                  className="flex size-5 items-center justify-center rounded border border-border hover:bg-muted"
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeLeg(key)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-danger-fg"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {selectedList.length} leg{selectedList.length === 1 ? "" : "s"} selected
            {replaceWarning && instrument !== initialInstrument ? " · replaces the legs on screen" : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected({})}
              disabled={selectedList.length === 0}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 active:scale-95"
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={handleDone}
              disabled={selectedList.length === 0}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50 active:scale-95"
            >
              {doneLabel(selectedList.length)}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
