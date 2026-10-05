# Sistema visual V2 — EBIM Admin Maestro («ejecutivo sobrio premium»)

Versión 2.0 · 2026-10-05 · Fase 03 de la corrida V4 «visual para Gerencia».
Fuentes: `DECISIONS.md` D-V01…D-V08, `BASELINE.md` (auditoría A01–A16), `EBIM_CONVENTIONS.md` (U-01…U-15),
skill `dataviz` (paleta validada con `validate_palette.js`, resultados en el Anexo A).

Este documento **manda** sobre el gusto en las fases 04–15. Si un valor no está aquí, se usa el más cercano de la
escala; no se inventan valores nuevos en pantallas. Los hex de este documento viven **solo** en `src/app/tokens.css`;
los componentes usan las variables o clases Tailwind (U-10, quality gate).

---

## 1. Principios

1. **El número es el protagonista.** Cada pantalla responde una pregunta; la cifra que la responde es la más grande
   y la única en tamaño display de su zona. Todo lo demás (etiquetas, monedas, ayudas) baja de peso.
2. **Color con intención.** Superficies neutras frías (slate); la marca aparece en el sidebar, la acción primaria, el
   foco y la serie de datos principal. Los semánticos solo cuando algo **significa** bien/mal y siempre con icono + texto.
3. **Capas sutiles, no cajas.** Plano tintado → tarjetas blancas con borde hairline → popovers → diálogos. Una tarjeta
   no se anida en otra tarjeta.
4. **Legible a 3 metros.** KPIs ≥ 32 px, ejes ≥ 12 px, contraste AA en claro y oscuro, ≤ 6 colores por gráfico.
5. **Siempre un estado.** Ninguna zona queda en blanco: carga (skeleton), vacío (con acción), error (en español, con
   reintento) o éxito (toast). Mismo componente en toda la app.

### Qué NO se hace
- Hex, `rgb()` o colores Tailwind de paleta (`text-red-600`, `bg-slate-100`…) en componentes: solo tokens.
- Segunda familia tipográfica, pesos < 400 o > 800, cursivas para énfasis, texto en mayúsculas fuera de `text-micro`.
- Paneles de filtros multi-campo (U-06); formularios apilados con scroll infinito (U-07); selector de color para el usuario (U-08).
- Gráficos de doble eje Y, tortas/donas de más de 2 porciones, rampas arcoíris, 3D, sombras o degradados dentro de marcas.
- Animaciones con rebote, parallax, autoplay de movimiento sin control; spinners para cargas de página.
- Botones rojos sólidos al nivel de la acción primaria; más de **una** acción primaria por zona.
- Mostrar un mismo importe en 3 monedas al mismo tamaño (A02): una moneda protagonista, las nativas en segundo plano.
- Mensajes técnicos o en inglés al usuario (A01): se traducen en `ErrorState`.

---

## 2. Tipografía

Familia única **DM Sans** variable (Google Fonts, `opsz 9..40`, `wght 400..800`; el import actual de `index.css` ya
cubre esos ejes). Mono (`ui-monospace`) **solo** para ids, códigos, tokens y slugs técnicos.
`font-optical-sizing: auto` en `html`; los niveles marcados con *opsz 40* lo fijan con `font-variation-settings: "opsz" 40`.

| Token / clase Tailwind | Tamaño / alto de línea | Peso | Tracking | opsz | Uso |
|---|---|---|---|---|---|
| `text-hero` | 56 / 60 | 700 | −0.025em | 40 | Una cifra por vista, **solo modo presentación** (fase 14). |
| `text-display` | 40 / 44 | 700 | −0.02em | 40 | Valor de KPI del Resumen ejecutivo (franja hero). |
| `text-kpi` | 32 / 38 | 700 | −0.02em | 40 | Valor de KpiTile en pantallas internas y fichas 360. |
| `text-h1` | 28 / 34 | 700 | −0.02em | 40 | Título de página (`PageContainer`). Uno por página. |
| `text-h2` | 20 / 28 | 600 | −0.01em | 40 | Título de sección / de tarjeta principal y de diálogo. |
| `text-h3` | 16 / 24 | 600 | −0.005em | auto | Título de tarjeta secundaria, grupo de formulario, drawer. |
| `text-body` | 14 / 22 | 400 (énfasis 600) | 0 | auto | Texto base, celdas, inputs, botones (600). |
| `text-compact` | 13 / 20 | 400 / 600 | 0 | auto | Labels de campo (600), tabs, leyendas, tooltips, celdas secundarias. |
| `text-caption` | 12 / 16 | 400 / 500 | 0.005em | auto | Ayuda/error de campo, ejes y ticks de gráficos, pie de tabla, metadatos. **Mínimo absoluto de la app.** |
| `text-micro` | 11 / 16 | 600 | 0.06em | auto | Micro-labels en MAYÚSCULAS: etiqueta de KPI, cabecera de tabla, grupos del sidebar, eyebrow. |

Implementación (fase 04): `theme.extend.fontSize` en `tailwind.config.ts` con `[size, { lineHeight, letterSpacing, fontWeight }]`
y, en `index.css` (`@layer utilities`), `.text-hero, .text-display, .text-kpi, .text-h1, .text-h2 { font-variation-settings: "opsz" 40 }`
y `.text-micro { text-transform: uppercase }`. Nada por debajo de 11 px (excepción: lockup «BY EBIM» 9.5 px de U-02).

Números:
- **`tabular-nums`** en todo número que se alinea en columna o cambia en sitio: celdas de tabla, ticks de ejes, tooltips,
  variaciones (deltas), contadores de pestañas, paginación, totales de pie. Clase base `.ebim-num` = `tabular-nums` + `text-right` en celdas.
- **Cifras proporcionales** (por defecto) en `text-hero`, `text-display` y `text-kpi` (decisión registrada: los dígitos de ancho fijo
  se ven sueltos a tamaño display; ver DECISIONS).
- Importes en tabla: alineados a la derecha, moneda ISO **en la columna o en la cabecera** cuando la columna es de una sola moneda;
  si es mixta, código en la celda en `text-muted`.
- Líneas de texto: medida máxima 72 ch (`max-w-prose`) en descripciones y estados vacíos.

---

## 3. Color

Variables en `src/app/tokens.css`, mapeadas en `tailwind.config.ts`. Se **conservan** los nombres existentes
(`--bg`, `--card`, `--elevated`, `--border`, `--text`, `--muted`, `--accent*`, semánticos, `--chart-*`) y se agregan los nuevos.
Contrastes WCAG 2.x calculados con `contrast()` de `validate_palette.js`.

