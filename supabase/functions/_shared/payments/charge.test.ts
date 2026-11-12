import { afterEach, describe, expect, it, vi } from 'vitest';
import { CulqiPaymentProvider, mapChargeError } from './culqi.ts';
import { MockPaymentProvider } from './mock.ts';
import { ProviderError, type ProviderAccountConfig } from './types.ts';

/**
 * M1/M2 · Cargo único (`createCharge`) y alta de tarjeta guardada (`saveCard`).
 *
 * Culqi TEST se ejercita con `fetch` simulado: lo que se fija aquí es la
 * TRADUCCIÓN (céntimos, moneda, metadatos, verificación por GET y mapeo de
 * rechazos), que es donde se esconden los errores caros.
 */

const account: ProviderAccountConfig = {
  id: 'acc-1',
  code: 'culqi-pe-test',
  providerKind: 'CULQI',
  environment: 'TEST',
  currency: 'PEN',
  publicKey: null,
  secretKeyRef: 'CULQI_SECRET_KEY',
};

// Clave ficticia con la forma TEST (no es una credencial: no tiene sufijo real).
const FAKE_KEY = ['sk', 'test', 'x'].join('_');

function culqi() {
  return new CulqiPaymentProvider(account, { apiBase: 'https://culqi.invalid/v2', secretKey: FAKE_KEY });
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Culqi createCharge', () => {
  it('envía el importe en céntimos, la moneda, el correo, el origen y los metadatos; y verifica por GET', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { id: 'chr_test_abc', outcome: { type: 'venta_exitosa' } }))
      .mockResolvedValueOnce(
        respond(200, {
          id: 'chr_test_abc',
          amount: 125050,
          currency_code: 'USD',
          creation_date: 1_790_000_000,
          outcome: { type: 'venta_exitosa' },
          metadata: { invoice_id: 'inv-1' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await culqi().createCharge({
      amountMinor: 125050,
      currency: 'USD',
      email: 'pagos@alpha.ebim.test',
      sourceId: 'tkn_test_token',
      description: 'Factura INV-1, eSupplier',
      metadata: { invoice_id: 'inv-1', link_id: 'link-1', origin: 'pay-portal' },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://culqi.invalid/v2/charges');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      amount: 125050,
      currency_code: 'USD',
      email: 'pagos@alpha.ebim.test',
      source_id: 'tkn_test_token',
      metadata: { invoice_id: 'inv-1', link_id: 'link-1', origin: 'pay-portal' },
    });
    // El saneador de texto quita la coma: Culqi la rechaza.
    expect(body.description).not.toContain(',');
    // La clave viaja en la cabecera, nunca en la URL.
    expect(url).not.toContain(FAKE_KEY);

    expect(fetchMock.mock.calls[1]![0]).toBe('https://culqi.invalid/v2/charges/chr_test_abc');
    expect(result).toMatchObject({ externalChargeId: 'chr_test_abc', amount: 1250.5, currency: 'USD', status: 'CONFIRMED' });
  });

  it('un rechazo del emisor es TARJETA_RECHAZADA con el mensaje para el titular', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond(402, {
          object: 'error',
          type: 'card_error',
          user_message: 'Tu tarjeta no tiene fondos suficientes.',
          merchant_message: 'insufficient_funds',
          decline_code: 'insufficient_funds',
        }),
      ),
    );
    await expect(
      culqi().createCharge({ amountMinor: 1000, currency: 'PEN', email: 'a@b.pe', sourceId: 'tkn_test_x', metadata: {} }),
    ).rejects.toMatchObject({ code: 'TARJETA_RECHAZADA', message: 'Tu tarjeta no tiene fondos suficientes.' });
  });

  it('3-D Secure (action_code en un 200) es TARJETA_REQUIERE_AUTENTICACION y no se verifica nada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { action_code: 'REVIEW', user_message: 'Autenticación requerida' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      culqi().createCharge({ amountMinor: 1000, currency: 'PEN', email: 'a@b.pe', sourceId: 'tkn_test_x', metadata: {} }),
    ).rejects.toMatchObject({ code: 'TARJETA_REQUIERE_AUTENTICACION' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un cargo creado que la consulta directa no confirma NO se da por pagado', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(201, { id: 'chr_test_x' }))
        .mockResolvedValueOnce(respond(200, { id: 'chr_test_x', amount: 1000, currency_code: 'PEN', outcome: { type: 'venta_rechazada' } })),
    );
    await expect(
      culqi().createCharge({ amountMinor: 1000, currency: 'PEN', email: 'a@b.pe', sourceId: 'crd_test_x', metadata: {} }),
    ).rejects.toMatchObject({ code: 'TARJETA_RECHAZADA' });
  });

  it('rechaza importes no enteros y monedas que Culqi no cobra sin llamar a la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      culqi().createCharge({ amountMinor: 10.5, currency: 'PEN', email: 'a@b.pe', sourceId: 'tkn_test_x', metadata: {} }),
    ).rejects.toMatchObject({ code: 'IMPORTE_INVALIDO' });
    await expect(
      culqi().createCharge({ amountMinor: 1000, currency: 'BOB', email: 'a@b.pe', sourceId: 'tkn_test_x', metadata: {} }),
    ).rejects.toMatchObject({ code: 'IMPORTE_INVALIDO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un error de la pasarela que no es de tarjeta no se atribuye a la tarjeta', () => {
    const err = mapChargeError(500, { merchant_message: 'boom' });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('PROVEEDOR_RECHAZO');
    expect(err.httpStatus).toBe(502);
  });
});

