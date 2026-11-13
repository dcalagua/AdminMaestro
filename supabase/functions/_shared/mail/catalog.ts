/**
 * Catálogo de plantillas del Admin Maestro en EBIM MailHub.
 *
 * Fuente única de verdad de las claves `masteradmin-*`, sus variables y su
 * diseño. `scripts/mailhub/sync-templates.ts` lo convierte (con el renderizador
 * del editor visual de MailHub) en HTML + texto + `design`, de modo que cada
 * plantilla se puede seguir editando por bloques en el panel de MailHub.
 *
 * Reglas del motor de MailHub: solo `{{variable}}`, siempre escapada; sin
 * condicionales ni bucles. Por eso los textos que cambian según el caso (p. ej.
 * «cómo ingresar») llegan ya armados en una variable desde el Admin Maestro.
 *
 * Módulo PURO (solo datos): lo importan las Edge Functions y vitest.
 */

export type Tone = 'info' | 'success' | 'warning' | 'danger';

export type CatalogBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'details'; rows: { label: string; value: string }[] }
  | { type: 'note'; text: string; tone: Tone }
  | { type: 'divider' };

export interface CatalogVariable {
  name: string;
  required: boolean;
  description: string;
}

export interface CatalogTemplate {
  key: string;
  name: string;
  description: string;
  /** Evento del outbox (o del hook de Auth) que la usa. */
  events: string[];
  subject: string;
  variables: CatalogVariable[];
  sample: Record<string, string>;
  blocks: CatalogBlock[];
}

export const BRAND = {
  headerText: 'EBIM · Admin Maestro',
  color: '#056769',
  footerText:
    'Correo automático del **Admin Maestro de EBIM**. Por favor no responda a este mensaje.\nEBIM · Lima, Perú',
};

const v = (name: string, description: string, required = true): CatalogVariable => ({ name, required, description });

const ACCESS_VARS = [
  v('nombre', 'Nombre de la persona (o su correo si no hay nombre)'),
  v('email', 'Correo de la cuenta'),
  v('enlace', 'Enlace de un solo uso (Supabase Auth)'),
  v('vence', 'Validez del enlace, p. ej. «1 hora»'),
  v('consola_url', 'URL pública del Admin Maestro'),
];

const ACCESS_SAMPLE = {
  nombre: 'Ana Torres',
  email: 'ana.torres@ebim.pe',
  enlace: 'https://adminmaestro.pages.dev/bienvenida',
  vence: '1 hora',
  consola_url: 'https://adminmaestro.pages.dev',
};

const IGNORE_IF_NOT_YOU = 'Si usted no solicitó este correo, puede ignorarlo: su cuenta sigue segura.';

