"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { InboxIcon, PlusIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import { formatINRExact } from "@/lib/format";
import { PAGE_HEIGHT_LOCK_CLASS } from "@/lib/layout";
import {
  addPayment,
  deletePayment,
  getCachedPayments,
  getPayments,
  subscribeToPaymentChanges,
  updatePayment,
  type AddPaymentInput,
  type Payment,
  type PaymentStatus,
  type PaymentType,
} from "@/lib/paymentStore";
import { showToast } from "@/lib/toast";
import PaymentModal from "./PaymentModal";

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partially Paid",
  paid: "Paid",
};

const STATUS_CLASSES: Record<PaymentStatus, string> = {
  pending: "border border-border bg-background text-muted-foreground",
  partial: "bg-accent/10 text-accent",
  paid: "bg-profit/10 text-profit",
};

const TYPE_LABELS: Record<PaymentType, string> = {
  payin: "Pay In",
  payout: "Payout",
};

const TYPE_CLASSES: Record<PaymentType, string> = {
  payin: "bg-profit/10 text-profit",
  payout: "bg-accent/10 text-accent",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type Row = Payment & { slNo: number };

/** Sorted chronologically (oldest first) so SL NO reads top-to-bottom, same convention as Trade Entries. */
function computeRows(payments: Payment[]): Row[] {
  const sorted = [...payments].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
  return sorted.map((payment, index) => ({ ...payment, slNo: index + 1 }));
}

type ModalState = { mode: "add" } | { mode: "edit"; payment: Payment } | null;

export default function PaymentView() {
  const [payments, setPayments] = useState<Payment[] | null>(getCachedPayments);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingDelete, setPendingDelete] = useState<Payment | null>(null);

  const rows = useMemo(() => (payments ? computeRows(payments) : null), [payments]);

  useEffect(() => {
    async function load() {
      try {
        setPayments(await getPayments());
      } catch {
        showToast("Couldn't load payments. Check your connection.");
      }
    }
    load();
    return subscribeToPaymentChanges(load);
  }, []);

  async function handleModalSave(input: AddPaymentInput) {
    if (modalState?.mode === "edit") {
      const { payment } = modalState;
      const previous = payments;

      // Update in place immediately so the row's position never visibly
      // shifts while waiting on the debounced Realtime refetch — same fix
      // Trade Entries needed for the identical reason.
      setPayments((prev) =>
        prev
          ? prev.map((p) =>
              p.id === payment.id
                ? {
                    ...p,
                    entry_date: input.entryDate,
                    details: input.details,
                    type: input.type,
                    initial_fund: input.initialFund,
                    profit: input.profit,
                    payout_amount: input.payoutAmount,
                    status: input.status,
                  }
                : p,
            )
          : prev,
      );

      try {
        await updatePayment(payment.id, input);
      } catch (err) {
        setPayments(previous);
        throw err;
      }
    } else {
      const previous = payments;
      const now = new Date().toISOString();

      // Same optimistic treatment as the edit branch above — without it, a
      // new row only appeared once the Realtime refetch came back, which
      // reads as a multi-second lag between clicking Save and seeing it.
      // The temporary id gets replaced wholesale once that refetch lands
      // with the server-assigned row, same as it does for every other row.
      const optimisticPayment: Payment = {
        id: `temp-${Date.now()}`,
        user_id: null,
        entry_date: input.entryDate,
        details: input.details,
        type: input.type,
        initial_fund: input.initialFund,
        profit: input.profit,
        payout_amount: input.payoutAmount,
        status: input.status,
        created_at: now,
        updated_at: now,
      };
      setPayments((prev) => (prev ? [...prev, optimisticPayment] : [optimisticPayment]));

      try {
        await addPayment(input);
      } catch (err) {
        setPayments(previous);
        throw err;
      }
    }
    setModalState(null);
  }

  function handleModalDelete() {
    if (modalState?.mode !== "edit") return;
    setPendingDelete(modalState.payment);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const payment = pendingDelete;
    setPendingDelete(null);
    setModalState(null);

    const previous = payments;
    setPayments((prev) => (prev ? prev.filter((p) => p.id !== payment.id) : prev));
    deletePayment(payment.id).catch(() => {
      setPayments(previous);
      showToast("Couldn't delete the payment. Try again.");
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      // Locked to the viewport so the header stays put and only the table
      // scrolls — same arrangement as Trade Entries and Logs.
      className={`flex flex-col gap-6 ${PAGE_HEIGHT_LOCK_CLASS}`}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money moving in and out of the trading account — funding, profit-sharing payouts, and status, all in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalState({ mode: "add" })}
          className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
        >
          <PlusIcon className="size-4" />
          Add Payment
        </button>
      </div>

      {rows === null ? (
        <LoadingState className="h-40" label="Loading payments…" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No payments logged yet. Add one above to get started.</p>
        </div>
      ) : (
        // Shrinks (min-h-0) into whatever height the header leaves and scrolls
        // inside it; a short ledger just keeps its own height. The table's
        // min-width keeps every column readable on a phone — it scrolls sideways
        // instead of squeezing Details and pushing Amount off-screen.
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
          <div tabIndex={0} role="region" aria-label="Payments" className="min-h-0 overflow-auto focus-visible:outline-offset-[-2px]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <colgroup>
                <col style={{ width: "8%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-left">
                  <th className={`${tableHeadClass} py-3 pl-5 pr-2 text-center`}>SL</th>
                  <th className={`${tableHeadClass} px-3 py-3`}>Date</th>
                  <th className={`${tableHeadClass} px-3 py-3`}>Details</th>
                  <th className={`${tableHeadClass} px-3 py-3 text-center`}>Type</th>
                  <th className={`${tableHeadClass} px-3 py-3 text-right`}>Amount</th>
                  <th className={`${tableHeadClass} px-3 py-3 text-center`}>Status</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map((row) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => setModalState({ mode: "edit", payment: row })}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="py-3 pl-5 pr-2 text-center text-muted-foreground">{row.slNo}</td>
                      <td className="whitespace-nowrap px-3 py-3">{formatCellDate(row.entry_date)}</td>
                      <td className="px-3 py-3 font-medium">
                        <span className="line-clamp-1 max-w-xs">{row.details}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TYPE_CLASSES[row.type]}`}
                        >
                          {TYPE_LABELS[row.type]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-medium tabular-nums">
                        {formatINRExact(row.payout_amount)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[row.status]}`}
                        >
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AnimatePresence>
        {modalState && (
          <PaymentModal
            key={modalState.mode === "edit" ? modalState.payment.id : "new"}
            payment={modalState.mode === "edit" ? modalState.payment : null}
            onSave={handleModalSave}
            onClose={() => setModalState(null)}
            onDelete={handleModalDelete}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this payment?"
            message={`${pendingDelete.details} — this can't be undone.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
