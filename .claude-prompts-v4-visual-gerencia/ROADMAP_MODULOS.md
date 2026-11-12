# Roadmap de módulos para el Admin Maestro

Ordenados por valor para el negocio. Esta noche se construyen **1** y **2**. El resto se propone para corridas siguientes:
cada uno merece su propia especificación corta antes de ejecutarse.

| # | Módulo | Qué resuelve | Esfuerzo | Estado |
|---|---|---|---|---|
| 1 | **Series ejecutivas (MRR histórico y movimientos)** | Tendencia real del negocio: MRR/ARR mensual, puente nuevo/expansión/contracción/churn, cartera por antigüedad | M | Esta noche (fase 08) |
| 2 | **Liquidación y pago de comisiones** | Cerrar el ciclo vendedor: devengado → liquidación → aprobación → pago con referencia | M | Esta noche (fase 13) |
| 3 | **Centro de cobranza y dunning** | Recordatorios automáticos por correo/WhatsApp antes y después del vencimiento, promesas de pago, escalamiento y suspensión gobernada; un tablero de cobranza diario | L | Siguiente |
| 4 | **Notificaciones y correo transaccional** | SMTP/proveedor propio, plantillas en español con marca (invitación, enlace de pago, recibo, factura, recordatorio), bitácora de envíos | M | Siguiente (habilita 3) |
| 5 | **Cotizaciones y propuestas (CPQ)** | Armar propuesta con planes/add-ons/descuentos aprobados, PDF de marca, aceptación del cliente y conversión automática en venta (onboarding) | L | Siguiente |
| 6 | **Portal autenticado de cliente y partner** | Autoservicio: facturas y pagos, usuarios de su empresa, consumo, cambio de plan, estado de cuenta del partner | L | Después |
| 7 | **Customer Success: salud y riesgo de churn** | Health score por cliente (uso, cobros, adopción de módulos, antigüedad), alertas de riesgo y playbooks | M | Después |
| 8 | **Facturación electrónica por país** (D-13) | Emisión fiscal SUNAT (PE), SIN (BO), SRI (EC) vía proveedor certificado; hoy la factura es gerencial | XL | Requiere decisión |
| 9 | **Metas, forecast y presupuesto** | Metas por vendedor/partner/producto, MRR proyectado, cumplimiento vs presupuesto | M | Después |
| 10 | **Cierres mensuales y snapshots** | Congelar KPIs al cierre (auditables), comparar meses sin que cambios retroactivos muevan cifras | S | Junto con 1 o 9 |
| 11 | **Reportes programados y exportación BI** | Resumen semanal por correo a Gerencia, exportación Excel/CSV, conector a BI | S–M | Después |
| 12 | **Integración contable/ERP** | Asientos de ventas, cobros y comisiones hacia el ERP | L | Requiere decisión |
| 13 | **Contratos y documentos** | Carga de OS/OC y contratos en Storage, versiones, vencimientos y firma | M | Después |
| 14 | **Soporte y SLA por tenant** | Incidencias por cliente/producto, SLA por plan, impacto en salud del cliente | M | Después |

## Recomendación de secuencia
1. Esta noche: 1 + 2 + rediseño visual.
2. Siguiente corrida: **4 → 3** (correo y luego cobranza automática): impacto directo en caja.
3. Luego **5** (CPQ) y **7** (salud del cliente): crecimiento y retención.
4. **8** y **12** dependen de decisiones de negocio y proveedores; conviene definirlos en una reunión con Finanzas.
