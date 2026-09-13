-- payments — fund payout ledger, backing the new Payment tab. Replaces the
-- old Brokerage Calculator "History" (trades/trade_legs), which had no
-- create path left anywhere in the UI; those tables and their data are left
-- as-is, just no longer surfaced. Each row stands alone (no running balance
-- across rows) with its own initial fund, profit, and payout amount, plus a
-- status tracking whether that payout has actually gone out yet.

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  entry_date date not null default current_date,
  details text not null,
  initial_fund numeric(14, 2) not null default 0,
  profit numeric(14, 2) not null default 0,
  payout_amount numeric(14, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_entry_date_idx on payments (entry_date desc, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.payments to anon, authenticated;

alter publication supabase_realtime add table public.payments;
