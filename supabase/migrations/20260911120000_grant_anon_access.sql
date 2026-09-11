-- Grant Data API access to the anon/authenticated roles.
--
-- Newer Supabase projects don't auto-expose newly created public-schema
-- tables/functions to the Data API roles (see `auto_expose_new_tables` in
-- supabase/config.toml) — without these grants, PostgREST returns 401/403 to
-- every request made with the anon key, even though RLS is deliberately not
-- enabled on these tables (see 20260910000000_init.sql).

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.trades to anon, authenticated;
grant select, insert, update, delete on table public.trade_legs to anon, authenticated;

grant execute on function public.save_trade(text, int, int, int, numeric, numeric, jsonb, uuid)
  to anon, authenticated;
