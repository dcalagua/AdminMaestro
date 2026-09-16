# Seguridad del plano de provisioning

Este documento describe **lo que está implementado y verificado**, no
intenciones. Cada afirmación nombra dónde se comprueba.

## 1. El error que este diseño evita por construcción

En payments ocurrió una vez: se asumió que «si la consulta con RLS no devolvió
error, el usuario está autorizado». **RLS filtra FILAS.** Una lista vacía y una
prohibición se ven exactamente igual desde el cliente.

`provisioning-orchestrator` no repite ese patrón. El orden es:

1. validar el JWT;
2. resolver el usuario con ese JWT;
3. preguntar a la base un **booleano explícito**
   (`can_execute_saas_provisioning` / `can_check_deployment_health`);
4. **sólo entonces** construir el cliente `service_role`.

Verificado en `e2e/v4-provisioning-orchestrator.spec.ts` («autorización: el gate
va ANTES del privilegio»): sin token → 401; tenant admin con JWT válido → 403;
partner → 403; propietario de otro producto → 403.

## 2. Los secretos no están en la base, y no pueden estarlo

`credential_profiles.secret_ref` guarda un **nombre** (`EWM_QAS_M2M_PRIVATE_KEY`),
no un valor. La garantía no es una convención: es un CHECK.

```sql
constraint credential_profiles_secret_ref_ck check (
  secret_ref is null or platform.is_secret_reference(secret_ref)
)
-- is_secret_reference := p_value ~ '^[A-Z][A-Z0-9_]{2,63}$'
```

Un PEM, un JWT, una clave base64 o una `sk_live_…` llevan minúsculas, puntos o
guiones: **ninguno pasa**, ni siquiera ejecutado como superusuario
(`21_v4_provisioning_model.test.sql`).

Además, `secret_ref` y `public_key_ref` **no tienen GRANT de SELECT para
`authenticated`**. Es un privilegio de **columna**, no una política: aunque
mañana alguien escribiera una política permisiva, la columna seguiría cerrada.
El único camino es `platform.reveal_credential_secret_ref()`, que exige
`platform.credentials.manage` y **audita cada lectura**.

El valor real se resuelve en la Edge Function con `Deno.env.get(secret_ref)` y
no se guarda en ninguna estructura que pueda serializarse.

## 3. SSRF: el riesgo que introduce hacer `base_url` configurable

Permitir configurar la URL desde la consola convierte al orquestador en un
posible proxy hacia dentro de la red del servidor. El objetivo evidente es
`http://169.254.169.254/latest/meta-data/iam/security-credentials/`, que en AWS,
Azure y GCP devuelve credenciales de la instancia.

Tres capas, y ninguna es redundante:

| Capa | Dónde | Qué añade |
| --- | --- | --- |
| CHECK de la base | `is_valid_provisioning_base_url()` | Ninguna interfaz puede guardar una URL inadmisible |
| Guard del orquestador | `url-guard.ts` | Revalida **en el momento de la llamada**, con el mismo parser que ejecuta el `fetch` |
| Redirecciones | `assertSafeRedirect()` + `redirect: 'manual'` | El CHECK no ve los saltos: ocurren después |

Bloqueado: esquemas distintos de http/https, credenciales embebidas, query,
fragmento, espacios y caracteres de control, barra final, loopback, link-local,
alias DNS de metadatos, RFC1918, CGNAT y dominios `.internal`/`.local`. En
DEMO/QAS/PRD se exige además HTTPS y host público; DEV es el único que admite
`http://127.0.0.1`.

La plantilla de ruta se valida por separado y el resultado **compuesto** se
comprueba contra el origen y el prefijo de la base: un identificador externo con
`/` se codifica por segmento y no puede inyectar ruta.

60 pruebas en `url-guard.test.ts`, 21 en el pgTAP del modelo.

## 4. El token M2M

Asimétrico y de vida corta. El enum `platform.m2m_algorithm` contiene
exactamente `RS256` y `ES256`; `none` y HS256 **no existen** en el modelo, y no
es un descuido: con un secreto compartido, quien puede verificar puede también
**emitir** tokens en nombre de MasterAdmin, y la auditoría deja de significar
nada.

