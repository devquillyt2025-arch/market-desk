-- Adds a closing date to trade_entries and paper_trade_entries — the date a
-- position was actually squared off, distinct from entry_date (when it was
-- opened) and expiry_date (the contract's expiry). Nullable: a "hold" entry
-- has no closing date yet, and existing rows aren't backfilled.

alter table trade_entries add column closing_date date;
alter table paper_trade_entries add column closing_date date;
