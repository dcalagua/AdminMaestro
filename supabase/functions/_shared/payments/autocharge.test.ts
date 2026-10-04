import { describe, expect, it, vi } from 'vitest';
import { handleAutocharge, type AutochargeDeps } from './autocharge.ts';
import { MockPaymentProvider } from './mock.ts';
import { ProviderError, type PaymentProvider, type ProviderAccountConfig } from './types.ts';

/**
 * M2 · `payment-autocharge` con dependencias inyectadas: orden de las llamadas,
 * origen del intento (MANUAL/RUN/CRON), mapeo de fallos definitivos frente a
 * ambiguos y resumen. La política de reintentos la decide la base (pgTAP 45).
 */

const INVOICE = '11111111-1111-4111-8111-111111111111';
const INVOICE_2 = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const account: ProviderAccountConfig = {
  id: ACCOUNT_ID, code: 'culqi-pe-test', providerKind: 'CULQI', environment: 'TEST',
  currency: 'PEN', publicKey: null, secretKeyRef: null,
};

function begun(invoiceId: string, method = 'crd_mock_card') {
  return {
    ok: true, attempt_id: `att-${invoiceId.slice(0, 4)}`, attempt_no: 1, invoice_id: invoiceId,
    invoice_number: `INV-${invoiceId.slice(0, 4)}`, amount: 850, currency: 'USD',
    provider_account_id: ACCOUNT_ID, external_payment_method_id: method, billing_email: 'pagos@alpha.ebim.test',
  };
}

function makeDeps(opts: {
  begin?: (args: Record<string, unknown>) => unknown;
  due?: unknown[];
  provider?: PaymentProvider;
  completeError?: string;
} = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const deps: AutochargeDeps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === 'begin_card_charge_attempt') {
        return { data: opts.begin ? opts.begin(args) : begun(String(args.p_invoice_id)), error: null };
      }
      if (fn === 'card_on_file_due_invoices') return { data: opts.due ?? [], error: null };
      if (fn === 'complete_card_charge_attempt') {
        return opts.completeError && args.p_succeeded
          ? { data: null, error: { message: `${opts.completeError}: detalle` } }
          : { data: { status: args.p_succeeded ? 'SUCCEEDED' : 'FAILED' }, error: null };
      }
      throw new Error(`rpc no esperada ${fn}`);
    }),
    loadAccount: vi.fn(async () => ({ id: ACCOUNT_ID, code: 'culqi-pe-test', status: 'ACTIVE' })),
    resolveProvider: vi.fn(() => opts.provider ?? new MockPaymentProvider(account)),
  };
  return { deps, calls, called: (fn: string) => calls.filter(([f]) => f === fn) };
}

const user = { kind: 'user' as const, userId: '10000000-0000-4000-a000-000000000003' };
const post = (body: unknown) => ({ method: 'POST', bodyText: JSON.stringify(body) });