describe('Culqi saveCard (tarjeta guardada sin suscripción)', () => {
  const customer = {
    organizationId: 'org-1',
    email: 'pagos@alpha.ebim.test',
    firstName: 'Contacto',
    lastName: 'Facturacion',
    countryCode: 'PE',
    address: 'Av. Demostracion 123',
    addressCity: 'Lima',
    phoneNumber: '51987654321',
  };

  it('reutiliza el Customer existente y crea solo la Card', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { id: 'crd_test_1', active: true, source: { iin: { card_brand: 'Visa' }, last_four: '1111' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await culqi().saveCard({
      token: 'tkn_test_1',
      customer: { ...customer, externalCustomerId: 'cus_test_1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://culqi.invalid/v2/cards');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toMatchObject({
      customer_id: 'cus_test_1',
      token_id: 'tkn_test_1',
    });
    expect(result).toEqual({
      externalCustomerId: 'cus_test_1',
      externalPaymentMethodId: 'crd_test_1',
      card: { brand: 'Visa', last4: '1111', expMonth: null, expYear: null },
    });
  });

  it('sin Customer previo lo crea con los siete campos; si falta alguno no llama a la red', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { id: 'cus_test_2' }))
      .mockResolvedValueOnce(respond(201, { id: 'crd_test_2', active: true, source: { last_four: '2222' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await culqi().saveCard({ token: 'tkn_test_2', customer });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://culqi.invalid/v2/customers');
    expect(result.externalCustomerId).toBe('cus_test_2');

    const silent = vi.fn();
    vi.stubGlobal('fetch', silent);
    await expect(culqi().saveCard({ token: 'tkn_test_3', customer: { ...customer, address: '' } })).rejects.toMatchObject({
      code: 'DATOS_FACTURACION_INCOMPLETOS',
    });
    expect(silent).not.toHaveBeenCalled();
  });

  it('una tarjeta que exige 3-D Secure no se guarda como activa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond(201, { id: 'crd_test_3', active: false })));
    await expect(
      culqi().saveCard({ token: 'tkn_test_3', customer: { ...customer, externalCustomerId: 'cus_test_1' } }),
    ).rejects.toMatchObject({ code: 'TARJETA_REQUIERE_AUTENTICACION' });
  });
});

describe('Mock createCharge / saveCard', () => {
  const mock = new MockPaymentProvider({ ...account, secretKeyRef: null });
  const input = {
    amountMinor: 120000,
    currency: 'USD',
    email: 'a@b.pe',
    sourceId: 'tkn_mock_portal',
    metadata: { invoice_id: 'inv-1', link_id: 'link-1' },
  };

  it('es determinista y marca el id como simulado', async () => {
    const a = await mock.createCharge(input);
    const b = await mock.createCharge(input);
    expect(a.externalChargeId).toMatch(/^chr_mock_[0-9a-f]{8}$/);
    expect(a.externalChargeId).toBe(b.externalChargeId);
    expect(a).toMatchObject({ amount: 1200, currency: 'USD', status: 'CONFIRMED' });
    const other = await mock.createCharge({ ...input, metadata: { invoice_id: 'inv-2', link_id: 'link-1' } });
    expect(other.externalChargeId).not.toBe(a.externalChargeId);
  });

  it('un origen con «decline» se rechaza y uno con «3ds» pide autenticación', async () => {
    await expect(mock.createCharge({ ...input, sourceId: 'tkn_mock_decline' })).rejects.toMatchObject({
      code: 'TARJETA_RECHAZADA',
    });
    await expect(mock.createCharge({ ...input, sourceId: 'crd_mock_3ds' })).rejects.toMatchObject({
      code: 'TARJETA_REQUIERE_AUTENTICACION',
    });
    await expect(mock.createCharge({ ...input, sourceId: 'otra_cosa' })).rejects.toMatchObject({ code: 'ORIGEN_INVALIDO' });
  });

  it('saveCard devuelve ids simulados y rechaza «decline»', async () => {
    const saved = await mock.saveCard({
      token: 'tkn_mock_a',
      customer: {
        organizationId: 'org-1', email: 'a@b.pe', firstName: 'A', lastName: 'B', countryCode: 'PE',
        address: 'Calle 1', addressCity: 'Lima', phoneNumber: '51999999999',
      },
    });
    expect(saved.externalCustomerId).toMatch(/^cus_mock_/);
    expect(saved.externalPaymentMethodId).toMatch(/^crd_mock_/);
    expect(saved.card.last4).toBe('4242');
    await expect(
      mock.saveCard({ token: 'tkn_mock_decline', customer: { organizationId: 'o' } as never }),
    ).rejects.toMatchObject({ code: 'TARJETA_RECHAZADA' });
  });
});
