# El contrato de provisioning y sus adaptadores

## 1. Por qué un contrato y no un cliente por producto

La suite no es homogénea: EWM es Java sobre PostgreSQL, otro producto puede ser
Supabase con Edge Functions y otro FastAPI. Si MasterAdmin tuviera un cliente
por tecnología, añadir el sexto producto sería escribir el sexto cliente.

Con un contrato, añadir un producto es **una fila de configuración**. El código
del orquestador no menciona ningún producto — y hay un test de registro que lo
mantiene así.

## 2. La interfaz

```ts
interface ProvisioningAdapter {
  readonly type: AdapterType;
  provision(context: ProvisioningContext): Promise<AdapterOutcome>;
  getStatus(context: ProvisioningContext): Promise<AdapterOutcome>;
}
```

`suspend` y `activate` **no** están todavía, a propósito: implementarlos sin un
contrato acordado con los productos sería inventar semántica que después habría
que romper.

## 3. Petición

`POST {base_url}{create_path_template}`

| Cabecera | Contenido |
| --- | --- |
| `authorization` | `Bearer <JWT M2M>` — ver [M2M.md](./M2M.md) |
| `content-type` | `application/json` |
| `x-correlation-id` | UUID de la solicitud; cruza los logs de ambos lados |
| `idempotency-key` | Clave estable; **la misma en todos los reintentos** |
| `x-masteradmin-contract` | Versión del contrato (`v1`) |

Cuerpo — el **mismo para todos los productos**:

```json
{
  "tenantCode": "alpha-ewm",
  "tenantName": "Empresa Directa Alpha · EWM",
  "adminEmail": "admin@alpha.ebim.test",
  "tenantType": "PRODUCTION",
  "environment": "QAS",
  "deploymentMode": "SHARED",
  "organization": {
    "code": "empresa-directa-alpha",
    "legalName": "Empresa Directa Alpha S.A.C.",
    "displayName": "Empresa Directa Alpha",
    "countryCode": "PE",
    "taxId": "20500000004"
  },
  "company": { "code": "ALPHA-01", "name": "…", "countryCode": "PE", "currency": "PEN", "taxId": "…" },
  "plan": { "code": "ewm-standard", "name": "EWM Standard" },
  "masterAdmin": {
    "tenantId": "50000000-…",
    "productCode": "ewm",
    "requestId": "…",
    "correlationId": "…",
    "contractVersion": "v1"
  }
}
```

Un producto que necesite más datos los pide **al contrato**, no a MasterAdmin
conociendo sus tablas.

## 4. Respuesta

```json
{
  "status": "ACTIVE",
  "externalTenantId": "ewm-tenant-7",
  "externalOrganizationId": "ewm-org-3",
  "externalCompanyId": "ewm-co-9",
  "resources": { "initialWarehouseId": "WH-01" },
  "rawReference": "op-123"
}
```

Reglas, todas verificadas en `response.test.ts`:

- `status` sólo admite `ACTIVE` o `PENDING`. `PENDING` es legítimo para
  productos que crean el tenant de forma asíncrona; MasterAdmin **no** lo
  declara activo hasta confirmarlo.
- `externalTenantId` es **obligatorio**. Sin él no hay alta que registrar, y un
  200 sin identificador se rechaza con `PROVIDER_RESPONSE_INVALID` — la solicitud
  no pasa a ACTIVE.
- Se acepta texto o número: hay backends con identificadores numéricos y
  rechazarlos obligaría a cada producto a adaptarse a nosotros.
- `resources` se filtra a escalares no sensibles, con tope de 25 claves y 500
  caracteres. Objetos y arrays se descartan: sin contrato que los describa, no
  hay forma de saber qué llevan dentro.

**Un 200 no es un éxito: es un 200.** Sin esta validación, un producto que
respondiera `{"ok":true}` sin crear nada dejaría el mapeo vacío y nadie se
enteraría hasta que el cliente intentara entrar.

## 5. Los identificadores externos son del PRODUCTO

`external_tenant_id`, `external_organization_id` y `external_company_id` son
identificadores **del producto**, no identificadores universales EBIM.
MasterAdmin los guarda y los muestra; **no los interpreta**.

Aunque hoy EWM pueda derivarlos de MasterAdmin, el modelo se mantiene explícito:
el día que un producto genere los suyos, no cambia nada aquí.

## 6. Adaptadores implementados

| Tipo | Estado | Comportamiento |
| --- | --- | --- |
| `HTTP_M2M` | Implementado | Genérico. Todo lo que varía es configuración |
| `MANUAL` | Implementado | `provision()` **falla** pidiendo el registro manual |
| `MOCK` | Implementado, **sólo DEV** | Recorre el flujo sin abrir un socket |
| `EDGE_FUNCTION` | Reservado | Existe en el enum; lanza `ADAPTER_NOT_IMPLEMENTED` |
| `DB_DIRECT` | **Prohibido** | No existe en el enum, y un test lo verifica |

