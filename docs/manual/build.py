#!/usr/bin/env python3
"""Genera manual/index.html (web y PDF) a partir del contenido estructurado."""
import html, os

E = html.escape
HERE = os.path.dirname(os.path.abspath(__file__))

ICONS = {
    'home': '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    'inbox': '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    'building': '<path d="M4 21V4h10v17"/><path d="M14 9h6v12"/><path d="M8 8h2M8 12h2M8 16h2M3 21h18"/>',
    'users': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4"/><path d="M21 20c0-2.4-1.4-4.3-3.6-5"/>',
    'handshake': '<path d="M3 12l4-4 4 2 3-3 7 5"/><path d="M7 15l3 3 2-2 2 2 3-3-4-4"/><path d="M3 12v3l4 0"/>',
    'grid': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'cycle': '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
    'window': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    'layers': '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    'plug': '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
    'rocket': '<path d="M9 15l-3-3c2-6 7-9 13-9 0 6-3 11-9 13z"/><circle cx="14.5" cy="9.5" r="1.6"/><path d="M5.5 15.5C4 17 4 20 4 20s3 0 4.5-1.5"/>',
    'file': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    'book': '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
    'coins': '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
    'percent': '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
    'chart': '<path d="M4 20V11M10 20V4M16 20v-7M3 20h18"/>',
    'store': '<path d="M4 9l1-5h14l1 5"/><path d="M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    'shield': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    'gear': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    'check': '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'alert': '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.2v.3"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.3"/>',
    'bolt': '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    'eye': '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'key': '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    'pulse': '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
}


def icon(name, cls='i'):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'


def li(items):
    return ''.join(f'<li>{icon("check", "li-i")}<span>{t}</span></li>' for t in items)


def frame(img, url, alt, cap=None):
    c = f'<figcaption>{cap}</figcaption>' if cap else ''
    return f'''<figure class="shot">
  <div class="frame">
    <div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">{icon("search", "url-i")}adminmaestro.pages.dev{E(url)}</span></div>
    <button type="button" data-full="img/{img}.jpg" aria-label="Ampliar: {E(alt)}"><img src="img/{img}.jpg" alt="{E(alt)}" loading="lazy" width="1440" height="900"></button>
  </div>{c}
</figure>'''


def module(m):
    shots = m['shots']
    if len(shots) == 1:
        s = shots[0]
        figs = frame(*s)
    else:
        figs = '<div class="pair">' + ''.join(frame(*s) for s in shots) + '</div>'
    panels = ''
    if m.get('find'):
        panels += f'<div class="panel find"><h4>{icon("eye", "h-i")}Qué encuentras</h4><ul>{li(m["find"])}</ul></div>'
    if m.get('act'):
        panels += f'<div class="panel act"><h4>{icon("bolt", "h-i")}Acciones</h4><ul>{li(m["act"])}</ul></div>'
    note = ''
    if m.get('note'):
        kind, text = m['note']
        note = f'<div class="callout {kind}">{icon("alert" if kind == "warn" else "info", "c-i")}<p>{text}</p></div>'
    return f'''<article class="module" id="{m['id']}">
  <div class="m-head">
    <span class="m-icon">{icon(m['icon'])}</span>
    <div class="m-title"><h3>{m['title']}</h3><span class="route">{E(m['path'])}</span></div>
  </div>
  <p class="purpose">{m['purpose']}</p>
  {figs}
  {f'<div class="panels">{panels}</div>' if panels else ''}
  {note}
</article>'''


