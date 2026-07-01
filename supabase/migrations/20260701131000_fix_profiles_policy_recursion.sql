-- Valor de Terras — backend
-- 15 · Correção: a policy profiles_update_self (migração 14) referenciava public.profiles
--      por subquery direta dentro de uma policy de profiles, causando recursão de RLS
--      (42P17) em qualquer UPDATE do próprio perfil. Passa a usar o helper SECURITY
--      DEFINER public.my_email() (mesmo padrão de my_role()/user_organization_id()).

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.my_role())
    and email is not distinct from (select public.my_email())
    and organization_id is not distinct from (select public.user_organization_id())
  );
