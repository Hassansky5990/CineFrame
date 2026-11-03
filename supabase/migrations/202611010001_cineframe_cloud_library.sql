-- CineFrame account-synced watchlist and viewing history
-- Run in Supabase Dashboard > SQL Editor.
create table if not exists public.cineframe_watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id bigint not null,
  media_type text not null check (media_type in ('movie','tv')),
  item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id, media_type)
);
create table if not exists public.cineframe_watch_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id bigint not null,
  media_type text not null check (media_type in ('movie','tv')),
  item jsonb not null default '{}'::jsonb,
  watched_at timestamptz not null default now(),
  season integer,
  episode integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id, media_type)
);
alter table public.cineframe_watchlist enable row level security;
alter table public.cineframe_watch_history enable row level security;
drop policy if exists "Users manage their own CineFrame watchlist" on public.cineframe_watchlist;
create policy "Users manage their own CineFrame watchlist"
on public.cineframe_watchlist for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage their own CineFrame history" on public.cineframe_watch_history;
create policy "Users manage their own CineFrame history"
on public.cineframe_watch_history for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists cineframe_watchlist_user_updated_idx on public.cineframe_watchlist (user_id, updated_at desc);
create index if not exists cineframe_history_user_watched_idx on public.cineframe_watch_history (user_id, watched_at desc);

-- Enable live cross-device updates through Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cineframe_watchlist'
  ) then
    alter publication supabase_realtime add table public.cineframe_watchlist;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cineframe_watch_history'
  ) then
    alter publication supabase_realtime add table public.cineframe_watch_history;
  end if;
end $$;
