-- Valor de Terras — backend
-- 04 · Row-Level Security
-- Escritas acontecem apenas via RPC SECURITY DEFINER (auditadas). As policies abaixo
-- controlam leitura: dono do pedido, equipe técnica e admin. Tabelas de referência
-- são de leitura pública. As chamadas a auth.uid()/helpers usam (select ...) para que o
-- planejador as avalie uma única vez por query (init-plan), não por linha.

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.technical_team_members enable row level security;
alter table public.properties enable row level security;
alter table public.appraisal_requests enable row level security;
alter table public.appraisal_estimates enable row level security;
alter table public.comparables enable row level security;
alter table public.appraisal_reports enable row level security;
alter table public.data_snapshots enable row level security;
alter table public.audit_logs enable row level security;
alter table public.enrichment_layers enable row level security;
alter table public.regional_base_prices enable row level security;

-- profiles: leitura do próprio + admin; update do próprio SEM poder mudar o papel
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select public.my_role()));

-- organizations: membros e admin
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated using (
    (select public.is_admin()) or id = (select public.user_organization_id())
  );

-- technical_team_members
drop policy if exists ttm_select on public.technical_team_members;
create policy ttm_select on public.technical_team_members
  for select to authenticated using ((select public.is_technician()) or profile_id = (select auth.uid()));

-- properties
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties
  for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_technician()));

-- appraisal_requests
drop policy if exists requests_select on public.appraisal_requests;
create policy requests_select on public.appraisal_requests
  for select to authenticated using (requester_id = (select auth.uid()) or (select public.is_technician()));

-- appraisal_estimates
drop policy if exists estimates_select on public.appraisal_estimates;
create policy estimates_select on public.appraisal_estimates
  for select to authenticated using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = appraisal_estimates.request_id
        and (r.requester_id = (select auth.uid()) or (select public.is_technician()))
    )
  );

-- comparables
drop policy if exists comparables_select on public.comparables;
create policy comparables_select on public.comparables
  for select to authenticated using (
    exists (
      select 1
      from public.appraisal_estimates e
      join public.appraisal_requests r on r.id = e.request_id
      where e.id = comparables.estimate_id
        and (r.requester_id = (select auth.uid()) or (select public.is_technician()))
    )
  );

-- appraisal_reports
drop policy if exists reports_select on public.appraisal_reports;
create policy reports_select on public.appraisal_reports
  for select to authenticated using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = appraisal_reports.request_id
        and (r.requester_id = (select auth.uid()) or (select public.is_technician()))
    )
  );

-- data_snapshots: dono do pedido; técnico SOMENTE no pedido sob sua responsabilidade; admin
drop policy if exists snapshots_select on public.data_snapshots;
create policy snapshots_select on public.data_snapshots
  for select to authenticated using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = data_snapshots.request_id
        and (
          r.requester_id = (select auth.uid())
          or r.technician_id = (select auth.uid())
          or (select public.is_admin())
        )
    )
  );

-- audit_logs: mesma regra de escopo dos snapshots
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select to authenticated using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = audit_logs.request_id
        and (
          r.requester_id = (select auth.uid())
          or r.technician_id = (select auth.uid())
          or (select public.is_admin())
        )
    )
  );

-- Tabelas de referência: leitura pública (anon + authenticated)
drop policy if exists enrichment_layers_read on public.enrichment_layers;
create policy enrichment_layers_read on public.enrichment_layers
  for select to anon, authenticated using (true);

drop policy if exists regional_prices_read on public.regional_base_prices;
create policy regional_prices_read on public.regional_base_prices
  for select to anon, authenticated using (true);
