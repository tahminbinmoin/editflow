-- Editflow schema. Every table is protected by row-level security: a user can only
-- read and write their own rows. Provider API keys are stored encrypted by the API
-- (AES-256-GCM with EDITFLOW_SECRET, which only the server knows), so even the owner's
-- browser only ever sees ciphertext.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Untitled video' check (char_length(name) <= 120),
  status text not null default 'setup' check (status in ('setup', 'editing', 'exported')),
  is_sample boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default '',
  source text not null default 'user',
  timeline jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists project_history_project on public.project_history (project_id, created_at);
create index if not exists project_history_user on public.project_history (user_id);

create table if not exists public.provider_settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (char_length(provider) <= 40),
  config jsonb not null default '{}'::jsonb,
  secret text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.ai_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid,
  provider text,
  model text,
  routed_via text,
  task text,
  ok boolean,
  input_tokens integer,
  output_tokens integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ai_log_user_created on public.ai_log (user_id, created_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
drop trigger if exists provider_settings_touch on public.provider_settings;
create trigger provider_settings_touch before update on public.provider_settings
  for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.project_history enable row level security;
alter table public.provider_settings enable row level security;
alter table public.ai_log enable row level security;

-- projects
create policy "own projects: select" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "own projects: insert" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own projects: update" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own projects: delete" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

-- history (must also belong to one of the user's projects)
create policy "own history: select" on public.project_history for select to authenticated using ((select auth.uid()) = user_id);
create policy "own history: insert" on public.project_history for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy "own history: delete" on public.project_history for delete to authenticated using ((select auth.uid()) = user_id);

-- provider settings
create policy "own provider settings: select" on public.provider_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "own provider settings: insert" on public.provider_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own provider settings: update" on public.provider_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own provider settings: delete" on public.provider_settings for delete to authenticated using ((select auth.uid()) = user_id);

-- AI usage log
create policy "own ai log: select" on public.ai_log for select to authenticated using ((select auth.uid()) = user_id);
create policy "own ai log: insert" on public.ai_log for insert to authenticated with check ((select auth.uid()) = user_id);

-- Storage: private "media" bucket, 50 MB per file (the Free plan maximum).
-- Files live under <user id>/<project id>/<asset id>/..., and users can only touch their own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "media: read own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: update own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
