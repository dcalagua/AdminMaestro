-- ============================================================================
-- EBIM Control Plane — 12 · pgTAP para los tests de base de datos
-- ----------------------------------------------------------------------------
-- Se instala en el schema `extensions` para no ensuciar `public`.
-- Sólo afecta al entorno local/CI: no se expone a PostgREST.
-- ============================================================================
create extension if not exists pgtap with schema extensions;
