import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from './mock.ts';
import { handlePayPortal, maskChargeId, PORTAL_MAX_BODY_BYTES, type PortalDeps, type PortalRequest } from './portal.ts';
import { ProviderError, type PaymentProvider, type ProviderAccountConfig } from './types.ts';

/**
 * M1/M2 · Handlers de `pay-portal` con dependencias inyectadas. La base y la
 * pasarela son dobles: lo que se fija aquí es el CONTRATO del portal público
 * (rutas, límites, respuestas idénticas para enlaces inválidos, saneado de la
 * respuesta, orden de las llamadas y códigos estables).
 */

const TOKEN = 'A'.repeat(40) + 'b_c';
const OTHER_TOKEN = 'Z'.repeat(43);
const INVOICE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

const accountRow = {
  id: ACCOUNT_ID,
  code: 'culqi-pe-test',
  provider_kind: 'CULQI',
  environment: 'TEST',
  currency: 'PEN',
  public_key: null,
  secret_key_ref: null,
  status: 'ACTIVE',
};

const mockAccount: ProviderAccountConfig = {
  id: ACCOUNT_ID, code: 'culqi-pe-test', providerKind: 'CULQI', environment: 'TEST',
  currency: 'PEN', publicKey: null, secretKeyRef: null,
};

function statementData() {
  return {
    valid: true,
    link: { id: LINK_ID, expires_at: '2026-11-01T00:00:00Z', allow_card_enrollment: true },
    organization: { id: 'org-1', name: 'Empresa Alpha', billing_email_masked: 'p***s@alpha.ebim.test', country_code: 'PE' },
    invoices: [
      {
        id: INVOICE, number: 'INV-1', status: 'ISSUED', currency: 'USD', total: 1200, paid: 0, balance: 1200,
        issue_date: '2026-10-01', due_date: '2026-10-16', period_start: '2026-10-01', period_end: '2026-10-31',
        product: 'eSupplier', payable_by_card: true, account_id: ACCOUNT_ID,
      },
    ],
    accounts: [{ ...accountRow, secret_key_ref: null }],
    card_on_file: null,
    enrollment: { available: true, account_id: ACCOUNT_ID, missing_fields: [], terms_version: 'CARD_ON_FILE_V1' },
  };
}

type Handler = (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };

function makeDeps(overrides: Partial<Record<string, Handler>> = {}, opts: { allowMock?: boolean; provider?: PaymentProvider } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const handlers: Record<string, Handler> = {
    payment_link_statement: (a) =>
      a.p_token_hash === sha(TOKEN)
        ? { data: statementData() }
        : { data: { valid: false, error: 'ENLACE_INVALIDO' } },
    payment_link_charge_context: () => ({
      data: {
        ok: true, link_id: LINK_ID, organization_id: 'org-1', billing_email: 'pagos@alpha.ebim.test',
        provider_account_id: ACCOUNT_ID,
        invoice: { id: INVOICE, number: 'INV-1', currency: 'USD', balance: '1200.00', subscription_id: 'sub-1' },
      },
    }),
    register_payment_link_event: () => ({ data: { event_id: 'e', rate_limited: false } }),
    register_provider_invoice_payment: () => ({ data: { duplicate: false, payment_id: 'p1' } }),
    payment_link_enrollment_context: () => ({
      data: {
        ok: true, link_id: LINK_ID, organization_id: 'org-1', provider_account_id: ACCOUNT_ID,
        external_customer_id: null, missing_fields: [],
        contact: {
          first_name: 'Ana', last_name: 'Pérez', email: 'pagos@alpha.ebim.test', address: 'Av. Uno 123',
          city: 'Lima', phone: '51987654321', country_code: 'PE',
        },
      },
    }),
    enroll_card_on_file: () => ({ data: { authorization_id: 'auth-1', subscriptions_switched: 2 } }),
    unenroll_card_on_file: () => ({ data: { ok: true, revoked: 1 } }),
    set_billing_contact_from_portal: () => ({ data: { filled: [] } }),
    ...overrides,
  };
  const deps: PortalDeps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const h = handlers[fn];
      if (!h) throw new Error(`rpc no esperada: ${fn}`);
      const r = h(args);
      return { data: r.data ?? null, error: r.error ?? null };
    }),
    loadAccount: vi.fn(async () => accountRow),
    resolveProvider: vi.fn(() => opts.provider ?? new MockPaymentProvider(mockAccount)),
    allowMock: opts.allowMock ?? true,
    sha256Hex: async (t: string) => sha(t),
  };
  return { deps, calls, called: (fn: string) => calls.filter(([f]) => f === fn) };
}

