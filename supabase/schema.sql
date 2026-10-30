-- CineFrame cloud library
-- Run this in Supabase Dashboard -> SQL Editor -> New query.
create table if not exists public.cineframe_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  watchlist jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint cineframe_watchlist_is_array check (jsonb_typeof(watchlist) = 'array'),
  constraint cineframe_history_is_array check (jsonb_typeof(history) = 'array')
);

alter table public.cineframe_library enable row level security;

drop policy if exists "Users can read their own CineFrame library" on public.cineframe_library;
create policy "Users can read their own CineFrame library"
  on public.cineframe_library for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own CineFrame library" on public.cineframe_library;
create policy "Users can insert their own CineFrame library"
  on public.cineframe_library for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own CineFrame library" on public.cineframe_library;
create policy "Users can update their own CineFrame library"
  on public.cineframe_library for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.cineframe_library to authenticated;
revoke all on public.cineframe_library from anon;
