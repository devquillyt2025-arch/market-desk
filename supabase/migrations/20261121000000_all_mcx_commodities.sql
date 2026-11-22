-- All MCX commodities join the instruments list:
-- Energy: CRUDEOIL, CRUDEOILM, NATURALGAS, NATGASMINI, ELECDMBL
-- Precious Metals: GOLD, GOLDM, GOLDTEN, GOLDGUINEA, GOLDPETAL, SILVER, SILVERM, SILVERMIC, SILVER100
-- Base Metals: COPPER, ZINC, ZINCMINI, ALUMINIUM, ALUMINI
--
-- Widens the inline CHECK constraint on `instrument` (<table>_instrument_check)
-- across trade_entries, paper_trade_entries, and live_portfolio_entries so that all
-- MCX commodity positions and trades are accepted without rejection.

alter table trade_entries drop constraint if exists trade_entries_instrument_check;
alter table trade_entries
  add constraint trade_entries_instrument_check
  check (instrument in (
    'NIFTY', 'BANKNIFTY', 'SENSEX',
    'CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'ELECDMBL',
    'GOLD', 'GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL',
    'SILVER', 'SILVERM', 'SILVERMIC', 'SILVER100',
    'COPPER', 'ZINC', 'ZINCMINI', 'ALUMINIUM', 'ALUMINI'
  ));

alter table paper_trade_entries drop constraint if exists paper_trade_entries_instrument_check;
alter table paper_trade_entries
  add constraint paper_trade_entries_instrument_check
  check (instrument in (
    'NIFTY', 'BANKNIFTY', 'SENSEX',
    'CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'ELECDMBL',
    'GOLD', 'GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL',
    'SILVER', 'SILVERM', 'SILVERMIC', 'SILVER100',
    'COPPER', 'ZINC', 'ZINCMINI', 'ALUMINIUM', 'ALUMINI'
  ));

alter table live_portfolio_entries drop constraint if exists live_portfolio_entries_instrument_check;
alter table live_portfolio_entries
  add constraint live_portfolio_entries_instrument_check
  check (instrument in (
    'NIFTY', 'BANKNIFTY', 'SENSEX',
    'CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'ELECDMBL',
    'GOLD', 'GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL',
    'SILVER', 'SILVERM', 'SILVERMIC', 'SILVER100',
    'COPPER', 'ZINC', 'ZINCMINI', 'ALUMINIUM', 'ALUMINI'
  ));