function req(route: string, body: unknown, extra: Partial<PortalRequest> = {}): PortalRequest {
  return {
    method: 'POST', route, bodyText: JSON.stringify(body),
    clientIp: '10.0.0.1', userAgent: 'vitest', ...extra,
  };
}

describe('pay-portal · entrada', () => {
  it('ruta desconocida → 404 RUTA_NO_ENCONTRADA; método distinto de POST → 405', async () => {
    const { deps } = makeDeps();
    expect((await handlePayPortal(req('admin', {}), deps)).body.error).toBe('RUTA_NO_ENCONTRADA');
    expect((await handlePayPortal(req('statement', {}, { method: 'GET' }), deps)).status).toBe(405);
  });

  it('cuerpo de más de 16 KB → 413 sin tocar la base', async () => {
    const { deps, calls } = makeDeps();
    const big = { token: TOKEN, pad: 'x'.repeat(PORTAL_MAX_BODY_BYTES) };
    const res = await handlePayPortal(req('statement', big), deps);
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('un token mal formado y uno inexistente responden EXACTAMENTE igual', async () => {
    const { deps } = makeDeps();
    const malformed = await handlePayPortal(req('statement', { token: 'corto' }), deps);
    const unknown = await handlePayPortal(req('statement', { token: OTHER_TOKEN }), deps);
    expect(malformed).toEqual(unknown);
    expect(unknown).toMatchObject({ status: 404, body: { error: 'ENLACE_INVALIDO' } });
  });
});

describe('pay-portal · /statement', () => {
  it('envía el hash (nunca el token) y una huella hash de IP + UA', async () => {
    const { deps, called } = makeDeps();
    await handlePayPortal(req('statement', { token: TOKEN }), deps);
    const [, args] = called('payment_link_statement')[0]!;
    expect(args.p_token_hash).toBe(sha(TOKEN));
    expect(JSON.stringify(args)).not.toContain(TOKEN);
    expect(args.p_client_fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(args)).not.toContain('10.0.0.1');
  });

  it('responde sin ids internos de cuenta, enlace u organización ni referencias de secretos', async () => {
    const { deps } = makeDeps();
    const res = await handlePayPortal(req('statement', { token: TOKEN }), deps);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const leaked of [ACCOUNT_ID, LINK_ID, 'org-1', 'secret_key_ref', 'account_id']) {
      expect(text).not.toContain(leaked);
    }
    const inv = (res.body.invoices as Array<Record<string, unknown>>)[0]!;
    expect(inv).toMatchObject({ number: 'INV-1', balance: 1200, payable_by_card: true, checkout: { mode: 'MOCK', public_key: null } });
    expect(res.body.enrollment).toMatchObject({ available: true, terms_version: 'CARD_ON_FILE_V1' });
  });

  it('sin PAYMENT_PORTAL_ALLOW_MOCK una cuenta MOCK no es pagable en línea', async () => {
    const { deps } = makeDeps({}, { allowMock: false });
    const res = await handlePayPortal(req('statement', { token: TOKEN }), deps);
    const inv = (res.body.invoices as Array<Record<string, unknown>>)[0]!;
    expect(inv.payable_by_card).toBe(false);
    expect(inv.checkout).toBeNull();
    expect(res.body.enrollment).toMatchObject({ available: false });
  });

  it('enlace vencido y revocado devuelven su código con 410', async () => {
    for (const code of ['ENLACE_VENCIDO', 'ENLACE_REVOCADO']) {
      const { deps } = makeDeps({ payment_link_statement: () => ({ data: { valid: false, error: code } }) });
      const res = await handlePayPortal(req('statement', { token: TOKEN }), deps);
      expect(res).toMatchObject({ status: 410, body: { error: code } });
      expect(String(res.body.message)).not.toMatch(/[A-Z]{4,}_/);
    }
  });
});

describe('pay-portal · /charge', () => {
  const body = { token: TOKEN, invoice_id: INVOICE, source_token: 'tkn_mock_ok', email: 'Ana@Alpha.ebim.test' };

  it('camino feliz: contexto → intento → cargo → registro → CHARGE_OK; comprobante enmascarado', async () => {
    const { deps, calls, called } = makeDeps();
    const res = await handlePayPortal(req('charge', body), deps);
    expect(res.status).toBe(200);
    expect(calls.map(([f]) => f)).toEqual([
      'payment_link_charge_context',
      'register_payment_link_event',
      'register_provider_invoice_payment',
      'register_payment_link_event',
    ]);
    expect(called('register_payment_link_event')[0]![1]).toMatchObject({ p_kind: 'CHARGE_ATTEMPT', p_invoice_id: INVOICE });
    const [, reg] = called('register_provider_invoice_payment')[0]!;
    expect(reg).toMatchObject({ p_invoice_id: INVOICE, p_amount: 1200, p_currency: 'USD', p_provider_account_id: ACCOUNT_ID });
    expect(String(reg.p_external_charge_id)).toMatch(/^chr_mock_/);
    expect(reg.p_external_event_key).toBe(`portal:${reg.p_external_charge_id}`);
    expect(called('register_payment_link_event')[1]![1]).toMatchObject({ p_kind: 'CHARGE_OK' });
    const receipt = res.body.receipt as Record<string, unknown>;
    expect(receipt).toMatchObject({ invoice_number: 'INV-1', amount: 1200, currency: 'USD' });
    expect(String(receipt.charge)).toMatch(/^chr_…[0-9a-f]{4}$/);
    expect(res.body.simulated).toBe(true);
  });

  it('el importe es el SALDO que decide la base, no uno que mande el navegador', async () => {
    const { deps } = makeDeps();
    const spy = vi.spyOn(MockPaymentProvider.prototype, 'createCharge');
    await handlePayPortal(req('charge', { ...body, amount: 1 }), deps);
    expect(spy.mock.calls[0]![0]).toMatchObject({ amountMinor: 120000, currency: 'USD', email: 'ana@alpha.ebim.test' });
    spy.mockRestore();
  });

  it('límite de intentos → 429 DEMASIADOS_INTENTOS y no se llama a la pasarela', async () => {
    const provider = new MockPaymentProvider(mockAccount);
    const spy = vi.spyOn(provider, 'createCharge');
    const { deps } = makeDeps({ register_payment_link_event: () => ({ data: { rate_limited: true } }) }, { provider });
    const res = await handlePayPortal(req('charge', body), deps);
    expect(res).toMatchObject({ status: 429, body: { error: 'DEMASIADOS_INTENTOS' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('tarjeta rechazada → 402 TARJETA_RECHAZADA y evento CHARGE_FAILED; nada se registra', async () => {
    const { deps, called } = makeDeps();
    const res = await handlePayPortal(req('charge', { ...body, source_token: 'tkn_mock_decline' }), deps);
    expect(res).toMatchObject({ status: 402, body: { error: 'TARJETA_RECHAZADA' } });
    expect(called('register_provider_invoice_payment')).toHaveLength(0);
    expect(called('register_payment_link_event')[1]![1]).toMatchObject({ p_kind: 'CHARGE_FAILED', p_error_code: 'TARJETA_RECHAZADA' });
  });

  it('3-D Secure → TARJETA_REQUIERE_AUTENTICACION (se ofrece transferencia)', async () => {
    const { deps } = makeDeps();
    const res = await handlePayPortal(req('charge', { ...body, source_token: 'tkn_mock_3ds' }), deps);
    expect(res.body).toMatchObject({ error: 'TARJETA_REQUIERE_AUTENTICACION' });
    expect(String(res.body.message)).toMatch(/transferencia/);
  });

  it('cuenta MOCK sin permiso explícito → CUENTA_NO_CONFIGURADA antes de cualquier intento', async () => {
    const { deps, called } = makeDeps({}, { allowMock: false });
    const res = await handlePayPortal(req('charge', body), deps);
    expect(res.body.error).toBe('CUENTA_NO_CONFIGURADA');
    expect(called('register_payment_link_event')).toHaveLength(0);
  });

  it('un token simulado contra una pasarela real se rechaza sin cobrar', async () => {
    const real = { name: 'culqi', mode: 'TEST', createCharge: vi.fn() } as unknown as PaymentProvider;
    const { deps } = makeDeps({}, { provider: real });
    const res = await handlePayPortal(req('charge', body), deps);
    expect(res.body.error).toBe('TARJETA_RECHAZADA');
    expect(real.createCharge).not.toHaveBeenCalled();
  });

  it('factura no pagable y sobrecobro en el registro', async () => {
    const ctx = makeDeps({ payment_link_charge_context: () => ({ data: { ok: false, error: 'FACTURA_NO_PAGABLE' } }) });
    expect((await handlePayPortal(req('charge', body), ctx.deps)).body.error).toBe('FACTURA_NO_PAGABLE');

    const over = makeDeps({
      register_provider_invoice_payment: () => ({ error: { message: 'SOBRECOBRO: la factura INV-1 suma …' } }),
    });
    const res = await handlePayPortal(req('charge', body), over.deps);
    // El dinero ya se cobró: no se le pide al cliente que repita el pago.
    expect(res.body.error).toBe('PAGO_EN_REVISION');
    expect(over.called('register_payment_link_event').at(-1)![1]).toMatchObject({ p_kind: 'CHARGE_FAILED', p_error_code: 'SOBRECOBRO' });
  });

  it('valida invoice_id y source_token antes de tocar la base', async () => {
    const { deps, calls } = makeDeps();
    expect((await handlePayPortal(req('charge', { ...body, invoice_id: 'x' }), deps)).body.error).toBe('FACTURA_NO_PAGABLE');
    expect((await handlePayPortal(req('charge', { ...body, source_token: 'crd_x' }), deps)).body.error).toBe('SOLICITUD_INVALIDA');
    expect(calls).toHaveLength(0);
  });
});

describe('pay-portal · /enroll y /unenroll', () => {
  const body = { token: TOKEN, source_token: 'tkn_mock_card', accepted_terms: true };

  it('sin aceptar los términos → 400 TERMINOS_NO_ACEPTADOS', async () => {
    const { deps, calls } = makeDeps();
    const res = await handlePayPortal(req('enroll', { ...body, accepted_terms: false }), deps);
    expect(res).toMatchObject({ status: 400, body: { error: 'TERMINOS_NO_ACEPTADOS' } });
    expect(calls).toHaveLength(0);
  });

  it('alta: guarda la tarjeta con los datos de la organización y registra la autorización', async () => {
    const { deps, called } = makeDeps();
    const res = await handlePayPortal(req('enroll', body), deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, card: { brand: 'VISA', last4: '4242' }, subscriptions_switched: 2 });
    expect(called('register_payment_link_event')[0]![1]).toMatchObject({ p_kind: 'ENROLL_ATTEMPT' });
    const [, args] = called('enroll_card_on_file')[0]!;
    expect(args).toMatchObject({ p_link_id: LINK_ID, p_provider_account_id: ACCOUNT_ID, p_terms_version: 'CARD_ON_FILE_V1' });
    expect(String(args.p_external_payment_method_id)).toMatch(/^crd_mock_/);
    expect(JSON.stringify(args)).not.toContain('tkn_mock_card');
  });

  it('faltan datos de facturación y no llegan → 409 con la lista; con ellos se completan', async () => {
    let missing = ['billing_phone'];
    const { deps, called } = makeDeps({
      payment_link_enrollment_context: () => ({
        data: {
          ok: true, link_id: LINK_ID, organization_id: 'org-1', provider_account_id: ACCOUNT_ID, missing_fields: missing,
          contact: { first_name: 'Ana', last_name: 'Pérez', email: 'a@b.pe', address: 'Av. Uno 123', city: 'Lima', phone: missing.length ? null : '51999999999', country_code: 'PE' },
        },
      }),
      set_billing_contact_from_portal: (a) => {
        if (a.p_phone) missing = [];
        return { data: { filled: a.p_phone ? ['billing_phone'] : [] } };
      },
    });
    const first = await handlePayPortal(req('enroll', body), deps);
    expect(first).toMatchObject({ status: 409, body: { error: 'DATOS_FACTURACION_INCOMPLETOS', missing_fields: ['billing_phone'] } });

    const second = await handlePayPortal(req('enroll', { ...body, billing_contact: { phone: '51 999 999 999' } }), deps);
    expect(second.status).toBe(200);
    expect(called('set_billing_contact_from_portal').at(-1)![1]).toMatchObject({ p_link_id: LINK_ID, p_phone: '51 999 999 999' });
  });

  it('tarjeta rechazada al guardarla → 402 y no hay autorización', async () => {
    const { deps, called } = makeDeps();
    const res = await handlePayPortal(req('enroll', { ...body, source_token: 'tkn_mock_decline' }), deps);
    expect(res.body.error).toBe('TARJETA_RECHAZADA');
    expect(called('enroll_card_on_file')).toHaveLength(0);
  });

  it('baja: revoca con el hash del token', async () => {
    const { deps, called } = makeDeps();
    const res = await handlePayPortal(req('unenroll', { token: TOKEN }), deps);
    expect(res.body).toEqual({ ok: true, revoked: 1 });
    expect(called('unenroll_card_on_file')[0]![1]).toMatchObject({ p_token_hash: sha(TOKEN) });
  });
});

describe('utilidades', () => {
  it('maskChargeId deja solo el prefijo y los 4 últimos caracteres', () => {
    expect(maskChargeId('chr_test_abcdef123456')).toBe('chr_…3456');
  });

  it('un error inesperado nunca filtra el mensaje interno', async () => {
    const { deps } = makeDeps({
      payment_link_charge_context: () => {
        throw new ProviderError('X', 'detalle interno con id 2222');
      },
    });
    const res = await handlePayPortal(req('charge', { token: TOKEN, invoice_id: INVOICE, source_token: 'tkn_mock_ok' }), deps);
    expect(res.body.error).toBe('ERROR_INTERNO');
    expect(JSON.stringify(res.body)).not.toContain('2222');
  });
});
