# DECISIONS V2

Decisiones aprobadas antes de implementación:

1. El Control Plane administra toda la suite EBIM, no solo eSupplier.
2. Organización/Partner/Tenant son conceptos de negocio, no equivalen automáticamente a base de datos.
3. Deployment modes: SHARED, PARTNER_DEDICATED, TENANT_DEDICATED.
4. Shared admite Partners/Empresas con múltiples tenants.
5. Cada tenant productivo tiene licencia; DEMO no recurrente.
6. Implementation/onboarding es cobrable one-time.
7. Partner Dedicated = licencia base Partner + N licencias tenant + infra dedicada + implementación opcional.
8. Tenant Dedicated = licencia Enterprise + infra dedicada + implementación + soporte/SLA opcional.
9. Cobranza se configura por subscription/producto.
10. Culqi es primer provider, pero el dominio queda desacoplado.
11. OS/OC de cliente es documento comercial, no Culqi Order y no payment.
12. Comisión nace de cobro CONFIRMED.
13. EBIM conserva gobierno de infraestructura y secretos.
14. Culqi live no se activa sin configuración y autorización explícita.


---

## Decisiones tomadas durante la ejecución V2

### DV2-001 · 2026-09-07 · Escritura sensible = RPC, no GRANT
**Contexto:** el baseline REVOCA explícitamente INSERT/UPDATE/DELETE a `authenticated` sobre
`plans`, `plan_prices`, `subscriptions`, `subscription_items`, `invoices`, `invoice_lines`,
`payments`, `sales_agents`, `sales_attributions`, `commission_*`, `deployment_targets`,
`provisioning_*` y `audit_logs`.
**Decisión:** V2 **no abre** esos GRANTs. Toda escritura pasa por RPC `SECURITY DEFINER` con
`search_path` fijo, autorización explícita al inicio del cuerpo y `platform.log_audit()`.
**Consecuencia:** más código SQL, pero la autoridad sigue siendo la base y ocultar un botón
nunca es la protección. Coherente con la regla 9 del contrato de ejecución y con C-13/S-05.

### DV2-002 · 2026-09-07 · Corrección del gate `typecheck`/`build`
**Contexto:** `npm run build` fallaba (`vite.config.ts` TS2769) y `npm run typecheck` era un
script inválido que tapaba su propio error con un `||`, dejando `tsconfig.node.json` sin
comprobar nunca.
**Decisión:** `vite.config.ts` importa `defineConfig` de `vitest/config`; `typecheck` comprueba
los dos proyectos por separado y `build` depende de `typecheck`.
**Consecuencia:** el gate vuelve a detectar regresiones en los archivos de configuración.
Detalle y evidencia en `docs/nightly-v2/AUDIT_BASELINE.md` §5.

### DV2-003 · 2026-09-07 · GUIDELINES_ROOT inaccesible → snapshot local
**Contexto:** BE-01, la ruta de Drive no es enumerable desde esta sesión.
**Decisión:** usar `docs/architecture/EBIM_CONVENTIONS.md` como fuente de convenciones, sin
inventar ninguna nueva, tal y como autoriza `00_START_HERE_VSCODE.md`.
**Consecuencia:** las convenciones C-*/S-*/U-*/P-* citadas en ese snapshot son vinculantes
para V2. Si en el futuro GUIDELINES_ROOT vuelve a ser legible, hay que re-contrastar.

### DV2-004 · 2026-09-07 · Reverso de comisión por CONTRA-EVENTO
**Contexto:** un cobro revertido tiene que deshacer su comisión sin falsear el pasado.
**Alternativas:** (a) borrar los eventos — destruye la historia; (b) marcarlos VOID —
reescribe un periodo ya liquidado y pagado.
**Decisión:** contra-evento con importe negativo que apunta al original.
**Consecuencias:** el original queda intacto y **todas las sumas existentes siguen
siendo correctas sin tocarlas** (`sum(amount)` netea solo). El CHECK de importe pasa
a ser MÁS estricto: devengo >= 0, reverso <= 0.

### DV2-005 · 2026-09-07 · No se inventa firma de webhook para Culqi
**Contexto:** la documentación oficial de Culqi, consultada el 2026-09-07, no describe
ninguna firma criptográfica ni cabecera HMAC para verificar un webhook.
**Decisión:** NO inventar una. Se documenta la limitación y se compensa con idempotencia
dura, validación estricta del payload, verificación server-to-server del cargo y
correlación obligatoria con una suscripción existente.
**Consecuencias:** el endpoint es público y no escribe nada directamente: todo pasa por
`register_provider_payment()`. En PRD conviene restringir por IP de origen.

### DV2-006 · 2026-09-07 · La URL base de la API de Culqi no se asume
**Contexto:** `apidocs.culqi.com` no devolvió contenido legible desde esta sesión.
**Decisión:** la URL base es configuración (`CULQI_API_BASE`) y su ausencia degrada a
MOCK. En LIVE, en cambio, falla ruidosamente: nunca se degrada en silencio.
**Consecuencias:** hay que confirmarla antes de activar producción (checklist §10).

### DV2-007 · 2026-09-07 · Límites del acuerdo de canal con defaults PERMISIVOS
**Contexto:** `allowed_deployment_modes` y `allowed_tenant_types` son columnas nuevas
sobre una tabla con datos.
**Decisión:** defaults permisivos. Una columna nueva no puede prohibir retroactivamente
lo que el sistema ya permitía; poner `{SHARED}` habría invalidado de golpe los tenants
PARTNER_DEDICATED que el seed ya tenía.
**Consecuencias:** la restricción es OPT-IN, y el guard solo actúa cuando alguien acota
el acuerdo a propósito.

### DV2-008 · 2026-09-07 · Puerto de desarrollo 5199 con strictPort
**Contexto:** el 5173 lo ocupa de forma permanente el dev server de otro proyecto de la
máquina, y `reuseExistingServer: true` hizo que la suite E2E se ejecutara entera contra
esa otra aplicación.
**Decisión:** mover NUESTRO puerto (mismo criterio que el blocker B-01 del baseline),
`strictPort: true` para fallar en vez de saltar en silencio, y `reuseExistingServer: false`.
**Consecuencias:** ante un puerto ocupado se prefiere fallar a certificar la aplicación
equivocada.

### DV2-009 · 2026-09-07 · Nunca ejecutar `tsc` sin `--noEmit`
**Contexto:** el typecheck roto del baseline emitió 53 archivos `.js` dentro de `src/` y
junto a los configs de la raíz. Vite y Playwright resuelven `.js` ANTES que `.ts`, así
que el bundle y la configuración quedaron congelados sin dar ningún error.
**Decisión:** los scripts comprueban con `--noEmit`, `.gitignore` bloquea esos artefactos
y el README lo advierte.
**Consecuencias:** un `tsc` mal invocado ya no puede congelar la aplicación en silencio.
