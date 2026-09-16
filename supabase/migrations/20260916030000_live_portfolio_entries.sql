-- Live Portfolio: was previously just a derived view over trade_entries
-- (rows with status = 'hold'), which meant it could only be edited/deleted
-- by going to Trade Entries. Giving it its own table — same shape as
-- trade_entries' current state, closing_date included — makes it fully
-- independent, with its own Add/Edit/Delete, matching Paper Trade's pattern.

create table live_portfolio_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  entry_date date not null default current_date,
  instrument text not null check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX')),
  strike_price numeric(10, 2),
  option_type text check (option_type in ('CE', 'PE')),
  expiry_date date,
  closing_date date,
  lots int not null check (lots > 0),
  side text not null check (side in ('buy', 'sell')),
  buy_price numeric(12, 2) not null,
  sell_price numeric(12, 2) not null,
  pnl numeric(14, 2) not null default 0,
  status text not null default 'hold' check (status in ('squared_off', 'hold')),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index live_portfolio_entries_entry_date_idx on live_portfolio_entries (entry_date desc, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.live_portfolio_entries to anon, authenticated;

-- Broadcast row changes for live cross-device sync, same as trade_entries/paper_trade_entries.
alter publication supabase_realtime add table public.live_portfolio_entries;