### 3.1 Neutros y superficies (slate frío)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#f4f6f8` | `#0b1215` | Plano de la app (ligeramente tintado). |
| `--card` | `#ffffff` | `#121a1f` | Tarjetas, tablas, topbar, inputs. **Superficie de gráficos.** |
| `--sunken` *(nuevo)* | `#f8fafc` | `#0f161a` | Cabecera de tabla, zebra, pozos dentro de tarjeta, pista de skeleton. |
| `--elevated` | `#ffffff` | `#18232a` | Popovers, menús, tooltips, toasts, diálogos, drawer. |
| `--hover` *(nuevo)* | `#f1f5f9` | `#17222a` | Hover de fila / ítem de menú. |
| `--border` | `#e3e8ee` | `#24313a` | Hairline de tarjetas, separadores, grid de tabla. |
| `--border-strong` *(nuevo)* | `#8592a2` | `#5f6f7c` | Borde de controles de formulario (input, select, checkbox, switch apagado). |
| `--text` | `#101828` | `#e8eef2` | Texto principal. |
| `--text-2` *(nuevo)* | `#475467` | `#b6c2cc` | Texto secundario (descripciones, celdas secundarias). |
| `--muted` | `#5d6b7e` | `#8e9daa` | Etiquetas, ejes, placeholders, metadatos. |
| `--disabled` *(nuevo)* | `#98a2b3` | `#5b6873` | Texto deshabilitado (exento de AA, siempre con `cursor-not-allowed`). |
| `--scrim` *(nuevo)* | `rgba(16,24,40,.48)` | `rgba(0,0,0,.64)` | Fondo de diálogos/drawer. |

Contrastes de texto (AA ≥ 4.5:1):

| Par | Claro | Oscuro |
|---|---|---|
| `--text` sobre `--bg` / `--card` / `--sunken` | 16.38 / 17.75 / 16.96 | 16.14 / 15.04 / 15.60 |
| `--text-2` sobre `--bg` / `--card` / `--sunken` | 7.10 / 7.69 / 7.35 | 10.42 / 9.70 / 10.07 |
| `--muted` sobre `--bg` / `--card` / `--sunken` | 5.01 / 5.43 / 5.19 | 6.80 / 6.33 / 6.57 |
| `--muted` sobre `--elevated` / `--hover` / `--accent-soft` | 5.43 / 4.95 / 4.67 | 5.75 / 5.82 / 5.09 |
| `--text` sobre `--hover` / `--accent-soft` | 16.20 / 15.28 | 13.82 / 12.10 |
| `--text-2` sobre `--hover` / `--elevated` | 7.02 / 7.69 | — / 8.82 |
| `--accent-action-fg` sobre `--accent-action-hover` | 9.03 | 9.34 |
| `--border-strong` sobre `--card` (no-texto, ≥ 3:1) | 3.17 | 3.40 |

Regla: los controles de formulario viven **sobre `--card` o `--elevated`**, nunca directamente sobre `--bg`
(ahí `--border-strong` baja a 2.92:1).

### 3.2 Marca (no elegible por el usuario, U-08)

| Token | Claro | Oscuro | Uso / contraste |
|---|---|---|---|
| `--accent` | `#5aa97f` | `#5aa97f` | Verde EBIM: **solo rellenos** (barras de progreso, punto de estado «activo», isotipo en claro). 2.83:1 sobre blanco → nunca texto. |
| `--accent-deep` | `#056769` | `#5ec4b0` | Teal: **texto** de marca, links, tab activa, icono activo. 6.67 sobre card claro · 8.38 sobre card oscuro. |
| `--accent-soft` | `#e3f1ee` | `#11302c` | Fondo de fila seleccionada, badge `accent`, hover de botón secundario. `--accent-deep` encima: 5.74 / 6.74; `--muted` encima: 4.67. |
| `--accent-action` | `#056769` | `#5ec4b0` | Fondo de botón primario. |
| `--accent-action-hover` | `#04524f` | `#7dd3c2` | Hover del primario. |
| `--accent-action-fg` | `#ffffff` | `#062420` | Texto del primario: 6.67 / 7.81. |
| `--accent2` | `#056769` | `#056769` | Teal de marca (sin cambio). |
| `--brand-mark` | `#0a5a52` | `#0a5a52` | Isotipo sobre claro (§4.6). Sobre sidebar/hero: blanco. |
| `--sidebar` | `linear-gradient(180deg, #0a3d3a 0%, #0a5a52 100%)` | `linear-gradient(180deg, #08201f 0%, #0c3532 100%)` | Sidebar (D-V03, corrige A05). Blanco: ≥ 8.09 / ≥ 13.37. Texto de grupo `rgba(255,255,255,.72)`: ≥ 4.95. |
| `--sidebar-indicator` *(nuevo)* | `#7fd3a6` | `#7fd3a6` | Barra de 3 px del ítem activo: 4.53:1 sobre el tramo más claro. |
| `--hero-grad` | `linear-gradient(155deg, #0a3d3a 0%, #0a5a52 55%, #1f7a68 100%)` | igual | Panel de marca del login, bienvenida, portal. Blanco ≥ 5.20. |

La fase 04 reemplaza los valores actuales `--accent-deep/--accent-action #2f7355` por el teal `#056769` (D-V03, U-01):
el verde funcional anterior queda retirado.

### 3.3 Semánticos

Valores actuales conservados (ya AA); se recalculó su contraste contra las nuevas superficies.

| Rol | Texto claro | Soft claro | Texto oscuro | Soft oscuro | Contraste texto sobre card / soft (claro · oscuro) |
|---|---|---|---|---|---|
| ok | `#177a47` | `#e6f4ec` | `#5fd08c` | `#12291d` | 5.37 / 4.73 · 9.12 / 8.00 |
| warn | `#935a00` | `#fdf1de` | `#f5b546` | `#2c2110` | 5.67 / 5.08 · 9.70 / 8.69 |
| danger | `#b42318` | `#fdeceb` | `#ff8f85` | `#2e1513` | 6.57 / 5.75 · 7.98 / 7.72 |
| info | `#0b6b8f` | `#e6f2f7` | `#5cc3e6` | `#10262f` | 5.98 / 5.24 · 8.72 / 7.76 |

`--danger-fill` `#b42318` (blanco 6.57) y nuevo `--danger-fill-hover` `#9a1d14` (8.20) en ambos modos.
Un semántico **nunca** va solo: icono Phosphor (`CheckCircle`, `Warning`, `WarningOctagon`, `Info`) + texto.

### 3.4 Foco

| Token | Claro | Oscuro |
|---|---|---|
| `--focus` *(nuevo)* | `#056769` (6.15 sobre `--bg`) | `#5ec4b0` (8.38 sobre card) |
| `--accent-ring` | `rgba(5,103,105,.22)` | `rgba(94,196,176,.30)` |
| Foco sobre sidebar/hero | `#ffffff` (8.09) | `#ffffff` |

---

## 4. Elevación, radios, espaciado, rejilla y breakpoints

### 4.1 Elevación (3 niveles)

| Nivel | Clase | Claro | Oscuro | Para |
|---|---|---|---|---|
| e0 | — | `--bg` | `--bg` | Plano de la app. |
| e1 | `shadow-card` | `0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)` + borde `--border` | sin sombra; borde `--border` sobre `--card` | Tarjetas, tablas, KpiTile. |
| e2 | `shadow-pop` | `0 2px 6px rgba(16,24,40,.06), 0 12px 32px -12px rgba(16,24,40,.22)` | `0 12px 32px -12px rgba(0,0,0,.6)` + borde `--border` sobre `--elevated` | Menús, selects abiertos, tooltips, toasts, paleta ⌘K. |
| e3 | `shadow-modal` *(nuevo)* | `0 24px 64px -16px rgba(16,24,40,.32)` | `0 24px 64px -16px rgba(0,0,0,.7)` + borde | Diálogos y drawer, siempre sobre `--scrim`. |

`shadow-brand` (sombra teñida del login, U-04) se conserva solo para la tarjeta de login.

