-- Hardening (achado MEDIUM da revisão): 1 polígono de embargo em restricted_areas
-- tem topologia inválida ("nested shells"), que pode disparar TopologyException do
-- GEOS em ST_Intersects dependendo do plano. Sanea as geometrias de polígono das
-- tabelas semeadas nesta leva; barato (roda uma vez) e defensivo p/ próximas cargas.
update public.restricted_areas
   set geom = extensions.st_multi(extensions.st_makevalid(geom))
 where not extensions.st_isvalid(geom);

update public.outorgas
   set geom = extensions.st_multi(extensions.st_makevalid(geom))
 where kind = 'mineracao' and not extensions.st_isvalid(geom);

update public.urban_perimeters
   set geom = extensions.st_multi(extensions.st_makevalid(geom))
 where not extensions.st_isvalid(geom);
