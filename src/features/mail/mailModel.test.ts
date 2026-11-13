import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../../supabase/functions/_shared/mail/catalog';
import { MAIL_EVENT, latestMailByInvoice, MAIL_FILTERS, MAIL_STATUS, MAIL_TEMPLATES, canCancel, canResend, mailStatus, matchesFilter } from './mailModel';

describe('mailModel', () => {
  it('la lista de plantillas de la consola es la del catálogo publicado en MailHub', () => {
    expect(MAIL_TEMPLATES.map((t) => t.key)).toEqual(TEMPLATES.map((t) => t.key));
  });

  it('todo evento del catálogo tiene nombre en español', () => {
    for (const t of TEMPLATES) for (const e of t.events) expect(MAIL_EVENT[e], e).toBeTruthy();
  });

  it('cada estado de la base tiene etiqueta; uno desconocido no rompe', () => {
    expect(Object.keys(MAIL_STATUS)).toHaveLength(12);
    expect(mailStatus('HELD').label).toBe('Retenido (QAS)');
    expect(mailStatus('NUEVO')).toMatchObject({ label: 'NUEVO', tone: 'neutral' });
  });

  it('filtros: problemas, retenidos y en curso', () => {
    expect(matchesFilter('BOUNCED', 'problems')).toBe(true);
    expect(matchesFilter('HELD', 'problems')).toBe(false);
    expect(matchesFilter('HELD', 'held')).toBe(true);
    expect(matchesFilter('SENT', 'in_flight')).toBe(true);
    expect(matchesFilter('ANY', 'all')).toBe(true);
    expect(MAIL_FILTERS[0].id).toBe('all');
  });

  it('reenviar y cancelar siguen las reglas de la base', () => {
    expect(canResend({ status: 'FAILED', category: 'BUSINESS' })).toBe(true);
    expect(canResend({ status: 'BOUNCED', category: 'AUTH' })).toBe(false);
    expect(canResend({ status: 'DELIVERED', category: 'BUSINESS' })).toBe(false);
    expect(canCancel({ status: 'HELD' })).toBe(true);
    expect(canCancel({ status: 'SENT' })).toBe(false);
  });

  it('último correo por factura', () => {
    const m = latestMailByInvoice([
      { invoice_id: 'i1', created_at: '2026-11-01T00:00:00Z', status: 'DELIVERED' },
      { invoice_id: 'i1', created_at: '2026-11-05T00:00:00Z', status: 'HELD' },
      { invoice_id: null, created_at: '2026-11-06T00:00:00Z', status: 'SENT' },
    ] as never);
    expect(m.get('i1')?.status).toBe('HELD');
    expect(m.size).toBe(1);
  });
});
