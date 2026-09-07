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
