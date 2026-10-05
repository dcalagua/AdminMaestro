# FASE 07 — Login, bienvenida y portal de pago

## Objetivo
Las pantallas que ven Gerencia y los clientes primero. Deben gritar «EBIM» y «confiable».

## Alcance
- `LoginPage`: cumplir y elevar U-04/U-05 al pie de la letra (tarjeta 22px, grid 1fr 1fr, máx 1000, panel izquierdo con isotipo animado
  «gira y para» (U-03), wordmark, eyebrow, párrafo, EXACTAMENTE 3 bullets, pie de confianza; panel derecho con labels encima, ojo de
  contraseña, «¿Olvidaste tu contraseña?» a la derecha, CTA ancho completo, un solo link secundario, lockup al pie). Fondo con
  gradiente de marca sutil. Oculta panel izquierdo en móvil.
- `/bienvenida` (fijar contraseña) con la misma anatomía y medidor de fortaleza.
- `/pagar` (portal de pago público): cabecera de marca, tarjeta de estado de cuenta con total pendiente destacado, lista de facturas
  como tarjetas claras, botón de pago prominente, bloque «Pago automático» con explicación de confianza (Culqi, sin guardar datos de
  tarjeta), comprobante elegante con check animado (respetando reduced motion), estados de enlace vencido/revocado amables. Responsive móvil impecable (los clientes pagarán desde el celular).

## Pasos
1. Implementa. 2. Tests existentes de login/portal verdes (ajusta textos con criterio). 3. Capturas `VISUAL_LABEL=fase07`
   de login (claro/oscuro, 1440 y 390 de ancho), bienvenida y `/pagar` (con un enlace de demo de la fase 02 si existe; si no, el estado inválido).
4. Gate completo. 5. Commits.

## Hecho cuando
Las tres pantallas al nivel del sistema visual, móvil incluido, gates verdes.