CHAPTERS = [
    {
        'key': 'inicio', 'n': '03', 'title': 'Inicio', 'icon': 'home',
        'lead': 'El pulso del negocio y lo que hay que hacer hoy. Es la primera pantalla después de ingresar.',
        'modules': [
            dict(id='m-resumen', icon='chart', title='Resumen ejecutivo', path='Inicio › Resumen',
                 purpose='Cuánto factura el negocio, si crece, de dónde viene el crecimiento, si se cobra y qué requiere atención. Cada cifra abre el detalle que la compone.',
                 shots=[('resumen', '/', 'Resumen ejecutivo con KPIs y gráficos de MRR')],
                 find=['Tres vistas: <b>Ejecutivo</b>, <b>Finanzas</b> y <b>Operación SaaS</b>.',
                       'Evolución del MRR, puente de cambios, cobrado frente a facturado y antigüedad de la cartera.',
                       'MRR por producto y por mercado, cada moneda por separado, sin mezclarlas.'],
                 act=['Cambiar el horizonte a <b>12 o 18 meses</b> y alternar gráfico o tabla.',
                      '<b>Presentar</b>: modo de proyección para reuniones, con opción de ocultar nombres.']),
            dict(id='m-bandeja', icon='inbox', title='Bandeja', path='Inicio › Bandeja',
                 purpose='Lo que requiere atención hoy, en una sola lista y con la acción al lado.',
                 shots=[('bandeja', '/bandeja', 'Bandeja de pendientes agrupados por tipo')],
                 find=['Filtros por urgencia: <b>Urgentes</b>, <b>Importantes</b> y <b>Normales</b>.',
                       'Grupos con contador: 18 facturas vencidas, 16 renovaciones y alertas, 1 documento por aprobar.',
                       'La campana de la barra superior muestra el mismo contador.'],
                 act=['Cada pendiente abre directamente la pantalla donde se resuelve.']),
        ],
    },
    {
        'key': 'clientes', 'n': '04', 'title': 'Clientes', 'icon': 'users',
        'lead': 'Las cuentas, los canales que venden con EBIM y el equipo comercial con su cartera.',
        'modules': [
            dict(id='m-cuentas', icon='building', title='Cuentas', path='Clientes › Cuentas',
                 purpose='Clientes y organizaciones de la plataforma. Es la puerta de entrada a la ficha 360 de cada cliente.',
                 shots=[('cuentas', '/cuentas', 'Listado de cuentas cliente')],
                 find=['Pestañas <b>Clientes</b> y <b>Todas las organizaciones</b>.', 'Filtros de activos o archivados y buscador por nombre, RUC o país.'],
                 act=['<b>Nuevo cliente</b>. Para vender un plan completo, usa Comercial › Nueva venta.']),
            dict(id='m-cuenta360', icon='eye', title='Ficha 360 del cliente', path='Cuentas › un cliente',
                 purpose='Todo lo de un cliente en una ficha: qué contrató, qué debe, en qué paso está su alta y en qué apps está.',
                 shots=[('cuenta-360', '/organizations/…', 'Ficha 360 de Industrias Titán, pestaña Resumen', 'Resumen: cabecera fija y avance del alta.'),
                        ('cuenta-360-apps', '/organizations/…?tab=apps', 'Ficha 360, pestaña Apps y accesos', 'Apps y accesos: un bloque por app.')],
                 find=['<b>Cabecera fija</b>: estado, salud de cobranza, MRR, saldo vencido, apps activas y responsable comercial.',
                       '<b>¿En qué paso está el alta del cliente?</b>: cuenta, contrato, factura, enlace de pago, pago y alta en las apps.',
                       'Pestañas: Resumen, Apps y accesos, Contratos y cobranza, Personas y Actividad.'],
                 act=['<b>Dar de alta en las apps</b>: abre la tabla de altas de este cliente.', '<b>Generar enlace de pago</b> y <b>Más acciones</b>.']),
            dict(id='m-partners', icon='handshake', title='Partners y canales', path='Clientes › Partners',
                 purpose='Organizaciones que comercializan o administran tenants. Sus condiciones pueden variar por producto; los acuerdos y la cartera están en su ficha 360.',
                 shots=[('partners', '/partners', 'Listado de partners y canales')],
                 act=['<b>Nuevo partner</b> y acceso a su ficha con acuerdos por producto.']),
            dict(id='m-equipo', icon='users', title='Equipo comercial', path='Clientes › Equipo comercial',
                 purpose='Los comerciales y la cartera que tienen atribuida. Cobrar una comisión no da acceso operativo a ningún tenant.',
                 shots=[('equipo-comercial', '/sales-agents', 'Listado de comerciales', 'Comerciales.'),
                        ('atribuciones', '/sales-agents?tab=atribuciones', 'Atribuciones comerciales vigentes', 'Atribuciones: base del cálculo de comisiones.')],
                 act=['<b>Nuevo comercial</b> y <b>Nueva atribución</b>.']),
        ],
    },
    {
        'key': 'suite', 'n': '05', 'title': 'Suite', 'icon': 'grid',
        'lead': 'El corazón del Admin Maestro: las 8 apps, cada cliente en cada app y la conexión segura con ellas.',
        'modules': [
            dict(id='m-centro', icon='grid', title='Centro de la suite', path='Suite › Centro de la suite',
                 purpose='La salud de las 8 apps y el estado de cada cuenta en cada app, en una sola pantalla.',
                 shots=[('suite', '/suite', 'Franja de salud con una tarjeta por app', 'Salud de las apps: estado, hora del último chequeo y canales de cada app.')],
                 find=['<span class="pill ok">Activo</span> existe en la app y en el Admin Maestro.',
                       '<span class="pill warn">Sin alta</span> existe aquí, pero nunca se creó en la app.',
                       '<span class="pill warn">Pendiente de confirmar</span> la app ya lo creó; falta confirmarlo aquí.',
                       '<span class="pill off">De baja</span> archivado. Un guion «—» indica que el cliente no tiene esa app.'],
                 act=['<b>Verificar ahora</b>: llamada real y firmada a la app.',
                      'Filtros: Requieren atención, Por confirmar, Alta fallida, En curso, Suspendidas, Activas.',
                      'Desde una celda: <b>Ver tenant</b>, <b>Confirmar como activo</b>, <b>Reintentar alta</b>, <b>Suspender</b>.']),
            dict(id='m-matriz', icon='layers', title='Matriz cliente × app', path='Centro de la suite › Cuentas en cada app',
                 purpose='Una fila por cliente y una columna por app. Al abrir una celda se ve el detalle del tenant y sus acciones.',
                 shots=[('matriz', '/suite', 'Matriz con una fila por cuenta y una columna por app', 'Cuentas en cada app.'),
                        ('celda-detalle', '/suite', 'Panel con el detalle del tenant Textiles Arequipa en EWM', 'Detalle de una celda.')]),
            dict(id='m-ciclo', icon='cycle', title='Ciclo de vida y cortes', path='Centro de la suite › Ciclo de vida y cortes',
                 purpose='Cobranza, cortes por impago y reactivación de cada cliente en cada app. La regla vive en la base: el corte automático solo actúa si el super admin lo habilita.',
                 shots=[('ciclo-vida', '/suite/ciclo-de-vida', 'Ciclo de vida de los tenants')],
                 find=['KPIs: tenants activos, en gracia, <b>por suspender</b> y suspendidos.', 'Pestañas: Matriz, Cobranza y cortes, Historial de suspensiones, Política y jobs.'],
                 act=['<b>Simular ciclo</b>: muestra qué pasaría, sin cambiar nada.', '<b>Ejecutar ciclo ahora</b>: aplica la política. Con el corte automático apagado no suspende a nadie.'],
                 note=('warn', '<b>Hoy:</b> el corte automático está apagado y 16 tenants figuran «por suspender». Encenderlo es una decisión de negocio del super admin y queda en la auditoría.')),
            dict(id='m-ficha-app', icon='window', title='Ficha de una app', path='Centro de la suite › Ver ficha',
                 purpose='Salud, tenants, conexión, módulos, uso e historial de altas de una app.',
                 shots=[('ficha-app', '/apps/tms', 'Ficha de la app TMS')],
                 find=['<b>Resumen</b>: salud por entorno y canales.', '<b>Tenants</b>: los clientes de esa app.', '<b>Conexión</b>: cómo se conecta de forma segura, sin mostrar secretos.', '<b>Sincronización</b>, <b>Uso</b> e <b>Historial</b> de altas.'],
                 act=['<b>Verificar ahora</b> en cada entorno.']),
            dict(id='m-tenants', icon='layers', title='Tenants', path='Suite › Tenants',
                 purpose='Todos los tenants de todas las apps. Un tenant pertenece a una sola app; dónde vive lo decide su modo de despliegue.',
                 shots=[('tenants', '/tenants', 'Listado de tenants', 'Listado con filtros.'),
                        ('tenant-360', '/tenants/…', 'Ficha del tenant Textiles Arequipa en EWM', 'Ficha del tenant.')],
                 act=['<b>Nuevo tenant</b>: el asistente del capítulo 9.', 'En la ficha: <b>Suspender</b> o reactivar, con motivo y vista previa del impacto.']),
            dict(id='m-apps', icon='plug', title='Apps', path='Suite › Apps',
                 purpose='La conexión técnica de la consola con cada app: integraciones, altas, módulos habilitados, uso, entornos y solicitudes de infraestructura.',
                 shots=[('apps', '/apps', 'Pestaña de integraciones SaaS', 'Integraciones.'),
                        ('apps-altas', '/apps?tab=altas', 'Altas en las apps', 'Altas en las apps.')],
                 act=['Revisar o reintentar un alta.', 'Completar la configuración que pide una app (por ejemplo, EWM).']),
        ],
    },
    {
        'key': 'comercial', 'n': '06', 'title': 'Comercial', 'icon': 'rocket',
        'lead': 'Vender, contratar y definir qué se vende.',
        'modules': [
            dict(id='m-venta', icon='rocket', title='Nueva venta', path='Comercial › Nueva venta',
                 purpose='Da de alta a un cliente de principio a fin: cuenta, plan con su precio y contrato. Después emite la primera factura, envía el enlace de pago y activa sus apps.',
                 shots=[('nueva-venta', '/onboarding', 'Asistente de nueva venta en seis pasos')],
                 find=['Seis pasos: Cuenta › Plan y precio › Contrato › Primera factura › Enlace de pago › Alta en las apps.'],
                 act=['Nueva venta crea contrato y factura. «Nuevo tenant» solo crea el espacio del cliente en una app.']),
            dict(id='m-contratos', icon='file', title='Contratos y suscripciones', path='Comercial › Contratos',
                 purpose='La cartera contractual: licencias por tenant, licencias base de partner y fees de infraestructura dedicada.',
                 shots=[('contratos', '/subscriptions', 'Listado de contratos y suscripciones')],
                 find=['Filtros: Activas, Pago atrasado, Borrador, Pausadas y Canceladas.'],
                 act=['<b>Nueva suscripción</b>; cada contrato abre su ficha 360.']),
            dict(id='m-catalogo', icon='book', title='Catálogo', path='Comercial › Catálogo',
                 purpose='Lo que se vende: productos de la suite, planes, add-ons y las capacidades que habilita cada uno.',
                 shots=[('catalogo', '/catalogo', 'Catálogo de productos', 'Productos.'),
                        ('catalogo-planes', '/catalogo?tab=planes', 'Planes y licencias', 'Planes y licencias.')],
                 find=['Pestañas: Productos, Planes y licencias, Add-ons y tarifas, Capacidades, Registro de capacidades.']),
        ],
    },
    {
        'key': 'finanzas', 'n': '07', 'title': 'Finanzas', 'icon': 'coins',
        'lead': 'Cobrar, pagar comisiones y entender el margen de cada producto, partner y tenant.',
        'modules': [
            dict(id='m-cobranza', icon='coins', title='Cobranza', path='Finanzas › Cobranza',
                 purpose='Qué hay que cobrar hoy, facturas, cobros, conciliación con la pasarela y renovaciones por vencer.',
                 shots=[('cobranza', '/cobranza', 'Facturas por cobrar', 'Por cobrar.'),
                        ('conciliacion', '/cobranza?tab=conciliacion', 'Conciliación con la pasarela', 'Conciliación.')],
                 find=['Pestañas: Por cobrar, Facturación y cobros, Renovaciones y Conciliación.'],
                 act=['<b>Emitir factura</b> y enviar el enlace al portal de pago del cliente.']),
            dict(id='m-comisiones', icon='percent', title='Comisiones', path='Finanzas › Comisiones',
                 purpose='Comisiones generadas solo por cobros confirmados, sus liquidaciones y los planes que las calculan.',
                 shots=[('comisiones', '/commissions', 'Comisiones y liquidaciones')],
                 act=['<b>Generar liquidación</b> y <b>Exportar CSV</b>.']),
            dict(id='m-costos', icon='chart', title='Costos y margen', path='Finanzas › Costos y margen',
                 purpose='Margen gerencial = cobrado − costo asignado − comisión. Es una lectura de gestión, no utilidad neta ni resultado contable.',
                 shots=[('costos', '/costs', 'Costos registrados y margen')],
                 find=['Costos registrados y margen por producto, por partner y por tenant.']),
            dict(id='m-tarifas', icon='store', title='Tarifas de partners', path='Finanzas › Tarifas de partners',
                 purpose='Lo que cada partner paga a EBIM por usar la plataforma con los clientes que él factura. No son comisiones.',
                 shots=[('tarifas-partners', '/partner-fees', 'Estados de cuenta de partners')],
                 act=['<b>Calcular</b> o <b>Calcular todos</b>: genera el estado de cuenta, que luego se emite como factura al partner.']),
        ],
    },
    {
        'key': 'gobierno', 'n': '08', 'title': 'Gobierno', 'icon': 'shield',
        'lead': 'Quién entra, qué hizo cada persona y cómo se configura la consola.',
        'modules': [
            dict(id='m-usuarios', icon='user', title='Usuarios y accesos', path='Gobierno › Usuarios',
                 purpose='Personal EBIM, usuarios de partners y de clientes: perfil, accesos, invitaciones, desactivación y a qué apps entra cada persona.',
                 shots=[('usuarios', '/users', 'Usuarios y accesos')],
                 act=['<b>Invitar usuario</b>. Requiere el correo transaccional configurado.']),
            dict(id='m-auditoria', icon='shield', title='Auditoría', path='Gobierno › Auditoría',
                 purpose='Las acciones administrativas sensibles, día por día. La bitácora no se puede editar ni borrar desde la aplicación: lo impide la base de datos.',
                 shots=[('auditoria', '/audit', 'Bitácora de auditoría')],
                 act=['<b>Ver detalle</b> de cada acción y <b>Exportar CSV</b>.']),
            dict(id='m-config', icon='gear', title='Configuración', path='Gobierno › Configuración',
                 purpose='Sesión y apariencia de cada usuario; para EBIM, además, monedas y tipo de cambio, créditos IA, cuentas de pago y opciones avanzadas.',
                 shots=[('configuracion', '/settings', 'Configuración general', 'General y apariencia.'),
                        ('creditos-ia', '/settings?tab=creditos-ia', 'Créditos IA', 'Créditos IA.')]),
        ],
    },
]


