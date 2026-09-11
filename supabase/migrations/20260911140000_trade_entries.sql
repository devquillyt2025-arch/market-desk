-- trade_entries — a simple daily trading journal: one row per day with that
-- day's P&L and whether the position was squared off or is still on hold.
-- Independent of `trades`/`trade_legs` (the Brokerage Calculator's saved
-- multi-leg trades) — same "no RLS yet, single-user tool" rationale as the
-- rest of this schema.

create table trade_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  entry_date date not null default current_date,
  pnl numeric(14, 2) not null default 0,
  status text not null default 'hold' check (status in ('squared_off', 'hold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trade_entries_entry_date_idx on trade_entries (entry_date desc, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.trade_entries to anon, authenticated;

-- Broadcast row changes for live cross-device sync, same as notes.
alter publication supabase_realtime add table public.trade_entries;
