import { describe, expect, it } from 'vitest';
import { contractSubtitle } from './contractSubtitle';

describe('contractSubtitle', () => {
  it('no repite la cuenta ni el nombre corto de la app que ya dice el tenant', () => {
    expect(
      contractSubtitle({
        lockup: 'eSupplier by EBIM',
        shortName: 'eSupplier',
        organization: 'Empresa Directa Alpha',
        tenant: 'Empresa Directa Alpha · eSupplier',
      }),
    ).toBe('eSupplier by EBIM · Empresa Directa Alpha');
  });

  it('conserva un tenant con nombre propio', () => {
    expect(
      contractSubtitle({ lockup: 'EBIM EWM', shortName: 'EWM', organization: 'Qhapaq', tenant: 'Qhapaq Lima' }),
    ).toBe('EBIM EWM · Qhapaq · Qhapaq Lima');
  });

  it('sin tenant, el contrato es de nivel partner', () => {
    expect(contractSubtitle({ lockup: 'TMS', organization: 'Andina' })).toBe('TMS · Andina · nivel partner');
  });
});
