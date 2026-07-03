-- Fix (revisão 2026-07-03): a RPC run_preliminary_estimate (v0.3.1) gerava comparáveis
-- 100% sintéticos rotulados com fontes reais e ainda transicionava o pedido para
-- ESTIMATE_DELIVERED, contornando o motor DERAL/NBR atual (run_estimate_with_enrichment).
-- Nenhum código de produção a referencia; removida para eliminar o bypass.
drop function if exists public.run_preliminary_estimate(uuid);
