-- trade_entries was created empty and minimal (date/P&L/status only); add
-- the trade detail fields now that the app actually captures them.

alter table trade_entries
  add column instrument text not null check (instrument in ('NIFTY', 'BANKNIFTY', 'SENSEX')),
  add column lots int not null check (lots > 0),
  add column side text not null check (side in ('buy', 'sell'));
