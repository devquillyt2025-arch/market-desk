-- balance_sheet_entries + balance_sheet_settings — a running debit/credit
-- ledger with a configurable starting fund, shown as a second view inside
-- the Trade Entries tab. Closing balance, Fund, PNL(K), and Overall % Ret
-- are all DERIVED at read time (see calculateBalanceSheet.ts) from the
-- ordered list of entries plus the starting fund — never stored, so
-- editing or deleting an entry can't leave a stale running total behind.

-- Singleton settings row: `id boolean primary key default true check (id)`
-- only ever permits exactly one row (id must be true, and true can't repeat
-- under a primary key), which is exactly the "one global setting" shape.
create table balance_sheet_settings (
  id boolean primary key default true check (id),
  starting_fund numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now()
);

insert into balance_sheet_settings (starting_fund) values (0);

create table balance_sheet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  entry_date date not null default current_date,
  type text not null check (type in ('debit', 'credit')),
  amount numeric(14, 2) not null check (amount >= 0),
  remarks text,
  created_at timestamptz not null default now()
);

create index balance_sheet_entries_date_idx on balance_sheet_entries (entry_date, created_at);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.balance_sheet_settings to anon, authenticated;
grant select, insert, update, delete on table public.balance_sheet_entries to anon, authenticated;

alter publication supabase_realtime add table public.balance_sheet_settings;
alter publication supabase_realtime add table public.balance_sheet_entries;