### 4.2 Radios

| Token Tailwind | Valor | Para |
|---|---|---|
| `rounded-sm` | 4 px | Data-end de barras, checkbox, chips de leyenda. |
| `rounded-md` | 8 px | Tooltip, ítem de menú, tab tipo pastilla, skeleton. |
| `rounded-field` | 11 px | Inputs, selects, botones (U-04). |
| `rounded-card` | 14 px | Tarjetas, KpiTile, tablas, toasts. |
| `rounded-dialog` *(nuevo)* | 18 px | Diálogos, paleta ⌘K. |
| `rounded-login` | 22 px | Tarjeta de login (U-04). |
| `rounded-full` | — | Badges, avatares, switch, punto de estado. |

### 4.3 Espaciado (escala 4 px)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64` = Tailwind `1 · 2 · 3 · 4 · 5 · 6 · 8 · 10 · 12 · 16`. Nada fuera de la escala
(ni `px-3.5`, ni `mt-[7px]`), salvo los tokens de densidad. Reglas fijas:
- Padding de tarjeta: 20 (`p-5`); cabecera de tarjeta `px-5 py-4`; KpiTile `p-5`.
- Separación entre tarjetas y entre filas de la rejilla: 16 (`gap-4`); entre secciones de página: 24 (`space-y-6`).
- Encabezado de página → contenido: 24. Label → control: 6 (`mb-1.5`); control → ayuda: 6; campo → campo: 16.
- Densidad (U-09, sin cambios 1:1 con el contrato): `--control-h/--row-h/--pad-y/--pad-x` = cómoda `40/52/12/14`,
  equilibrada `36/44/9/12` (default), compacta `32/38/6/10`. Alto de control y de fila **siempre** desde estos tokens.

### 4.4 Rejilla de página

- Sidebar 248 px (rail colapsado 76 px). Contenido: `PageContainer` `max-w-[1440px] mx-auto px-6 py-6` (`2xl:px-8`).
  Ancho útil: 1440×900 → 1144 px; 1280×800 → 984 px.
- Rejilla de dashboard: **12 columnas, `gap-4`**. A partir de `xl` (≥ 1280):

| Fila | Contenido | Columnas |
|---|---|---|
| 1 | Franja hero de 6 KpiTile | 3 × 2 filas (`lg:grid-cols-3`), 6 en una fila desde `2xl` (≥ 1536) |
| 2 | Evolución de MRR (área) · Puente de MRR (waterfall) | 8 · 4 |
| 3 | Facturado vs cobrado · Cartera por antigüedad | 7 · 5 |
| 4 | Mix MRR por producto · por país/mercado | 6 · 6 |
| 5 | Top 5 clientes · Top partners · Requiere atención | 4 · 4 · 4 |

  Debajo de `xl` cada gráfico ocupa 12 columnas; KPIs en 2 columnas (`sm`) y 1 (`< sm`).
- Pantallas internas: franja de 3–4 KpiTile (`grid-cols-2 lg:grid-cols-4`), luego la tarjeta del listado a 12 columnas.
- Fichas 360: cabecera de perfil a 12, KPIs en 4, contenido de pestañas a 12 (o 8 · 4 con columna lateral de resumen).

### 4.5 Breakpoints (Tailwind por defecto)

`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Objetivos de revisión: **1440×900 y 1280×800** (sin desbordes ni cortes),
más 390×844 (móvil, sidebar en cajón) para no romper. El sidebar fijo aparece desde `lg`.

---

## 5. Componentes

Estados comunes a todo control: *default · hover · focus-visible · active · disabled · read-only · error · busy*.
Transición de color 150 ms `ease-out`. Foco: §3.4 y §7.

### 5.1 Campos (input, select, textarea, money, search)

- Anatomía vertical: **label** (`text-compact` 600, `--text`, `*` requerido en `--danger`) → 6 → **control** → 6 → **ayuda**
  (`text-caption`, `--muted`) o **error** (`text-caption`, `--danger`, icono `WarningCircle` 14 px, `role="alert"`, sustituye a la ayuda).
- Control: alto `--control-h`, radio 11, borde 1 px `--border-strong`, fondo `--card`, texto `text-body` `--text`, placeholder `--muted`,
  padding horizontal 12; con icono a la izquierda: icono 16 px `--muted` a 12 px del borde, texto a 36 px.
- **Hover:** borde `--text-2`. **Focus:** borde `--focus` + `box-shadow: 0 0 0 3px var(--accent-ring)` (sin outline extra).
  **Error:** `aria-invalid="true"`, borde `--danger`, anillo `rgba(180,35,24,.18)` al enfocar. **Disabled:** fondo `--sunken`, texto `--disabled`,
  borde `--border`. **Read-only:** fondo `--sunken`, borde `--border`, texto `--text` (se puede seleccionar y copiar).
- Select: mismo control + chevron Phosphor `CaretDown` 16 px a 12 px de la derecha (`appearance-none`).
- Textarea: alto mínimo 3 líneas (88 px), `resize-y`, padding 10/12.
- MoneyField: prefijo con código ISO (`text-compact` 600 `--muted`) separado por hairline `--border`; cifra a la izquierda con `tabular-nums`.
- SearchField: icono `MagnifyingGlass`, botón limpiar `X` cuando hay texto, `type="search"`. Ancho mínimo 240, máximo 480 (no a 1100 px, A10).
- Ancho por contenido: códigos/fechas/monedas 160–240 px; nombres 320–480; nunca un select de un valor a ancho completo.

### 5.2 Checkbox y switch

- Checkbox 16×16, radio 4, borde `--border-strong`; marcado: fondo `--accent-action`, check blanco/`--accent-action-fg`; hit-area de 24×24
  incluyendo la etiqueta (`text-body`) a 8 px.
- Switch (preferencias on/off de efecto inmediato): pista 36×20 `rounded-full`; apagado: fondo `--sunken` + borde `--border-strong`;
  encendido: `--accent-action`; perilla 16 px `--card` con `shadow-card`; `role="switch"` + `aria-checked`.
- Ambos: focus-visible con el anillo global; disabled con opacidad 0.55.

### 5.3 Botones

| Variante | Clase | Fondo | Texto | Borde | Hover |
|---|---|---|---|---|---|
| Primario | `ebim-btn-primary` | `--accent-action` | `--accent-action-fg` | — | `--accent-action-hover` |
| Secundario | `ebim-btn-secondary` | `--card` | `--accent-deep` | 1 px `--accent-deep` | `--accent-soft` |
| Fantasma | `ebim-btn-ghost` | transparente | `--text` | 1 px `--border` | `--hover` |
| Peligro | `ebim-btn-danger` | `--danger-fill` | `#fff` (token `--danger-fill-fg`) | — | `--danger-fill-hover` |
| Link | `ebim-link` | — | `--accent-deep` 600 | — | subrayado |

Tamaños: `sm` alto 32, padding 12, `text-compact`; `md` alto `--control-h`, padding 16, `text-body` 600 (default); `lg` alto 44, padding 20.
Icono 16 px (20 en `lg`) a 8 px del texto. Botón solo-icono: cuadrado del alto del tamaño + `aria-label` + tooltip.
**Busy:** `aria-busy="true"`, spinner 16 px (borde 2 px, `currentColor` 30 % + tramo sólido) en lugar del icono, texto se mantiene,
ancho no cambia, deshabilitado. Disabled: opacidad 0.55. Máximo una primaria por zona; la de peligro nunca es la primaria de
la cabecera (A11): en cabecera va como fantasma con texto `--danger` y confirma en diálogo.

