-- upstox_config — single-row settings table holding the daily Upstox access
-- token, pasted in by hand at /settings (tokens expire ~3:30 AM IST
-- daily; no auto-refresh yet, by design — see the Live Portfolio tab).
-- `id` is pinned to 1 and checked as such so the table can never hold more
-- than one row; every read/write targets id = 1.
--
-- Same "no RLS yet, single-user tool" posture as every other table here —
-- see trade_entries' migration for the rationale. The actual Upstox API
-- call stays server-side regardless (this app's anon key can already read
-- this row directly, same as any other table, but a browser call straight
-- to Upstox would hit CORS anyway, hence the /api/upstox/option-chain route
-- reading this table with the service-role key instead of the anon client).

create table upstox_config (
  id integer primary key default 1,
  access_token text,
  updated_at timestamptz not null default now(),
  constraint upstox_config_singleton check (id = 1)
);

insert into upstox_config (id) values (1);

grant usage on schema public to anon, authenticated;
grant select, update on table public.upstox_config to anon, authenticated;

alter publication supabase_realtime add table public.upstox_config;
