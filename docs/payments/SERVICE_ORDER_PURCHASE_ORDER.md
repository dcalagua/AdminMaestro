# Órdenes de Servicio y Órdenes de Compra

**Fase 08 de V2.** Migración: `20260907000500_commercial_documents.sql`.

---

## 1. Qué es y qué NO es

Una OS/OC es el documento **administrativo** con el que el cliente autoriza el
gasto. En muchas empresas peruanas, sin ella no entra ninguna factura al
circuito de pago, así que el Control Plane necesita saber si existe, en qué
estado está y cuándo caduca.

**No es una Culqi Order. No es un cobro.**

| Acción | ¿Mueve el trámite? | ¿Mueve dinero? |
|---|---|---|
| Solicitar la OS | Sí | No |
| Registrar que llegó | Sí | No |
| **Aprobarla** | **Sí** | **NO** |
| Confirmar un pago | — | Sí |

La comisión sigue naciendo donde nacía: de un `payments.status = 'CONFIRMED'`.

> **Verificado, no afirmado.** `04_v2_business.test.sql` §5-9 cuenta `payments`
> y `commission_events` antes y después de aprobar una OS. Los dos números son
> idénticos.

---

## 2. Máquina de estados

```
                 ┌───────────┐
                 │ REQUESTED │  se pidió al cliente
                 └─────┬─────┘
                       │ receive (exige NÚMERO)
                 ┌─────▼─────┐
        ┌────────┤ RECEIVED  │
        │        └─────┬─────┘
        │ reject       │ approve (exige VENCIMIENTO)
   ┌────▼─────┐  ┌─────▼─────┐
   │ REJECTED │  │ APPROVED  │  habilita la continuidad administrativa
   └────┬─────┘  └─────┬─────┘
        │              │
        └──────┬───────┴──────┐
          ┌────▼────┐   ┌─────▼────┐
          │CANCELLED│   │ EXPIRED  │   terminales
          └─────────┘   └──────────┘
```

Lo que la máquina impide, y por qué importa:

- **No se aprueba lo que no ha llegado.** `REQUESTED → APPROVED` no existe. Ese
  salto es exactamente el agujero que este modelo cierra: aprobar un documento
  que nadie ha visto.
- **Recibida exige número.** Sin `document_number` no está recibida: está
  solicitada. Lo imponen un `CHECK` y la RPC (`NUMERO_REQUERIDO`).
- **Aprobada exige vencimiento.** Un documento aprobado sin `valid_to` no podría
  caducar nunca, y entonces «una vencida no autoriza la renovación» sería
  inaplicable (`VIGENCIA_REQUERIDA`).
- **Un solo documento vivo** por suscripción y tipo (índice `scd_open_uk`):
  pedir dos OS a la vez para el mismo contrato es un error de proceso.

---

## 3. Caducidad

`expire_commercial_documents(p_as_of)` es **determinista** (recibe la fecha) e
**idempotente**: la primera pasada caduca lo vencido y la segunda con la misma
fecha devuelve 0.

Un documento vencido **no autoriza la renovación**: la vista
`v_subscription_documents` expone `document_ok`, que responde a la única
pregunta que importa — *¿tiene esta suscripción, HOY, la autorización
administrativa que su método de cobro exige?*

---

## 4. Archivos

`external_file_ref` guarda una **referencia**: una ruta de storage o un enlace
del ERP del cliente. Nunca el contenido, y nunca una URL firmada — que caduca y
es, de hecho, un secreto de corta vida.

---

## 5. Superficie

| RPC | Qué exige |
|---|---|
| `request_commercial_document` | Autorización sobre la suscripción |
| `receive_commercial_document` | Número de documento |
| `approve_commercial_document` | Estado `RECEIVED` + fecha de vencimiento |
| `reject_commercial_document` | Motivo |
| `cancel_commercial_document` | — |
| `expire_commercial_documents` | Rol EBIM; recibe `p_as_of` |

Autorización: EBIM comercial/finanzas, o el admin de la organización a la que se
factura (`can_manage_subscription_documents`).

La tabla no es escribible directamente por `authenticated`.

---

## 6. Dónde se ve

`/subscriptions/:id` → pestaña **Cobranza** → tarjeta «Órdenes de Servicio /
Compra», con la línea de tiempo (solicitada / recibida / aprobada) y las
acciones disponibles según el estado.