### 5.4 Badge y punto de estado

- Badge: `rounded-full`, alto 22, padding 8, `text-caption` 600, tonos `neutral` (`--sunken` + borde `--border` + `--text-2`),
  `ok/warn/danger/info` (soft + texto del rol), `accent` (`--accent-soft` + `--accent-deep`). Opción `dot`: punto 6 px del color del rol
  delante del texto. Texto en español y en minúscula inicial (`Activa`, no `ACTIVE`, A13).
- Punto de estado (listas de usuarios/integraciones): 8 px + texto; nunca solo el punto.

### 5.5 Tarjeta

`ebim-card`: `--card`, borde `--border`, `rounded-card`, `shadow-card`. Cabecera opcional `px-5 py-4` con título `text-h3`
(principal `text-h2`), descripción `text-compact --muted`, acciones a la derecha (fantasma `sm` o menú `DotsThree`). Separador hairline
solo si el cuerpo es tabla. Cuerpo `p-5`. Pie opcional `px-5 py-3` `text-caption --muted` sobre `--sunken`. La tarjeta clicable tiene hover
`--hover` en el borde (`border-strong`) y es un `<a>`/`<button>` real.

### 5.6 KPI tile (`KpiTile`, evoluciona `StatCard`)

Orden vertical, `p-5`, alto mínimo 148 (dashboard) / 120 (interno):
1. **Etiqueta** `text-micro --muted` (+ icono opcional 16 px `--muted`; + `InfoTooltip` con la definición del KPI).
2. **Valor** `text-display` (dashboard) o `text-kpi` (interno), `--text`, cifras proporcionales. La moneda va como prefijo
   `text-h3` 600 `--muted` alineado a la base: `USD` **50.1 K**. Nunca el valor en color semántico (A09); el color va en la variación.
3. **Variación** `text-compact` 600 `tabular-nums`: flecha Phosphor `ArrowUpRight`/`ArrowDownRight`/`Minus` 14 px + `+4.1 %` +
   «vs ago» en `--muted`. Color = dirección × si subir es bueno: bueno `--ok`, malo `--danger`, neutro `--muted`
   (p. ej. cartera vencida que sube = `--danger`).
4. **Sparkline** 12 meses, alto 36, ancho completo (§6.6).
5. **Pie** opcional `text-caption --muted` (desglose nativo «BOB 50.5 K · PEN 51.2 K», fecha de corte, «mes en curso parcial»).

Estados: skeleton (barra 40 % para etiqueta, 60 % para valor, sparkline gris); **sin datos**: valor `—` en `--muted` + pie que explica
por qué («Sin cobros en el período»), nunca un `0` que parezca dato (A04, A08); error: icono `WarningCircle` + «No disponible» + reintentar.
Si el tile navega al detalle, todo el tile es el enlace (U: continuidad resumen → detalle).

### 5.7 Tabla (`DataTable` / `PagedTable`)

- Contenedor dentro de tarjeta; `overflow-x-auto` con la primera columna `sticky left-0` si hay scroll horizontal.
- Cabecera **sticky** (`top-0` del área de scroll), fondo `--sunken`, borde inferior `--border`, `text-micro --muted`, alto 40.
  Columnas ordenables: cabecera botón con `CaretUpDown` / `CaretUp` / `CaretDown` 12 px y `aria-sort`.
- Filas alto `--row-h`, separadas por hairline `--border` (sin zebra); hover `--hover`; seleccionada `--accent-soft`.
- Celdas `text-body --text`, padding `--pad-x`; secundaria en `text-compact --text-2` bajo la principal (máximo **2 líneas** por celda, A07).
- Números: `.ebim-num` (derecha + tabular); importe con moneda; negativos con `−` y `--danger` solo si significa pérdida.
- Ids/códigos: mono `text-compact`, `whitespace-nowrap`, truncado con `…` y `title` (A07), copiar al hover (`Copy` 14 px).
- Acciones de fila: columna final de 48 px, botón `DotsThree` (menú) visible siempre en foco y al hover en desktop; la acción
  primaria de la fila es el clic en la fila/nombre. Nada de «Archivar» rojo por fila (A12).
- Pie: `text-caption --muted` con conteo «1–25 de 832» + paginación (fantasma `sm`).
- Estados: skeleton de 6 filas; vacío (§5.14) dentro de la tarjeta; error (§5.14) dentro de la tarjeta.

### 5.8 Pestañas

- **`SectionTabs`** (fichas, U-07): subrayado. Alto 44, `text-compact` 600, inactiva `--muted`, hover `--text`, activa `--accent-deep`
  con barra inferior 2 px `--accent-deep`; borde inferior del grupo `--border`. Deep-link `#hash`. Más de 7 pestañas → scroll horizontal
  con degradados de borde y flechas (nunca dos renglones, A08/A09).
- **`StatusTabs`** (listados, U-06): segmentado. Contenedor `--sunken` radio 11 padding 4; pestaña `rounded-md` alto 32,
  activa `--card` + `shadow-card` + `--text`; inactiva `--muted`. Contador `tabular-nums` en `text-caption` en pastilla `--border`.
- Teclado: flechas izquierda/derecha, `Home/End`; `role="tablist"`/`tab`/`tabpanel`.

### 5.9 Diálogo (`FormDialog`, `ConfirmDialog`)

`--elevated`, `rounded-dialog`, `shadow-modal`, sobre `--scrim`. Anchos: confirmación 440, formulario 560, formulario amplio 720;
alto máximo 85vh con cuerpo con scroll y cabecera/pie fijos. Cabecera `px-6 pt-6` título `text-h2` + descripción `text-compact --text-2`
+ cerrar `X` (fantasma solo-icono). Cuerpo `px-6 py-4`. Pie `px-6 pb-6` acciones a la derecha: cancelar (fantasma) + confirmar
(primario o peligro). Foco inicial en el primer campo (o en Cancelar si es destructivo); `Esc` cierra; foco atrapado (`useModalFocus`).
Entrada: opacidad 0→1 y `translateY(8px)→0` en 200 ms.

### 5.10 Drawer (`DetailDrawer`)

Lateral derecho, ancho 480 (`md`) / 640 (`lg`), alto completo, `--elevated`, `shadow-modal`, sobre `--scrim`. Cabecera sticky
`px-6 py-4` con título `text-h3`, subtítulo `text-caption --muted`, cerrar. Cuerpo con `DetailList` en 2 columnas (label `text-caption --muted`,
valor `text-body`). Pie sticky con acciones si las hay. Entrada `translateX(24px)→0` + opacidad, 200 ms.

### 5.11 Toast

Abajo a la derecha, 24 px de los bordes, ancho 360, apilado hacia arriba (máx. 3 visibles). `--elevated`, `rounded-card`, `shadow-pop`,
barra izquierda de 3 px del color del rol, icono del rol 20 px, título `text-compact` 600, detalle `text-caption --text-2`, cerrar.
Éxito 6 s; error 6 s con pausa al hover/foco (ya existe autocierre). `role="status"` (éxito/info) o `role="alert"` (error).

