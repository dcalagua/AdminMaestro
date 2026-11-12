# Glosario de negocio · Admin Maestro V5

Versión 1.0 · 2026-11-12 · Fase F1 del plan `PLAN_MEJORA_UI_UX_V5.md` (§3.4 y §5).
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
  que se sumen en fases siguientes.

## 4. Cómo se vigila

`src/lib/glossary.test.ts` recorre con el compilador de TypeScript todos los `.tsx`/`.ts` de `src/` (salvo la galería de
componentes y los tests) y extrae los textos visibles: texto JSX, props de texto (`title`, `description`, `label`,
`placeholder`, `hint`, `message`, `aria-label`…), propiedades de texto en objetos de configuración, mensajes de toast y de
validación, diccionarios de etiquetas y tablas de pares. Falla si alguno contiene un término de la lista negra
(`FORBIDDEN_UI_TERMS`) o un nombre de objeto de la base (`SQL_OBJECT_NAME`). El `title` de un elemento HTML (tooltip) y la
prop `source` de los gráficos quedan fuera a propósito.

Al agregar una pantalla, usa `term()` de `src/lib/glossary.ts` cuando el texto se arme en código, o escribe el término de
negocio directamente; nunca el técnico.
