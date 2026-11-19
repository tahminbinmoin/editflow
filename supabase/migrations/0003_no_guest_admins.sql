-- Guest (anonymous) accounts can't claim admin, even with a valid invite code.
create or replace function public.claim_admin(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  inv public.admin_invites;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then raise exception 'Guest accounts cannot become admins. Create an admin account with an email and password.'; end if;
  select * into inv from public.admin_invites
   where code_hash = encode(extensions.digest(upper(trim(code)), 'sha256'), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then raise exception 'That invite code is not valid, expired or already used.'; end if;
  insert into public.admins (user_id) values ((select auth.uid())) on conflict do nothing;
  update public.admin_invites set used_by = (select auth.uid()), used_at = now() where id = inv.id;
  return true;
end $$;
revoke all on function public.claim_admin(text) from public, anon;
grant execute on function public.claim_admin(text) to authenticated;
