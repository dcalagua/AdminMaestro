# EBIM Control Plane - Pack de Prompts Nocturnos

## Objetivo

Construir desde una carpeta vacía una primera base funcional y gestionable de **EBIM Control Plane**, usando **React + TypeScript + Supabase**, para administrar de forma centralizada múltiples productos SaaS de EBIM, sus organizaciones, partners/resellers, clientes/tenants, comerciales, licencias, costos, comisiones, despliegues, accesos y auditoría.

La base debe quedar preparada inicialmente para administrar, como mínimo:

- eSupplier
- EWM by EBIM
- TMS
- GMAO
- eChange
- Futuros SaaS mediante catálogo configurable, sin hardcodear el core para un solo producto.

## Path obligatorio en macOS

```text
/Users/edudavidmorenoccama/Library/CloudStorage/GoogleDrive-gep.soporteit@gmail.com/My Drive/EBIM-Plataforma
```

Claude puede **leer** lineamientos y convenciones existentes dentro de ese path (por ejemplo `CLAUDE.md`, `.claude/`, `README*`, `AGENTS.md`, `CONTRIBUTING.md`, `.editorconfig`), pero debe **modificar únicamente la carpeta del nuevo proyecto**.

## Forma recomendada de uso nocturno

1. Crea una carpeta vacía para el nuevo proyecto dentro del path anterior, por ejemplo:

```text
.../EBIM-Plataforma/EBIM-Control-Plane
```

2. Abre Claude Code/Claude CLI dentro de esa carpeta.
3. Pega completo el contenido de `01_PROMPT_MAESTRO_AUTONOMO.md`.
4. Déjalo ejecutar.
5. Si la sesión se corta o compacta contexto, usa `14_PROMPT_SUPERVISOR_RECUPERACION.md`.
6. Por la mañana, ejecuta `15_PROMPT_CERTIFICACION_FINAL.md`.

## Archivos del pack

- `01_PROMPT_MAESTRO_AUTONOMO.md`: ejecución completa nocturna.
- `02_PROMPT_GUARDRAILS_DISCOVERY.md`: límites de filesystem, convenciones EBIM y preparación.
- `03_PROMPT_BOOTSTRAP_REACT_SUPABASE.md`: creación del proyecto base.
- `04_PROMPT_MODELO_CONTROL_PLANE.md`: esquema central multi-SaaS/multi-organización/multi-tenant.
- `05_PROMPT_AUTH_RBAC_RLS.md`: Auth, permisos y aislamiento.
- `06_PROMPT_PARTNERS_MULTI_SAAS_TENANTS.md`: partners/resellers y tenants por producto.
- `07_PROMPT_COMERCIAL_COMISIONES_LICENCIAS.md`: comerciales, atribución, licencias y comisiones.
- `08_PROMPT_COSTOS_FACTURACION_MARGEN.md`: costos, facturación gerencial y rentabilidad.
- `09_PROMPT_DEPLOYMENTS_PROVISIONING.md`: Shared / Partner Dedicated / Tenant Dedicated.
- `10_PROMPT_UI_ADMIN_REACT.md`: consola administrativa React.
- `11_PROMPT_SEEDS_ESCENARIOS_DEMO.md`: datos demo realistas para validar el modelo.
- `12_PROMPT_TESTS_SEGURIDAD_CALIDAD.md`: gates técnicos y seguridad.
- `13_PROMPT_DOCUMENTACION_HANDOFF.md`: documentación y cierre de la noche.
- `14_PROMPT_SUPERVISOR_RECUPERACION.md`: recuperación autónoma si algo falla o la sesión se interrumpe.
- `15_PROMPT_CERTIFICACION_FINAL.md`: auditoría final de mañana.
- `16_DEFINITION_OF_DONE.md`: criterio objetivo de completitud.

## Principios arquitectónicos no negociables

1. **Organization no significa base de datos.**
2. **Tenant no significa base de datos.**
3. El Control Plane no almacena los datos operativos sensibles de eSupplier/EWM/TMS/etc.; administra metadatos, acceso, suscripciones, costos, canales y despliegues.
4. Una misma organización/partner puede comercializar varios SaaS.
5. Un cliente final puede tener uno o varios tenants, incluso en distintos SaaS.
6. Un comercial puede atribuirse a una venta sin tener acceso a datos operativos del tenant.
7. La infraestructura física se decide mediante `deployment_mode`:
   - `SHARED`
   - `PARTNER_DEDICATED`
   - `TENANT_DEDICATED`
8. Los partners y comerciales **no reciben service_role, credenciales de DB ni acceso directo a Supabase**.
9. Toda tabla expuesta debe tener permisos mínimos y RLS adecuado.
10. Ningún secreto debe quedar versionado.
11. Durante la ejecución nocturna no se toca producción.

## Resultado esperado al amanecer

No se busca sólo una maqueta. Debe quedar una base que pueda levantarse localmente, resetear su BD desde migraciones, cargar datos demo, autenticar usuarios de prueba, navegar módulos administrativos, respetar permisos y pasar un conjunto explícito de pruebas/gates.