- `sub` = el **sistema** (`masteradmin-provisioning`), nunca el correo de una
  persona. El humano viaja en `actor_id`, que es **auditoría y no autoriza**.
- `exp − iat` ≤ 300 s, con techo aplicado en el código además del CHECK.
- `jti` único por emisión.
- `scope` obligatorio: el orquestador se niega a firmar un token sin alcance.
- `aud` sin valor por defecto: cada producto declara la suya.

30 pruebas en `m2m.test.ts`, incluida la firma real con claves **generadas en
memoria** — en el repositorio no hay ninguna clave privada, y el escáner de
secretos lo verifica en cada ejecución.

## 5. Reintentos

Se reintentan timeouts, caídas de red y 408/425/429/5xx. **No** se reintentan
400, 401, 403, 404, 409, 410 ni 422.

El 409 es el importante: significa que el tenant **ya existe** al otro lado.
Insistir no lo arregla y es justo el caso en que alguien tiene que mirar.

Todos los reintentos llevan la **misma** `Idempotency-Key`: para el producto son
el mismo intento, no altas distintas. Un trigger impide siquiera modificar la
clave de una solicitud viva.

## 6. Qué no sale nunca hacia el frontend

El cuerpo crudo de la respuesta del producto no se guarda ni se devuelve. Se
extrae un código estable, un estado HTTP y un mensaje **saneado y truncado**
(`errors.ts`): se redactan JWT, cabeceras `Authorization`, bloques PEM, cadenas
de conexión, trazas de pila y rutas de código del servidor remoto.

Así la consola puede decir `ADMIN_EMAIL_ALREADY_PROVISIONED` —accionable— sin
que aparezca el nombre de una tabla de EWM.

`resources` se filtra a escalares no sensibles, con tope de claves y longitud, y
la base aplica encima su guard anti-secretos sobre el JSONB.

## 7. Guard de ambiente

El adaptador MOCK **falla cerrado** fuera de DEV, en tres sitios: el trigger de
coherencia del destino, las precondiciones de la base y el propio registro de
adaptadores (que ni siquiera lo instancia). Las tres protegen del mismo
desastre: un MOCK activo en QAS o PRD declararía `ACTIVE` un tenant que no
existe en ninguna parte, y nadie lo descubriría hasta que el cliente intentara
entrar.

## 8. Escritura

Ninguna tabla nueva concede INSERT/UPDATE/DELETE a `authenticated`. Toda
escritura pasa por RPC `SECURITY DEFINER` con `search_path` fijo que autoriza en
su primera línea. Un INSERT directo desde el navegador se saltaría la resolución
de destino, la idempotencia, la política y la auditoría — es decir, todo lo que
hace correcto al subsistema.

Tampoco hay DELETE físico: un trigger lo bloquea incluso para `service_role`.
El historial de provisioning es evidencia.

## 9. Auditoría

Cada operación registra actor, rol del actor, tenant, producto, destino,
integración, solicitud, `correlation_id`, `idempotency_key`, acción, estado y
momento. Los cambios de configuración guardan antes, después y campos
modificados.

Lo que **no** entra en la bitácora: claves, tokens, cabeceras de autorización y
—deliberadamente— ni siquiera el **nombre** del secreto al crear un perfil,
porque `audit_logs` tiene lectura más amplia que `credential_profiles`.
Verificado en `22_v4_provisioning_rbac.test.sql`.

## 10. El escáner de secretos

`npm run secrets:scan` se endureció en esta fase: ahora recorre **todas** las
coincidencias de cada patrón, no sólo la primera —lo que destapó tres hallazgos
que antes quedaban ocultos tras el primero del mismo fichero— y las exenciones
son **por línea y con motivo escrito** (`secrets-scan:allow <motivo>`), en vez
de una lista de ficheros exentos donde cualquiera podría esconder una clave
real. El resumen las cuenta en cada ejecución para que no crezcan en silencio.
