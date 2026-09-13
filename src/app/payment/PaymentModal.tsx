"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import DatePicker from "@/components/DatePicker";
import { TrashIcon, XIcon } from "@/components/icons";
import Select from "@/components/Select";
import { type AddPaymentInput, PAYMENT_STATUSES, type Payment, type PaymentStatus } from "@/lib/paymentStore";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const selectTriggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partially Paid",
  paid: "Paid",
};

const STATUS_OPTIONS = PAYMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

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
  const [entryDate, setEntryDate] = useState(payment?.entry_date ?? todayISODate());
  const [details, setDetails] = useState(payment?.details ?? "");
  const [initialFund, setInitialFund] = useState(payment ? String(payment.initial_fund) : "");
  const [profit, setProfit] = useState(payment ? String(payment.profit) : "");
  const [payoutAmount, setPayoutAmount] = useState(payment ? String(payment.payout_amount) : "");
  const [status, setStatus] = useState<PaymentStatus>(payment?.status ?? "pending");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedInitialFund = Number(initialFund);
  const parsedProfit = Number(profit);
  const parsedPayoutAmount = Number(payoutAmount);
  const hasValidAmounts =
    initialFund.trim() !== "" &&
    profit.trim() !== "" &&
    payoutAmount.trim() !== "" &&
    Number.isFinite(parsedInitialFund) &&
    Number.isFinite(parsedProfit) &&
    Number.isFinite(parsedPayoutAmount);

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
      setFormError("Enter valid Initial Fund, Profit, and Payout Amount values.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        entryDate,
        details: details.trim(),
        initialFund: parsedInitialFund,
        profit: parsedProfit,
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
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{payment ? "Edit Payment" : "Add Payment"}</h2>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 col-span-2">
              <label htmlFor="payment-details" className={labelClass}>
                Details
              </label>
              <input
                id="payment-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="e.g. March payout"
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
                triggerClassName={selectTriggerClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="payment-initial-fund" className={labelClass}>
                Initial Fund
              </label>
              <input
                id="payment-initial-fund"
                type="number"
                step="0.01"
                value={initialFund}
                onChange={(e) => setInitialFund(e.target.value)}
                placeholder="e.g. 100000"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="payment-profit" className={labelClass}>
                Profit
              </label>
              <input
                id="payment-profit"
                type="number"
                step="0.01"
                value={profit}
                onChange={(e) => setProfit(e.target.value)}
                placeholder="e.g. 15000"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
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

          {formError && <p className="text-sm text-loss">{formError}</p>}
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-between border-t border-border bg-card p-4">
          {payment ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-loss transition-colors hover:bg-loss/10"
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
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95"
            >
              {saving ? "Saving…" : payment ? "Save Changes" : "Save Payment"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
