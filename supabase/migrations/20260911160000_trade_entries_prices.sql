-- P&L is now computed client-side from buy/sell price (same formula as the
-- Brokerage Calculator: (sell - buy) * lot size * lots) instead of typed in
-- manually, so the raw prices need to be stored too.

alter table trade_entries
  add column buy_price numeric(12, 2) not null,
  add column sell_price numeric(12, 2) not null;