### 5.12 Skeleton

Bloques `--sunken` (oscuro: `--elevated`) `rounded-md`, con brillo lineal de 1.6 s (gradiente `--sunken → --hover → --sunken`);
con `prefers-reduced-motion` es estático. Formas: tabla (cabecera + 6 filas con anchos 40/24/16/12 %), KpiTile (§5.6), gráfico
(rectángulo del alto del plot + 5 ticks). `aria-busy="true"` en el contenedor y texto oculto «Cargando…» (`role="status"`).
En recargas (refetch) **no** se vuelve a mostrar el skeleton: se mantiene el contenido con opacidad 0.6.

### 5.13 Encabezado de página (`PageContainer`)

Migas (`text-caption --muted`, separador `CaretRight` 12 px, la última sin enlace) → 8 → fila: título `text-h1 --text` + descripción
`text-body --text-2` (máx. 72 ch) a la izquierda; acciones a la derecha (máx. 1 primaria + 2 secundarias/fantasma; el resto en menú
`DotsThree`). Opcional debajo: metadatos en `text-caption --muted` (fecha de corte, moneda de reporte). Separación al contenido 24.
El `h1` recibe el foco al navegar (fase 06).

### 5.14 Estados vacío, error y éxito

- **Vacío:** centrado, `py-12`, ilustración SVG inline monocroma 96×96 (trazo 1.5 px `--border-strong`, un detalle en `--accent`),
  título `text-h3 --text`, descripción `text-body --text-2` (máx. 48 ch), acción primaria o secundaria si existe una acción real.
  Variante **sin resultados de búsqueda**: icono `MagnifyingGlass` 32 px + «Sin resultados para "…"» + botón «Limpiar búsqueda».
- **Error:** icono `WarningCircle` 32 px `--danger`, título «No se pudo cargar la información», detalle en español (los errores de
  PostgREST/Supabase pasan por `pgError.ts`; nunca el mensaje crudo en inglés, A01), botón «Reintentar» (fantasma).
- **Página pública de error** (`/pagar`, `/bienvenida`, 404; A14): tarjeta 480 centrada sobre `--bg` con isotipo, título `text-h2`,
  explicación, acción («Volver al inicio» / «Escribir a soporte») y lockup «by EBIM».
- **Éxito:** toast (§5.11); en asistentes, pantalla final con `CheckCircle` 48 px `--ok` + resumen + siguiente paso.

### 5.15 Tooltip y menús

Tooltip: `--elevated`, borde `--border`, `rounded-md`, `shadow-pop`, padding 8/10, `text-caption`, máx. 280 px, retardo 300 ms,
también en foco de teclado. Menú: `--elevated`, `rounded-card`, `shadow-pop`, padding 4, ítems alto 36 `rounded-md` hover `--hover`,
destructivos en `--danger` al final tras un separador.

---

## 6. Gráficos (método del skill `dataviz`)

Recharts 3; **sin animación** (`isAnimationActive={false}`); colores por token; texto con tokens de texto, nunca del color de la serie.
Toda figura vive en `ChartPanel`: título `text-h3`, subtítulo con unidad y período `text-caption --muted`, conmutador «Gráfico / Tabla»
(la tabla alternativa es obligatoria: es el canal de alivio de contraste y el acceso por teclado).

### 6.1 Paleta categórica (identidad) — `--chart-1…6`

Orden fijo, se asigna en secuencia, **nunca se cicla**; ≤ 6 series por gráfico (más → «Otros» o small multiples).
El color sigue a la entidad (un filtro no repinta a los sobrevivientes).

| Slot | Tono | Claro (sobre `#ffffff`) | Oscuro (sobre `#121a1f`) |
|---|---|---|---|
| 1 | teal (marca) | `#008d7c` | `#009b90` |
| 2 | naranja (acento cálido) | `#de6e29` | `#d76821` |
| 3 | violeta | `#724aab` | `#8e6ac7` |
| 4 | verde | `#47a34e` | `#4ea954` |
| 5 | azul | `#3370c7` | `#4d86d9` |
| 6 | magenta | `#c84c8b` | `#cb5790` |

Validación (Anexo A): adyacentes peor CVD ΔE 9.6 claro / 12.0 oscuro (objetivo ≥ 8), visión normal 24.0 / 22.0 (piso 15), los 6 ≥ 3:1.
Formas *todos-los-pares* (dispersión, mapas, small multiples): **máximo 3 series** (slots 1–3 validan: CVD 10.2 / 10.5).
Elegido entre las órdenes que pasan todos los gates en ambos modos (búsqueda exhaustiva con slot 1 = teal de marca).
Alias para compatibilidad (fase 04): `--chart-collected = --chart-1`, `--chart-cost = --chart-2`, `--chart-commission = --chart-3`,
`--chart-single = --chart-1`.

### 6.2 Rampas secuencial, ordinal y diverging

- **Secuencial (magnitud, heatmaps)** — teal, una tinta: `--chart-seq-100 #d9f6f1 · 200 #abe5dd · 300 #6fcabf · 400 #2baea1 ·
  500 #008c80 · 600 #006b61 · 700 #004b45`. Claro: bajo → alto = 100 → 700. Oscuro: se invierte el ancla, 600 → 200 (valor bajo
  cerca de la superficie). Uso ordinal (pasos discretos): claro 400→700, oscuro 600→200 (ambos validados `--ordinal`).
- **Ordinal de antigüedad de cartera** (0–30 · 31–60 · 61–90 · 90+), naranja de una tinta — `--chart-age-1…4`:
  claro `#f49b72 · #df733e · #bc541a · #903a03`; oscuro `#8d481a · #ba5d1d · #dc7b40 · #f7a97c` (más antiguo = más intenso en ambos).
  Es una rampa de magnitud, **no** un estado: no usa los tokens semánticos.
- **Diverging / polaridad** (puente de MRR, variaciones): polo positivo `--chart-pos = --chart-1` (teal), polo negativo
  `--chart-neg = --chart-2` (naranja), punto medio/total `--chart-total` claro `#334155` / oscuro `#cbd5e1`.
  Teal↔naranja CVD 10.2 / 14.0; total↔polos ≥ 20.8 (Anexo A).
- **Énfasis de dos tonos** (facturado vs cobrado): `--chart-billed` claro `#2baea1` (seq-400) / oscuro `#008c80` (seq-500);
  `--chart-collected-2` claro `#004b45` (seq-700) / oscuro `#abe5dd` (seq-200). CVD ≥ 29. El facturado claro queda en 2.74:1 →
  la regla de alivio exige leyenda + tabla alternativa (ya existe en `ChartPanel`).
- **Contexto / de-énfasis** (sparkline, series de referencia): `--chart-muted` claro `#8a96a6` (3.00:1) / oscuro `#66768a` (3.79:1).
- Estados en gráficos (cuando la serie **significa** bien/mal): tokens `--ok/--warn/--danger` + icono/etiqueta; nunca un slot categórico.

### 6.3 Ejes, grid, tooltip, leyenda

