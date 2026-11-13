# Glosario de negocio · Admin Maestro V6

Versión 2.0 · 2026-11-13 · Fase F1 del plan `PLAN_MEJORA_UI_UX_V6.md` (T7). Sustituye a `GLOSARIO_V5.md`
(versión 1.0, plan V5 §3.4 y §5), que queda como histórico.
Fuente en código: `src/lib/glossary.ts`. Guardia: `src/lib/glossary.test.ts`.

La UI de negocio habla el idioma del trabajo, no el de la base de datos ni el de los contratos técnicos.
Cada término técnico tiene **una** traducción, y se usa siempre la misma en menús, títulos, botones, estados vacíos, avisos y toasts.

## 1. Términos

| Término técnico | En la UI | Uso |
|---|---|---|
| `DRY_RUN` | **Simulación** | Modo en que la orden se registra sin llamar a la app. «En simulación», «se envía en simulación». El modo real se dice «Real». |
| Provisioning | **Alta en la app** (plural: **Altas en las apps**) | Crear el espacio del cliente en una app de la suite. Derivados: «política de altas», «altas habilitadas», «rol de altas». La cola de infraestructura física se llama «Solicitudes de infraestructura». |
| Entitlements | **Módulos habilitados** | Lo que el plan y los add-ons le permiten usar al cliente en una app. Un elemento suelto: «módulo habilitado». |
| Cutover | **Migración de cobro** | El paso a paso con el que una app deja de cobrar por su cuenta y pasa a cobrar desde el Admin Maestro. En el eje de módulos: «migración de módulos habilitados». |
| Slug | **Código** | Identificador corto en minúsculas y guiones que aparece en enlaces y URLs. |
| Shadow | **Comparación** | Etapa en que el cobro nuevo se calcula en paralelo y se compara con el de la app, sin cobrar. La pantalla es «Comparación de cobro». |
| M2M | **Conexión segura** | La conexión firmada servidor a servidor entre el Admin Maestro y cada app. «Perfil de conexión segura», «JWT asimétrico (conexión segura)». |
| Tenant | **Tenant** (se mantiene) | Decisión pendiente del dueño. En textos largos, «espacio del cliente en la app» cuando ayude a entender. |

### 1.1 Términos nuevos de la V6

| Término técnico | En la UI | Uso |
|---|---|---|
| MasterAdmin, Control Plane | **Admin Maestro** | El nombre del producto. «en el Admin Maestro», «al Admin Maestro». |
| Legacy (etapa de migración) | **La app manda** (módulos) · **Cobra la app** (cobro) | Primera etapa: la app decide sola. «(legacy)» en un catálogo: «(anterior)». |
| Shadow (etapa) | **En comparación** | El Admin Maestro calcula en paralelo y se compara, sin cambiar nada. |
| Dual read | **Doble control** | La app lee ambos orígenes y avisa si no coinciden. |
| MasterAdmin primary | **Manda el Admin Maestro** · **Cobra el Admin Maestro** | El Admin Maestro decide; la app aplica. |
| Legacy retired | **Migración completa** | La app ya no tiene su propio origen. |
| Biller (local) | **la app cobra / cobro de la app** | Solo en Configuración › Avanzado se admite «biller local». |
| Target, deployment target | **Destino** (de despliegue) | «Nuevo destino», «destino dedicado», «destino compartido». |
| Deployments | **Destinos** / **Entornos y despliegues** | Pestaña de la ficha de producto: «Destinos». |
| Webhook | **Aviso del proveedor** | «Avisos del proveedor rechazados», «Últimos avisos del proveedor». |
| Ledger | **Movimientos** / **registro** | «Calculado de los movimientos», «Registro sin duplicados». |
| Pool (de créditos) | **Bolsa** | «Bolsa del tenant», «Bolsa del producto». |
| Scope | **Permiso** | «Permiso de creación», «Permiso de consulta». El valor (`provisioning:tenant:create`) se muestra tal cual en `font-mono`. |
| Ingest (de uso) | **Conexión de uso** | «Encender conexión de uso», «Credenciales de la conexión de uso». |
| GET (lectura de confirmación) | **Confirmado por la app** | «Confirmado: hace 2 h». |
| Checksum | **Contenido** | «Contenido distinto». |
| Lockup | **Nombre con marca** | «eChange by EBIM». |
| One-time | **Cobro único** | «Cobros únicos». |
| Jobs | **Tareas programadas** | «Política y tareas programadas». |
| Auth | **Inicio de sesión** | «Inicio de sesión bloqueado». |
| «(D-06)», «hasta D-12», «(K05)» | (nada) | Las referencias a decisiones o KPI internos no se muestran; si hace falta, se explica la condición con palabras. |

## 2. Qué no se muestra en la UI de negocio

- Nombres de vistas, tablas o RPC (`executive_mrr_series`, `v_subscription_mrr`, `platform.invoice_summary`…).
  El pie de los gráficos ya no dice «Fuente: …»: la fuente técnica queda en el tooltip de un icono (`SourceHint`).
- Referencias a documentos internos: «contrato §4.4», «spec §12.7», «regla §2.3», «runbook … §2».
- Códigos de orden y de estado crudos en frases (`SUSPEND_TENANT`, `BILLING_SHADOW`): se dicen con palabras
  («la orden de suspensión a la app», «etapa de comparación»).

Los códigos que la persona debe **escribir tal cual** (nombres de secretos como `EWM_QAS_M2M_PRIVATE_KEY`, scopes como
`provisioning:tenant:create`, ejemplos de código) sí pueden aparecer, en `font-mono`, porque son datos y no vocabulario.

## 3. Dónde vive lo técnico

- **Tooltip** (atributo `title` de un elemento HTML): la fuente técnica de un gráfico, el estado crudo de una etapa.
- **Configuración › Avanzado** (sólo super admin): la comparación de cobro (antes «Billing shadow») y las opciones técnicas
  que se sumen en fases siguientes. La guardia no revisa `src/features/billing/shadow/` (V6): allí lo técnico está permitido,
  aunque con mayúsculas y frases de negocio.

## 4. Cómo se vigila

`src/lib/glossary.test.ts` recorre con el compilador de TypeScript todos los `.tsx`/`.ts` de `src/` (salvo la galería de
componentes y los tests) y extrae los textos visibles: texto JSX, props de texto (`title`, `description`, `label`,
`placeholder`, `hint`, `message`, `aria-label`…, y desde la V6 también `info`, `footer`, `context` y `emptyLabel` de los
KPI), propiedades de texto en objetos de configuración, mensajes de toast y de
validación, diccionarios de etiquetas y tablas de pares. Falla si alguno contiene un término de la lista negra
(`FORBIDDEN_UI_TERMS`) o un nombre de objeto de la base (`SQL_OBJECT_NAME`). El `title` de un elemento HTML (tooltip) y la
prop `source` de los gráficos quedan fuera a propósito.

Al agregar una pantalla, usa `term()` de `src/lib/glossary.ts` cuando el texto se arme en código, o escribe el término de
negocio directamente; nunca el técnico.
