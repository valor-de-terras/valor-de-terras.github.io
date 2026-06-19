-- Valor de Terras — backend
-- 05 · Storage (buckets privados e policies por papel)

insert into storage.buckets (id, name, public)
values
  ('geometries', 'geometries', false),
  ('art-pdfs', 'art-pdfs', false),
  ('report-pdfs', 'report-pdfs', false)
on conflict (id) do nothing;

-- Leitura: dono do objeto; equipe técnica lê laudo/ART
drop policy if exists storage_read on storage.objects;
create policy storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('geometries', 'art-pdfs', 'report-pdfs')
    and (owner = (select auth.uid()) or (select public.is_technician()))
  );

-- Upload de geometria: qualquer usuário autenticado, nos seus próprios objetos
drop policy if exists storage_insert_geometries on storage.objects;
create policy storage_insert_geometries on storage.objects
  for insert to authenticated
  with check (bucket_id = 'geometries' and owner = (select auth.uid()));

-- Upload de ART e laudo: somente equipe técnica
drop policy if exists storage_insert_technical on storage.objects;
create policy storage_insert_technical on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('art-pdfs', 'report-pdfs')
    and owner = (select auth.uid())
    and (select public.is_technician())
  );

-- Update/Delete: dono do objeto
drop policy if exists storage_update on storage.objects;
create policy storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('geometries', 'art-pdfs', 'report-pdfs')
    and owner = (select auth.uid())
  );

drop policy if exists storage_delete on storage.objects;
create policy storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('geometries', 'art-pdfs', 'report-pdfs')
    and owner = (select auth.uid())
  );
