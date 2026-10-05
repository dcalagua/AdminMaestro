import { formatDate } from '@/lib/format';

/** URL pública del portal. El token va en el FRAGMENTO: el navegador no lo envía al servidor. */
export function portalUrl(token: string): string {
  return `${window.location.origin}/pagar#${token}`;
}

/** `mailto:` prellenado en español para el contacto de facturación. */
export function portalMailto(email: string | null | undefined, organizationName: string, url: string, expiresAt: string | null): string {
  const subject = `Estado de cuenta y pago en línea — ${organizationName}`;
  const body = [
    'Hola,',
    '',
    `Te compartimos el enlace para revisar y pagar las facturas pendientes de ${organizationName}:`,
    '',
    url,
    '',
    expiresAt ? `El enlace vence el ${formatDate(expiresAt)}.` : '',
    'Puedes pagar con tarjeta y, si lo deseas, activar el pago automático de tus próximas facturas.',
    '',
    'Saludos,',
    'Equipo EBIM',
  ].join('\n');
  return `mailto:${email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

