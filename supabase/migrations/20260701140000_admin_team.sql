-- Valor de Terras — backend
-- 16 · Gestão da equipe técnica pelo admin (sem SQL manual):
--   listar técnicos, renovar a validade do CREA e ativar/desativar.
--   A CRIAÇÃO da conta de auth (confirmada) exige service role e fica na edge function
--   `admin-create-technician`, que promove via public.admin_upsert_technician.

-- lista a equipe técnica (só admin; retorna [] para os demais)
create or replace function public.admin_list_technicians()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', pr.id,
    'full_name', pr.full_name,
    'email', pr.email,
    'role', pr.role,
    'crea_number', t.crea_number,
    'uf', t.uf,
    'specialty', t.specialty,
    'active', t.active,
    'crea_active', t.crea_active,
    'crea_valid_until', t.crea_valid_until
  ) order by pr.full_name), '[]'::jsonb)
  from public.technical_team_members t
  join public.profiles pr on pr.id = t.profile_id
  where (select public.is_admin());
$$;

-- renova a validade do CREA (anuidade)
create or replace function public.admin_set_technician_validity(
  p_profile_id uuid,
  p_months int default 12
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Apenas admin pode alterar a equipe técnica';
  end if;
  update public.technical_team_members
     set crea_valid_until = current_date + make_interval(months => greatest(coalesce(p_months, 12), 1)),
         crea_active = true
   where profile_id = p_profile_id;
  if not found then raise exception 'Técnico não encontrado'; end if;
end $$;

-- ativa / desativa um técnico (bloqueia emissão sem apagar o histórico)
create or replace function public.admin_set_technician_active(
  p_profile_id uuid,
  p_active boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Apenas admin pode alterar a equipe técnica';
  end if;
  update public.technical_team_members set active = coalesce(p_active, true) where profile_id = p_profile_id;
  if not found then raise exception 'Técnico não encontrado'; end if;
end $$;

revoke all on function public.admin_list_technicians() from public, anon;
revoke all on function public.admin_set_technician_validity(uuid, int) from public, anon;
revoke all on function public.admin_set_technician_active(uuid, boolean) from public, anon;
grant execute on function public.admin_list_technicians() to authenticated;
grant execute on function public.admin_set_technician_validity(uuid, int) to authenticated;
grant execute on function public.admin_set_technician_active(uuid, boolean) to authenticated;
