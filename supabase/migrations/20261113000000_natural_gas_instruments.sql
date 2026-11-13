-- MCX natural gas joins crude oil and gold: Natural Gas (NATURALGAS) and Natural Gas Mini (NATGASMINI) -
-- Upstox's underlying symbols for them. Lots are 1,250 and 250 mmBtu.
--
-- Run this AFTER 20261112000000_commodity_instruments.sql. It widens the same inline CHECK on `instrument`
-- (<table>_instrument_check) again, to nine instruments, so a synced natural gas position or trade is accepted.
-- `drop ... if exists` keeps it safe to re-run.
--
-- Nothing else changes: strike_price numeric(10, 2), the price columns numeric(12, 2) and pnl numeric(14, 2)
-- already fit natural gas (strikes ~100-500, lot value ~35,000).

alter table trade_entries drop constraint if exists trade_entries_instrument_check;
alter table trade_entries
  add constraint trade_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM', 'NATURALGAS', 'NATGASMINI'));

alter table paper_trade_entries drop constraint if exists paper_trade_entries_instrument_check;
alter table paper_trade_entries
  add constraint paper_trade_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM', 'NATURALGAS', 'NATGASMINI'));

alter table live_portfolio_entries drop constraint if exists live_portfolio_entries_instrument_check;
alter table live_portfolio_entries
  add constraint live_portfolio_entries_instrument_check
  check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'CRUDEOILM', 'GOLD', 'GOLDM', 'NATURALGAS', 'NATGASMINI'));
