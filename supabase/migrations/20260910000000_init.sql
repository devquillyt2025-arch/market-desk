-- MarketDesk — initial schema
--
-- Design notes:
--   * No auth yet (single-user tool), but `user_id` is present on `trades` so
--     auth can be bolted on later without a migration. It's nullable and
--     unconstrained for now — no RLS, no FK to auth.users.
--   * `lot_size` and `qty` are stored per trade, not looked up from
--     instrument at read time. NSE/BSE revise lot sizes periodically, so a
--     trade must keep the values that were true when it was placed.
--   * `trade_legs` intentionally carries only sell/buy/net/leg_order. Strike,
--     expiry, option type (CE/PE) and brokerage/charges are all nullable
--     columns that can be added later with a plain `alter table ... add
--     column` — nothing here blocks that.
--   * RLS is deliberately not enabled yet — there's no auth to scope it to.
--     When auth lands, add `user_id`-scoped policies here (see GearEdge Ops'
--     `clients` table for the pattern) rather than an anon allow-all.

create extension if not exists pgcrypto;

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  instrument text not null check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX')),
  trade_date date not null default current_date,
  lots int not null check (lots > 0),
  lot_size int not null check (lot_size > 0),
  qty int not null check (qty > 0),
  total_net numeric(12, 2) not null default 0,
  total_pnl numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index trades_created_at_idx on trades (created_at desc);

create table trade_legs (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  sell_price numeric(12, 2) not null,
  buy_price numeric(12, 2) not null,
  net numeric(12, 2) not null,
  leg_order int not null,
  created_at timestamptz not null default now()
);

create index trade_legs_trade_idx on trade_legs (trade_id, leg_order);

-- ---------------------------------------------------------------------------
-- save_trade — inserts a trade and its legs together. A plain client-side
-- insert-then-insert would leave an orphaned trade row if the legs insert
-- failed partway through; wrapping both in one function keeps them atomic.
-- ---------------------------------------------------------------------------
create or replace function save_trade(
  p_instrument text,
  p_lots int,
  p_lot_size int,
  p_qty int,
  p_total_net numeric,
  p_total_pnl numeric,
  p_legs jsonb,
  p_user_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_trade_id uuid;
begin
  insert into trades (user_id, instrument, lots, lot_size, qty, total_net, total_pnl)
  values (p_user_id, p_instrument, p_lots, p_lot_size, p_qty, p_total_net, p_total_pnl)
  returning id into v_trade_id;

  insert into trade_legs (trade_id, sell_price, buy_price, net, leg_order)
  select
    v_trade_id,
    (leg->>'sell_price')::numeric,
    (leg->>'buy_price')::numeric,
    (leg->>'net')::numeric,
    (leg->>'leg_order')::int
  from jsonb_array_elements(p_legs) as leg;

  return v_trade_id;
end;
$$;
