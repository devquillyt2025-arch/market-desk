-- activity_log — backs the Logs tab. Was localStorage-only; moving to a
-- real table so the activity trail syncs across devices like everything
-- else now does. No `updated_at` — entries are append-only, never edited.

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  message text not null,
  created_at timestamptz not null default now()
);

create index activity_log_created_at_idx on activity_log (created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, delete on table public.activity_log to anon, authenticated;

alter publication supabase_realtime add table public.activity_log;
