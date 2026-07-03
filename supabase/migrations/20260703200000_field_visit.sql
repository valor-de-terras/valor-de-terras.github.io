-- Frente F (fundação): tier de vistoria presencial ("engenheiro sob demanda").
-- Escopo desta migration: só o modelo de dados sobre o qual o fluxo será construído.
-- FORA daqui (decisão de produto/jurídico/financeiro, não implementável sozinho):
--   split de pagamento (provedor: Stripe/Mercado Pago), contrato do engenheiro (PJ/
--   credenciado), agenda/dispatch e precificação por distância. Ver notes/roadmap/.

-- No pedido: modalidade da avaliação. 'presencial' habilita a vistoria de benfeitorias,
-- que eleva o Grau de Fundamentação (NBR) e o valor cobrado pelo laudo.
alter table public.appraisal_requests
  add column if not exists visit_mode text not null default 'remoto'
    check (visit_mode in ('remoto', 'presencial'));

-- No perfil do técnico: se aceita vistoria presencial, regiões atendidas e honorário.
alter table public.profiles
  add column if not exists accepts_field_visits boolean not null default false,
  add column if not exists service_regions text[],
  add column if not exists field_visit_fee numeric;

-- Admin configura a disponibilidade de vistoria de um técnico (reusa a infra de admin).
create or replace function public.admin_set_field_visit(
  p_technician uuid,
  p_accepts boolean,
  p_regions text[] default null,
  p_fee numeric default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas admin'; end if;
  update public.profiles
     set accepts_field_visits = coalesce(p_accepts, accepts_field_visits),
         service_regions = coalesce(p_regions, service_regions),
         field_visit_fee = coalesce(p_fee, field_visit_fee)
   where id = p_technician and role in ('technician', 'admin');
  if not found then raise exception 'Técnico não encontrado'; end if;
end $$;
revoke all on function public.admin_set_field_visit(uuid, boolean, text[], numeric) from public, anon;
grant execute on function public.admin_set_field_visit(uuid, boolean, text[], numeric) to authenticated;
