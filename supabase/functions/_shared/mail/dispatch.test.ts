import { describe, expect, it, vi } from 'vitest';
import { buildVariables, runDispatch, sendKeyFor, type DispatchDeps, type MarkResult, type OutboxRow } from './dispatch';
import { parseDeliveryConfig } from './policy';
import type { MailhubSendRequest, MailhubSendResult } from './mailhub';

/*
 * mail-dispatch: la salvaguarda de QAS se aplica ANTES de MailHub y antes de
 * generar un enlace de pago; los reintentos usan la misma clave; un 4xx es final.
 */
const APP = 'https://adminmaestro.pages.dev';

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'o1',
    category: 'BUSINESS',
    event_type: 'PAYMENT_CONFIRMED',
    template_key: 'masteradmin-pago-confirmado',
    recipient_email: 'finanzas@ebim.pe',
    variables: { cliente: 'Alpha', numero: 'INV-1', monto: 'USD 1.00' },
    needs_payment_link: false,
    idempotency_key: 'payment-confirmed-p1',
    resend_count: 0,
    attempts: 1,
    reference_label: 'INV-1',
    ...over,
  };
}

function harness(rows: OutboxRow[], result: MailhubSendResult | ((r: MailhubSendRequest) => MailhubSendResult), mode = 'allowlist') {
  const marks: MarkResult[] = [];
  const sent: MailhubSendRequest[] = [];
  let served = false;
  const deps: DispatchDeps = {
    delivery: parseDeliveryConfig((n) => (n === 'MAIL_DELIVERY_MODE' ? mode : n === 'MAIL_REDIRECT_TO' ? 'qa@ebim.pe' : undefined)),
    appUrl: APP,
    claimBatch: vi.fn(async () => {
      if (served) return [];
      served = true;
      return rows;
    }),
    paymentLink: vi.fn(async () => ({ token: 'TOKEN123', expires: '13/12/2026' })),
    markResult: vi.fn(async (r: MarkResult) => {
      marks.push(r);
    }),
    send: vi.fn(async (r: MailhubSendRequest) => {
      sent.push(r);
      return typeof result === 'function' ? result(r) : result;
    }),
  };
  return { deps, marks, sent };
}

const OK: MailhubSendResult = { ok: true, emailId: 'em-1', status: 'queued', replayed: false, suppressed: [] };

