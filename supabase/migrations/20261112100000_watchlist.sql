-- watchlist_items - backs the Watchlist page: the instruments you follow, in the order you keep them, shared
-- across devices like links/notes. Prices are never stored here - they are read live from Upstox.
--
-- `kind` says what it is; `item_key` is its stable identity and is unique, so the same instrument can't be listed twice:
--   index      -> Upstox's instrument key, e.g. 'NSE_INDEX|Nifty 50'
--   equity     -> Upstox's instrument key, e.g. 'NSE_EQ|INE002A01018'
--   commodity  -> 'MCX_COM|<symbol>', e.g. 'MCX_COM|CRUDEOIL'. Deliberately not a contract key: a futures
--                 contract expires every month, so the app looks up the current month's contract by symbol each time.
-- `sort_order` is the position in the list (ascending).

create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  kind text not null check (kind in ('index', 'equity', 'commodity')),
  item_key text not null unique,
  symbol text not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index watchlist_items_order_idx on watchlist_items (sort_order, created_at);

-- Starting list: the three indices and the main MCX energy and metals. (The app's DEFAULT_WATCHLIST in src/lib/watchlist.ts must match - a test checks.)
insert into watchlist_items (kind, item_key, symbol, name, sort_order) values
  ('index', 'NSE_INDEX|Nifty 50', 'NIFTY', 'Nifty 50', 1),
  ('index', 'NSE_INDEX|Nifty Bank', 'BANKNIFTY', 'Bank Nifty', 2),
  ('index', 'BSE_INDEX|SENSEX', 'SENSEX', 'Sensex', 3),
  ('commodity', 'MCX_COM|CRUDEOIL', 'CRUDEOIL', 'Crude Oil', 4),
  ('commodity', 'MCX_COM|NATURALGAS', 'NATURALGAS', 'Natural Gas', 5),
  ('commodity', 'MCX_COM|GOLD', 'GOLD', 'Gold', 6),
  ('commodity', 'MCX_COM|SILVER', 'SILVER', 'Silver', 7),
  ('commodity', 'MCX_COM|COPPER', 'COPPER', 'Copper', 8),
  ('commodity', 'MCX_COM|ZINC', 'ZINC', 'Zinc', 9),
  ('commodity', 'MCX_COM|ALUMINIUM', 'ALUMINIUM', 'Aluminium', 10)
on conflict (item_key) do nothing;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.watchlist_items to anon, authenticated;

-- Broadcast row changes for live cross-device sync, same as links/trade_entries.
alter publication supabase_realtime add table public.watchlist_items;
