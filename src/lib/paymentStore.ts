/**
 * Supabase-backed persistence for the Payment tab — a fund payout ledger.
 * Independent of tradeEntriesStore.ts; nothing here is derived from trade
 * P&L, since the profit/payout figures are entered by hand per row.
 */

import { logEvent } from "@/lib/activityLog";
import { round2 } from "@/lib/calculateTrade";
import { formatINR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { subscribeToTableChanges } from "@/lib/supabase/realtime";
import { PAYMENT_STATUSES, PAYMENT_TYPES, type Payment, type PaymentStatus, type PaymentType } from "@/lib/types";

export { PAYMENT_STATUSES, PAYMENT_TYPES, type Payment, type PaymentStatus, type PaymentType };

const supabase = createClient();

export type AddPaymentInput = {
  entryDate: string;
  details: string;
  type: PaymentType;
  initialFund: number;
  profit: number;
  payoutAmount: number;
  status: PaymentStatus;
};

/** Last-known result, kept warm so revisiting the tab paints instantly instead of flashing a skeleton. */
let cachedPayments: Payment[] | null = null;

/** Synchronous — for a view's initial state, so it can skip the skeleton on a repeat visit. */
export function getCachedPayments(): Payment[] | null {
  return cachedPayments;
}

export async function getPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  cachedPayments = data ?? [];
  return cachedPayments;
}

function describePayment(input: Pick<AddPaymentInput, "details" | "type" | "payoutAmount">): string {
  const verb = input.type === "payin" ? "pay in" : "payout";
  return `${input.details} (${verb} ${formatINR(round2(input.payoutAmount))})`;
}

export async function addPayment(input: AddPaymentInput): Promise<void> {
  const { error } = await supabase.from("payments").insert({
    entry_date: input.entryDate,
    details: input.details,
    type: input.type,
    initial_fund: round2(input.initialFund),
    profit: round2(input.profit),
    payout_amount: round2(input.payoutAmount),
    status: input.status,
  });
  if (error) throw error;
  logEvent(`Added payment: ${describePayment(input)}`);
}

export async function updatePayment(id: string, input: AddPaymentInput): Promise<void> {
  const { error } = await supabase
    .from("payments")
    .update({
      entry_date: input.entryDate,
      details: input.details,
      type: input.type,
      initial_fund: round2(input.initialFund),
      profit: round2(input.profit),
      payout_amount: round2(input.payoutAmount),
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  logEvent(`Edited payment: ${describePayment(input)}`);
}

export async function deletePayment(id: string): Promise<void> {
  const { data: payment, error } = await supabase.from("payments").delete().eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (payment) logEvent(`Deleted payment: ${payment.details}`);
}

/** Keeps every open session in sync via Supabase Realtime, same as notesStore.ts. */
export function subscribeToPaymentChanges(callback: () => void): () => void {
  return subscribeToTableChanges("payments", callback);
}
