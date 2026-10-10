"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import DatePicker from "@/components/DatePicker";
import { ChevronDownIcon, DownloadIcon, InboxIcon, PlusIcon, RefreshIcon, TrashIcon, UploadIcon } from "@/components/icons";
import OptionChainPicker from "@/components/OptionChainPicker";
import ImportPositionsModal, { type ImportMode, type ImportSource } from "@/components/ImportPositionsModal";
import LivePricingBanners from "@/components/LivePricingBanners";
import Select from "@/components/Select";
import StrategyPayoffChart from "@/components/StrategyPayoffChart";
import {
  addDays,
  analyzeStrategy,
  chartDomain,
  daysBetween,
  expiryCloseMs,
  istDateString,
  legGreeks,
  priceLegs,
  sampleCurves,
  strategyGreeks,
  strategyPnl,
  targetMomentMs,
  upcomingWeeklyExpiries,
  type LegType,
  type StrategyLeg,
} from "@/lib/calculateStrategy";
import { formatCompactINR, formatINR } from "@/lib/format";
import { loadLastSpots, saveLastSpot, type StoredSpot } from "@/lib/lastKnownPrices";
import { loadSavedAnalysis, saveAnalysis } from "@/lib/savedAnalysis";
import {
  buildStrategyExport,
  parseStrategyImport,
  tradeEntryToLeg,
  type DraftLeg,
  type DraftLegInput,
  type PickedLeg,
  type PriceMode,
} from "@/lib/strategyTransfer";
import { showToast } from "@/lib/toast";
import { DEFAULT_LOT_SIZES, INSTRUMENTS, INSTRUMENT_LABELS, type Instrument, type TradeEntry } from "@/lib/types";
import { fetchMargin, fetchOptionChain } from "@/lib/upstox/client";
import { isUpstoxOptionChainError, type UpstoxOptionChainResult, type UpstoxOptionChainStrike } from "@/lib/upstox/types";

/** Strike spacing per index — what the +/- buttons step by and what "ATM" rounds to. */
const STRIKE_STEP: Record<Instrument, number> = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };

/** One-line leg row from md up: [include] [B/S] [expiry] [strike] [CE/PE] [lots] [price] [delete]. Narrower screens wrap instead. */
const LEG_GRID =
  "md:grid md:grid-cols-[1rem_2rem_minmax(0,1.3fr)_minmax(0,1.5fr)_3rem_minmax(0,1fr)_minmax(0,1fr)_2rem] md:items-center md:gap-2";

const CHAIN_POLL_MS = 20_000;

const INSTRUMENT_OPTIONS = INSTRUMENTS.map((i) => ({ value: i, label: INSTRUMENT_LABELS[i] }));

type ChainStatus = "ok" | "token_expired" | "offline" | "error";
type Tab = "chart" | "payoff" | "pnl" | "greeks";

const TABS: { id: Tab; label: string }[] = [
  { id: "chart", label: "Payoff Chart" },
  { id: "payoff", label: "Payoff Table" },
  { id: "pnl", label: "P&L Table" },
  { id: "greeks", label: "Greeks" },
];

/** crypto.randomUUID only exists in secure contexts — plain-http LAN access has no such luxury. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `leg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function findQuote(rows: UpstoxOptionChainStrike[] | undefined, strike: number, type: LegType) {
  const row = rows?.find((r) => r.strike_price === strike);
  const leg = type === "CE" ? row?.call_options : row?.put_options;
  const ltp = leg?.market_data?.ltp;
  return {
    ltp: ltp != null && ltp > 0 ? ltp : null,
    iv: leg?.option_greeks?.iv ?? null,
    key: leg?.instrument_key ?? null,
  };
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `|| 0` folds -0 (from rounding a tiny negative, or negating 0) into plain 0 — otherwise it prints "-0". */
const whole = (n: number) => Math.round(n) || 0;
const signed = (n: number) => `${n > 0 ? "+" : ""}${whole(n).toLocaleString("en-IN")}`;
const pctText = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(0)}%`;
const pnlTone = (n: number) => (n > 0 ? "text-profit" : n < 0 ? "text-danger-fg" : "text-foreground");

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

function ImportMenu({ onPick }: { onPick: (source: ImportSource | "file") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const items: { id: ImportSource | "file"; label: string; hint: string }[] = [
    { id: "live", label: "Live Portfolio", hint: "Pick open positions" },
    { id: "paper", label: "Paper Trade", hint: "Pick open positions" },
    { id: "file", label: "JSON file", hint: "Strategy or trade-entries export" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
      >
        <UploadIcon className="size-4" />
        Import
        <ChevronDownIcon className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(item.id);
              }}
              className="flex w-full flex-col rounded-md px-3 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className="text-sm text-foreground">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stepper({
  value,
  onChange,
  step,
  min = 0,
  width = "w-20",
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  width?: string;
}) {
  // What's typed is held as text until the field loses focus, so it can be
  // emptied or half-typed without the parent snapping it back mid-keystroke.
  // Only a complete, in-range number is passed up.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");

  function handleType(text: string) {
    setDraft(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n >= min) onChange(n);
  }
  function nudge(delta: number) {
    setDraft(null);
    onChange(Math.max(min, value + delta));
  }

  const btn =
    "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95";
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button type="button" className={btn} onClick={() => nudge(-step)} aria-label="Decrease">
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={shown}
        onChange={(e) => handleType(e.target.value)}
        onBlur={() => setDraft(null)}
        className={`${INPUT_CLASS} ${width} text-center font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
      />
      <button type="button" className={btn} onClick={() => nudge(step)} aria-label="Increase">
        +
      </button>
    </div>
  );
}