| Elemento | Especificación |
|---|---|
| Grid | `--chart-grid` claro `#e8edf2` / oscuro `#212c33`, 1 px **sólido**, solo horizontal (barras horizontales: solo vertical). |
| Línea base | `--chart-baseline` claro `#c3ccd6` / oscuro `#3a4852`, 1 px; sin línea de eje Y. |
| Ticks | `--chart-axis = --muted`, `text-caption` (12 px, ≥ 12 del gate), `tabular-nums`, sin tick marks; 4–6 ticks Y con valores redondos compactos; X: meses `ene 26` (mes abreviado + año de 2 cifras solo en enero o en el primero). |
| Tooltip | §5.15 + punto/línea de 8 px del color de la serie junto a la etiqueta; valor completo (`formatMoney`, 2 decimales) en `tabular-nums`; período parcial anotado («oct 26 · parcial»). Cursor: línea vertical `--border-strong` (líneas/áreas) o banda `--hover` (barras). |
| Leyenda | Arriba a la izquierda, bajo el título, `text-compact --text-2`, muestra 10×10 `rounded-sm`; obligatoria con ≥ 2 series; ninguna con 1 serie. |
| Etiquetas directas | Selectivas: valor final de la línea, extremo, total de barra. Nunca un número por punto. Dentro de una barra solo si cabe con 8 px por lado. |
| Altura | Protagonista (evolución MRR) 320 px de plot; resto 240; sparkline 36. El contenedor incluye la banda del eje X (sin scroll interno). |

### 6.4 Marcas

Barras ≤ 24 px de grosor (gap de banda ≥ 40 %), data-end redondeado 4 px y base recta, separación de 2 px del color de superficie entre
barras adyacentes y segmentos apilados. Línea 2 px, uniones redondeadas. Marcadores ≥ 8 px con anillo de 2 px del color de superficie.
Área: tinta de la serie al 10 % (oscuro 16 %). Nunca borde alrededor de una marca. Hit-area ≥ 24 px.

### 6.5 Formatos de número

Locale **`es-PE`** (el de `src/lib/format.ts`: punto decimal, coma de miles) y **código ISO** de moneda (G-27: «S/» y «$» son ambiguos
en la suite multi-país; el símbolo puede acompañar al código, nunca reemplazarlo).

| Caso | Formato | Ejemplo |
|---|---|---|
| Importe completo (tabla, tooltip) | `formatMoney` | `PEN 1,234,567.50` |
| Importe compacto (KPI, eje, etiqueta) | `formatMoneyCompact`, 1 decimal desde 1 000 | `PEN 1.2 M` · `USD 50.1 K` · `USD 980` |
| En KpiTile | código separado + cifra compacta | `USD` **50.1 K** |
| Porcentaje | `formatPercent`, 1 decimal | `94.4%` |
| Variación relativa | signo siempre (`signDisplay: 'exceptZero'`), 1 decimal | `+4.1%` · `−2.3%` |
| Variación de tasa | puntos porcentuales | `+1.2 pp` |
| Conteos | `formatNumber`, sin decimales | `1,441` |
| Fechas | `formatDate`; mes de eje `ene 26`; período `oct 2026` | — |

Signo negativo: `−` (U+2212) en etiquetas de gráfico y deltas. Ninguna cifra se redondea a «0.0 K»: por debajo de 1 000 se muestra entera.

### 6.6 Reglas por forma

- **Sparkline (KPI):** 12 puntos mensuales, línea 1.5 px `--chart-muted`, último punto: marcador 6 px `--chart-1` con anillo de superficie;
  sin ejes, grid ni tooltip propio (el tile tiene la cifra); `aria-hidden` + texto oculto «Tendencia 12 meses: de X a Y».
  Escala Y desde el mínimo de la serie (es tendencia, no magnitud). Mes parcial: punto hueco.
- **Área de evolución de MRR:** una serie, línea 2 px `--chart-1` + área 10 %, eje Y desde 0, etiqueta directa del último valor,
  marca vertical «hoy» si el último mes es parcial. Selector de moneda de reporte en la fila de filtros de la página, no dentro de la tarjeta.
- **Waterfall (puente de MRR):** barras flotantes en orden fijo inicio → nuevo → expansión → contracción → churn → fin; inicio y fin
  `--chart-total` desde la base; aumentos `--chart-pos`, disminuciones `--chart-neg`; conectores 1 px `--chart-baseline` entre topes;
  etiqueta de valor sobre cada barra con signo (`+USD 3.2 K`, `−USD 0.8 K`); total final en `text-compact` 600.
- **Barras apiladas horizontales (cartera por antigüedad):** una barra por moneda/total, segmentos `--chart-age-1…4` en orden 0–30 → 90+,
  separación de 2 px, leyenda con los 4 rangos, etiqueta dentro del segmento solo si cabe; total al final de la barra.
- **Facturado vs cobrado:** barras agrupadas (facturado `--chart-billed`, cobrado `--chart-collected-2`) en **un solo eje** de importe;
  el % de cobro **no** va en un segundo eje: se muestra como fila de etiquetas `text-caption tabular-nums` bajo cada mes (o una
  mini-línea alineada en su propio gráfico de 64 px debajo, eje 0–100 %).
- **Mix por producto / país:** barras horizontales ordenadas desc., una serie → todas `--chart-1`, valor al final de la barra,
  máximo 8 + «Otros». Prohibido el pie/dona de más de 2 porciones.
- **Modo oscuro:** pasos propios de cada rampa (§6.1–6.2), validados contra `#121a1f`; grid/baseline oscuros; área 16 %.
  No se invierte automáticamente nada.

---

## 7. Movimiento y accesibilidad

- **Duraciones:** 150 ms color/hover/foco; 200 ms entrada de overlays (diálogo, drawer, menú, toast); salida 150 ms.
  Curva `cubic-bezier(0.2, 0, 0, 1)` (ease-out). Sin rebotes ni escalados > 1.02. Transición de ruta: opacidad 120 ms, sin bloquear.
- **`prefers-reduced-motion: reduce`:** la regla global actual (duraciones a 0.001 ms) se mantiene; skeleton sin brillo; el isotipo
  no gira (U-03); el autoplay del modo presentación queda apagado por defecto.
- **Foco visible:** global `outline: 2px solid var(--focus); outline-offset: 2px` en `:focus-visible`; inputs con borde `--focus` +
  anillo 3 px `--accent-ring`; sobre sidebar/hero el outline es blanco. Nunca `outline: none` sin reemplazo.
- **Objetivos táctiles:** mínimo 24×24 px (WCAG 2.5.8) en desktop; ≥ 40×40 en `< sm` para controles primarios (el token de densidad
  ya impide que compacta baje de 36 en móvil). Separación mínima entre objetivos 8 px.
- **Contraste:** texto ≥ 4.5:1 (≥ 3:1 desde 24 px o 18.66 px 700), componentes y marcas ≥ 3:1 o canal de alivio (§6.2). Todos los pares
  de §3 calculados.
- **Semántica:** un `h1` por página; `aria-sort` en tablas; `aria-describedby` campo → ayuda/error; `role="status"`/`alert` en estados;
  gráficos con `role="img"` + `aria-label` que resume la conclusión, y tabla alternativa navegable.
- **Idioma:** todo en español (U-13), incluidos `aria-label`, tooltips y errores.

### 7.1 Modo presentación (fase 14)

