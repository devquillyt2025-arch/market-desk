-- notes — backs the Notes tab. Same rationale as trades
-- (20260910000000_init.sql): single-user tool, no auth yet, so `user_id` is
-- present for later but RLS is deliberately not enabled — access is
-- controlled by the anon/authenticated grants below instead.

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text not null default '',
  content text not null default '',
  color text not null default 'default' check (
    color in ('default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink')
  ),
  pinned boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_updated_at_idx on notes (updated_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.notes to anon, authenticated;

-- Broadcast row changes so a note edited on one device shows up live on
-- another open session, instead of only on next reload.
alter publication supabase_realtime add table public.notes;
