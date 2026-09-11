-- links — backs the Important Links page. Was localStorage-only (seeded
-- client-side on first load); moving to a real table so custom links sync
-- across devices like notes/trade_entries do. `group_name` instead of
-- `group` avoids needing to quote a near-reserved word everywhere.

create table links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  label text not null,
  url text not null,
  description text,
  group_name text not null default 'My Links',
  created_at timestamptz not null default now()
);

create index links_group_created_idx on links (group_name, created_at);

-- Seed the same built-in reference links the old localStorage version
-- shipped with, so existing users see a familiar starting list.
insert into links (label, url, description, group_name) values
  ('NSE Option Chain', 'https://www.nseindia.com/option-chain', 'Live option chain for Nifty, Bank Nifty, and other indices.', 'Market Data'),
  ('India VIX', 'https://www.nseindia.com/market-data/india-vix', 'Volatility index, useful for gauging premium levels.', 'Market Data'),
  ('BSE India', 'https://www.bseindia.com/', 'Sensex quotes and market data.', 'Market Data'),
  ('NSE India', 'https://www.nseindia.com/', 'Exchange notices, circulars, and market status.', 'Exchange & Regulatory'),
  ('NSE Market Holidays', 'https://www.nseindia.com/resources/exchange-communication-holidays', 'Trading holiday calendar.', 'Exchange & Regulatory'),
  ('SEBI', 'https://www.sebi.gov.in/', 'Regulatory circulars and investor guidance.', 'Exchange & Regulatory');

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.links to anon, authenticated;

alter publication supabase_realtime add table public.links;
