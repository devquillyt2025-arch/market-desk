-- MCX crude oil and gold join Nifty / Bank Nifty / Sensex as tradable
-- instruments: Crude Oil (CRUDEOIL), Crude Oil Mini (CRUDEOILM), Gold (GOLD)
-- and Gold Mini (GOLDM) - Upstox's underlying symbols for them.
--
-- Each table's inline CHECK on `instrument` only allowed the three indices,
-- which would reject a synced crude position outright. The constraint names
-- below are the ones Postgres generated for those inline checks
-- (<table>_instrument_check); `drop ... if exists` keeps this safe to re-run.
--
-- Nothing else changes: strike_price numeric(10, 2), the price columns
-- numeric(12, 2) and pnl numeric(14, 2) already fit crude (~8,000) and gold
-- (~150,000) strikes and premiums.

alter table trade_entries drop constraint if exists trade_entries_instrument_check;
alter table trade_entries
  add constraint trade_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM'));

alter table paper_trade_entries drop constraint if exists paper_trade_entries_instrument_check;
alter table paper_trade_entries
  add constraint paper_trade_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM'));

alter table live_portfolio_entries drop constraint if exists live_portfolio_entries_instrument_check;
alter table live_portfolio_entries
  add constraint live_portfolio_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM'));