### Contratos (`product_integrations.adapter_key`)

Una integración `HTTP_M2M` habla **un** contrato, elegido por la columna enum
`adapter_key` (auditada por `upsert_product_integration`; valores libres
imposibles). El contrato decide sólo la **forma**: cuerpo, marcadores de ruta y
lectura de la respuesta. Transporte, guard SSRF, firma M2M y reintentos son
únicos y compartidos.

| `adapter_key` | Contrato | Capacidades | Quién lo usa |
| --- | --- | --- | --- |
| `GENERIC` (default) | Este documento, estándar EBIM v1 | `PROVISION` | Todas las integraciones existentes y futuras |
| `EWM_V1` | `WMS-by-EBIM` `API_CONTRACT.md` (`origin/qas` @ `7e45d70`) | `PROVISION`, `REPLAY_CERTIFICATION` y `GET_STATUS` si hay `status_path_template` y `read_scope` | Sólo `ewm-provisioning-v1` |

**EWM V1 no es el estándar de la suite. El estándar sigue siendo el contrato
genérico v1. Other SaaS: no changes required.** Toda fila previa a la migración
`20260921000100` quedó en `GENERIC`, y `upsert_product_integration` sin
`p_adapter_key` conserva el valor guardado.

Capacidades opcionales del orquestador:

| Acción | Qué hace | Permiso | Cambia estado |
| --- | --- | --- | --- |
| `GET_STATUS` | Consulta el tenant en el producto con `read_scope` y lo compara con el mapping | `can_read_saas_provisioning` (`platform.provisioning.read`) | No |
| `REPLAY_CERTIFICATION` | Repite el cuerpo aceptado con la misma `Idempotency-Key` y exige `200 replayed:true` | `can_certify_saas_provisioning` (`platform.provisioning.retry`, nunca PRD) | No |

La regla de capacidades vive en `platform.integration_capabilities` y se
contrasta en pruebas con la que declara cada codec compilado. Los datos propios
de un alta (p. ej. el almacén inicial de EWM) van en
`saas_provisioning_requests.product_configuration`, que sólo escribe
`set_saas_provisioning_configuration` antes del primer envío.

### MANUAL no finge

Su `provision()` devuelve `MANUAL_REGISTRATION_REQUIRED` y explica el camino
correcto. Un adaptador manual que devolviera «éxito» sin que nadie hubiera
creado nada sería exactamente la mentira que este subsistema existe para evitar.

El registro manual (`register_manual_provisioning`) recorre la máquina de
estados completa en vez de saltar a ACTIVE: el historial tiene que contar lo
mismo que el automático, marcado con `registered_manually = true`.

### MOCK sólo en DEV

Identificadores con prefijo `mock-`, para que una fuga a otro entorno salte a la
vista. Bloqueado en tres capas (trigger, precondiciones, registro).

## 7. Registro de adaptadores

La clave del registro es el **tipo de integración**, nunca el producto:

```ts
resolveAdapter(type, environment, deps, adapterKey = 'GENERIC')
```

`adapterKey` elige un codec de un registro **estático y compilado**
(`CONTRACT_CODECS`); nada que venga de la base se evalúa.

La alternativa —`if (product === 'EWM')` repartido por la aplicación— tiene un
coste conocido: con cinco productos son cinco ramas en doce archivos y ninguna
está entera en el mismo sitio.

## 8. EWM

EWM implementó y certificó **su propio** contrato antes de este estándar y no se
puede cambiar. Por eso existe el codec `EWM_V1`: sigue siendo el mismo
adaptador `HTTP_M2M` (mismo transporte, SSRF, firma y reintentos), con otra
forma de cuerpo y de respuesta. Todo lo específico de EWM vive en
`supabase/functions/_shared/provisioning/adapters/ewm-v1.ts` y, en la consola,
en `src/features/deployments/contractAdapters.ts`.

| Punto | EWM V1 |
| --- | --- |
| Alta | `POST /internal/platform/v1/tenants`, scope `ewm:tenant:create` |
| Consulta | `GET /internal/platform/v1/tenants/{controlPlaneTenantId}`, scope `ewm:tenant:read` |
| Firma | ES256, `iss masteradmin.ebim`, `aud ewm.ebim`, TTL ≤ 300 s |
| Identificador externo | `externalTenantId = companyId` (EWM declara que `company.id` es su `tenant_id`) |
| Replay | `200 replayed:true` es éxito; se registra `PROVIDER_REPLAYED` |
| Admin | Siempre `PREPROVISIONED`: la consola nunca lo muestra como activo |

Diseño completo: `docs/superpowers/specs/2026-09-21-ewm-masteradmin-adapter-design.md`.
Certificación QAS: [EWM_QAS_CERTIFICATION.md](./EWM_QAS_CERTIFICATION.md).
