"use client";

/**
 * "Build your own" - for the move that isn't on the list. Each row is one thing to do (exit some
 * lots, add some, open a new option); put several together and the lab shows what the mix does to
 * the whole book, using the same maths as the suggestions. Controlled: the lab owns the rows.
 */

import { XIcon, PlusIcon } from "@/components/icons";
import Select from "@/components/Select";
import Stepper from "@/components/Stepper";
import { pillButton } from "@/components/averaging/ui";
import type { Book, BuilderMove, OptionType, Side, Underlying } from "@/lib/whatIf";

let counter = 0;
const nextId = () => `move-${++counter}`;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-full border border-border bg-background p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-full px-3 text-sm font-medium transition-colors active:scale-95 sm:min-h-7 ${
            value === o.value ? "bg-accent-solid text-accent-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SIDES = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
] as const;
const TYPES = [
  { value: "CE", label: "Call" },
  { value: "PE", label: "Put" },
] as const;

export default function CustomBuilder({
  moves,
  onChange,
  book,
  focus,
}: {
  moves: BuilderMove[];
  onChange: (moves: BuilderMove[]) => void;
  book: Book;
  focus: Underlying | null;
}) {
  const positions = book.legs.map((l) => ({
    value: l.id,
    label: `${l.label} · ${l.lots} lot${l.lots === 1 ? "" : "s"} ${l.isShort ? "sold" : "bought"}`,
  }));

  const update = (id: string, patch: Partial<BuilderMove>) =>
    onChange(moves.map((m) => (m.id === id ? ({ ...m, ...patch } as BuilderMove) : m)));
  const remove = (id: string) => onChange(moves.filter((m) => m.id !== id));

  function addPosition(kind: "reduce" | "add") {
    const leg = book.legs[0];
    if (!leg) return;
    onChange([...moves, { id: nextId(), kind, legId: leg.id, lots: kind === "reduce" ? Math.max(1, Math.floor(leg.lots / 2)) : 1 }]);
  }
  function addOption(side: Side) {
    if (!focus) return;
    onChange([...moves, { id: nextId(), kind: "open", side, type: "CE", strike: focus.atm, lots: 1 }]);
  }

  const hasPositions = book.legs.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {moves.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          Add one or more moves below. For example, exit 2 of your 4 lots and buy 4 farther-out calls with the cash — the lab shows what that mix does to your odds and your risk.
        </p>
      )}

      {moves.map((m) => {
        const leg = m.kind === "open" ? null : book.legs.find((l) => l.id === m.legId);
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-background p-3">
            {m.kind === "open" ? (
              <>
                <Segmented label="Buy or sell" value={m.side} options={SIDES} onChange={(side) => update(m.id, { side })} />
                <Segmented label="Call or put" value={m.type} options={TYPES} onChange={(type: OptionType) => update(m.id, { type })} />
                <div className="w-44">
                  <Select
                    size="sm"
                    value={m.strike === null ? "" : String(m.strike)}
                    onChange={(v) => update(m.id, { strike: Number(v) })}
                    options={
                      focus
                        ? focus.strikes.flatMap((s) => {
                            const q = focus.byContract.get(`${m.type}|${s}`);
                            return q ? [{ value: String(s), label: `${s} · ₹${q.ltp.toFixed(2)}` }] : [];
                          })
                        : []
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                  {m.kind === "reduce" ? (leg?.isShort ? "Buy back" : "Sell") : leg?.isShort ? "Sell more" : "Buy more"}
                </span>
                <div className="w-72 max-w-full">
                  <Select
                    size="sm"
                    value={m.legId}
                    onChange={(legId) => {
                      const next = book.legs.find((l) => l.id === legId);
                      update(m.id, { legId, lots: m.kind === "reduce" && next ? Math.min(m.lots, next.lots) : m.lots });
                    }}
                    options={positions}
                  />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <Stepper
                value={m.lots}
                onChange={(lots) => update(m.id, { lots })}
                step={1}
                min={1}
                max={m.kind === "reduce" ? (leg?.lots ?? 1) : 99}
                precision={0}
                width="w-14"
                label="lots"
                large
              />
              <span className="text-sm text-muted-foreground">lot{m.lots === 1 ? "" : "s"}</span>
            </div>
            <button
              type="button"
              onClick={() => remove(m.id)}
              aria-label="Remove this move"
              className="ml-auto flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 sm:size-8"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {hasPositions && (
          <>
            <button type="button" onClick={() => addPosition("reduce")} className={pillButton(false)}>
              <PlusIcon className="size-3.5" /> Exit lots
            </button>
            <button type="button" onClick={() => addPosition("add")} className={pillButton(false)}>
              <PlusIcon className="size-3.5" /> Add lots
            </button>
          </>
        )}
        {focus && (
          <>
            <button type="button" onClick={() => addOption("buy")} className={pillButton(false)}>
              <PlusIcon className="size-3.5" /> Buy an option
            </button>
            <button type="button" onClick={() => addOption("sell")} className={pillButton(false)}>
              <PlusIcon className="size-3.5" /> Sell an option
            </button>
          </>
        )}
        {moves.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="ml-auto text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