def chapter(ch):
    chips = ''.join(f'<a class="chip" href="#{m["id"]}">{icon(m["icon"], "chip-i")}{m["title"]}</a>' for m in ch['modules'])
    mods = ''.join(module(m) for m in ch['modules'])
    return f'''<section class="chapter c-{ch['key']}" id="{ch['key']}">
  <div class="opener">
    <div class="opener-inner">
      <span class="big-n" aria-hidden="true">{ch['n']}</span>
      <div class="opener-text">
        <span class="kicker">{icon(ch['icon'], 'k-i')}Capítulo {int(ch['n'])}</span>
        <h2>{ch['title']}</h2>
        <p>{ch['lead']}</p>
        <nav class="chips" aria-label="Módulos de {ch['title']}">{chips}</nav>
      </div>
    </div>
  </div>
  <div class="ch-body">{mods}</div>
</section>'''


APPS = [
    ('TMS', '#2B7A9B', 'GRUPASA · TMS', 'grupasa-tms', '16 s', 'Asistente completo'),
    ('TMS', '#2B7A9B', 'Industrias Titán · TMS', 'industrias-titan-tms', '10 s', 'Desde la ficha 360'),
    ('eChange', '#8A5CB8', 'Exportadora Guayas · eChange', 'exportadora-guayas-echange', '16 s', 'Asistente completo'),
    ('eSupplier', '#056769', 'Industrias Titán · eSupplier', 'industrias-titan-esupplier', '15 s', 'Entorno Desarrollo (DEVQAS)'),
    ('eCommerce', '#2D5BD3', 'Empresa Enterprise Omega · eCommerce', 'omega-ecommerce', '14 s', 'Asistente completo'),
    ('Comerza', '#B4436C', 'GRUPASA · Comerza', 'grupasa-comerza', '13 s', 'Asistente completo'),
    ('EWM', '#3E8F63', 'Textiles Arequipa · EWM', 'textiles-arequipa-ewm', '—', 'Con empresa y almacén WH-AQP'),
    ('eExpense', '#C2610C', 'EBIM eExpense QAS Smoke', 'prueba técnica', '—', 'Existente; no se creó otro'),
    ('GMAO', '#185D4A', 'EBIM GMAO QAS Smoke', 'prueba técnica', '—', 'Existente; no se creó otro'),
]


