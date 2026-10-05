# MasterAdmin V4 — Experiencia visual para Gerencia (corrida nocturna)

**Objetivo:** que el Admin Maestro se vea elegante, profesional y con impacto al presentarlo a Gerencia, con un
**Resumen Ejecutivo** de gráficos representativos del negocio, y sumar dos módulos que el tablero necesita.

**Dónde corre:** rama `feature/masteradmin-visual-gerencia` en el worktree `.worktrees/visual-gerencia`, contra el
**Supabase local** (`ebim-control-plane`). No hay push, no toca la nube (AdminMaestro), QAS ni PRD.

---

## Cómo arrancar (desde una terminal normal, NO dentro de una sesión de Claude)

```bash
cd /Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin
# 1. Docker Desktop abierto y la Mac enchufada a la corriente.
# 2. Lanzar la noche (caffeinate evita que la Mac duerma):
bash .claude-prompts-v4-visual-gerencia/RUN_NOCHE.sh
```

**Ver avance:**
- `tail -f .claude-prompts-v4-visual-gerencia/logs/runner.log`
- `cat .claude-prompts-v4-visual-gerencia/STATE.md`

**Reanudar** (si se cortó): vuelve a ejecutar el mismo comando; salta las fases marcadas `DONE`.

**Correr solo una fase:** `bash .claude-prompts-v4-visual-gerencia/RUN_NOCHE.sh 09_DASHBOARD_EJECUTIVO`

**Detener:** `Ctrl+C` en la terminal del runner. El estado queda en `STATE.md`.

## Qué revisar en la mañana

1. **Informe final:** `docs/superpowers/evidence/visual-gerencia/FINAL_REPORT.md` (en el worktree), con las
   capturas antes/después de cada pantalla en `docs/superpowers/evidence/visual-gerencia/capturas/`.
2. **La app con los datos de demostración:**
   ```bash
   cd .worktrees/visual-gerencia && npm run dev   # http://127.0.0.1:5199
   ```
   Entrar como `dcalagua@ebim.pe` o `finance@ebim.test` (contraseña local del seed: ver `e2e/fixtures.ts`).
   `/?presentacion=1` abre el **modo presentación** del Resumen Ejecutivo.
3. Si te gusta: le pides a Claude «sube la rama y mergea a dev con gh» (y luego, con tu aprobación, desplegar).

---

## Plan de fases (en orden de valor: si la noche se corta, lo más visible ya quedó)

| # | Fase | Resultado visible |
|---|---|---|
| 01 | Baseline y capturas «antes» | Gates en verde, capturas de las 33 pantallas antes del cambio |
| 02 | Datos de demostración para Gerencia | 12–18 meses de historia realista **solo en local** (clientes, contratos, cobros, uso) |
| 03 | Sistema visual (especificación) | `docs/design/VISUAL_SYSTEM_V2.md`: tipografía, color, superficies, movimiento, gráficos |
| 04 | Tokens, tipografía y tema | `tokens.css` v2 claro/oscuro, escala tipográfica de impacto, números tabulares |
| 05 | Componentes base | Inputs, selects, botones, badges, tarjetas, tablas, tabs, diálogos, skeletons + galería `/design` |
| 06 | Shell y navegación | Sidebar premium, topbar, encabezados de página, migas, buscador global ⌘K |
| 07 | Login, bienvenida y portal de pago | Login EBIM (U-04) pulido, `/bienvenida` y `/pagar` de nivel cliente |
| 08 | Series ejecutivas (backend) | **Módulo nuevo:** MRR histórico mensual y movimientos (nuevo/expansión/contracción/churn), cartera por antigüedad |
| 09 | Resumen Ejecutivo | KPIs con sparkline y variación, evolución MRR, puente de MRR, cobrado vs facturado, cartera, mix por producto y país |
| 10 | Pantallas de Finanzas | Facturación, cobros, comisiones, renovaciones, conciliación, FX, créditos, tarifas partners |
| 11 | Pantallas de Clientes y Productos | Clientes, partners, 360, suite SaaS, planes, tenants, contratos, nueva venta |
| 12 | Pantallas de Operación y Gobierno | Integraciones, uso, despliegues, altas, usuarios, auditoría, configuración |
| 13 | Módulo: liquidación y pago de comisiones | **Módulo nuevo:** aprobar y pagar liquidaciones con referencia (brecha P0) |
| 14 | Modo presentación | Vista a pantalla completa para Gerencia, rotación de tableros, impresión/PDF |
| 15 | QA visual y accesibilidad | Capturas «después», contraste AA, modo oscuro, responsive, regresión completa |
| 16 | Cierre e informe | Informe final, galería antes/después, documentación, commit final |

Más módulos propuestos para siguientes noches: ver `ROADMAP_MODULOS.md`.

## Archivos del pack

- `RUN_NOCHE.sh`: el runner. Prepara worktree, `.env.development.local` local y Supabase; ejecuta una sesión por fase.
- `00_CONTEXTO_COMUN.md`: reglas comunes que se anteponen a cada fase.
- `fases/NN_*.md`: una instrucción por fase.
- `DECISIONS.md`: decisiones visuales y de alcance ya tomadas (no se re-discuten de noche).
- `QUALITY_GATE.md`: gates obligatorios por fase.
- `STATE.md`: estado vivo (lo actualiza cada fase).
- `ROADMAP_MODULOS.md`: módulos adicionales recomendados para el Admin Maestro.
