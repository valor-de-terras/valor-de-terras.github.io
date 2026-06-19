-- Valor de Terras — backend
-- 07 · Defesa em profundidade: revoga EXECUTE do papel anon em todas as funções do
-- domínio. O Supabase concede execute a anon/authenticated por DEFAULT PRIVILEGES, e
-- `revoke from public` não remove esse grant explícito a anon. As funções já barram
-- chamadas não autenticadas internamente; isto garante que anon sequer execute o corpo.

do $$
declare
  sig text;
begin
  for sig in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_appraisal_request', 'run_preliminary_estimate',
        'proceed_to_technical_review', 'cancel_request',
        'assign_technical_review', 'submit_art_and_finish',
        'is_admin', 'is_technician', 'my_role', 'user_organization_id',
        '_extract_geom'
      )
  loop
    execute format('revoke all on function public.%s from anon', sig);
  end loop;
end $$;
