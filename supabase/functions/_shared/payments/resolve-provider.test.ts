import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  providerResolver,
  resolvePaymentProvider,
  toAccountConfig,
  vaultSecretLoader,
  type EnvReader,
} from './index.ts';
import { CulqiPaymentProvider } from './culqi.ts';
import { MockPaymentProvider } from './mock.ts';
import { ProviderError, type ProviderAccountConfig } from './types.ts';

/**
 * Spec §11 · De dónde sale la llave secreta de Culqi.
 *
 *   llave cifrada (Vault, RPC de servicio) → variable de `secret_key_ref` → MOCK
 *   URL: `api_base_url` de la cuenta → `CULQI_API_BASE` → MOCK
 *   LIVE: nunca degrada a MOCK y exige CULQI_ALLOW_LIVE=true (entorno).
 *
 * Las llaves se COMPONEN aquí: un literal con forma de llave dispararía el
 * escáner de secretos del repositorio.
 */
const key = (env: 'test' | 'live', body: string) => ['sk', env, body].join('_');
const VAULT_KEY = key('test', 'Vault000000AAAA');
const ENV_KEY = key('test', 'Entorno0000BBBB');
const LIVE_KEY = key('live', 'Produccion0CCCC');

const base: ProviderAccountConfig = {
  id: 'acc-1',
  code: 'culqi-pe-test',
  providerKind: 'CULQI',
  environment: 'TEST',
  currency: 'PEN',
  publicKey: null,
  secretKeyRef: null,
};

function envOf(vars: Record<string, string>): EnvReader {
  return (name) => vars[name];
}

/** Hace una llamada real del adapter con `fetch` simulado y devuelve URL y cabecera. */
async function probe(provider: unknown): Promise<{ url: string; auth: string }> {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  await (provider as CulqiPaymentProvider).verifyCharge('chr_x');
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
  return { url, auth: (init.headers as Record<string, string>).authorization! };
}

afterEach(() => vi.unstubAllGlobals());

describe('resolvePaymentProvider · llave cifrada (Vault)', () => {
  it('usa la llave cifrada y la URL de la cuenta', async () => {
    const loadVaultSecret = vi.fn().mockResolvedValue(VAULT_KEY);
    const provider = await resolvePaymentProvider(
      { ...base, hasVaultSecret: true, apiBaseUrl: 'https://cuenta.culqi.invalid/v2/' },
      { env: envOf({}), loadVaultSecret },
    );
    expect(provider).toBeInstanceOf(CulqiPaymentProvider);
    expect(provider.mode).toBe('TEST');
    expect(loadVaultSecret).toHaveBeenCalledWith('acc-1');
    const { url, auth } = await probe(provider);
    expect(url).toBe('https://cuenta.culqi.invalid/v2/charges/chr_x');
    expect(auth).toBe(`Bearer ${VAULT_KEY}`);
  });

  it('la llave cifrada gana a la variable de entorno; la URL de la cuenta gana a CULQI_API_BASE', async () => {
    const provider = await resolvePaymentProvider(
      { ...base, hasVaultSecret: true, secretKeyRef: 'CULQI_SECRET_KEY', apiBaseUrl: 'https://cuenta.culqi.invalid/v2' },
      {
        env: envOf({ CULQI_SECRET_KEY: ENV_KEY, CULQI_API_BASE: 'https://entorno.culqi.invalid/v2' }),
        loadVaultSecret: async () => VAULT_KEY,
      },
    );
    const { url, auth } = await probe(provider);
    expect(url.startsWith('https://cuenta.culqi.invalid/v2/')).toBe(true);
    expect(auth).toBe(`Bearer ${VAULT_KEY}`);
  });

  it('si Vault ya no tiene la llave, cae a la variable de `secret_key_ref`', async () => {
    const provider = await resolvePaymentProvider(
      { ...base, hasVaultSecret: true, secretKeyRef: 'CULQI_SECRET_KEY' },
      {
        env: envOf({ CULQI_SECRET_KEY: ENV_KEY, CULQI_API_BASE: 'https://entorno.culqi.invalid/v2' }),
        loadVaultSecret: async () => null,
      },
    );
    expect((await probe(provider)).auth).toBe(`Bearer ${ENV_KEY}`);
  });

  it('una llave cifrada ilegible NO degrada a MOCK y el error no la cita', async () => {
    const failing = resolvePaymentProvider(
      { ...base, hasVaultSecret: true, apiBaseUrl: 'https://cuenta.culqi.invalid/v2' },
      { env: envOf({}), loadVaultSecret: async () => Promise.reject(new Error(`boom ${VAULT_KEY}`)) },
    );
    await expect(failing).rejects.toMatchObject({ code: 'LLAVE_NO_DISPONIBLE', httpStatus: 500 });
    await failing.catch((e: ProviderError) => expect(e.message).not.toContain(VAULT_KEY));

    // Cableado olvidado (cuenta con llave cifrada y sin lector): también falla.
    await expect(
      resolvePaymentProvider({ ...base, hasVaultSecret: true }, { env: envOf({}) }),
    ).rejects.toMatchObject({ code: 'LLAVE_NO_DISPONIBLE' });
  });
});

