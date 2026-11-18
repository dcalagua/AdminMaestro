-- ============================================================================
-- eChange: los canales vienen incluidos en el plan (2026-11-18)
-- ----------------------------------------------------------------------------
-- Mismo paso que la Flota IA (20261025000200), ahora para los canales. En
-- eChange se cobra el PLAN (A · Mesa completa, B · Mesa y activos); ningún canal
-- se vende por separado (20261118120000 de ese repo):
--
--   · el portal y el correo los pone EBIM;
--   · WhatsApp, Teams y el teléfono los pone el CLIENTE (su número y su cuenta
--     de Meta, sus licencias de Microsoft 365, su cuenta de voz) y eChange solo
--     se conecta: Meta le factura a él, no a EBIM;
--   · la «Línea telefónica de la mesa» era el número que revendía EBIM y se dio
--     de baja.
--
-- Se marcan RETIRED, no se borran, igual que los agentes. Ningún tenant los
-- tenía (platform.tenant_addons con addon_code echange_*: 0 filas el
-- 2026-11-18). El precio legacy no se toca (lo congela un trigger).
-- ============================================================================

update platform.catalog_items
   set lifecycle_status = 'RETIRED',
       description = 'Retirado el 2026-11-18: en eChange los canales vienen incluidos en el plan; WhatsApp, Teams y el teléfono los pone el cliente con sus propias cuentas. '
                     || description
 where code in ('echange_email', 'echange_esupplier', 'echange_phone', 'echange_portal',
                'echange_service_line', 'echange_teams', 'echange_whatsapp')
   and lifecycle_status <> 'RETIRED';
