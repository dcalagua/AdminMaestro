# Guía de demo (10 minutos) — MasterAdmin experiencia ejecutiva

Entorno: stack LOCAL dedicado (`supabase start --workdir .runtime`, API 127.0.0.1:55421) con
`supabase/fixtures/executive-demo.sql` aplicado; frontend `npx vite --port 5209`. Datos sintéticos
(prefijo `DEMO-EXEC`, usuarios `@ebim.test` del seed). **No es facturación real ni QAS.**

| Min | Pantalla | Qué mostrar | Qué decir |
|---|---|---|---|
| 0–2 | `/` Resumen ejecutivo | Barra de contexto (período, fecha FX, foto actual). Seis KPI. | «MRR, saldo y antigüedad son foto de hoy; cobrado y margen son del período. Cambiar la fecha FX no mueve el período. Nunca se suman monedas.» |
| 2–3 | K04 → `/billing?estado=OPEN&antiguedad=VENCIDA` | Clic en «Ver vencidas». Chip de filtro, nota «Resumen y tabla cubren las mismas N facturas», >200 filas paginadas, export. | «El total sale del servidor sobre todo el universo autorizado; la tabla es una página del mismo universo.» |
| 3–4 | `/#finanzas` | Antigüedad (G03), componentes del margen por SaaS (G04, «No asignado / plataforma»), canal (G05), cobertura FX. | «Margen gerencial = cobrado − costo − comisión; no es utilidad contable. Si falta una tasa, el consolidado no se calcula.» |
| 4–5 | `/#operacion` | Matriz producto × entorno: destinos «No evaluado», salud «observado <fecha>». | «Nada llama a los proveedores al abrir la vista; una observación no es uptime; no afirmamos certificación sin fuente.» |
| 5–7 | Cliente 360 `/organizations/30000000-0000-4000-a000-000000000004` | Vista 360 (métodos de cobro distintos), Productos y contratos, Cobros y saldo, Documentos (referencia, no archivo), Tenants y acceso. | «Cada sección consulta sólo esta organización y muestra su propio error; un fallo no se ve como “sin movimientos”.» |
| 7–8 | Tenant 360 `/tenants/5e000000-0000-4000-a000-00000000e001` | Cuatro dimensiones: comercial PENDING, alta ACTIVE + mapping activo, salud observada, admin PREPROVISIONED; MRR «Sin recurrente vigente». | «Conviven sin un semáforo global; preaprovisionado no significa que el admin ya pueda entrar.» |
| 8–9 | `/onboarding` (opcional) | Cinco pasos; al crear, el Tenant 360 muestra «siguientes pasos». | «Cerrar la venta no ejecuta el alta SaaS; los enlaces no provisionan nada.» |
| 9–10 | `/audit` y Configuración | Bitácora paginada con detalle controlado; apariencia por usuario y persistencia declarada. | «JSON sólo en detalle y con claves sensibles ocultas.» |

Perfiles alternativos (contraseña local de demo del seed): `admin@andina.ebim.test` (partner: sólo su
cartera, sin costos), `ewm.owner@ebim.test` (técnico: sólo Operación SaaS, sin finanzas),
`comercial@indep.ebim.test` (comercial: sus atribuciones y comisiones).