def app_cards():
    out = []
    for name, color, tenant, code, t, how in APPS:
        out.append(f'''<div class="app-card" style="--app:{color}">
  <div class="app-top"><span class="app-chip">{E(name)}</span><span class="pill ok">Activo</span></div>
  <h4>{E(tenant)}</h4>
  <span class="mono code">{E(code)}</span>
  <div class="app-meta"><span>{icon("clock", "am-i")}{E(t)}</span><span>{E(how)}</span></div>
</div>''')
    return ''.join(out)


REQ = [
    ('TMS', '#2B7A9B', 'ok', 'Sí', 'Ensayada tres veces. Render puede tardar ~30 s en despertar la app: pulsa «Verificar ahora» antes.'),
    ('eChange', '#8A5CB8', 'ok', 'Sí', 'Ensayada. El resultado llega en el mismo alta.'),
    ('eSupplier', '#056769', 'ok', 'Sí', 'Su alta habilitada está en el entorno de Desarrollo compartido (DEVQAS).'),
    ('eCommerce', '#2D5BD3', 'ok', 'Sí', 'Ensayada.'),
    ('Comerza', '#B4436C', 'ok', 'Sí', 'Ensayada.'),
    ('EWM', '#3E8F63', 'warn', 'Con pasos extra', 'Exige la <b>empresa</b> del cliente y una <b>configuración</b> (almacén inicial, zona horaria y nombre del administrador). Sin ellas responde «Precondiciones no cumplidas». La configuración se completa en Apps › Altas en las apps; la empresa aún no se elige en el asistente.'),
    ('eExpense', '#C2610C', 'bad', 'No usar en QAS', 'Su ambiente QAS lo usa un cliente real.'),
    ('GMAO', '#185D4A', 'bad', 'No usar en QAS', 'Un solo proyecto para todos sus ambientes.'),
]


