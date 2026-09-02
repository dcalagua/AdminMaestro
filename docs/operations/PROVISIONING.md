# Provisioning

## 1. Postura por defecto: DRY_RUN

```
PROVISIONING_MODE=DRY_RUN
```

Durante esta implementación **no se ha ejecutado ninguna llamada remota real**.
El `DryRunProvider` simula la operación completa: produce el mismo timeline y el
mismo shape de resultado que produciría el proveedor real, sin red de por medio.

Eso permite ejercitar y probar toda la máquina de estados sin tocar
infraestructura ni arriesgar un proyecto creado por accidente.

## 2. Máquina de estados

```
PENDING ──▶ VALIDATING ──▶ RUNNING ──▶ SUCCEEDED   (terminal)
   │            │             │
   │            │             └──────▶ FAILED ──▶ PENDING   (si quedan intentos)
   │            └────────────────────▶ FAILED
   └──────────────────────────────────▶ CANCELLED  (terminal)
```

El trigger `enforce_provisioning_transition` rechaza cualquier transición fuera
de este grafo con `TRANSICION_INVALIDA`. No se puede volver de `SUCCEEDED` a
`RUNNING`, ni saltar de `PENDING` a `SUCCEEDED` sin haberse ejecutado.

Un `FAILED` sólo vuelve a `PENDING` si `attempts < max_attempts`.

## 3. Idempotencia

`provisioning_requests.idempotency_key` es **único**. Reintentar una solicitud no
duplica el trabajo, y el worker se niega a reprocesar una solicitud terminal:

- `SUCCEEDED` → reprocesar duplicaría infraestructura;
- `CANCELLED` → reprocesar revive algo que alguien decidió detener.

## 4. Sin secretos en las tablas

Ni `provisioning_requests.payload` ni `provisioning_events.detail` ni
`deployment_targets.metadata` pueden contener credenciales. El trigger
`reject_secret_like_json` inspecciona las claves del JSONB y rechaza las que
contengan `password`, `secret`, `service_role`, `api_key`, `token`, `pat`,
`private_key`, `connection_string`, `dsn`, `jwt_secret`.

Un CHECK sobre JSONB no puede recorrer claves; un trigger sí, y cuesta poco.

## 5. La abstracción de proveedor

`supabase/functions/provisioning-worker/provider.ts`:

```ts
interface ProvisioningProvider {
  readonly name: string;
  readonly mode: 'DRY_RUN' | 'LIVE';
  execute(input: ProvisioningInput): Promise<ProvisioningOutcome>;
}
```

La lógica de dominio no menciona "Supabase": habla de un `ProvisioningProvider`.
Añadir AWS o Azure mañana es implementar esta interfaz, no reescribir la máquina
de estados.

| Implementación | Estado |
|---|---|
| `DryRunProvider` | **Activa.** Simula y devuelve el plan de lo que haría. |
| `SupabaseManagementProvider` | **Esqueleto.** Exige `SUPABASE_MANAGEMENT_TOKEN` en el constructor y falla ruidosamente si falta. Su `execute()` rechaza con `MODO_LIVE_NO_HABILITADO`. |

El esqueleto falla en el constructor a propósito: deja explícito **dónde** se
integra el token mañana, en vez de un `TODO` que alguien complete pasándolo
desde el frontend.

## 6. Dónde vive el token de la Management API

| Lugar | ¿Puede tener el token? |
|---|---|
| Edge Function secrets (`supabase secrets set`) | **Sí.** Es el único lugar. |
| `.env.local` del desarrollador | No para el cliente — sin prefijo `VITE_`, no llega al bundle. |
| Repositorio | **Nunca.** `secrets:scan` lo detecta. |
| Tablas de la aplicación | **Nunca.** El trigger anti-secretos lo rechaza. |
| Navegador / bundle | **Nunca.** No lleva prefijo `VITE_`; hay un test E2E que lo verifica en el bundle servido. |
| Google Drive / buzón de coordinación | **Nunca** (contrato §2.6: son legibles por cualquiera con acceso a la carpeta). |

## 7. Camino a LIVE (cuando el operador lo autorice)

1. Autorización **explícita** del operador para el proyecto y el entorno.
2. `supabase secrets set SUPABASE_MANAGEMENT_TOKEN=…` en el proyecto destino.
3. `supabase secrets set PROVISIONING_MODE=LIVE`.
4. Implementar `SupabaseManagementProvider.execute()`:
   - usar el token **sólo** en la cabecera `Authorization`;
   - **sanitizar** la respuesta antes de escribirla en `provisioning_events`:
     nunca volcar el cuerpo crudo del proveedor;
   - respetar la clave de idempotencia para no duplicar proyectos;
   - registrar cada paso en el timeline, no sólo el resultado final.
5. Crear la solicitud con `mode = 'LIVE'` **explícitamente**. El worker rechaza
   procesar una solicitud `DRY_RUN` aunque él esté en LIVE
   (`MODO_INCOMPATIBLE`): un worker no debe "promover" en silencio lo que
   alguien creó como simulación.
6. Empezar por un entorno DEV con `EBIM_ALLOW_REMOTE_DEV=true`.

> Nunca `supabase db reset --linked` ni wipes remotos, ni siquiera con
> `EBIM_ALLOW_REMOTE_DEV=true`.

## 8. UI

`/provisioning` muestra la cola con tabs de estado (Todas / En cola / Fallidas /
Completadas), el badge de modo, el contador de intentos y el timeline expandible
por solicitud, con el `error_message` sanitizado cuando falló. El botón de
reintento aparece sólo si quedan intentos disponibles y pide confirmación.

`/deployments` lista los targets agrupando los tenants que aloja cada uno — es
donde se ve de un vistazo la diferencia entre compartido y dedicado.
