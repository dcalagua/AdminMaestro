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
resolveAdapter(type, environment, deps)
```

La alternativa —`if (product === 'EWM')` repartido por la aplicación— tiene un
coste conocido: con cinco productos son cinco ramas en doce archivos y ninguna
está entera en el mismo sitio.

## 8. EWM

**No hay adaptador específico de EWM, y no debería haberlo.** El adaptador
`HTTP_M2M` genérico cubre el contrato; EWM se conecta rellenando configuración
desde la consola.

Sólo se escribiría un adaptador propio si el contrato final de EWM exigiera
semántica que el genérico no puede expresar. Hasta entonces, crearlo sería
código específico de producto en un Control Plane que existe justamente para no
tenerlo.

El seed trae `ewm-provisioning-v1` como **borrador deshabilitado** con la forma
propuesta (audience `ewm.ebim`, RS256, TTL 300, `/internal/platform/v1/tenants`).
Cuando el contrato se confirme, se completa desde la UI: ni SQL, ni despliegue.