def req_rows():
    return ''.join(
        f'<tr><td><span class="app-dot" style="--app:{c}"></span><b>{n}</b></td><td><span class="pill {k}">{s}</span></td><td>{d}</td></tr>'
        for n, c, k, s, d in REQ)


STEPS = [
    ('Abre «Nuevo tenant»', 'En <b>Suite › Tenants</b> pulsa <b>Nuevo tenant</b>, arriba a la derecha. También puedes pulsar ⌘K y escribir «Nuevo tenant».', None, None),
    ('Paso 1 · Cuenta y app', 'Elige la <b>Organización cliente</b> y el <b>Producto SaaS</b> (la app). Pulsa <b>Continuar</b>.',
     [('wizard-1-cuenta-app', '/onboarding?modo=app', 'Paso 1 con cliente y app elegidos')], None),
    ('Paso 2 · Tenant', 'Completa los datos y pulsa <b>Crear tenant</b>. El tenant queda creado en el Admin Maestro, «Pendiente» hasta su alta en la app.',
     [('wizard-2-tenant', '/onboarding?modo=app', 'Paso 2 con los datos del tenant')], 'kv'),
    ('Paso 3 · Solicitar y ejecutar el alta', 'En la fila de la app pulsa <b>Solicitar alta</b> (pasa a «Lista para ejecutar») y luego <b>Ejecutar alta</b>. El Admin Maestro hace una llamada firmada a la app.',
     [('wizard-4-solicitud', '/onboarding?modo=app', 'Solicitud lista para ejecutar', 'Solicitud creada.'),
      ('wizard-5-resultado', '/onboarding?modo=app', 'Resultado del alta: Activo', 'En 10 a 16 segundos: «Activo».')], None),
    ('Confirma el tenant como activo', 'En <b>Centro de la suite</b>, la celda dice «Activo en la app · pendiente de confirmar». Ábrela y pulsa <b>Confirmar como activo</b> dos veces (botón y confirmación). Queda en la auditoría.',
     [('confirm-c2-detalle', '/suite', 'Botón Confirmar como activo en el detalle de la celda')], None),
]

KV = '''<dl class="kv">
  <div><dt>Canal / partner</dt><dd>«Venta directa EBIM (sin partner)», salvo que lo administre un partner con acuerdo activo.</dd></div>
  <div><dt>Despliegue y tipo</dt><dd>«Compartido» y «Producción». DEMO no genera suscripción recurrente.</dd></div>
  <div><dt>Nombre del tenant</dt><dd>Cliente · App, por ejemplo <b>Exportadora Guayas · eChange</b>.</dd></div>
  <div><dt>Código</dt><dd>Minúsculas y guiones, único dentro de la app: <code>exportadora-guayas-echange</code>.</dd></div>
  <div><dt>Correo del administrador</dt><dd>El del cliente. No puede ser del dominio <code>@ebim.pe</code>.</dd></div>
</dl>'''


