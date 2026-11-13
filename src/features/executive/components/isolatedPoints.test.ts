import { describe, expect, it } from 'vitest';
import { isolatedIndexes } from './isolatedPoints';

describe('isolatedIndexes', () => {
  it('marca solo los valores sin vecinos con dato', () => {
    expect([...isolatedIndexes([3, 3, null, 31, null, null])]).toEqual([3]);
    expect([...isolatedIndexes([null, 5])]).toEqual([1]);
    expect([...isolatedIndexes([1, 2, 3])]).toEqual([]);
    expect([...isolatedIndexes([])]).toEqual([]);
  });
});
