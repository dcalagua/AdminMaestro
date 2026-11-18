-- ============================================================================
-- eChange: lo que redacta la IA es del Plan B (2026-11-18)
-- ----------------------------------------------------------------------------
-- Regla comercial única (eChange 20261118140000): la Torre de Control, el
-- informe del período en PDF y el anexo Excel son de los DOS planes —son cifras
-- de la base y lo que demuestra el servicio—; lo que REDACTA la IA es del Plan B:
-- el informe mensual y la recomendación de adopción de la Torre.
--
-- Solo cambia cómo se describen los planes (descripción y `metadata.incluye`):
-- precio, unidad de cobro y código no se tocan.
-- ============================================================================

update platform.plans
   set description = replace(description,
         'reportes operativos; IA de atención y autoservicio.',
         'reportes operativos, Torre de Control, informe del período en PDF y anexo Excel; IA de atención y autoservicio.'),
       metadata = jsonb_set(metadata, '{incluye}',
         '["Casos, catálogo y SLA", "Portal y conocimiento", "Aprobaciones y automatización", "Reportes operativos, Torre de Control, informe PDF y anexo Excel", "IA de atención y autoservicio"]'::jsonb)
 where code = 'echange-mesa-completa';

update platform.plans
   set description = replace(description,
         'informe mensual redactado por IA.',
         'informe mensual y recomendación de la Torre de Control redactados por IA.'),
       metadata = jsonb_set(metadata, '{incluye}',
         '["Todo el Plan A", "Equipos y activos", "Inventario y asignaciones", "Devoluciones y actas", "Informe mensual y recomendación de la Torre redactados por IA"]'::jsonb)
 where code = 'echange-mesa-y-activos';