def steps():
    out = []
    for i, (t, d, shots, extra) in enumerate(STEPS, 1):
        body = ''
        if extra == 'kv':
            body += KV
        if shots:
            body += frame(*shots[0]) if len(shots) == 1 else '<div class="pair">' + ''.join(frame(*s) for s in shots) + '</div>'
        out.append(f'''<li class="step">
  <span class="step-n">{i}</span>
  <div class="step-c"><h4>{t}</h4><p>{d}</p>{f'<div class="step-body">{body}</div>' if body else ''}</div>
</li>''')
    return '<ol class="timeline">' + ''.join(out) + '</ol>'


FINDINGS = [
    ('bad', 'key', 'Alta prioridad', 'Contraseña del super admin publicada', 'La contraseña de las cuentas administrativas está en el repositorio público. Rotarla al terminar la presentación con Gerencia.'),
    ('bad', 'plug', 'Alta prioridad', 'EWM no se da de alta solo con el asistente', 'EWM exige la empresa del cliente y la configuración del almacén. Añadir al paso 2 el selector de empresa y, para EWM, los campos de almacén que ya existen en Apps › Altas.'),
    ('warn', 'check', 'Media', 'La confirmación del tenant activo es manual', 'Cuando la app responde «Activo», el tenant sigue «Pendiente» hasta que una persona lo confirma. Confirmarlo solo al recibir la respuesta activa, conservando la auditoría.'),
    ('warn', 'layers', 'Media', 'Datos de demostración sin alta', '13 cuentas aparecen «Sin alta» en la matriz (tenants semilla que nunca se crearon en su app) y las cuentas técnicas se llaman «EBIM … QAS Smoke». Darlos de alta o archivarlos, y renombrar las técnicas.'),
    ('warn', 'inbox', 'Media', 'Correo transaccional sin configurar', 'Las invitaciones de usuarios y los cambios de contraseña no llegan. Configurar el SMTP antes de invitar a partners o clientes.'),
    ('off', 'pulse', 'Planificado', 'Canales que aún no actúan dentro de las apps', 'Suspensión dentro de cada app (falta desplegar el receptor <code>lifecycle.v1</code>), módulos habilitados por contrato, consumo por app y usuarios por app (SSO). La consola los muestra como «No activo».'),
    ('off', 'cycle', 'Decisión de negocio', 'Corte automático por impago apagado', '16 tenants están «por suspender». Encender el corte automático es una decisión del super admin; hasta entonces decide una persona y todo queda auditado.'),
]


def findings():
    return ''.join(f'''<div class="finding f-{k}">
  <span class="f-icon">{icon(ic)}</span>
  <div><div class="f-top"><span class="pill {k}">{lvl}</span></div><h4>{t}</h4><p>{d}</p></div>
</div>''' for k, ic, lvl, t, d in FINDINGS)


CAPS = [
    ('Alta de tenants en las apps desde la consola', 'ok', 'Operativa'),
    ('Salud de las 8 apps con verificación real', 'ok', 'Operativa'),
    ('Matriz cliente × app y fichas 360', 'ok', 'Operativa'),
    ('Ciclo de vida: gracia, corte y reactivación', 'ok', 'Operativa · corte automático apagado'),
    ('Facturación, cobranza, portal de pago, comisiones y margen', 'ok', 'Operativa'),
    ('Bandeja, buscador ⌘K y auditoría', 'ok', 'Operativa'),
    ('Suspensión aplicada dentro de cada app', 'off', 'Pendiente en las apps'),
    ('Módulos habilitados y consumo por app', 'off', 'Apagado en QAS'),
]

MAP = [('inicio', 'home', 'Inicio', 'Resumen · Bandeja'),
       ('clientes', 'users', 'Clientes', 'Cuentas · Partners · Equipo comercial'),
       ('suite', 'grid', 'Suite', 'Centro de la suite · Tenants · Apps'),
       ('comercial', 'rocket', 'Comercial', 'Nueva venta · Contratos · Catálogo'),
       ('finanzas', 'coins', 'Finanzas', 'Cobranza · Comisiones · Costos · Tarifas'),
       ('gobierno', 'shield', 'Gobierno', 'Usuarios · Auditoría · Configuración')]