- **Activación:** `/?presentacion=1` o botón «Presentar» del Resumen Ejecutivo, solo personal EBIM con vista financiera (para otros
  perfiles el parámetro no hace nada). Conserva los filtros de la URL (`moneda`, `cierre`, `horizonte`); `diapositiva=N` (1–6) y
  `anonimo=1` también viven en la URL. «Atrás» o `Esc` salen; el foco vuelve a «Presentar».
- **Diapositivas:** (1) KPIs hero 3×2, (2) evolución MRR, (3) puente del mes, (4) facturado vs cobrado + antigüedad (7·5), (5) mix
  producto y mercado (6·6), (6) top clientes y partners (6·6). Son los MISMOS paneles del tablero (mismas lecturas y estados).
- **Teclado:** → ↓ Av Pág y espacio avanzan; ← ↑ Re Pág y Mayús+espacio retroceden; Inicio/Fin; 1–6 saltan; `Esc` sale; Ctrl/⌘+P
  imprime las seis. Campos y el espacio sobre botones/enlaces conservan su comportamiento.
- **Pantalla completa:** Fullscreen API pedida en el clic de «Presentar» o con su botón; si el navegador la niega, el overlay ya cubre
  la ventana (alternativa). Salir de pantalla completa sin el botón (Esc del navegador) cierra la presentación.
- **Legibilidad a distancia:** texto +1 escalón (display→hero 56, compacto→14…), ejes y etiquetas de gráficos a 14 px, alto de gráficos
  ajustado a la ventana (`clamp(… calc(100vh − N) …)`); caben enteras a 1440×900 y 1280×800. Tema claro forzado por defecto (no toca la
  preferencia U-08); conmutable. Autoplay apagado por defecto (cada 20 s, vuelve a la primera); con reduced motion no hay fundidos.
- **Ocultar nombres:** clientes → «Cliente A, B…» y partners → «Partner A…» por MRR al cierre (el mayor es «A»), iguales en todas las
  diapositivas; las filas pierden el enlace a la ficha (revelaría el nombre). Productos y mercados no se ocultan.
- **Impresión / PDF:** A4 apaisado, margen 10 mm, una diapositiva por hoja con su cabecera; los gráficos se redibujan al ancho de la hoja
  antes de abrir el diálogo. El tablero normal impreso (Ctrl/⌘+P) oculta menús y controles, sale en claro y pone una sección por hoja.

---

## 8. Inventario de pantallas → patrón

### Patrones

| Id | Patrón | Anatomía |
|---|---|---|
| **PT-DASH** | Tablero ejecutivo | Encabezado + fila de filtros (moneda de reporte, período) + rejilla §4.4. |
| **PT-LIST** | Listado | Encabezado → franja de 3–4 KpiTile (opcional) → tarjeta { SearchField + StatusTabs · DataTable · pie }. U-06. |
| **PT-LIST-CHART** | Listado con gráfico | PT-LIST + un ChartPanel (240 px) entre KPIs y tabla, solo donde responda una pregunta. |
| **PT-360** | Ficha 360 | Cabecera de perfil (avatar de iniciales 48 px, nombre `text-h1`, estado Badge, país, metadatos) → 4 KpiTile → SectionTabs `#hash` → pestaña «Resumen» con mini-gráficos 8·4. |
| **PT-DETAIL** | Ficha simple | Encabezado con migas + SectionTabs `#hash` + DetailList / tablas; barra Guardar persistente si edita (U-07). |
| **PT-CARDS** | Catálogo en tarjetas | Encabezado + SearchField + rejilla de tarjetas (3 col `xl`, 2 `md`) con estado y 2–3 cifras. |
| **PT-WIZARD** | Asistente | Stepper horizontal (pasos numerados, actual en `--accent-deep`) + formulario 8 col + resumen lateral sticky 4 col con total. |
| **PT-SETTINGS** | Configuración | SectionTabs `#hash` + secciones en tarjetas + barra Guardar persistente. |
| **PT-TIMELINE** | Línea de tiempo | PT-LIST cuya tabla es una lista temporal agrupada por día: icono por tipo, quién/qué/cuándo, detalle expandible. |
| **PT-AUTH** | Login | U-04 al pie de la letra; panel de marca con `--hero-grad`. |
| **PT-PUBLIC** | Página pública | Tarjeta centrada 480–560 con marca, estados §5.14 (portal de pago, bienvenida, 404). |
| **PT-PRESENT** | Modo presentación | Overlay a pantalla completa sobre la app inerte: cabecera discreta (isotipo, «Datos al», mes analizado, moneda de reporte, notas) → diapositiva (`h2` `text-h1` + subtítulo «N de 6» + paneles del tablero con la escala tipográfica +1 escalón, `.ebim-present-scale`) → barra inferior (anterior/siguiente, puntos con `aria-current`, «N / 6», progreso, Automático, Ocultar nombres, Tema claro, Pantalla completa, Imprimir, Salir `Esc`). |

### Pantallas

| Ruta | Pantalla | Patrón | Fase | Auditoría |
|---|---|---|---|---|
| `/login` | Login | PT-AUTH | 07 | A15 |
| `/pagar` | Portal de pago | PT-PUBLIC | 07 | A14 |
| `/bienvenida` | Bienvenida | PT-PUBLIC | 07 | A14 |
| `/` | Resumen ejecutivo | PT-DASH | 08–09, 14 | A02, A03, A04 |
| `/?presentacion=1` | Modo presentación del resumen (fase 14) | PT-PRESENT | 14 | — |
| `/billing` | Facturación y cobros | PT-LIST-CHART (cobros por semana) | 10 | A07 |
| `/costs` | Costos y margen | PT-LIST-CHART (cobrado/costo/comisión, slots 1–3) | 10 | A07 |
| `/commissions` | Comisiones | PT-LIST-CHART (comisiones por mes) | 10, 13 | A07 |
| `/commission-plans` | Reglas de comisión | PT-LIST | 10 | — |
| `/renewals` | Renovaciones | PT-LIST (ventanas como StatusTabs, no KPIs) | 10 | A07, A11 |
| `/reconciliation` | Conciliación | PT-LIST | 10 | — |
| `/regional` | Monedas y FX | PT-LIST | 10 | — |
| `/ai-credits` | Créditos IA | PT-LIST-CHART (consumo vs incluido) | 10 | — |
| `/billing-shadow` | Billing shadow | PT-LIST | 10 | — |
| `/partner-fees` | Tarifas de partners | PT-LIST | 10 | — |
| `/customers` | Clientes | PT-LIST (avatar de iniciales) | 11 | A12 |
| `/partners` | Partners y canales | PT-LIST | 11 | — |
| `/organizations` | Directorio corporativo | PT-LIST | 11 | — |
| `/organizations/:id` | Ficha 360 de organización | PT-360 | 11 | A08 |
| `/sales-agents` | Equipo comercial | PT-LIST | 11 | — |
| `/attributions` | Atribuciones | PT-LIST | 11 | — |
| `/products` | Suite SaaS | PT-CARDS | 11 | A12, A13 |
| `/products/:id` | Ficha de producto | PT-DETAIL | 11 | — |
| `/plans` | Planes y licencias | PT-LIST | 11 | — |
| `/feature-flags` | Capacidades | PT-LIST (corregir carga primero) | 11 | **A01 (P0)** |
| `/commercial/capabilities` | Registro de capacidades | PT-LIST | 11 | — |
| `/catalog/addons` | Add-ons y tarifas | PT-LIST | 11 | — |
| `/onboarding` | Nueva venta | PT-WIZARD | 11 | A10 |
| `/tenants` | Tenants | PT-LIST | 11 | — |
| `/tenants/:id` | Tenant 360 | PT-360 | 11 | A09 |
| `/subscriptions` | Contratos y suscripciones | PT-LIST | 11 | A07 |
| `/subscriptions/:id` | Contrato 360 (cobro, enlace, intentos) | PT-DETAIL | 10–11 | — |
| `/integrations` | Integraciones | PT-CARDS (semáforo + stepper LEGACY/SHADOW/PRIMARY) | 12 | — |
| `/integrations/:id` | Ficha de integración | PT-DETAIL + PT-TIMELINE (eventos) | 12 | — |
| `/commercial/entitlement-sync` | Sincronización de entitlements | PT-LIST | 12 | — |
| `/usage` | Uso | PT-LIST-CHART (medidores + barras consumo vs incluido) | 12 | — |
| `/deployments` | Entornos y despliegues | PT-LIST | 12 | — |
| `/saas-provisioning` | Altas SaaS | PT-LIST | 12 | — |
| `/provisioning` | Solicitudes de infraestructura | PT-LIST | 12 | — |
| `/users` | Usuarios y accesos | PT-LIST (avatar, roles en chips, punto de estado) | 12 | — |
| `/users/:id` | Ficha de usuario | PT-DETAIL | 12 | — |
| `/audit` | Auditoría | PT-TIMELINE | 12 | — |
| `/settings` | Configuración (Cuentas de pago, Mi perfil) | PT-SETTINGS | 12 | A10, A16 |
| `/404` | No encontrado | PT-PUBLIC | 12 | — |
| *(nueva)* | Liquidación y pago de comisiones | PT-LIST + PT-WIZARD (liquidar) | 13 | — |
| Shell | Sidebar, topbar, ⌘K | §3.2 sidebar, U-11 A topbar | 06 | A05, A06, A16 |