describe('resolvePaymentProvider · variable de entorno y MOCK', () => {
  it('sin llave cifrada usa la variable que nombra `secret_key_ref` y CULQI_API_BASE', async () => {
    const loadVaultSecret = vi.fn();
    const provider = await resolvePaymentProvider(
      { ...base, secretKeyRef: 'CULQI_SECRET_KEY' },
      { env: envOf({ CULQI_SECRET_KEY: ENV_KEY, CULQI_API_BASE: 'https://entorno.culqi.invalid/v2/' }), loadVaultSecret },
    );
    expect(loadVaultSecret).not.toHaveBeenCalled();
    const { url, auth } = await probe(provider);
    expect(url).toBe('https://entorno.culqi.invalid/v2/charges/chr_x');
    expect(auth).toBe(`Bearer ${ENV_KEY}`);
  });

  it('TEST sin llave, o sin URL de la API, opera en MOCK', async () => {
    const env = envOf({ CULQI_API_BASE: 'https://entorno.culqi.invalid/v2' });
    expect((await resolvePaymentProvider(base, { env })).mode).toBe('MOCK');
    expect((await resolvePaymentProvider({ ...base, secretKeyRef: 'CULQI_SECRET_KEY' }, { env })).mode).toBe('MOCK');
    // Llave cifrada pero ninguna URL: no se inventa la URL de la API.
    const sinUrl = await resolvePaymentProvider(
      { ...base, hasVaultSecret: true },
      { env: envOf({}), loadVaultSecret: async () => VAULT_KEY },
    );
    expect(sinUrl).toBeInstanceOf(MockPaymentProvider);
  });

  it('MANUAL/BANK no tienen pasarela: MOCK sin leer ninguna llave', async () => {
    const loadVaultSecret = vi.fn();
    const provider = await resolvePaymentProvider(
      { ...base, providerKind: 'BANK', hasVaultSecret: true },
      { env: envOf({}), loadVaultSecret },
    );
    expect(provider.mode).toBe('MOCK');
    expect(loadVaultSecret).not.toHaveBeenCalled();
  });
});

describe('resolvePaymentProvider · LIVE', () => {
  const live: ProviderAccountConfig = { ...base, code: 'culqi-pe-live', environment: 'LIVE', hasVaultSecret: true, apiBaseUrl: 'https://cuenta.culqi.invalid/v2' };

  it('LIVE sin configuración falla ruidosamente (nunca MOCK)', async () => {
    await expect(
      resolvePaymentProvider({ ...live, hasVaultSecret: false }, { env: envOf({}) }),
    ).rejects.toMatchObject({ code: 'CULQI_LIVE_SIN_CONFIGURAR' });
  });

  it('LIVE con llave cifrada exige CULQI_ALLOW_LIVE=true en el ENTORNO', async () => {
    const loadVaultSecret = async () => LIVE_KEY;
    const blocked = resolvePaymentProvider(live, { env: envOf({}), loadVaultSecret });
    await expect(blocked).rejects.toMatchObject({ code: 'LIVE_NO_AUTORIZADO', httpStatus: 403 });
    await blocked.catch((e: ProviderError) => expect(e.message).not.toContain(LIVE_KEY));

    const allowed = await resolvePaymentProvider(live, { env: envOf({ CULQI_ALLOW_LIVE: 'true' }), loadVaultSecret });
    expect(allowed.mode).toBe('LIVE');
  });

  it('el adapter sigue abortando si la llave no corresponde al entorno', async () => {
    await expect(
      resolvePaymentProvider(live, { env: envOf({ CULQI_ALLOW_LIVE: 'true' }), loadVaultSecret: async () => VAULT_KEY }),
    ).rejects.toMatchObject({ code: 'LLAVE_NO_COINCIDE' });
  });
});

describe('cableado desde la fila de la base', () => {
  const row = {
    id: 'acc-1', code: 'culqi-pe-test', provider_kind: 'CULQI', environment: 'TEST', currency: 'PEN',
    public_key: null, secret_key_ref: null, secret_vault_id: '9b0c1f7e-0000-4000-a000-000000000001',
    api_base_url: 'https://cuenta.culqi.invalid/v2', status: 'ACTIVE',
  };

  it('toAccountConfig solo expone el INDICADOR de llave cifrada y la URL', () => {
    const cfg = toAccountConfig(row);
    expect(cfg).toMatchObject({ hasVaultSecret: true, apiBaseUrl: 'https://cuenta.culqi.invalid/v2' });
    expect(JSON.stringify(cfg)).not.toContain(row.secret_vault_id);
    expect(toAccountConfig({ ...row, secret_vault_id: null, api_base_url: '' })).toMatchObject({
      hasVaultSecret: false,
      apiBaseUrl: null,
    });
  });

  it('vaultSecretLoader llama a la RPC de servicio y no propaga su error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: VAULT_KEY, error: null });
    expect(await vaultSecretLoader(rpc)('acc-1')).toBe(VAULT_KEY);
    expect(rpc).toHaveBeenCalledWith('payment_provider_account_secret', { p_account_id: 'acc-1' });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await vaultSecretLoader(rpc)('acc-1')).toBeNull();

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied for function x' } });
    await expect(vaultSecretLoader(rpc)('acc-1')).rejects.toMatchObject({
      code: 'LLAVE_NO_DISPONIBLE',
      message: 'No se pudo leer la llave secreta cifrada.',
    });
  });

  it('providerResolver: fila → llave cifrada → Culqi TEST', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: VAULT_KEY, error: null });
    const provider = await providerResolver(rpc, envOf({}))(row);
    expect(provider.mode).toBe('TEST');
    expect((await probe(provider)).auth).toBe(`Bearer ${VAULT_KEY}`);
  });
});