def build():
    css = open(os.path.join(HERE, 'style.css')).read()
    nav_map = ''.join(f'<a class="map-tile c-{k}" href="#{k}"><span class="mt-icon">{icon(ic)}</span><span class="mt-n">{n}</span><b>{t}</b><span>{d}</span></a>'
                      for (k, ic, t, d), n in zip(MAP, ['03', '04', '05', '06', '07', '08']))
    toc = ''.join(f'<li><a href="#{a}">{b}</a></li>' for a, b in [
        ('conceptos', '1. Cómo está organizado'), ('navegacion', '2. Ingreso y navegación'), ('inicio', '3. Inicio'), ('clientes', '4. Clientes'),
        ('suite', '5. Suite'), ('comercial', '6. Comercial'), ('finanzas', '7. Finanzas'), ('gobierno', '8. Gobierno'),
        ('crear-tenant', '9. Crear un tenant'), ('ejemplos', '10. Tenants de ejemplo'), ('revision', '11. Revisión')])
    caps = ''.join(f'<li><span>{t}</span><span class="pill {k}">{s}</span></li>' for t, k, s in CAPS)
    page = f'''<title>Manual del Admin Maestro</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,400&family=DM+Mono:wght@400;500&display=swap">
<style>{css}</style>

<header class="cover">
  <div class="cover-inner">
    <div class="wordmark"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>Admin Maestro<small>BY EBIM</small></span></div>
    <div class="cover-grid">
      <div class="cover-text">
        <span class="cover-kicker">Manual de uso · Versión V5</span>
        <h1>Manual del Admin&nbsp;Maestro</h1>
        <p>La consola desde la que EBIM ve, da de alta y gobierna los clientes de las 8 apps de la suite. Cada módulo explicado con capturas reales, el paso a paso para crear un tenant y la revisión completa de la plataforma.</p>
        <div class="apps-strip" aria-label="Apps de la suite">
          <span style="--app:#056769">eSupplier</span><span style="--app:#3E8F63">EWM</span><span style="--app:#2B7A9B">TMS</span><span style="--app:#185D4A">GMAO</span>
          <span style="--app:#8A5CB8">eChange</span><span style="--app:#C2610C">eExpense</span><span style="--app:#2D5BD3">eCommerce</span><span style="--app:#B4436C">Comerza</span>
        </div>
        <div class="meta"><span>{icon('window', 'meta-i')}adminmaestro.pages.dev</span><span>{icon('pulse', 'meta-i')}Ambiente QAS</span><span>{icon('clock', 'meta-i')}Revisado el 12-nov-2026</span></div>
      </div>
      <div class="cover-shot" aria-hidden="true">
        <div class="frame"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">adminmaestro.pages.dev/suite</span></div><img src="img/suite.jpg" alt=""></div>
      </div>
    </div>
  </div>
</header>

<div class="wrap">
  <nav class="toc" aria-label="Índice"><h2>Contenido</h2><ol id="toc-list">{toc}</ol></nav>
  <main>
    <details class="mobile-toc"><summary>Contenido del manual</summary><ol>{toc}</ol></details>

    <section class="intro c-suite" id="conceptos">
      <div class="sec-head"><span class="kicker">{icon('info', 'k-i')}Capítulo 1</span><h2>Cómo está organizado</h2><p>Todo en la consola gira alrededor de tres piezas. Entenderlas basta para leer cualquier pantalla.</p></div>
      <div class="concepts">
        <div class="concept k1"><span class="cc-icon">{icon('building')}</span><span class="k">Cuenta</span><h4>El cliente</h4><p>La empresa que compra. Tiene sus contratos, su facturación y su responsable comercial. Puede ser cliente y partner a la vez.</p></div>
        <div class="concept k2"><span class="cc-icon">{icon('layers')}</span><span class="k">Tenant</span><h4>Su espacio en una app</h4><p>El lugar del cliente dentro de UNA app. Un cliente con TMS y eChange tiene dos tenants.</p></div>
        <div class="concept k3"><span class="cc-icon">{icon('bolt')}</span><span class="k">Alta</span><h4>La creación en la app</h4><p>La llamada firmada con la que el Admin Maestro crea el tenant dentro de la app, con su resultado registrado.</p></div>
      </div>
      <div class="flow" aria-label="Recorrido de un cliente"><span>{icon('building', 'fl-i')}Cuenta</span><i>›</i><span>{icon('file', 'fl-i')}Contrato</span><i>›</i><span>{icon('coins', 'fl-i')}Factura y cobro</span><i>›</i><span>{icon('layers', 'fl-i')}Tenant por app</span><i>›</i><span class="hl">{icon('bolt', 'fl-i')}Alta en la app</span></div>
      <div class="callout info">{icon('info', 'c-i')}<p><b>Las 8 apps conectadas:</b> eSupplier, EWM, TMS, GMAO, eChange, eExpense, eCommerce y Comerza. El ERP aún no está conectado; ebim-mail y el gateway son servicios de apoyo, no apps.</p></div>
      <div class="callout info">{icon('shield', 'c-i')}<p><b>Quién puede hacer qué:</b> lo decide la base de datos. La consola esconde los botones que un rol no puede usar, pero la autorización real vive en el servidor. Cobrar una comisión no da acceso a ningún tenant.</p></div>
    </section>

    <section class="intro c-gobierno" id="navegacion">
      <div class="sec-head"><span class="kicker">{icon('search', 'k-i')}Capítulo 2</span><h2>Ingreso y navegación</h2><p>Se entra con correo y contraseña. El menú izquierdo agrupa 18 módulos en seis grupos, cada uno con su color en este manual.</p></div>
      <div class="map">{nav_map}</div>
      <div class="pair">
        {frame('login', '/login', 'Pantalla de ingreso', 'Ingreso. El registro público está cerrado: los usuarios se invitan desde Gobierno › Usuarios.')}
        {frame('palette', '/suite', 'Buscador con acciones rápidas', '⌘K abre el buscador: pantallas, acciones como «Nuevo tenant», facturas y cobros.')}
      </div>
      <div class="panels">
        <div class="panel find"><h4>{icon('window', 'h-i')}La barra superior</h4><ul>{li(['<b>Buscador ⌘K</b>: ir a cualquier sitio o ejecutar una acción.', '<b>Etiqueta de ambiente</b> «QAS · pruebas», siempre visible.', '<b>Campana</b> con los pendientes de la Bandeja.', '<b>Modo oscuro</b> y <b>menú del usuario</b>.'])}</ul></div>
        <div class="panel act"><h4>{icon('bolt', 'h-i')}Atajos útiles</h4><ul>{li(['⌘K › «Nuevo tenant».', '⌘K › «Verificar salud de las apps».', '⌘K › «Emitir factura…».', '⌘K › «Ir a Bandeja».'])}</ul></div>
      </div>
    </section>

    {''.join(chapter(c) for c in CHAPTERS)}

    <section class="chapter c-suite" id="crear-tenant">
      <div class="opener"><div class="opener-inner"><span class="big-n" aria-hidden="true">09</span><div class="opener-text">
        <span class="kicker">{icon('bolt', 'k-i')}Capítulo 9 · Guía práctica</span>
        <h2>Cómo crear un tenant en una app</h2>
        <p>Dos movimientos en un solo asistente: crear el tenant en el Admin Maestro y ejecutar el alta, que lo crea dentro de la app. Menos de un minuto. Ejemplo real: Exportadora Guayas en eChange.</p>
      </div></div></div>
      <div class="ch-body">
        <div class="callout info">{icon('info', 'c-i')}<p><b>Antes de empezar:</b> necesitas un usuario con permiso de plataforma (el super admin lo tiene) y un cliente que ya exista en Cuentas. Si es nuevo, créalo en Clientes › Cuentas › Nuevo cliente o véndele un plan con Comercial › Nueva venta.</p></div>
        {steps()}
        <div class="callout tip">{icon('check', 'c-i')}<p><b>Si el tenant ya existe y solo falta el alta:</b> abre el cliente en Clientes › Cuentas y pulsa <b>Dar de alta en las apps</b>. Aparece la misma tabla del paso 3.</p></div>
        <h3 class="sub-h">Qué pide cada app</h3>
        <div class="table-wrap"><table><thead><tr><th>App</th><th>¿Con el asistente?</th><th>Qué tener en cuenta</th></tr></thead><tbody>{req_rows()}</tbody></table></div>
      </div>
    </section>

    <section class="intro c-suite" id="ejemplos">
      <div class="sec-head"><span class="kicker">{icon('check', 'k-i')}Capítulo 10</span><h2>Tenants de ejemplo creados</h2><p>Altas reales hechas el 12-nov-2026 por la noche desde la web publicada. Todas activas en su app y confirmadas en el Admin Maestro.</p></div>
      <div class="app-cards">{app_cards()}</div>
      <div class="callout warn">{icon('alert', 'c-i')}<p><b>Reservados para la demo en vivo:</b> Minera Illimani · TMS (<code>minera-illimani-tms</code>) y, como respaldo, Comercial Santa Cruz · eChange (<code>comercial-santa-cruz-echange</code>). No los uses en pruebas.</p></div>
    </section>

    <section class="chapter c-finanzas" id="revision">
      <div class="opener"><div class="opener-inner"><span class="big-n" aria-hidden="true">11</span><div class="opener-text">
        <span class="kicker">{icon('shield', 'k-i')}Capítulo 11</span>
        <h2>Revisión completa de la plataforma</h2>
        <p>Todas las pantallas recorridas con el super admin en la web publicada, chequeo real de las 8 apps, altas reales en 6 apps y comparación del código con lo desplegado en Supabase Cloud.</p>
      </div></div></div>
      <div class="ch-body">
        <div class="score">
          <div class="s1"><span class="s-icon">{icon('window')}</span><b>34/34</b><span>pantallas sin errores de consola ni de red</span></div>
          <div class="s2"><span class="s-icon">{icon('pulse')}</span><b>8/8</b><span>apps sanas en el chequeo real</span></div>
          <div class="s3"><span class="s-icon">{icon('bolt')}</span><b>7</b><span>altas reales activas en 6 apps</span></div>
          <div class="s4"><span class="s-icon">{icon('layers')}</span><b>85 · 10</b><span>migraciones y funciones en la nube, iguales al código</span></div>
        </div>
        <h3 class="sub-h">Hallazgos y recomendaciones</h3>
        <div class="findings">{findings()}</div>
        <h3 class="sub-h">Lo que funciona hoy</h3>
        <ul class="caps">{caps}</ul>
        <footer class="end">Manual elaborado sobre la versión publicada en adminmaestro.pages.dev (ambiente QAS) el 12-nov-2026. Las capturas muestran datos de prueba de QAS.</footer>
      </div>
    </section>
  </main>
</div>

<dialog class="viewer" id="viewer" aria-label="Captura ampliada"><button type="button" id="viewer-close">Cerrar</button><img id="viewer-img" alt=""><p id="viewer-cap"></p></dialog>
<script>{open(os.path.join(HERE, 'app.js')).read()}</script>
'''
    open(os.path.join(HERE, 'index.html'), 'w').write(page)
    print('ok', len(page))


if __name__ == '__main__':
    build()
