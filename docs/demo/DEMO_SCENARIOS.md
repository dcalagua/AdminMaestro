# Escenarios de demostración

El seed (`supabase/seed.sql`) es **determinista**: mismos UUID, mismos importes,
mismo resultado en cada `npm run db:reset`. Termina con un bloque de
verificación que **falla ruidosamente** si el modelo queda incompleto, en vez de
dejar una base a medias que parece cargada.

> Datos ficticios. Ninguna persona, empresa ni cifra es real. Usuarios en el
> dominio de fixtures `@ebim.test` (contrato §11: nunca cuentas reales).

## 1. Catálogo

| Producto | Código | Unidad de cobro |
|---|---|---|
| eSupplier by EBIM | `esupplier` | TENANT |
| EWM by EBIM | `ewm` | **WAREHOUSE** (contrato §11.1: WMS cobra por almacén) |
| TMS by EBIM | `tms` | TENANT |
| GMAO by EBIM | `gmao` | TENANT |
| eChange by EBIM | `echange` | TENANT |

## 2. Organizaciones

| Organización | País | Capacidades |
|---|---|---|
| EBIM | PE | PLATFORM |
| Consultora Andina | PE | PARTNER · CONSULTING · **CUSTOMER** |
| Reseller Pacífico | CL | PARTNER · RESELLER |
| Empresa Directa Alpha | PE | CUSTOMER |
| Empresa Enterprise Omega | PE | CUSTOMER (2 sociedades: PE y CO) |
| Cliente Partner Uno | PE | CUSTOMER |
| Cliente Partner Dos | PE | CUSTOMER |
| Cliente EWM Norte | CL | CUSTOMER |
| Cliente EWM Sur | CL | CUSTOMER |
| Industrias Titán | PE | CUSTOMER |

Consultora Andina es partner **y** cliente a la vez: el modelo de capacidades lo
soporta sin duplicar la cuenta.

## 3. Los nueve escenarios

### 1 · eSupplier SHARED — venta directa de EBIM

`alpha-esupplier` · Empresa Directa Alpha · sin partner.
Licencia USD 850/mes + addon Licitaciones USD 350/mes + implementation fee
USD 3.500 (one-time). Atribuida a **Carla Comercial** (independiente).

### 2 · eSupplier SHARED — partner con múltiples tenants

Consultora Andina administra `cliente-p1-esupplier` y `cliente-p2-esupplier`,
**los dos en el MISMO target compartido** `shared-esupplier-sa-east`, junto al
tenant directo de Alpha y a un DEMO.

Es el escenario que demuestra que un partner **no necesita infraestructura
propia** para tener cartera. Margen de canal: 25%.

### 3 · eSupplier PARTNER_DEDICATED — Consultora Andina

Target `andina-esupplier-dedicated` (dueño: Andina) con dos tenants.

```
SUB-ANDINA-PD-BASE   (sin tenant)  licencia base 2.200 + infra 900 + setup 8.000
SUB-ANDINA-PD-A      cliente A     licencia por tenant 480/mes
SUB-ANDINA-PD-B      cliente B     licencia por tenant 480/mes
```

La licencia base es una suscripción **sin tenant**: es del partner.

### 4 · eSupplier TENANT_DEDICATED — Empresa Enterprise Omega

Target exclusivo `omega-esupplier-dedicated`, un solo tenant.
Licencia Enterprise 4.200 + infra 1.500 + soporte premium 800 + addons 650, con
setup de 18.000. Addons: marca blanca, multi-país, SLA premium, licitaciones.
Dos sociedades (Perú y Colombia) con config por sociedad: la colombiana
sobrescribe `tax_id_label = NIT`, moneda COP y zona horaria de Bogotá.

### 5 · EWM SHARED — dos tenants

`alpha-ewm` (directo) y `p1-ewm` (vía Andina) en `shared-ewm-sa-east`, más un
TRIAL (`trial-ewm-alpha`).

### 6 · EWM PARTNER_DEDICATED — Reseller Pacífico con 2 clientes finales

