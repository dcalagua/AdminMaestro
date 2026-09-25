import { describe, it, expect } from 'vitest';
import { createBodyText, sha256Hex } from './fingerprint';
import { GENERIC_CODEC } from './adapters/generic';
import type { ContractCodec, ProvisioningContext } from './types';

describe('fingerprint', () => {
  it('sha256Hex es el SHA-256 estándar en hexadecimal', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('createBodyText = JSON.stringify(codec.buildCreateBody(ctx)) y es estable', () => {
    const ctx = { payload: { tenantCode: 'alpha', b: [1, 2], c: { d: null } } } as unknown as ProvisioningContext;
    const codec: ContractCodec = GENERIC_CODEC;
    expect(createBodyText(codec, ctx)).toBe(JSON.stringify(codec.buildCreateBody(ctx)));
    expect(createBodyText(codec, ctx)).toBe(createBodyText(codec, ctx));
  });
});
