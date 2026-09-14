-- Adds an expiry date to trade_entries, needed to disambiguate contracts at
-- the same strike across different expiries when matching against Upstox's
-- option-chain response (the Live Portfolio tab). Nullable: existing rows
-- have no expiry and stay that way — the app treats a null expiry as
-- "not tracked live" rather than requiring a backfill.

alter table trade_entries add column expiry_date date;
