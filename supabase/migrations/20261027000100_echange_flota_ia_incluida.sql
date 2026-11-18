-- ============================================================================
-- eChange: la Flota IA viene incluida en el plan (2026-11-18)
-- ----------------------------------------------------------------------------
-- Los planes de Gerencia (A · Mesa completa, B · Mesa y activos, por agente)
-- son lo que se cobra en eChange. Los nueve agentes de IA que el mapeo del
-- 2026-11-16 (20261023000200) registró como add-ons en BORRADOR —algunos con un
-- precio de referencia de una cotización vieja (Reportería 90, Correo entrante
-- 60, Altas y bajas 140)— no se venden por separado:
--
--   · los siete activos vienen con cualquier plan;
--   · la reportería y los activos son parte del Plan B (los aplica eChange);
--   · «Correo entrante» y «Altas, bajas y equipos» se retiraron en eChange
--     (20261118100000 de ese repo): no gobernaban nada.
--
-- Se marcan RETIRED, no se borran: el rastro de que existieron como borrador
-- sirve, y ningún tenant los tenía (platform.tenant_addons, 0 filas el
-- 2026-11-18). El precio legacy no se toca (lo congela un trigger).
-- Los CANALES de eChange (WhatsApp, teléfono, correo, eSupplier, línea) no se
-- tocan acá: siguen en borrador hasta que Gerencia decida si se cobran.
-- ============================================================================

update platform.catalog_items
   set lifecycle_status = 'RETIRED',
       description = 'Retirado el 2026-11-18: en eChange la Flota IA viene incluida en el plan (la reportería, con el Plan B); no se vende por separado. '
                     || description
 where code in ('echange_adoption_analyst', 'echange_asset_clerk', 'echange_deflector',
                'echange_email_intake', 'echange_intake_assistant', 'echange_report_writer',
                'echange_survey_sentiment', 'echange_triage', 'echange_voice_transcriber')
   and lifecycle_status <> 'RETIRED';
