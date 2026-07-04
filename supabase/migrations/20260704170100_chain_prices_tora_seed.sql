-- Refino 1 · preço de tora (cadeia florestal) — SEAB/DERAL Preços Florestais 2025-11
-- Tora para processo (celulose/painéis) em pé no produtor, R$/m³. Substitui erva-mate
-- como preço da cadeia florestal. Outliers (<R$40/m³) e vazios excluídos.

delete from public.chain_prices where cadeia='florestal' and produto like 'Erva-mate%';
insert into public.chain_prices (cadeia, produto, regional, unidade, preco, ref_month, fonte) values
('florestal','Tora para processo','Apucarana','m³',95.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Cornélio Procópio','m³',87.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Curitiba','m³',95.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Guarapuava','m³',121.80,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Irati','m³',91.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Ivaiporã','m³',90.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','Ponta Grossa','m³',131.70,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','União da Vitória','m³',90.00,'2025-11','SEAB/DERAL Preços Florestais'),
('florestal','Tora para processo','PR (referência)','m³',100.19,'2025-11','SEAB/DERAL Preços Florestais')
on conflict (produto, regional) do update set preco=excluded.preco, ref_month=excluded.ref_month;