Target `pacifico-ewm-dedicated` con `ewm-norte` y `ewm-sur`.
Licencia base 1.900 + infra 1.100 + 520/mes por tenant. Margen 20%.

### 7 · EWM TENANT_DEDICATED — Industrias Titán

Target exclusivo `titan-ewm-dedicated`.
Licencia 3.800 + infra 1.400 + setup 15.000 + SLA premium.

### 8 · Partner multi-SaaS

Consultora Andina está habilitada para **eSupplier y EWM** con condiciones
distintas por producto:

| Producto | Margen | Nivel | Soporte incluido |
|---|---|---|---|
| eSupplier | 25% | GOLD | Sí |
| EWM | 18% | SILVER | No |

Es exactamente el caso del contrato §11.1: lo canónico es la jerarquía, no las
condiciones.

### 9 · Comercial independiente con ventas en dos productos

**Carla Comercial** (`comercial@indep.ebim.test`), sin organización:

| Atribución | Producto | Cliente | Origen |
|---|---|---|---|
| `alpha-esupplier` | eSupplier | Empresa Directa Alpha | DIRECT |
| `titan-ewm` | EWM | Industrias Titán | REFERRAL |

Plan `indep-standard`: 10% de licencia cobrada por 12 meses + 5% del
implementation fee cobrado.

**Carla NO tiene ninguna fila en `tenant_memberships`.** Ve sus comisiones y no
puede entrar a ningún tenant. Verificado en `01_rls_isolation.test.sql` #16 y en
el E2E "un SALES_AGENT ve su tablero comercial y nada operativo".

## 4. Datos financieros

Tres meses de historia:
- **meses −2 y −1**: facturados y **cobrados** (pago confirmado) → generan
  comisión por el trigger;
- **mes actual**: facturado y **sin cobrar** → así el dashboard muestra que
  facturado ≠ cobrado, que es el punto;
- el implementation fee se cobra **una sola vez**, en el primer mes;
- una factura `VOID` y una `DRAFT` de USD 9.999 cada una, que **no deben**
  aparecer en ningún agregado (test `02` #13).

Resultado:

| Métrica | Valor |
|---|---|
| MRR | USD 24.750,00 |
| Ingreso cobrado | USD 98.600,00 |
| Costo registrado | USD 16.584,00 |
| Comisión pendiente | USD 1.593,60 |
| Comisión pagada | USD 1.390,00 |
| Tenants productivos | 11 |
| Demo / trial | 2 |
| Tenants por modelo | 7 SHARED · 4 PARTNER_DEDICATED · 2 TENANT_DEDICATED |

## 5. Provisioning

Cuatro solicitudes en `DRY_RUN`, cubriendo la máquina de estados completa:

| Solicitud | Estado | Para qué |
|---|---|---|
| `prov-alpha-esupplier-0001` | SUCCEEDED | Timeline completo: PENDING → VALIDATING → RUNNING → SUCCEEDED. |
| `prov-andina-dedicated-0001` | SUCCEEDED | Creación de target dedicado (simulada). |
| `prov-titan-ewm-0001` | FAILED | Con `error_message` y 2 intentos: habilita el botón de reintento. |
| `prov-ewm-sur-0001` | PENDING | En cola. |

## 6. Cómo recorrer la demo en 5 minutos

1. Entra como `dcalagua@ebim.pe` → **Dashboard**: MRR, cobrado, costos, margen.
2. **SaaS Products** → eSupplier → pestaña *Organizaciones habilitadas*: se ve el
   partner multi-SaaS con su margen.
3. **Tenants** → filtro *Dedicados*: los tres modelos conviviendo.
4. Abre `Empresa Enterprise Omega · eSupplier` → pestañas *Suscripción*
   (licencia + infra + soporte + setup) y *Atribución comercial*.
5. **Costos y margen** → pestaña *Por partner*: rentabilidad del canal.
6. **Provisioning** → *Timeline* de la solicitud fallida.
7. Cierra sesión y entra como `comercial@indep.ebim.test`: el mismo sistema,
   otro mundo — sólo su tablero comercial.
8. Entra como `admin@andina.ebim.test` y ve a `/costs`: acceso denegado.