function Tile({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-2.5" title={hint}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

export default function AnalysisView() {
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [legs, setLegs] = useState<DraftLeg[]>([]);
  const [spotOverride, setSpotOverride] = useState("");
  const [chains, setChains] = useState<Record<string, UpstoxOptionChainStrike[]>>({});
  const [chainStatus, setChainStatus] = useState<ChainStatus>("ok");
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("chart");
  const [dayIndex, setDayIndex] = useState(0);
  const [targetSpotInput, setTargetSpotInput] = useState<number | null>(null);
  const [invertRR, setInvertRR] = useState(false);
  const [margin, setMargin] = useState<{ sig: string; value: number | null }>({ sig: "", value: null });
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [chainOpen, setChainOpen] = useState(false);
  // Spot from the most recent chain load — not derived from the cache, whose entry order says nothing about freshness.
  const [liveSpot, setLiveSpot] = useState<({ instrument: Instrument } & StoredSpot) | null>(null);
  // The last spot saved on this device per index — only used when a chain load fails with no spot seen yet this session.
  const [storedSpots, setStoredSpots] = useState<Partial<Record<Instrument, StoredSpot>>>({});
  // Gates both the save effect and the first chain load below until *after*
  // the saved strategy has been restored — otherwise the save effect would
  // fire first, on the still-empty default state, and overwrite the very
  // strategy the restore was about to bring back (and the chain load would
  // fetch for the default underlying instead of the saved one).
  const [hydrated, setHydrated] = useState(false);
  const requestedRef = useRef<Set<string>>(new Set());
  // Lets an in-flight chain fetch notice the underlying changed (e.g. via an
  // import) before it writes prices into legs that now belong to another index.
  const instrumentRef = useRef(instrument);
  // Mirrors chainStatus for the poll timer, which shouldn't keep hammering Upstox with a token it knows is bad.
  const tokenExpiredRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lotSize = DEFAULT_LOT_SIZES[instrument];
  const step = STRIKE_STEP[instrument];
  const today = istDateString(nowMs);
  const defaultExpiry = useMemo(() => upcomingWeeklyExpiries(today, instrument, nowMs, 1)[0], [today, instrument, nowMs]);

  useEffect(() => {
    instrumentRef.current = instrument;
  }, [instrument]);

  // Restored after mount rather than in the useState initializers: localStorage
  // doesn't exist during SSR, so reading it there would hydrate with a mismatch.
  useEffect(() => {
    const saved = loadSavedAnalysis();
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setInstrument(saved.instrument);
      setLegs(saved.legs);
      setSpotOverride(saved.spotOverride);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    setStoredSpots(loadLastSpots());
    setHydrated(true);
  }, []);

  // Every change is saved as it happens — there's no Save button. Only Clear All empties it.
  useEffect(() => {
    if (hydrated) saveAnalysis({ instrument, legs, spotOverride });
  }, [hydrated, instrument, legs, spotOverride]);

  // "Now" only needs to be roughly current — it drives time-to-expiry.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // --- Option chains: spot, per-strike LTP/IV and instrument keys ------------

  const fillPrices = useCallback(
    (expiry: string, rows: UpstoxOptionChainStrike[], overwrite: boolean) => {
      setLegs((prev) =>
        prev.map((l) => {
          if (l.expiry !== expiry || (!overwrite && l.price !== "")) return l;
          const { ltp } = findQuote(rows, l.strike, l.type);
          return ltp === null ? l : { ...l, price: String(ltp) };
        }),
      );
    },
    [],
  );

  const loadChains = useCallback(
    async (inst: Instrument, expiries: string[], { force, overwritePrices }: { force: boolean; overwritePrices: boolean }) => {
      const fresh = expiries.filter((e) => force || !requestedRef.current.has(`${inst}|${e}`));
      if (fresh.length === 0) return;
      fresh.forEach((e) => requestedRef.current.add(`${inst}|${e}`));

      const results = await Promise.all(
        fresh.map(async (expiry): Promise<readonly [string, UpstoxOptionChainResult]> => {
          try {
            return [expiry, await fetchOptionChain(inst, expiry)] as const;
          } catch {
            return [expiry, { error: "network_error" }] as const;
          }
        }),
      );

      let status: ChainStatus = "ok";
      const loaded: Record<string, UpstoxOptionChainStrike[]> = {};
      for (const [expiry, result] of results) {
        if (isUpstoxOptionChainError(result)) {
          status = result.error === "token_expired" ? "token_expired" : result.error === "network_error" ? "offline" : "error";
          continue;
        }
        loaded[`${inst}|${expiry}`] = result.data;
        if (instrumentRef.current === inst) fillPrices(expiry, result.data, overwritePrices);
      }
      const freshSpot = Object.values(loaded)
        .flat()
        .find((r) => (r.underlying_spot_price ?? 0) > 0)?.underlying_spot_price;
      if (freshSpot) {
        const spotNow = { value: freshSpot, at: Date.now() };
        setLiveSpot({ instrument: inst, ...spotNow });
        saveLastSpot(inst, spotNow);
      }
      setChains((prev) => ({ ...prev, ...loaded }));
      tokenExpiredRef.current = status === "token_expired";
      setChainStatus(status);
      setNowMs(Date.now());
    },
    [fillPrices],
  );

  // A saved strategy can outlive its expiry; Upstox has no chain for a date that's gone, so don't keep asking (every poll) for one.
  const neededExpiries = [...new Set([defaultExpiry, ...legs.map((l) => l.expiry).filter((e) => e >= today)])]
    .sort()
    .join(",");
  useEffect(() => {
    if (!hydrated) return;
    void loadChains(instrument, neededExpiries.split(","), { force: false, overwritePrices: false });
  }, [hydrated, instrument, neededExpiries, loadChains]);

  // Keep spot and IV current. Typed or imported prices are left alone — only "Reset Prices" overwrites them.
  useEffect(() => {
    const id = setInterval(() => {
      if (tokenExpiredRef.current || document.hidden) return;
      void loadChains(instrument, neededExpiries.split(","), { force: true, overwritePrices: false });
    }, CHAIN_POLL_MS);
    return () => clearInterval(id);
  }, [instrument, neededExpiries, loadChains]);

  async function handleRefreshPrices() {
    setRefreshing(true);
    try {
      await loadChains(instrument, neededExpiries.split(","), { force: true, overwritePrices: true });
    } finally {
      setRefreshing(false);
    }
  }

  // Once the chain can't be reached (token expired / offline) the spot on screen is the last one seen — this
  // session's if there is one, else the one saved on this device (e.g. the token lapsed overnight).
  const chainsDown = chainStatus === "token_expired" || chainStatus === "offline";
  const lastSeenSpot =
    liveSpot?.instrument === instrument ? liveSpot : chainsDown ? (storedSpots[instrument] ?? null) : null;
  const chainSpot = lastSeenSpot?.value ?? null;
  const spotIsLast = chainsDown && lastSeenSpot !== null;

  const overrideNum = Number(spotOverride);
  const spot = overrideNum > 0 ? overrideNum : chainSpot;

  // --- Legs ------------------------------------------------------------------

  const quoteFor = useCallback(
    (leg: Pick<DraftLeg, "expiry" | "strike" | "type">) =>
      findQuote(chains[`${instrument}|${leg.expiry}`], leg.strike, leg.type),
    [chains, instrument],
  );

  function addLeg() {
    const last = legs[legs.length - 1];
    const atm = spot ? Math.round(spot / step) * step : 0;
    const draft = {
      expiry: last?.expiry ?? defaultExpiry,
      strike: last?.strike ?? atm,
      type: last?.type ?? ("CE" as LegType),
    };
    const ltp = quoteFor(draft).ltp;
    setLegs((prev) => [
      ...prev,
      {
        id: newId(),
        enabled: true,
        side: last ? last.side : "sell",
        lots: 1,
        price: ltp === null ? "" : String(ltp),
        ...draft,
      },
    ]);
  }

  function updateLeg(id: string, patch: Partial<DraftLeg>) {
    setLegs((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        // A different contract has a different market price — pull it in when we know it.
        if ("strike" in patch || "type" in patch || "expiry" in patch) {
          const ltp = quoteFor(next).ltp;
          if (ltp !== null) next.price = String(ltp);
        }
        return next;
      }),
    );
  }

  /** The strategy is auto-saved, so this is the one way to empty it — legs and any manual spot go together. */
  function handleClearAll() {
    setLegs([]);
    setSpotOverride("");
  }

  function handleInstrumentChange(next: Instrument) {
    if (next === instrument) return;
    setInstrument(next);
    setLegs([]);
    setSpotOverride("");
    setTargetSpotInput(null);
    setDayIndex(0);
  }

  // --- Import / export -------------------------------------------------------

  /** Replaces or extends the legs; switching underlying always replaces, since legs from two indices can't share a chart. */
  function applyImportedLegs(inst: Instrument, incoming: DraftLegInput[], mode: ImportMode) {
    const withIds: DraftLeg[] = incoming.map((l) => {
      // Live-priced legs: use the chain if it's already cached; otherwise the
      // blank price is filled when that expiry's chain arrives.
      const cached = l.price === "" ? findQuote(chains[`${inst}|${l.expiry}`], l.strike, l.type).ltp : null;
      return { ...l, id: newId(), price: cached !== null ? String(cached) : l.price };
    });
    const extend = mode === "add" && inst === instrument;
    if (inst !== instrument) {
      setInstrument(inst);
      setSpotOverride("");
    }
    if (!extend) {
      setTargetSpotInput(null);
      setDayIndex(0);
    }
    setLegs((prev) => (extend ? [...prev, ...withIds] : withIds));
  }

  function handleImportPositions(
    inst: Instrument,
    entries: TradeEntry[],
    options: { mode: ImportMode; priceMode: PriceMode },
  ) {
    const incoming = entries.map((e) => tradeEntryToLeg(e, options.priceMode)).filter((l): l is DraftLegInput => l !== null);
    applyImportedLegs(inst, incoming, options.mode);
    showToast(
      `Imported ${incoming.length} leg${incoming.length === 1 ? "" : "s"} from ${importSource === "paper" ? "Paper Trade" : "Live Portfolio"}.`,
      "success",
    );
    setImportSource(null);
  }

  /** Legs picked on the option-chain ladder — added to the strategy, or replacing it if a different underlying was chosen. */
  function handlePickedLegs(inst: Instrument, picked: PickedLeg[]) {
    const incoming: DraftLegInput[] = picked.map((p) => ({
      enabled: true,
      side: p.side,
      type: p.type,
      strike: p.strike,
      expiry: p.expiry,
      lots: p.lots,
      price: p.ltp === null ? "" : String(p.ltp),
    }));
    applyImportedLegs(inst, incoming, "add");
    setChainOpen(false);
  }

  function handleImportPick(source: ImportSource | "file") {
    if (source === "file") fileInputRef.current?.click();
    else setImportSource(source);
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires onChange
    if (!file) return;
    try {
      const parsed = parseStrategyImport(JSON.parse(await file.text()));
      if (parsed.legs.length === 0) {
        showToast("That file has no legs to import.");
        return;
      }
      applyImportedLegs(parsed.instrument, parsed.legs, "replace");
      showToast(
        `Imported ${parsed.legs.length} leg${parsed.legs.length === 1 ? "" : "s"}${parsed.skipped ? ` (${parsed.skipped} skipped)` : ""}.`,
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof SyntaxError
          ? "Couldn't import — that isn't valid JSON."
          : err instanceof Error
            ? err.message
            : "Couldn't import that file.",
      );
    }
  }

  function handleExport() {
    if (legs.length === 0) {
      showToast("Add some legs first — there's nothing to export yet.");
      return;
    }
    downloadJson(`strategy-${instrument.toLowerCase()}-${today}.json`, buildStrategyExport(instrument, legs));
  }

  // --- Analysis --------------------------------------------------------------

  // The analysis is anchored on the earliest expiry, so one expired leg beside
  // live ones would drag everything back to a date that's already gone — the
  // live legs valued as of then, POP and the date slider meaningless. That's
  // routine now that a saved strategy outlives its weekly expiry, so while any
  // included leg is still live, expired ones are left out (and flagged below,
  // not deleted). A strategy that's *entirely* expired is left alone: it's
  // still shown at its settled value.
  const dropsExpired = useMemo(
    () => legs.some((l) => l.enabled && expiryCloseMs(l.expiry) > nowMs),
    [legs, nowMs],
  );
  const isLeftOut = useCallback(
    (l: Pick<DraftLeg, "expiry">) => dropsExpired && expiryCloseMs(l.expiry) <= nowMs,
    [dropsExpired, nowMs],
  );
  const leftOutCount = legs.filter((l) => l.enabled && isLeftOut(l)).length;

  const strategyLegs: StrategyLeg[] = useMemo(
    () =>
      legs.map((l) => ({
        id: l.id,
        enabled: l.enabled && !isLeftOut(l),
        side: l.side,
        type: l.type,
        strike: l.strike,
        expiry: l.expiry,
        lots: l.lots,
        price: l.price.trim() === "" ? NaN : Number(l.price),
        chainIv: quoteFor(l).iv,
      })),
    [legs, quoteFor, isLeftOut],
  );

  const priced = useMemo(() => (spot ? priceLegs(strategyLegs, spot, nowMs, lotSize) : []), [strategyLegs, spot, nowMs, lotSize]);
  const metrics = useMemo(() => (spot ? analyzeStrategy(priced, spot, nowMs) : null), [priced, spot, nowMs]);

  const totalDays = metrics ? Math.max(daysBetween(today, istDateString(metrics.expiryMs)), 0) : 0;
  const day = Math.min(dayIndex, totalDays);
  const targetMs = metrics ? targetMomentMs(day, totalDays, nowMs, metrics.expiryMs) : nowMs;
  const targetSpot = targetSpotInput ?? spot ?? 0;

  const domain = useMemo(() => (spot && metrics ? chartDomain(priced, spot, metrics.sdPct) : null), [priced, spot, metrics]);
  const curves = useMemo(
    () => (domain && metrics ? sampleCurves(priced, domain, metrics.expiryMs, targetMs) : null),
    [domain, metrics, priced, targetMs],
  );
  const targetPnl = metrics ? strategyPnl(priced, targetSpot, targetMs) : 0;
  const greeks = useMemo(
    () => (metrics ? strategyGreeks(priced, targetSpot, targetMs) : null),
    [metrics, priced, targetSpot, targetMs],
  );

  // --- Margin (Upstox, basket-level so hedges net off) -------------------------

  const marginRequest = useMemo(() => {
    const byKey = new Map<string, { key: string; side: "BUY" | "SELL"; qty: number; price: number }>();
    for (const l of priced) {
      const key = quoteFor(l).key;
      if (!key) return null; // a leg without an instrument key would make the basket total partial
      const side = l.side === "buy" ? "BUY" : "SELL";
      const id = `${key}|${side}`;
      const existing = byKey.get(id);
      if (existing) existing.qty += l.qty;
      else byKey.set(id, { key, side, qty: l.qty, price: l.price });
    }
    return byKey.size ? [...byKey.values()] : null;
  }, [priced, quoteFor]);
  const marginSig = marginRequest ? marginRequest.map((r) => `${r.key}:${r.side}:${r.qty}`).sort().join(",") : "";

  useEffect(() => {
    if (!marginRequest) return;
    let cancelled = false;
    const sig = marginSig;
    const timer = setTimeout(async () => {
      const result = await fetchMargin(
        marginRequest.map((r) => ({
          instrument_key: r.key,
          quantity: r.qty,
          transaction_type: r.side,
          product: "D" as const,
          price: r.price,
        })),
      );
      if (cancelled) return;
      if ("error" in result) {
        setMargin({ sig, value: null });
        return;
      }
      const summed = result.margins.reduce((acc, m) => acc + (m.total_margin ?? 0), 0);
      setMargin({ sig, value: result.finalMargin ?? summed });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marginSig is the stable identity of marginRequest.
  }, [marginSig]);

  const marginNeeded = marginSig && margin.sig === marginSig ? margin.value : null;

  // --- Headline tiles ----------------------------------------------------------

  const debit = metrics && metrics.netPremium < 0 ? -metrics.netPremium : null;
  const fundsNeeded = marginNeeded ?? debit;
  const pctBase = fundsNeeded ?? metrics?.maxLoss ?? null;
  const pctOf = (v: number) => (pctBase && pctBase > 0 ? ` (${pctText((v / pctBase) * 100)})` : "");

  const rrValue =
    metrics && metrics.maxProfit !== null && metrics.maxLoss !== null && metrics.maxProfit > 0 && metrics.maxLoss > 0
      ? invertRR
        ? metrics.maxProfit / metrics.maxLoss
        : metrics.maxLoss / metrics.maxProfit
      : null;

  const dateLabel = (ms: number) =>
    new Date(ms).toLocaleString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

  const hasLegs = priced.length > 0;
  const netPremiumText = metrics
    ? `${metrics.netPremium >= 0 ? "Get" : "Pay"} ${formatINR(Math.abs(metrics.netPremium))}`
    : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build any option strategy leg by leg and see its payoff on expiry and on any date before it — max profit/loss,
          break-evens, probability of profit, Greeks and margin. Your strategy is saved on this device until you clear
          it — nothing here is traded.
        </p>
      </div>

      <LivePricingBanners
        tokenExpired={chainStatus === "token_expired"}
        offline={chainStatus === "offline"}
        lastPricesAt={spotIsLast ? lastSeenSpot.at : null}
      />

      {/* Strategy builder */}
      <section className="rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <label className="mb-1 block text-xs text-muted-foreground">Underlying</label>
              <Select value={instrument} onChange={handleInstrumentChange} options={INSTRUMENT_OPTIONS} />
            </div>
            <div className="w-36">
              <label htmlFor="spot" className="mb-1 block text-xs text-muted-foreground">
                Spot {overrideNum > 0 ? "(manual)" : chainSpot ? (spotIsLast ? "(last)" : "(live)") : ""}
              </label>
              <input
                id="spot"
                type="number"
                inputMode="decimal"
                value={spotOverride}
                placeholder={chainSpot ? chainSpot.toFixed(2) : "Enter spot"}
                onChange={(e) => setSpotOverride(e.target.value)}
                className={`${INPUT_CLASS} font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFile}
              className="hidden"
            />
            <ImportMenu onPick={handleImportPick} />
            <button
              type="button"
              onClick={handleExport}
              disabled={legs.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 active:scale-95"
            >
              <DownloadIcon className="size-4" />
              Export
            </button>
            <button
              type="button"
              onClick={handleRefreshPrices}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 active:scale-95"
            >
              <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              Reset Prices
            </button>
            {legs.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                title="Remove every leg and start fresh — your strategy is otherwise kept until you do"
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={addLeg}
              title="Add a blank leg and type the strike and price yourself"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <PlusIcon className="size-4" />
              Manual Leg
            </button>
            <button
              type="button"
              onClick={() => setChainOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
            >
              <PlusIcon className="size-4" />
              Add Leg
            </button>
          </div>
        </div>

        {legs.length === 0 ? (
          <div
            className={`mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center ${hydrated ? "" : "invisible"}`}
          >
            <InboxIcon className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No legs yet. Click Add Leg to pick contracts from the option chain, or use Import to bring in positions from Live Portfolio or Paper Trade.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <div
              className={`hidden px-2 text-xs text-muted-foreground ${LEG_GRID}`}
              aria-hidden="true"
            >
              <span />
              <span className="text-center">B/S</span>
              <span>Expiry</span>
              <span className="text-center">Strike</span>
              <span className="text-center">Type</span>
              <span className="text-center">Lots</span>
              <span className="text-center">Price</span>
              <span />
            </div>
            {legs.map((leg) => (
              <div
                key={leg.id}
                title={leg.enabled && isLeftOut(leg) ? "Expired — left out of the analysis while other legs are still live" : undefined}
                className={`flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 ${LEG_GRID} ${
                  leg.enabled && !isLeftOut(leg) ? "" : "opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={leg.enabled}
                  onChange={(e) => updateLeg(leg.id, { enabled: e.target.checked })}
                  aria-label="Include leg"
                  className="size-4 accent-accent"
                />
                <button
                  type="button"
                  onClick={() => updateLeg(leg.id, { side: leg.side === "buy" ? "sell" : "buy" })}
                  title="Switch buy / sell"
                  className={`flex size-8 items-center justify-center rounded-lg text-sm font-bold transition-colors ${
                    leg.side === "buy" ? "bg-info/20 text-info" : "bg-danger-fg/15 text-danger-fg"
                  }`}
                >
                  {leg.side === "buy" ? "B" : "S"}
                </button>
                <div className="w-40 md:w-auto md:min-w-0">
                  <DatePicker
                    value={leg.expiry}
                    onChange={(v) => v && updateLeg(leg.id, { expiry: v })}
                    triggerClassName="flex w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <Stepper
                  value={leg.strike}
                  step={step}
                  min={step}
                  onChange={(v) => updateLeg(leg.id, { strike: v })}
                  width="w-24 md:w-auto md:min-w-0 md:flex-1"
                />
                <button
                  type="button"
                  onClick={() => updateLeg(leg.id, { type: leg.type === "CE" ? "PE" : "CE" })}
                  title="Switch call / put"
                  className="h-8 w-12 rounded-lg border border-border text-sm font-medium transition-colors hover:bg-muted md:w-full"
                >
                  {leg.type}
                </button>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-xs text-muted-foreground md:hidden">Lots</span>
                  <Stepper
                    value={leg.lots}
                    step={1}
                    min={1}
                    width="w-14 md:w-auto md:min-w-0 md:flex-1"
                    onChange={(v) => updateLeg(leg.id, { lots: Math.max(1, Math.round(v) || 1) })}
                  />
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-xs text-muted-foreground md:hidden">Price</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={leg.price}
                    onChange={(e) => updateLeg(leg.id, { price: e.target.value })}
                    className={`${INPUT_CLASS} w-24 font-mono tabular-nums md:w-full md:min-w-0`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setLegs((prev) => prev.filter((l) => l.id !== leg.id))}
                  aria-label="Remove leg"
                  className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-danger-fg md:ml-0"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
              <span>
                Lot size {lotSize} · {legs.filter((l) => l.enabled).length - leftOutCount} of {legs.length} legs included
                {leftOutCount > 0 && (
                  <>
                    {" "}
                    · <span className="text-warning">{leftOutCount} expired, left out</span>
                  </>
                )}
              </span>
              <span>
                Premium <span className={`font-mono font-semibold ${metrics ? pnlTone(metrics.netPremium) : ""}`}>{netPremiumText}</span>
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Analysis */}
      <section className="rounded-xl border border-border bg-background p-4">
        <h2 className="text-lg font-semibold">Analyse</h2>

        {!hasLegs || !metrics || !spot || !curves || !domain || !greeks ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {legs.length > 0 && !spot
              ? "Waiting for the spot price — enter it above if live data isn't available."
              : legs.length > 0
                ? "Enter a price for at least one included leg to see the analysis."
                : "Add legs above to see the payoff, probability of profit and Greeks."}
          </p>
        ) : (
          <>
            <dl className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              <Tile label="Max Profit" hint="Best P&L at the earliest expiry">
                {metrics.maxProfit === null ? (
                  <span className="text-profit">Unlimited</span>
                ) : (
                  <span className="text-profit">
                    {signed(metrics.maxProfit)}
                    {pctOf(metrics.maxProfit)}
                  </span>
                )}
              </Tile>
              <Tile label="Max Loss" hint="Worst P&L at the earliest expiry">
                {metrics.maxLoss === null ? (
                  <span className="text-danger-fg">Unlimited</span>
                ) : (
                  <span className="text-danger-fg">
                    {signed(-metrics.maxLoss)}
                    {pctOf(-metrics.maxLoss)}
                  </span>
                )}
              </Tile>
              <Tile label="Funds Needed" hint="Margin from Upstox if available, otherwise the net premium you pay">
                {fundsNeeded === null ? "—" : formatCompactINR(fundsNeeded)}
              </Tile>
              <Tile label="Margin Needed" hint="SPAN + exposure for the whole basket, hedges netted (Upstox)">
                {marginNeeded === null ? "—" : formatINR(marginNeeded)}
              </Tile>
              <Tile label="Risk / Reward" hint="Max loss ÷ max profit — click 1/x to flip it">
                <span className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInvertRR((v) => !v)}
                    className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {invertRR ? "x" : "1/x"}
                  </button>
                  {rrValue === null ? "—" : rrValue.toFixed(2)}
                </span>
              </Tile>
              <Tile label="POP" hint="Market-implied probability that the strategy is profitable at expiry">
                {metrics.pop === null ? "—" : `${(metrics.pop * 100).toFixed(0)}%`}
              </Tile>
              <Tile label="Breakeven" hint="Underlying level(s) where expiry P&L crosses zero">
                {metrics.breakevens.length === 0
                  ? "—"
                  : metrics.breakevens
                      .slice(0, 3)
                      .map((b) => `${Math.round(b).toLocaleString("en-IN")} (${pctText(((b - spot) / spot) * 100)})`)
                      .join(", ")}
              </Tile>
              <Tile label="Net Premium">{netPremiumText}</Tile>
              <Tile label="Days to expiry">{totalDays}D</Tile>
            </dl>

            <div role="tablist" className="mt-5 flex gap-5 overflow-x-auto border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? "border-accent text-accent"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "chart" && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-5 rounded bg-gradient-to-r from-profit to-danger-fg" /> On Expiry
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-5 rounded bg-accent" /> On Target Date
                  </span>
                </div>

                <StrategyPayoffChart
                  points={curves}
                  spot={spot}
                  targetSpot={targetSpot}
                  sdPct={metrics.sdPct}
                  targetPnl={targetPnl}
                  showTarget
                />

                <div className="mt-1 flex justify-center">
                  <span
                    className={`rounded-md px-3 py-1 text-xs font-semibold text-white ${targetPnl >= 0 ? "bg-profit" : "bg-danger"}`}
                  >
                    Projected {targetPnl >= 0 ? "profit" : "loss"}: {signed(targetPnl)}
                    {pctBase && pctBase > 0 ? ` (${pctText((targetPnl / pctBase) * 100)})` : ""}
                  </span>
                </div>

                {/*
                  Side by side, the two columns share their rows (subgrid) instead of
                  stacking independently: the target column's header holds a Stepper
                  (~34px, and wraps when the column is narrow) while the date column's is
                  a single line of text, so as separate stacks the two sliders sat at
                  different heights. Sharing rows keeps header / slider / caption lined up
                  whatever either side does.
                */}
                <div className="mt-5 grid gap-5 lg:grid-cols-2 lg:gap-y-0">
                  <div className="lg:row-span-3 lg:grid lg:grid-rows-subgrid">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                      <span className="whitespace-nowrap">
                        <span className="text-muted-foreground">{INSTRUMENT_LABELS[instrument]} Target</span>{" "}
                        <button
                          type="button"
                          onClick={() => setTargetSpotInput(null)}
                          className="font-medium text-accent hover:underline"
                        >
                          Reset
                        </button>
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{pctText(((targetSpot - spot) / spot) * 100)}</span>
                        <Stepper
                          value={Math.round(targetSpot * 10) / 10}
                          step={step}
                          min={1}
                          // Important: INPUT_CLASS's own w-full otherwise wins, which stretched this to 215px and forced the header to wrap.
                          width="w-20!"
                          onChange={setTargetSpotInput}
                        />
                      </span>
                    </div>
                    <input
                      type="range"
                      min={Math.floor(domain[0])}
                      max={Math.ceil(domain[1])}
                      step={1}
                      value={Math.min(Math.max(targetSpot, domain[0]), domain[1])}
                      onChange={(e) => setTargetSpotInput(Number(e.target.value))}
                      className="w-full accent-accent"
                      aria-label="Target spot"
                    />
                  </div>

                  <div className="lg:row-span-3 lg:grid lg:grid-rows-subgrid">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                      <span className="whitespace-nowrap">
                        <span className="text-muted-foreground">Date: {totalDays - day}D to expiry</span>{" "}
                        <button
                          type="button"
                          onClick={() => setDayIndex(0)}
                          className="font-medium text-accent hover:underline"
                        >
                          Reset
                        </button>
                      </span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{dateLabel(targetMs)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(totalDays, 1)}
                      step={1}
                      value={day}
                      disabled={totalDays === 0}
                      onChange={(e) => setDayIndex(Number(e.target.value))}
                      className="w-full accent-accent disabled:opacity-40"
                      aria-label="Target date"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Today</span>
                      <span>
                        {new Date(`${istDateString(metrics.expiryMs)}T00:00:00Z`).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        })}{" "}
                        expiry
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "payoff" && (
              <PayoffTable
                spot={spot}
                step={step * 2}
                pnlAtExpiry={(s) => strategyPnl(priced, s, metrics.expiryMs)}
                pnlAtTarget={(s) => strategyPnl(priced, s, targetMs)}
                targetLabel={dateLabel(targetMs)}
                base={pctBase}
              />
            )}

            {tab === "pnl" && (
              <PnlMatrix
                spot={spot}
                sdPct={metrics.sdPct}
                today={today}
                totalDays={totalDays}
                nowMs={nowMs}
                expiryMs={metrics.expiryMs}
                pnl={(s, ms) => strategyPnl(priced, s, ms)}
              />
            )}

            {tab === "greeks" && (
              <div className="mt-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  At {targetSpot.toFixed(1)} on {dateLabel(targetMs)} — move the target on the chart tab to see how they shift.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Leg</th>
                        <th className="px-3 py-2 text-right font-medium">Delta</th>
                        <th className="px-3 py-2 text-right font-medium">Gamma</th>
                        <th className="px-3 py-2 text-right font-medium">Theta (₹/day)</th>
                        <th className="px-3 py-2 text-right font-medium">Vega (₹/1% IV)</th>
                        <th className="py-2 pl-3 text-right font-medium">IV</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {priced.map((l) => {
                        const g = legGreeks(l, targetSpot, targetMs);
                        return (
                          <tr key={l.id} className="border-b border-border/60">
                            <td className="py-2 pr-3 font-sans">
                              <span className={l.side === "buy" ? "text-info" : "text-danger-fg"}>{l.side === "buy" ? "B" : "S"}</span>{" "}
                              {l.strike} {l.type} · {l.lots}L
                            </td>
                            <td className="px-3 py-2 text-right">{g.delta.toFixed(1)}</td>
                            <td className="px-3 py-2 text-right">{g.gamma.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right">{whole(g.theta)}</td>
                            <td className="px-3 py-2 text-right">{whole(g.vega)}</td>
                            <td className="py-2 pl-3 text-right">{(l.sigma * 100).toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                      <tr className="font-semibold">
                        <td className="py-2 pr-3 font-sans">Net</td>
                        <td className="px-3 py-2 text-right">{greeks.delta.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">{greeks.gamma.toFixed(3)}</td>
                        <td className={`px-3 py-2 text-right ${pnlTone(greeks.theta)}`}>{whole(greeks.theta)}</td>
                        <td className="px-3 py-2 text-right">{whole(greeks.vega)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Delta is in underlying units (₹ gained per 1-point move). Theta is time decay per calendar day — positive
                  means you earn it. Vega is the P&amp;L for a 1-point rise in implied volatility. Each leg&apos;s IV is
                  solved from the price you entered.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <AnimatePresence>
        {chainOpen && (
          <OptionChainPicker
            key="chain"
            initialInstrument={instrument}
            initialExpiry={legs[legs.length - 1]?.expiry ?? defaultExpiry}
            replaceWarning={legs.length > 0}
            doneLabel={(n) => `Add ${n} leg${n === 1 ? "" : "s"}`}
            onDone={handlePickedLegs}
            onClose={() => setChainOpen(false)}
          />
        )}
        {importSource && (
          <ImportPositionsModal
            key={importSource}
            source={importSource}
            currentInstrument={instrument}
            today={today}
            hasLegs={legs.length > 0}
            onImport={handleImportPositions}
            onClose={() => setImportSource(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PayoffTable({
  spot,
  step,
  pnlAtExpiry,
  pnlAtTarget,
  targetLabel,
  base,
}: {
  spot: number;
  step: number;
  pnlAtExpiry: (s: number) => number;
  pnlAtTarget: (s: number) => number;
  targetLabel: string;
  base: number | null;
}) {
  const atm = Math.round(spot / step) * step;
  const levels = Array.from({ length: 21 }, (_, i) => atm + (i - 10) * step).filter((s) => s > 0);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Underlying</th>
            <th className="px-3 py-2 text-right font-medium">Change</th>
            <th className="px-3 py-2 text-right font-medium">P&amp;L on expiry</th>
            <th className="py-2 pl-3 text-right font-medium">P&amp;L on {targetLabel}</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {levels.map((s) => {
            const exp = pnlAtExpiry(s);
            const tgt = pnlAtTarget(s);
            const nearSpot = Math.abs(s - spot) < step / 2;
            return (
              <tr key={s} className={`border-b border-border/60 ${nearSpot ? "bg-accent/10" : ""}`}>
                <td className="py-1.5 pr-3">{s.toLocaleString("en-IN")}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{pctText(((s - spot) / spot) * 100)}</td>
                <td className={`px-3 py-1.5 text-right ${pnlTone(exp)}`}>
                  {signed(exp)}
                  {base ? <span className="text-xs text-muted-foreground"> {pctText((exp / base) * 100)}</span> : null}
                </td>
                <td className={`py-1.5 pl-3 text-right ${pnlTone(tgt)}`}>{signed(tgt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PnlMatrix({
  spot,
  sdPct,
  today,
  totalDays,
  nowMs,
  expiryMs,
  pnl,
}: {
  spot: number;
  sdPct: number;
  today: string;
  totalDays: number;
  nowMs: number;
  expiryMs: number;
  pnl: (spot: number, atMs: number) => number;
}) {
  const sd = Math.max(sdPct, 0.02);
  const spots = Array.from({ length: 13 }, (_, i) => spot * (1 + ((i - 6) / 3) * sd)).reverse();
  const dayLabel = (d: number) =>
    new Date(addDays(today, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  let moments: { key: string; label: string; ms: number }[];
  if (totalDays === 0) {
    // Expiry day: the only meaningful split is now vs. the closing bell.
    moments = [
      ...(nowMs < expiryMs ? [{ key: "now", label: "Now", ms: nowMs }] : []),
      { key: "exp", label: "Expiry", ms: expiryMs },
    ];
  } else {
    const count = Math.min(totalDays, 5);
    const days = [...new Set(Array.from({ length: count + 1 }, (_, i) => Math.round((i / count) * totalDays)))];
    moments = days.map((d) => ({
      key: String(d),
      label: `${d === 0 ? "Today" : dayLabel(d)}${d === totalDays ? " (exp)" : ""}`,
      ms: targetMomentMs(d, totalDays, nowMs, expiryMs),
    }));
  }
  const grid = spots.map((s) => moments.map((m) => pnl(s, m.ms)));
  const peak = Math.max(1, ...grid.flat().map(Math.abs));

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-2 pr-3 text-left font-medium">Underlying</th>
            {moments.map((m) => (
              <th key={m.key} className="px-2 py-2 text-right font-medium">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {spots.map((s, r) => (
            <tr key={s} className="border-b border-border/40">
              <td className="py-1.5 pr-3">
                {Math.round(s).toLocaleString("en-IN")}
                <span className="ml-1.5 text-xs text-muted-foreground">{pctText(((s - spot) / spot) * 100)}</span>
              </td>
              {grid[r].map((v, c) => (
                <td
                  key={c}
                  className="px-2 py-1.5 text-right"
                  style={{
                    background: `color-mix(in srgb, ${v >= 0 ? "var(--profit)" : "var(--danger-fg)"} ${Math.round((Math.abs(v) / peak) * 40)}%, transparent)`,
                  }}
                >
                  {formatCompactINR(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
