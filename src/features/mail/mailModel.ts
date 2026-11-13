import type { CellTone } from '@/components/ui/cells';
import type { MailRow } from './mailApi';

/**
 * Correo del Admin Maestro por EBIM MailHub (migración 20261022000100).
 *
 * Etiquetas y tonos de la bandeja `mail_outbox`. Es UX: la base decide quién
 * ve qué (RLS + `can_view_mail()`) y quién reenvía o cancela.
 */
export type MailStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED'
  | 'SUPPRESSED'
  | 'HELD'
  | 'SKIPPED'
  | 'CANCELLED';

export const MAIL_STATUS: Record<MailStatus, { label: string; tone: CellTone; help: string }> = {
  PENDING: { label: 'En cola', tone: 'info', help: 'Esperando a mail-dispatch (cada minuto o «Procesar ahora»).' },
  SENDING: { label: 'Enviando', tone: 'info', help: 'mail-dispatch lo está entregando a MailHub.' },
  SENT: { label: 'Enviado', tone: 'accent', help: 'MailHub lo aceptó y lo entregó al proveedor.' },
  DELIVERED: { label: 'Entregado', tone: 'ok', help: 'El servidor del destinatario lo recibió (no implica leído).' },
  DELAYED: { label: 'Demorado', tone: 'warn', help: 'Entrega demorada temporalmente; el proveedor sigue intentando.' },
  BOUNCED: { label: 'Rebotado', tone: 'danger', help: 'El buzón no existe o rechazó el correo. Corrija la dirección.' },
  COMPLAINED: { label: 'Marcado como spam', tone: 'danger', help: 'El destinatario lo marcó como spam.' },
  FAILED: { label: 'Fallido', tone: 'danger', help: 'No se pudo enviar. Revise el detalle y reenvíe.' },
  SUPPRESSED: { label: 'Suprimido', tone: 'danger', help: 'La dirección está en la lista de supresión de MailHub.' },
  HELD: { label: 'Retenido (QAS)', tone: 'warn', help: 'Salvaguarda de QAS: el destinatario no es de un dominio permitido y no se envió.' },
  SKIPPED: { label: 'Descartado', tone: 'neutral', help: 'Sin destinatario válido o dominio de prueba: no hay buzón real.' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral', help: 'Cancelado por un operador.' },
};

export function mailStatus(status: string | null | undefined) {
  return MAIL_STATUS[(status ?? '') as MailStatus] ?? { label: status ?? '—', tone: 'neutral' as CellTone, help: '' };
}

export const MAIL_EVENT: Record<string, string> = {
  AUTH_INVITE: 'Invitación a la consola',
  AUTH_RECOVERY: 'Restablecer contraseña',
  AUTH_MAGICLINK: 'Enlace de ingreso',
  AUTH_SIGNUP: 'Confirmar correo',
  AUTH_EMAIL_CHANGE: 'Cambio de correo',
  AUTH_REAUTHENTICATION: 'Código de verificación',
  INVOICE_ISSUED: 'Factura emitida',
  PAYMENT_CONFIRMED: 'Pago confirmado',
  INVOICE_OVERDUE: 'Factura vencida',
  TENANT_SUSPENDED: 'Suspensión por impago',
  TENANT_REACTIVATED: 'Servicio reactivado',
  TENANT_ACTIVATED: 'Bienvenida al tenant',
  OPS_SYNC_DIGEST: 'Resumen de sincronización',
  OPS_PROVISIONING_FAILED: 'Alta fallida',
  TEST: 'Prueba de plantilla',
};

export const MAIL_CATEGORY: Record<string, string> = {
  AUTH: 'Acceso',
  BUSINESS: 'Cliente',
  OPS: 'Operaciones',
  TEST: 'Prueba',
};

/** Plantillas `masteradmin-*` publicadas en MailHub (catálogo: supabase/functions/_shared/mail/catalog.ts). */
export const MAIL_TEMPLATES: Array<{ key: string; label: string }> = [
  { key: 'masteradmin-acceso-invitacion', label: 'Invitación a la consola' },
  { key: 'masteradmin-acceso-restablecer', label: 'Restablecer contraseña' },
  { key: 'masteradmin-acceso-enlace', label: 'Enlace de ingreso' },
  { key: 'masteradmin-acceso-confirmar', label: 'Confirmar correo' },
  { key: 'masteradmin-acceso-cambio-correo', label: 'Cambio de correo' },
  { key: 'masteradmin-acceso-codigo', label: 'Código de verificación' },
  { key: 'masteradmin-tenant-bienvenida', label: 'Bienvenida al tenant' },
  { key: 'masteradmin-factura-emitida', label: 'Factura emitida' },
  { key: 'masteradmin-pago-confirmado', label: 'Pago confirmado' },
  { key: 'masteradmin-factura-vencida', label: 'Factura vencida' },
  { key: 'masteradmin-tenant-suspendido', label: 'Suspensión por impago' },
  { key: 'masteradmin-tenant-reactivado', label: 'Servicio reactivado' },
  { key: 'masteradmin-ops-resumen', label: 'Resumen para operaciones' },
];

/** Pestañas de estado del listado. */
export type MailFilter = 'all' | 'problems' | 'held' | 'delivered' | 'in_flight';

export const MAIL_FILTERS: Array<{ id: MailFilter; label: string; statuses: MailStatus[] | null }> = [
  { id: 'all', label: 'Todos', statuses: null },
  { id: 'problems', label: 'Con problemas', statuses: ['FAILED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'DELAYED'] },
  { id: 'held', label: 'Retenidos', statuses: ['HELD'] },
  { id: 'in_flight', label: 'En curso', statuses: ['PENDING', 'SENDING', 'SENT'] },
  { id: 'delivered', label: 'Entregados', statuses: ['DELIVERED'] },
];

export function matchesFilter(status: string | null | undefined, filter: MailFilter): boolean {
  const def = MAIL_FILTERS.find((f) => f.id === filter);
  return !def?.statuses || def.statuses.includes((status ?? '') as MailStatus);
}

/** Se puede reenviar (RPC `mail_retry`): fallidos, rebotados o suprimidos que no son de acceso. */
export function canResend(row: { status: string | null; category: string | null }): boolean {
  return row.category !== 'AUTH' && ['FAILED', 'BOUNCED', 'SUPPRESSED'].includes(row.status ?? '');
}

/** Se puede cancelar (RPC `mail_cancel`): pendiente o retenido. */
export function canCancel(row: { status: string | null }): boolean {
  return ['PENDING', 'HELD'].includes(row.status ?? '');
}

/** Línea secundaria de un correo: a quién y sobre qué. */
export function mailSubject(row: {
  event_type: string | null;
  reference_label: string | null;
  organization_name?: string | null;
  tenant_name?: string | null;
}): string {
  const event = MAIL_EVENT[row.event_type ?? ''] ?? row.event_type ?? 'Correo';
  const about = row.reference_label ?? row.tenant_name ?? row.organization_name;
  return about ? `${event} · ${about}` : event;
}

/** Último correo de cada factura (para la columna «Correo» de la tabla de facturas). */
export function latestMailByInvoice(rows: MailRow[] | undefined): Map<string, MailRow> {
  const out = new Map<string, MailRow>();
  for (const r of rows ?? []) {
    if (!r.invoice_id) continue;
    const prev = out.get(r.invoice_id);
    if (!prev || (r.created_at ?? '') > (prev.created_at ?? '')) out.set(r.invoice_id, r);
  }
  return out;
}
