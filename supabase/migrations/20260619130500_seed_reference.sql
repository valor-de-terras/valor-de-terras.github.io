-- Valor de Terras — backend
-- 06 · Dados de referência (catálogo de enriquecimento e preços-base regionais)
-- Os fatores espelham o motor de homogeneização da demo do front-end. São ilustrativos.

insert into public.enrichment_layers (key, label, source, factor, sort) values
  ('relevo', 'Relevo & declividade', 'DEM SRTM / AW3D30', 1.0400, 1),
  ('solo', 'Solo & aptidão agrícola', 'EMBRAPA WMS / SiBCS', 1.1200, 2),
  ('uso', 'Uso e cobertura do solo', 'MapBiomas (STAC)', 1.0600, 3),
  ('clima', 'Clima & balanço hídrico', 'INMET / BDMEP', 1.0300, 4),
  ('hidro', 'Hidrografia & APP', 'ANA SNIRH', 0.9700, 5),
  ('acesso', 'Acesso & logística', 'OSM Overpass', 1.0500, 6),
  ('embargo', 'Restrições & embargos', 'IBAMA / ICMBio', 1.0000, 7),
  ('comp', 'Comparáveis de mercado', 'DERAL/SEAB + CEPEA', 1.0000, 8)
on conflict (key) do update
  set label = excluded.label, source = excluded.source, factor = excluded.factor, sort = excluded.sort;

insert into public.regional_base_prices (uf, municipality, base_price_per_ha, source) values
  ('PR', 'Guarapuava', 62000, 'DERAL/SEAB-PR (referência ilustrativa)'),
  ('PR', 'Castro', 88000, 'DERAL/SEAB-PR (referência ilustrativa)'),
  ('PR', 'Cascavel', 105000, 'DERAL/SEAB-PR (referência ilustrativa)'),
  ('PR', null, 75000, 'Média estadual ilustrativa')
on conflict (uf, municipality) do update
  set base_price_per_ha = excluded.base_price_per_ha, source = excluded.source;
