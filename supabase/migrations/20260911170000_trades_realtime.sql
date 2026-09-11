-- History wasn't live-syncing across devices — it fetched trades once on
-- mount but never subscribed to changes, unlike notes/trade_entries.
alter publication supabase_realtime add table public.trades;
