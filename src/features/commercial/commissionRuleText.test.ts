import { describe, it, expect } from 'vitest';
import { describeRule, exampleForRule } from './commissionRuleText';

describe('commissionRuleText', () => {
  it('lee una regla porcentual recurrente con tope', () => {
    const text = describeRule({
      basis: 'COLLECTED_LICENSE', rate: 0.1, currency: 'USD', is_recurring: true, max_months: 12, max_total_amount: 500,
    });
    expect(text).toContain('de licencia cobrada');
    expect(text).toContain('durante 12 meses');
    expect(text).toMatch(/tope USD\s*500\.00/);
  });

  it('el ejemplo aplica la tasa existente sobre el cobro de ejemplo', () => {
    const example = exampleForRule({ basis: 'COLLECTED_ANY', rate: 0.1, currency: 'PEN' });
    expect(example).toMatch(/PEN\s*100\.00/);
  });

  it('sin tasa ni monto no inventa un resultado', () => {
    expect(exampleForRule({ basis: 'COLLECTED_ANY', rate: null, fixed_amount: null, currency: 'USD' })).toBeNull();
  });
});