export const TEMPLATES: CatalogTemplate[] = [
  // ------------------------------------------------------------------ Acceso (Supabase Auth)
  {
    key: 'masteradmin-acceso-invitacion',
    name: 'Admin Maestro · Invitación a la consola',
    description: 'Invitación de un usuario a la consola del Admin Maestro (Gobierno › Usuarios › Invitar).',
    events: ['AUTH_INVITE'],
    subject: 'Invitación al Admin Maestro de EBIM',
    variables: ACCESS_VARS,
    sample: ACCESS_SAMPLE,
    blocks: [
      { type: 'heading', text: 'Le damos la bienvenida, {{nombre}}' },
      {
        type: 'text',
        text: 'Le invitaron a la consola del **Admin Maestro de EBIM**, donde se gestionan los clientes, los tenants de cada app de la suite, los contratos y la cobranza.',
      },
      { type: 'details', rows: [{ label: 'Usuario', value: '{{email}}' }, { label: 'Consola', value: '{{consola_url}}' }] },
      { type: 'button', label: 'Aceptar la invitación', url: '{{enlace}}' },
      { type: 'note', tone: 'info', text: 'El enlace es personal y vale **{{vence}}**. Al abrirlo podrá definir su contraseña.' },
      { type: 'text', text: IGNORE_IF_NOT_YOU },
    ],
  },
  {
    key: 'masteradmin-acceso-restablecer',
    name: 'Admin Maestro · Restablecer contraseña',
    description: 'Recuperación de contraseña de la consola.',
    events: ['AUTH_RECOVERY'],
    subject: 'Restablezca su contraseña del Admin Maestro',
    variables: ACCESS_VARS,
    sample: ACCESS_SAMPLE,
    blocks: [
      { type: 'heading', text: 'Restablecer su contraseña' },
      { type: 'text', text: 'Hola {{nombre}},\n\nRecibimos una solicitud para restablecer la contraseña de **{{email}}** en el Admin Maestro.' },
      { type: 'button', label: 'Definir una contraseña nueva', url: '{{enlace}}' },
      { type: 'note', tone: 'warning', text: 'El enlace vale **{{vence}}** y se puede usar una sola vez.' },
      { type: 'text', text: IGNORE_IF_NOT_YOU },
    ],
  },
  {
    key: 'masteradmin-acceso-enlace',
    name: 'Admin Maestro · Enlace de ingreso',
    description: 'Enlace mágico para ingresar a la consola sin contraseña.',
    events: ['AUTH_MAGICLINK'],
    subject: 'Su enlace para ingresar al Admin Maestro',
    variables: ACCESS_VARS,
    sample: ACCESS_SAMPLE,
    blocks: [
      { type: 'heading', text: 'Ingresar al Admin Maestro' },
      { type: 'text', text: 'Hola {{nombre}},\n\nUse este botón para ingresar con **{{email}}**.' },
      { type: 'button', label: 'Ingresar', url: '{{enlace}}' },
      { type: 'note', tone: 'info', text: 'El enlace vale **{{vence}}** y se puede usar una sola vez.' },
      { type: 'text', text: IGNORE_IF_NOT_YOU },
    ],
  },
  {
    key: 'masteradmin-acceso-confirmar',
    name: 'Admin Maestro · Confirmar correo',
    description: 'Confirmación de la dirección de correo de una cuenta nueva.',
    events: ['AUTH_SIGNUP'],
    subject: 'Confirme su correo en el Admin Maestro',
    variables: ACCESS_VARS,
    sample: ACCESS_SAMPLE,
    blocks: [
      { type: 'heading', text: 'Confirme su correo' },
      { type: 'text', text: 'Hola {{nombre}},\n\nConfirme que **{{email}}** es su dirección para usar el Admin Maestro.' },
      { type: 'button', label: 'Confirmar mi correo', url: '{{enlace}}' },
      { type: 'note', tone: 'info', text: 'El enlace vale **{{vence}}**.' },
      { type: 'text', text: IGNORE_IF_NOT_YOU },
    ],
  },
  {
    key: 'masteradmin-acceso-cambio-correo',
    name: 'Admin Maestro · Cambio de correo',
    description: 'Confirmación del cambio de correo de una cuenta (se envía a la dirección actual y a la nueva).',
    events: ['AUTH_EMAIL_CHANGE'],
    subject: 'Confirme el cambio de correo de su cuenta del Admin Maestro',
    variables: [
      v('nombre', 'Nombre de la persona'),
      v('email_actual', 'Correo actual de la cuenta'),
      v('email_nuevo', 'Correo nuevo solicitado'),
      v('destino', '«su dirección actual» o «su nueva dirección»'),
      v('enlace', 'Enlace de un solo uso (Supabase Auth)'),
      v('vence', 'Validez del enlace'),
      v('consola_url', 'URL pública del Admin Maestro'),
    ],
    sample: {
      nombre: 'Ana Torres',
      email_actual: 'ana.torres@ebim.pe',
      email_nuevo: 'ana@grupoebim.com',
      destino: 'su nueva dirección',
      enlace: 'https://adminmaestro.pages.dev/bienvenida',
      vence: '1 hora',
      consola_url: 'https://adminmaestro.pages.dev',
    },
    blocks: [
      { type: 'heading', text: 'Confirme el cambio de correo' },
      { type: 'text', text: 'Hola {{nombre}},\n\nSe pidió cambiar el correo de su cuenta del Admin Maestro. Este mensaje llega a {{destino}}.' },
      { type: 'details', rows: [{ label: 'Correo actual', value: '{{email_actual}}' }, { label: 'Correo nuevo', value: '{{email_nuevo}}' }] },
      { type: 'button', label: 'Confirmar el cambio', url: '{{enlace}}' },
      { type: 'note', tone: 'warning', text: 'El cambio se completa cuando se confirma desde las dos direcciones. El enlace vale **{{vence}}**.' },
      { type: 'text', text: 'Si usted no pidió este cambio, no abra el enlace y avise al administrador de la consola.' },
    ],
  },
  {
    key: 'masteradmin-acceso-codigo',
    name: 'Admin Maestro · Código de verificación',
    description: 'Código para confirmar una operación sensible (reautenticación).',
    events: ['AUTH_REAUTHENTICATION'],
    subject: 'Su código de verificación del Admin Maestro',
    variables: [
      v('nombre', 'Nombre de la persona'),
      v('email', 'Correo de la cuenta'),
      v('codigo', 'Código de un solo uso'),
      v('vence', 'Validez del código'),
      v('consola_url', 'URL pública del Admin Maestro'),
    ],
    sample: { nombre: 'Ana Torres', email: 'ana.torres@ebim.pe', codigo: '482913', vence: '1 hora', consola_url: 'https://adminmaestro.pages.dev' },
    blocks: [
      { type: 'heading', text: 'Código de verificación' },
      { type: 'text', text: 'Hola {{nombre}},\n\nIngrese este código en el Admin Maestro para confirmar la operación:' },
      { type: 'details', rows: [{ label: 'Código', value: '{{codigo}}' }, { label: 'Vale', value: '{{vence}}' }] },
      { type: 'text', text: 'Nadie de EBIM le pedirá este código. ' + IGNORE_IF_NOT_YOU },
    ],
  },

  // ------------------------------------------------------------------ Suite: alta del tenant
  {
    key: 'masteradmin-tenant-bienvenida',
    name: 'Admin Maestro · Bienvenida al tenant',
    description: 'Al administrador del cliente cuando su tenant queda activo en la app (Confirmar como activo).',
    events: ['TENANT_ACTIVATED'],
    subject: 'Su espacio en {{app}} está activo: {{tenant}}',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('tenant', 'Nombre del tenant'),
      v('app', 'App de la suite («TMS by EBIM»)'),
      v('email', 'Correo del administrador del tenant'),
      v('ambiente', 'Ambiente del tenant (Producción, Pruebas…)'),
      v('como_ingresar', 'Instrucciones para ingresar'),
    ],
    sample: {
      cliente: 'Industrias Titán S.A.C.',
      tenant: 'Industrias Titán · TMS',
      app: 'TMS by EBIM',
      email: 'admin@titan.com.pe',
      ambiente: 'Producción',
      como_ingresar: 'TMS by EBIM le enviará a esta misma dirección un correo para crear su contraseña. Si no lo recibe en 24 horas, escríbanos.',
    },
    blocks: [
      { type: 'heading', text: '¡Su espacio en {{app}} está listo!' },
      {
        type: 'text',
        text: 'Hola,\n\nEl espacio **{{tenant}}** de **{{cliente}}** ya está activo. Usted figura como su administrador.',
      },
      {
        type: 'details',
        rows: [
          { label: 'App', value: '{{app}}' },
          { label: 'Tenant', value: '{{tenant}}' },
          { label: 'Ambiente', value: '{{ambiente}}' },
          { label: 'Administrador', value: '{{email}}' },
        ],
      },
      { type: 'note', tone: 'success', text: '**Cómo ingresar:** {{como_ingresar}}' },
      { type: 'text', text: 'Desde su usuario administrador podrá invitar a su equipo y configurar la app.' },
    ],
  },

  // ------------------------------------------------------------------ Finanzas
  {
    key: 'masteradmin-factura-emitida',
    name: 'Admin Maestro · Factura emitida',
    description: 'Al contacto de facturación del cliente cuando se emite una factura, con el enlace al portal de pago.',
    events: ['INVOICE_ISSUED'],
    subject: 'Factura {{numero}} de EBIM · {{monto}}',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('numero', 'Número de la factura'),
      v('periodo', 'Periodo facturado'),
      v('emision', 'Fecha de emisión'),
      v('vencimiento', 'Fecha de vencimiento'),
      v('monto', 'Total con moneda'),
      v('enlace_pago', 'Portal de pago del cliente (enlace personal)'),
      v('vence_enlace', 'Hasta cuándo vale el enlace de pago'),
    ],
    sample: {
      cliente: 'Industrias Titán S.A.C.',
      numero: 'INV-202611-TITAN-TMS',
      periodo: '01/11/2026 – 30/11/2026',
      emision: '13/11/2026',
      vencimiento: '28/11/2026',
      monto: 'USD 1,250.00',
      enlace_pago: 'https://adminmaestro.pages.dev/pagar',
      vence_enlace: '13/12/2026',
    },
    blocks: [
      { type: 'heading', text: 'Nueva factura de EBIM' },
      { type: 'text', text: 'Estimado cliente **{{cliente}}**,\n\nEmitimos la factura **{{numero}}**.' },
      {
        type: 'details',
        rows: [
          { label: 'Factura', value: '{{numero}}' },
          { label: 'Periodo', value: '{{periodo}}' },
          { label: 'Emisión', value: '{{emision}}' },
          { label: 'Vence', value: '{{vencimiento}}' },
          { label: 'Total', value: '{{monto}}' },
        ],
      },
      { type: 'button', label: 'Ver y pagar', url: '{{enlace_pago}}' },
      { type: 'note', tone: 'info', text: 'El portal muestra sus facturas pendientes y acepta pago con tarjeta. El enlace es personal y vale hasta el **{{vence_enlace}}**.' },
    ],
  },
  {
    key: 'masteradmin-pago-confirmado',
    name: 'Admin Maestro · Pago confirmado',
    description: 'Recibo al contacto de facturación cuando un pago queda CONFIRMADO.',
    events: ['PAYMENT_CONFIRMED'],
    subject: 'Recibimos su pago de {{monto}} · {{numero}}',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('numero', 'Número de la factura'),
      v('monto', 'Importe pagado con moneda'),
      v('fecha_pago', 'Fecha del pago'),
      v('medio', 'Medio de pago'),
      v('referencia', 'Referencia del pago'),
      v('saldo', 'Saldo pendiente de la factura'),
      v('estado_factura', 'Estado de la factura tras el pago'),
    ],
    sample: {
      cliente: 'Industrias Titán S.A.C.',
      numero: 'INV-202611-TITAN-TMS',
      monto: 'USD 1,250.00',
      fecha_pago: '20/11/2026',
      medio: 'Tarjeta',
      referencia: 'PAY-7F3A21',
      saldo: 'USD 0.00',
      estado_factura: 'Pagada',
    },
    blocks: [
      { type: 'heading', text: 'Gracias, recibimos su pago' },
      { type: 'text', text: 'Estimado cliente **{{cliente}}**,\n\nConfirmamos el pago de **{{monto}}** a la factura **{{numero}}**.' },
      {
        type: 'details',
        rows: [
          { label: 'Factura', value: '{{numero}}' },
          { label: 'Importe', value: '{{monto}}' },
          { label: 'Fecha', value: '{{fecha_pago}}' },
          { label: 'Medio', value: '{{medio}}' },
          { label: 'Referencia', value: '{{referencia}}' },
          { label: 'Saldo de la factura', value: '{{saldo}}' },
          { label: 'Estado', value: '{{estado_factura}}' },
        ],
      },
      { type: 'note', tone: 'success', text: 'Este correo es su constancia de pago. Consérvelo junto con su factura.' },
    ],
  },
  {
    key: 'masteradmin-factura-vencida',
    name: 'Admin Maestro · Recordatorio de factura vencida',
    description: 'Una vez por factura, cuando pasa su vencimiento sin pagarse (alerta PAST_DUE).',
    events: ['INVOICE_OVERDUE'],
    subject: 'Recordatorio: la factura {{numero}} está vencida',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('numero', 'Número de la factura'),
      v('vencimiento', 'Fecha de vencimiento'),
      v('dias_vencida', 'Días transcurridos desde el vencimiento'),
      v('saldo', 'Saldo pendiente con moneda'),
      v('enlace_pago', 'Portal de pago del cliente (enlace personal)'),
      v('vence_enlace', 'Hasta cuándo vale el enlace de pago'),
    ],
    sample: {
      cliente: 'Industrias Titán S.A.C.',
      numero: 'INV-202610-TITAN-TMS',
      vencimiento: '28/10/2026',
      dias_vencida: '5',
      saldo: 'USD 1,250.00',
      enlace_pago: 'https://adminmaestro.pages.dev/pagar',
      vence_enlace: '12/12/2026',
    },
    blocks: [
      { type: 'heading', text: 'Factura vencida' },
      { type: 'text', text: 'Estimado cliente **{{cliente}}**,\n\nLa factura **{{numero}}** venció el {{vencimiento}} y aún tiene saldo pendiente.' },
      { type: 'note', tone: 'warning', text: 'Saldo pendiente: **{{saldo}}** · {{dias_vencida}} días de atraso.' },
      { type: 'button', label: 'Pagar ahora', url: '{{enlace_pago}}' },
      { type: 'text', text: 'Si ya realizó el pago, ignore este recordatorio: puede tardar un día en reflejarse. El enlace vale hasta el {{vence_enlace}}.' },
    ],
  },
  {
    key: 'masteradmin-tenant-suspendido',
    name: 'Admin Maestro · Suspensión por impago',
    description: 'Al cliente cuando un tenant se suspende por facturas vencidas.',
    events: ['TENANT_SUSPENDED'],
    subject: 'Servicio suspendido: {{tenant}}',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('tenant', 'Nombre del tenant'),
      v('app', 'App de la suite'),
      v('fecha', 'Fecha de la suspensión'),
      v('motivo', 'Motivo registrado'),
      v('enlace_pago', 'Portal de pago del cliente (enlace personal)'),
      v('vence_enlace', 'Hasta cuándo vale el enlace de pago'),
    ],
    sample: {
      cliente: 'Industrias Titán S.A.C.',
      tenant: 'Industrias Titán · TMS',
      app: 'TMS by EBIM',
      fecha: '15/12/2026',
      motivo: 'Facturas vencidas fuera del periodo de gracia',
      enlace_pago: 'https://adminmaestro.pages.dev/pagar',
      vence_enlace: '14/01/2027',
    },
    blocks: [
      { type: 'note', tone: 'danger', text: '**Servicio suspendido:** {{tenant}} en {{app}}' },
      { type: 'text', text: 'Estimado cliente **{{cliente}}**,\n\nSuspendimos el acceso a **{{tenant}}** por facturas vencidas sin pagar.' },
      { type: 'details', rows: [{ label: 'App', value: '{{app}}' }, { label: 'Fecha', value: '{{fecha}}' }, { label: 'Motivo', value: '{{motivo}}' }] },
      { type: 'button', label: 'Regularizar el pago', url: '{{enlace_pago}}' },
      { type: 'text', text: 'Al confirmarse el pago, el servicio se reactiva automáticamente y sus datos se conservan intactos. El enlace vale hasta el {{vence_enlace}}.' },
    ],
  },
  {
    key: 'masteradmin-tenant-reactivado',
    name: 'Admin Maestro · Servicio reactivado',
    description: 'Al cliente cuando se levanta una suspensión por impago.',
    events: ['TENANT_REACTIVATED'],
    subject: 'Servicio reactivado: {{tenant}}',
    variables: [
      v('cliente', 'Nombre del cliente'),
      v('tenant', 'Nombre del tenant'),
      v('app', 'App de la suite'),
      v('fecha', 'Fecha de la reactivación'),
    ],
    sample: { cliente: 'Industrias Titán S.A.C.', tenant: 'Industrias Titán · TMS', app: 'TMS by EBIM', fecha: '16/12/2026' },
    blocks: [
      { type: 'heading', text: 'Su servicio está activo de nuevo' },
      { type: 'text', text: 'Estimado cliente **{{cliente}}**,\n\nReactivamos el acceso a **{{tenant}}** en {{app}}. Gracias por regularizar su cuenta.' },
      { type: 'details', rows: [{ label: 'App', value: '{{app}}' }, { label: 'Tenant', value: '{{tenant}}' }, { label: 'Reactivado', value: '{{fecha}}' }] },
      { type: 'note', tone: 'success', text: 'Sus usuarios ya pueden ingresar con sus credenciales de siempre.' },
    ],
  },

  // ------------------------------------------------------------------ Operaciones (interno EBIM)
  {
    key: 'masteradmin-ops-resumen',
    name: 'Admin Maestro · Resumen para operaciones',
    description: 'Interno EBIM: diferencias de sincronización con las apps o altas fallidas.',
    events: ['OPS_SYNC_DIGEST', 'OPS_PROVISIONING_FAILED'],
    subject: '[Admin Maestro] {{titulo}}',
    variables: [
      v('titulo', 'Título del aviso'),
      v('motivo', 'Qué pasó, en una frase'),
      v('diferencias_nuevas', 'Diferencias abiertas por esta corrida'),
      v('diferencias_abiertas', 'Diferencias abiertas en total'),
      v('altas_fallidas', 'Altas fallidas en las últimas 24 h'),
      v('fecha', 'Fecha y hora del evento (Lima)'),
      v('enlace', 'Pantalla del Admin Maestro donde se atiende'),
    ],
    sample: {
      titulo: 'Sincronización con 3 diferencias nuevas',
      motivo: 'La sincronización diaria terminó con diferencias que una persona debe revisar.',
      diferencias_nuevas: '3',
      diferencias_abiertas: '7',
      altas_fallidas: '0',
      fecha: '13/11/2026 05:31',
      enlace: 'https://adminmaestro.pages.dev/apps?tab=sincronizacion-apps',
    },
    blocks: [
      { type: 'note', tone: 'warning', text: '**{{titulo}}**' },
      { type: 'text', text: '{{motivo}}' },
      {
        type: 'details',
        rows: [
          { label: 'Diferencias nuevas', value: '{{diferencias_nuevas}}' },
          { label: 'Diferencias abiertas', value: '{{diferencias_abiertas}}' },
          { label: 'Altas fallidas (24 h)', value: '{{altas_fallidas}}' },
          { label: 'Fecha', value: '{{fecha}}' },
        ],
      },
      { type: 'button', label: 'Abrir en el Admin Maestro', url: '{{enlace}}' },
    ],
  },
];

export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

export function templateByKey(key: string): CatalogTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** Placeholders `{{x}}` usados por una plantilla (asunto + bloques). */
export function placeholdersOf(t: CatalogTemplate): string[] {
  const text = [t.subject, JSON.stringify(t.blocks)].join(' ');
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g)].map((m) => m[1]))].sort();
}