describe('payment-autocharge', () => {
  it('«Cobrar ahora»: intento MANUAL que ignora el calendario, cargo con la tarjeta guardada y cierre con éxito', async () => {
    const { deps, calls, called } = makeDeps();
    const res = await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(res.status).toBe(200);
    expect(calls.map(([f]) => f)).toEqual(['begin_card_charge_attempt', 'complete_card_charge_attempt']);
    expect(called('begin_card_charge_attempt')[0]![1]).toMatchObject({
      p_invoice_id: INVOICE, p_trigger_source: 'MANUAL', p_actor: user.userId, p_ignore_schedule: true,
    });
    const [, done] = called('complete_card_charge_attempt')[0]!;
    expect(done).toMatchObject({ p_succeeded: true, p_amount: 850, p_currency: 'USD' });
    expect(String(done.p_external_charge_id)).toMatch(/^chr_mock_/);
    expect(res.body).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('el cargo usa el crd_ guardado, el saldo en céntimos y la factura en los metadatos', async () => {
    const provider = new MockPaymentProvider(account);
    const spy = vi.spyOn(provider, 'createCharge');
    const { deps } = makeDeps({ provider });
    await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      amountMinor: 85000, currency: 'USD', sourceId: 'crd_mock_card',
      metadata: { invoice_id: INVOICE, origin: 'payment-autocharge' },
    });
  });

  it('«Ejecutar cobros pendientes»: recorre la cola de la base con origen RUN (CRON si llama el servidor)', async () => {
    const due = [{ invoice_id: INVOICE }, { invoice_id: INVOICE_2 }];
    const a = makeDeps({ due });
    const res = await handleAutocharge(post({ run: true, limit: 500 }), user, a.deps);
    expect(a.called('card_on_file_due_invoices')[0]![1]).toEqual({ p_limit: 100 });
    expect(a.called('begin_card_charge_attempt').map(([, x]) => x.p_trigger_source)).toEqual(['RUN', 'RUN']);
    expect(a.called('begin_card_charge_attempt').every(([, x]) => x.p_ignore_schedule === false)).toBe(true);
    expect(res.body).toMatchObject({ processed: 2, succeeded: 2 });

    const b = makeDeps({ due });
    await handleAutocharge(post({ run: true }), { kind: 'service' }, b.deps);
    expect(b.called('begin_card_charge_attempt').map(([, x]) => x.p_trigger_source)).toEqual(['CRON', 'CRON']);
    expect(b.called('begin_card_charge_attempt')[0]![1].p_actor).toBeNull();
  });

  it('un rechazo de tarjeta cierra el intento como FALLIDO con su código (la base aplica el reintento)', async () => {
    const { deps, called } = makeDeps({ begin: (args) => begun(String(args.p_invoice_id), 'crd_mock_decline') });
    const res = await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(called('complete_card_charge_attempt')[0]![1]).toMatchObject({ p_succeeded: false, p_error_code: 'TARJETA_RECHAZADA' });
    expect(res.body).toMatchObject({ failed: 1, succeeded: 0 });
  });

  it('un fallo AMBIGUO de la pasarela deja el intento PENDING (REVIEW): no se arriesga un doble cargo', async () => {
    const flaky = {
      name: 'culqi', mode: 'TEST',
      createCharge: vi.fn().mockRejectedValue(new ProviderError('PROVEEDOR_NO_DISPONIBLE', 'timeout', 502)),
    } as unknown as PaymentProvider;
    const { deps, called } = makeDeps({ provider: flaky });
    const res = await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(called('complete_card_charge_attempt')).toHaveLength(0);
    expect((res.body.results as Array<Record<string, unknown>>)[0]).toMatchObject({ status: 'REVIEW', error_code: 'PROVEEDOR_NO_DISPONIBLE' });
  });

  it('cobrado pero no registrable → REVIEW con el código de la base', async () => {
    const { deps } = makeDeps({ completeError: 'SOBRECOBRO' });
    const res = await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect((res.body.results as Array<Record<string, unknown>>)[0]).toMatchObject({ status: 'REVIEW', error_code: 'SOBRECOBRO' });
  });

  it('si la base dice que no procede (intento en curso, sin autorización) se omite sin cobrar', async () => {
    const provider = new MockPaymentProvider(account);
    const spy = vi.spyOn(provider, 'createCharge');
    const { deps } = makeDeps({ provider, begin: () => ({ ok: false, error: 'COBRO_NO_PROCEDE' }) });
    const res = await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(spy).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ skipped: 1 });
  });

  it('LIVE sin autorización explícita: el selector falla y el intento queda FALLIDO sin cargo', async () => {
    const { deps, called } = makeDeps();
    (deps.resolveProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ProviderError('LIVE_NO_AUTORIZADO', 'CULQI_ALLOW_LIVE', 403);
    });
    await handleAutocharge(post({ invoice_id: INVOICE }), user, deps);
    expect(called('complete_card_charge_attempt')[0]![1]).toMatchObject({ p_succeeded: false, p_error_code: 'LIVE_NO_AUTORIZADO' });
  });

  it('cuerpo inválido o sin acción → 400; método distinto de POST → 405', async () => {
    const { deps } = makeDeps();
    expect((await handleAutocharge({ method: 'POST', bodyText: '[' }, user, deps)).status).toBe(400);
    expect((await handleAutocharge(post({}), user, deps)).body.error).toBe('SOLICITUD_INVALIDA');
    expect((await handleAutocharge(post({ invoice_id: 'nope' }), user, deps)).body.error).toBe('FACTURA_INVALIDA');
    expect((await handleAutocharge({ method: 'GET', bodyText: '' }, user, deps)).status).toBe(405);
  });
});