---

## Anexo A — Validación de la paleta (`dataviz/scripts/validate_palette.js`, 2026-10-05)

Superficies de gráfico: claro `#ffffff` (`--card`), oscuro `#121a1f` (`--card` oscuro).

```text
$ node validate_palette.js "#008d7c,#de6e29,#724aab,#47a34e,#3370c7,#c84c8b" --mode light --surface "#ffffff"
Palette (light, surface #ffffff, categorical): 6 slots
  [PASS] Lightness band         all 6 inside L 0.43–0.77
  [PASS] Chroma floor           all 6 >= 0.1
  [PASS] CVD separation         worst adjacent #c84c8b↔#3370c7 ΔE 9.6 (protan) · tritan 8.8
  [PASS] Normal-vision floor    worst adjacent #c84c8b↔#3370c7 ΔE 24.0 (normal)
  [PASS] Contrast vs surface    all 6 >= 3:1
  → ALL CHECKS PASS                                                          exit 0

$ node validate_palette.js "#009b90,#d76821,#8e6ac7,#4ea954,#4d86d9,#cb5790" --mode dark --surface "#121a1f"
Palette (dark, surface #121a1f, categorical): 6 slots
  [PASS] Lightness band         all 6 inside L 0.48–0.67
  [PASS] Chroma floor           all 6 >= 0.1
  [PASS] CVD separation         worst adjacent #cb5790↔#4d86d9 ΔE 12.0 (protan) · tritan 5.5
  [PASS] Normal-vision floor    worst adjacent #cb5790↔#4d86d9 ΔE 22.0 (normal)
  [PASS] Contrast vs surface    all 6 >= 3:1
  → ALL CHECKS PASS                                                          exit 0

$ node validate_palette.js "#008d7c,#de6e29,#724aab" --mode light --surface "#ffffff" --pairs all
  [PASS] CVD separation         worst all-pairs #de6e29↔#008d7c ΔE 10.2 (protan) · tritan 15.2
  [PASS] Normal-vision floor    worst all-pairs #724aab↔#008d7c ΔE 23.4 (normal)
  [PASS] Lightness band · Chroma floor · Contrast vs surface (3 >= 3:1)      exit 0

$ node validate_palette.js "#009b90,#d76821,#8e6ac7" --mode dark --surface "#121a1f" --pairs all
  [PASS] CVD separation         worst all-pairs #8e6ac7↔#009b90 ΔE 10.5 (deutan) · tritan 13.2
  [PASS] Normal-vision floor    worst all-pairs #8e6ac7↔#009b90 ΔE 21.1 (normal)
  [PASS] Lightness band · Chroma floor · Contrast vs surface (3 >= 3:1)      exit 0

$ node validate_palette.js "#f49b72,#df733e,#bc541a,#903a03" --ordinal --mode light --surface "#ffffff"
  [PASS] Lightness monotone · [PASS] Adjacent ΔL >= 0.06
  [PASS] Light-end contrast     #f49b72 at 2.15:1 vs surface · [PASS] Single hue (spread 0°)   exit 0

$ node validate_palette.js "#8d481a,#ba5d1d,#dc7b40,#f7a97c" --ordinal --mode dark --surface "#121a1f"
  [PASS] Lightness monotone · [PASS] Adjacent ΔL >= 0.06
  [PASS] Light-end contrast     #8d481a at 2.58:1 vs surface · [PASS] Single hue (spread 1°)   exit 0

$ node validate_palette.js "#2baea1,#008c80,#006b61,#004b45" --ordinal --mode light --surface "#ffffff"
  [PASS] Lightness monotone · [PASS] Adjacent ΔL >= 0.06
  [PASS] Light-end contrast     #2baea1 at 2.74:1 vs surface · [PASS] Single hue (spread 2°)   exit 0

$ node validate_palette.js "#006b61,#008c80,#2baea1,#6fcabf,#abe5dd" --ordinal --mode dark --surface "#121a1f"
  [PASS] Lightness monotone · [PASS] Adjacent ΔL >= 0.06
  [PASS] Light-end contrast     #006b61 at 2.75:1 vs surface · [PASS] Single hue (spread 2°)   exit 0

$ node validate_palette.js "#008d7c,#de6e29" --mode light --surface "#ffffff"      # polos del waterfall
  [PASS] CVD separation ΔE 10.2 (protan) · [PASS] Normal-vision 25.7 · [PASS] Contrast   exit 0
$ node validate_palette.js "#009b90,#d76821" --mode dark --surface "#121a1f"
  [PASS] CVD separation ΔE 14.0 (protan) · [PASS] Normal-vision 25.2 · [PASS] Contrast   exit 0
```

Separación adicional calculada con el mismo validador (filas de separación; el gris no es categórico, por eso no se le aplican
banda ni croma): total `#334155` ↔ teal 20.8 / ↔ naranja 25.7 (claro); total `#cbd5e1` ↔ teal 21.7 / ↔ naranja 25.9 (oscuro).
Facturado/cobrado (seq-400 ↔ seq-700 claro) CVD 30.7, normal 31.2, contraste del facturado 2.74:1 → alivio con leyenda + tabla;
(seq-500 ↔ seq-200 oscuro) CVD 29.2, normal 30.8, ambos ≥ 3:1.
Descartado: facturado en gris neutro `#8a96a6` junto a teal — CVD 7.4 y visión normal 13.7 (< 15, falla dura).
