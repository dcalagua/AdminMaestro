# leads.v1 — Solicitudes de la web

Las landings de la suite (hoy eChange, `echange.ebim.pe`) recogen pedidos de prueba y contacto. El
Admin Maestro los **lee** con GET firmado M2M (mismo transporte que la sincronización de tenants) y
los trabaja en **Comercial › Solicitudes de la web** (`/solicitudes`).

## Canal

- `product_integrations.leads_path` + `leads_read_scope` (los dos o ninguno). eChange:
  `/leads` y `echange:leads:read`.
- `GET {base_url}{leads_path}?after=<cursor>&limit=100`, cabecera `x-masteradmin-contract: leads.v1`.
- Respuesta de la app: `{contractVersion:"leads.v1", productCode, environment, items:[…], nextCursor, resumeCursor}`.
  Ítem: `externalId, receivedAt, name, company, email, phone, teamSize, planInterest (código de plan),
  country (PE|EC|BO|null), message, source`. Contrato del lado de eChange:
  `eChange/docs/platform-provisioning/LEADS.md`.

## Lectura

- Edge Function `lead-sync` (verify_jwt). Servidor: pg_cron `ebim-lead-sync` cada 10 min vía
  `invoke_scheduled_function('LEAD_SYNC')` (Vault: `masteradmin_project_url`,
  `masteradmin_service_role_key`). Humano: «Traer ahora», exige `can_manage_commercial()`.
- `lead_sync_plan()` (destinos con canal y su cursor) → GET por páginas (máx. 10 × 100) →
  `record_lead_sync()` (idempotente por destino + id externo; una relectura actualiza el contacto y
  **nunca** el estado ni las notas). El estado de cada destino queda en `lead_sync_state`.

## Seguimiento

`commercial_leads.status`: `NEW → CONTACTED → CONVERTED | DISCARDED`.

- `set_commercial_lead_status` (NEW, CONTACTED, DISCARDED con motivo obligatorio), auditada.
- `link_commercial_lead_organization`: enlaza la cuenta cliente y pasa a CONVERTED, auditada.
- «Crear cliente y nueva venta» crea la organización con los datos de la solicitud y abre
  `/onboarding?solicitud=…&cuenta=…`: propone producto, plan de interés, tenant TRIAL, admin, país y
  **no activa la suscripción** (es una prueba).
- Bandeja: tipo «Solicitudes de la web» con las NUEVAS; pasado un día sin contestar, urgentes.
- Lo ve y lo trabaja `can_manage_commercial()` (finanzas o admin de producto de EBIM). Un partner no.
