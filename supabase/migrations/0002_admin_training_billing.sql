-- Admins + AI training studio + billing-ready plans (payments not enabled yet).
--
-- Admins are ordinary auth users listed in public.admins. Nobody can add themselves: an admin
-- account is created by claiming a one-time invite code (claim_admin), and invite codes are made
-- by existing admins (create_admin_invite) or by the project owner in SQL. Codes are stored hashed.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

create or replace function public.claim_admin(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  inv public.admin_invites;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  select * into inv from public.admin_invites
   where code_hash = encode(extensions.digest(upper(trim(code)), 'sha256'), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then raise exception 'That invite code is not valid, expired or already used.'; end if;
  insert into public.admins (user_id) values ((select auth.uid())) on conflict do nothing;
  update public.admin_invites set used_by = (select auth.uid()), used_at = now() where id = inv.id;
  return true;
end $$;

create or replace function public.create_admin_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  raw text := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  code text;
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  code := substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4);
  insert into public.admin_invites (code_hash, created_by) values (encode(extensions.digest(code, 'sha256'), 'hex'), (select auth.uid()));
  return code;
end $$;

create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  return json_build_object(
    'users', (select count(*) from auth.users),
    'signups_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'projects', (select count(*) from public.projects),
    'exported', (select count(*) from public.projects where status = 'exported'),
    'ai_requests_30d', (select count(*) from public.ai_log where created_at > now() - interval '30 days'),
    'admins', (select count(*) from public.admins)
  );
end $$;

revoke all on function public.claim_admin(text) from public, anon;
revoke all on function public.create_admin_invite() from public, anon;
revoke all on function public.admin_stats() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.claim_admin(text) to authenticated;
grant execute on function public.create_admin_invite() to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.admins enable row level security;
alter table public.admin_invites enable row level security; -- no policies: functions only
create policy "admins: see self" on public.admins for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ----- Training studio -----
-- A house style per type of reel (versioned). Published versions are read by every signed-in
-- user's story edit; only admins can write.
create table if not exists public.edit_styles (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9-]{1,40}$'),
  label text not null check (char_length(label) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  version integer not null default 1,
  rules jsonb not null default '[]'::jsonb,
  examples jsonb not null default '[]'::jsonb,
  pacing jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  trained_from integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version)
);
create index if not exists edit_styles_key on public.edit_styles (key, version desc);

-- Gold-standard edits by Editflow's editors: what the raw footage said and what a pro kept.
create table if not exists public.training_examples (
  id uuid primary key default gen_random_uuid(),
  edit_type text not null check (edit_type ~ '^[a-z0-9-]{1,40}$'),
  title text not null default '' check (char_length(title) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  rating smallint check (rating between 1 and 5),
  data jsonb not null default '{}'::jsonb,
  source_project_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.edit_styles enable row level security;
alter table public.training_examples enable row level security;
create policy "styles: read published" on public.edit_styles for select to authenticated using (published or (select public.is_admin()));
create policy "styles: admins insert" on public.edit_styles for insert to authenticated with check ((select public.is_admin()));
create policy "styles: admins update" on public.edit_styles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "styles: admins delete" on public.edit_styles for delete to authenticated using ((select public.is_admin()));
create policy "examples: admins read" on public.training_examples for select to authenticated using ((select public.is_admin()));
create policy "examples: admins insert" on public.training_examples for insert to authenticated with check ((select public.is_admin()));
create policy "examples: admins update" on public.training_examples for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "examples: admins delete" on public.training_examples for delete to authenticated using ((select public.is_admin()));

-- ----- Plans & usage (billing-ready; payments are not switched on) -----
-- One row per paying user, written only by the server's payment webhook (service role) once a
-- payment provider is connected. No row = the free plan.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (char_length(plan) <= 40),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  provider text check (char_length(provider) <= 40),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "own subscription: select" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));

-- What each user used (exports, AI tasks, transcription minutes) for plan limits later.
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) <= 40),
  amount numeric not null default 1,
  project_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_created on public.usage_events (user_id, created_at desc);
alter table public.usage_events enable row level security;
create policy "own usage: select" on public.usage_events for select to authenticated using (user_id = (select auth.uid()));
create policy "own usage: insert" on public.usage_events for insert to authenticated with check (user_id = (select auth.uid()));
