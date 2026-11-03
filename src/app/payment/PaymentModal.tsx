"use client";

import { motion } from "framer-motion";
import { useId, useState } from "react";

import DatePicker from "@/components/DatePicker";
import { TrashIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import { useDialogFocus } from "@/lib/useDialogFocus";
import {
  type AddPaymentInput,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type Payment,
  type PaymentStatus,
  type PaymentType,
} from "@/lib/paymentStore";

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Pay In and Payout show different fields. Rather than swapping them in and
 * out — which resized the card, and with it re-centred it, every time the
 * type flipped — both versions sit stacked in one grid cell: the cell is
 * always as tall as the taller one, so the card never moves, and only the
 * contents cross-fade. The hidden version is `inert`, so it can't be tabbed
 * into or clicked.
 */
const STACKED_CLASS = "[grid-area:1/1] transition-[opacity,transform] duration-200 ease-out";
const SHOWN_CLASS = "translate-y-0 opacity-100";
const HIDDEN_CLASS = "pointer-events-none -translate-y-1 opacity-0";

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partially Paid",
  paid: "Paid",
};

const STATUS_OPTIONS = PAYMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

const TYPE_LABELS: Record<PaymentType, string> = {
  payin: "Pay In",
  payout: "Payout",
};

const TYPE_DESCRIPTIONS: Record<PaymentType, string> = {
  payin: "Funding added to the trading account.",
  payout: "Profit-sharing paid out from the account.",
};

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

type PaymentModalProps = {
  /** null = creating a new entry; otherwise the entry being edited. */
  payment: Payment | null;
  onSave: (input: AddPaymentInput) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
};

export default function PaymentModal({ payment, onSave, onClose, onDelete }: PaymentModalProps) {
  const dialogRef = useDialogFocus(onClose);
  const titleId = useId();
  const [type, setType] = useState<PaymentType>(payment?.type ?? "payout");
  const [entryDate, setEntryDate] = useState(payment?.entry_date ?? todayISODate());
  const [details, setDetails] = useState(payment?.details ?? "");
  const [initialFund, setInitialFund] = useState(payment ? String(payment.initial_fund) : "");
  const [profit, setProfit] = useState(payment ? String(payment.profit) : "");
  const [payoutAmount, setPayoutAmount] = useState(payment ? String(payment.payout_amount) : "");
  const [status, setStatus] = useState<PaymentStatus>(payment?.status ?? "pending");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isPayIn = type === "payin";
  const parsedInitialFund = Number(initialFund);
  const parsedProfit = Number(profit);
  const parsedPayoutAmount = Number(payoutAmount);
  // Both types only require a payout amount. Pay In uses it as the funded
  // amount; Payout uses it as the amount being paid out.
  const hasValidAmounts = payoutAmount.trim() !== "" && Number.isFinite(parsedPayoutAmount);

  async function handleSave() {
    if (!entryDate) {
      setFormError("Pick a date.");
      return;
    }
    if (!details.trim()) {
      setFormError("Enter the payment details.");
      return;
    }
    if (!hasValidAmounts) {
      setFormError(isPayIn ? "Enter a valid amount." : "Enter a valid payout amount.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        entryDate,
        details: details.trim(),
        type,
        initialFund: 0,
        profit: 0,
        payoutAmount: parsedPayoutAmount,
        status,
      });
    } catch {
      setFormError(payment ? "Couldn't save changes. Try again." : "Couldn't save the payment. Try again.");
      setSaving(false);
    }
  }

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-panel flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{payment ? "Edit Payment" : "Add Payment"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>Type</span>
            <div className="inline-flex w-fit rounded-lg border border-border p-1">
              {PAYMENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={t === type}
                  // Same weight either way — switching it made the labels (and the whole toggle) change width.
                  className={`relative rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    t === type ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === type && (
                    <motion.span
                      layoutId="payment-type-pill"
                      className="absolute inset-0 rounded-md bg-card shadow-sm"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative">{TYPE_LABELS[t]}</span>
                </button>
              ))}
            </div>
            <div className="grid">
              {PAYMENT_TYPES.map((t) => (
                <p
                  key={t}
                  aria-hidden={t !== type}
                  className={`text-xs text-muted-foreground ${STACKED_CLASS} ${t === type ? SHOWN_CLASS : HIDDEN_CLASS}`}
                >
                  {TYPE_DESCRIPTIONS[t]}
                </p>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 col-span-2">
                <label htmlFor="payment-details" className={labelClass}>
                  Details
                </label>
                <input
                  id="payment-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={isPayIn ? "e.g. March funding" : "e.g. March payout"}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="payment-date" className={labelClass}>
                  Date
                </label>
                <DatePicker id="payment-date" value={entryDate} onChange={setEntryDate} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="payment-status" className={labelClass}>
                  Status
                </label>
                <Select
                  id="payment-status"
                  value={status}
                  onChange={setStatus}
                  options={STATUS_OPTIONS}
                  size="sm"
                />
              </div>
            </div>

            <div className="grid">
              <div inert={!isPayIn} aria-hidden={!isPayIn} className={`${STACKED_CLASS} ${isPayIn ? SHOWN_CLASS : HIDDEN_CLASS}`}>
                <div className="flex flex-col gap-1">
                  <label htmlFor="payment-amount" className={labelClass}>
                    Amount
                  </label>
                  <input
                    id="payment-amount"
                    type="number"
                    step="0.01"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="e.g. 7500"
                    className={`${inputClass} font-mono tabular-nums`}
                  />
                </div>
              </div>

              <div
                inert={isPayIn}
                aria-hidden={isPayIn}
                className={`flex flex-col gap-1 ${STACKED_CLASS} ${isPayIn ? HIDDEN_CLASS : SHOWN_CLASS}`}
              >
                <label htmlFor="payment-payout" className={labelClass}>
                  Payout Amount
                </label>
                <input
                  id="payment-payout"
                  type="number"
                  step="0.01"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="e.g. 7500"
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
            </div>
          </div>

          {formError && <p className="text-sm text-danger-fg">{formError}</p>}
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-between border-t border-border bg-bg-surface-alt p-4">
          {payment ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-danger-fg transition-colors hover:bg-loss/10"
            >
              <TrashIcon className="size-4" />
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent-solid px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95"
            >
              {saving ? "Saving…" : payment ? "Save Changes" : "Save Payment"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