describe('runDispatch', () => {
  it('EBIM pasa: plantilla, clave estable, x-region en el cliente y estado SENT', async () => {
    const h = harness([row()], OK);
    const s = await runDispatch(h.deps);
    expect(s).toMatchObject({ claimed: 1, sent: 1 });
    expect(h.sent[0]).toMatchObject({
      to: ['finanzas@ebim.pe'],
      templateKey: 'masteradmin-pago-confirmado',
      idempotencyKey: 'masteradmin-payment-confirmed-p1',
      referenceId: 'INV-1',
    });
    expect(h.marks[0]).toMatchObject({ id: 'o1', status: 'SENT', mailhubEmailId: 'em-1', deliveredTo: 'finanzas@ebim.pe', deliveryMode: 'allowlist' });
  });

  it('QAS: un cliente real queda RETENIDO sin llamar a MailHub ni crear enlace de pago', async () => {
    const h = harness([row({ recipient_email: 'admin@chm.com.pe', needs_payment_link: true, event_type: 'INVOICE_ISSUED', template_key: 'masteradmin-factura-emitida' })], OK);
    const s = await runDispatch(h.deps);
    expect(s.held).toBe(1);
    expect(h.deps.send).not.toHaveBeenCalled();
    expect(h.deps.paymentLink).not.toHaveBeenCalled();
    expect(h.marks[0].status).toBe('HELD');
    expect(h.marks[0].detail).toContain('Retenido (QAS)');
  });

  it('dominio de prueba: descartado, en cualquier modo', async () => {
    const h = harness([row({ recipient_email: 'pagos@alpha.ebim.test' })], OK, 'live');
    expect((await runDispatch(h.deps)).skipped).toBe(1);
    expect(h.deps.send).not.toHaveBeenCalled();
  });

  it('factura: el enlace al portal se genera al enviar y viaja solo a MailHub', async () => {
    const h = harness(
      [row({ event_type: 'INVOICE_ISSUED', template_key: 'masteradmin-factura-emitida', needs_payment_link: true, variables: { numero: 'INV-1' } })],
      OK,
    );
    await runDispatch(h.deps);
    expect(h.deps.paymentLink).toHaveBeenCalledWith('o1');
    expect(h.sent[0].variables.enlace_pago).toBe(`${APP}/pagar#TOKEN123`);
    expect(h.sent[0].variables.vence_enlace).toBe('13/12/2026');
    expect(JSON.stringify(h.marks)).not.toContain('TOKEN123');
  });

  it('si el enlace de pago no se puede generar, el correo falla con el código de la base', async () => {
    const h = harness([row({ needs_payment_link: true, event_type: 'INVOICE_OVERDUE', template_key: 'masteradmin-factura-vencida' })], OK);
    (h.deps.paymentLink as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ORGANIZACION_INACTIVA: no se genera'));
    await runDispatch(h.deps);
    expect(h.deps.send).not.toHaveBeenCalled();
    expect(h.marks[0]).toMatchObject({ status: 'FAILED', errorCode: 'ORGANIZACION_INACTIVA' });
  });

  it('error reintentable: vuelve a PENDING con backoff; agotados los intentos, FAILED', async () => {
    const err: MailhubSendResult = { ok: false, retryable: true, httpStatus: 503, code: 'internal_error', message: 'caído' };
    const a = harness([row({ attempts: 2 })], err);
    expect((await runDispatch(a.deps)).retried).toBe(1);
    expect(a.marks[0]).toMatchObject({ status: 'PENDING', retryInSeconds: 120, errorCode: 'internal_error' });
    const b = harness([row({ attempts: 8 })], err);
    await runDispatch(b.deps);
    expect(b.marks[0].status).toBe('FAILED');
  });

  it('un 4xx de MailHub es definitivo', async () => {
    const h = harness([row()], { ok: false, retryable: false, httpStatus: 422, code: 'template_variables_missing', message: 'faltan' });
    await runDispatch(h.deps);
    expect(h.marks[0]).toMatchObject({ status: 'FAILED', errorCode: 'template_variables_missing' });
  });

  it('dirección suprimida en MailHub: SUPPRESSED', async () => {
    const h = harness([row()], { ...OK, suppressed: ['finanzas@ebim.pe'] });
    await runDispatch(h.deps);
    expect(h.marks[0].status).toBe('SUPPRESSED');
  });

  it('redirect: va al buzón de QA y queda constancia del destinatario original', async () => {
    const h = harness([row({ recipient_email: 'admin@chm.com.pe' })], OK, 'redirect');
    await runDispatch(h.deps);
    expect(h.sent[0].to).toEqual(['qa@ebim.pe']);
    expect(h.sent[0].metadata).toMatchObject({ redirected: true });
    expect(h.marks[0]).toMatchObject({ status: 'SENT', deliveredTo: 'qa@ebim.pe', detail: 'Redirigido desde admin@chm.com.pe' });
  });

  it('un error inesperado en una fila no detiene el lote', async () => {
    const h = harness([row({ id: 'a' }), row({ id: 'b', idempotency_key: 'payment-confirmed-p2' })], (r) => {
      if (r.idempotencyKey.endsWith('p1')) throw new Error('boom');
      return OK;
    });
    const s = await runDispatch(h.deps);
    expect(s).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(h.marks.find((m) => m.id === 'a')?.status).toBe('PENDING');
  });
});

describe('variables y claves', () => {
  it('un reenvío usa una clave nueva hacia MailHub', () => {
    expect(sendKeyFor({ idempotency_key: 'invoice-issued-1', resend_count: 0 })).toBe('masteradmin-invoice-issued-1');
    expect(sendKeyFor({ idempotency_key: 'invoice-issued-1', resend_count: 2 })).toBe('masteradmin-invoice-issued-1-r2');
  });
  it('rutas relativas del resumen de operaciones → URL de la consola', () => {
    const v = buildVariables(row({ variables: { enlace: '/apps?tab=sincronizacion-apps', titulo: '/no-es-enlace' } }), APP);
    expect(v.enlace).toBe(`${APP}/apps?tab=sincronizacion-apps`);
    expect(v.titulo).toBe('/no-es-enlace');
  });
  it('prueba (TEST): variables de muestra del catálogo; las internas `_x` no viajan', () => {
    const v = buildVariables(row({ event_type: 'TEST', template_key: 'masteradmin-acceso-invitacion', variables: { _sample: true } }), APP);
    expect(v.nombre).toBe('Ana Torres');
    expect(v.consola_url).toBe(APP);
    expect(v).not.toHaveProperty('_sample');
  });
});
