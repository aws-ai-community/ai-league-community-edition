import { describe, it, expect } from 'vitest';
import { truncateDisplayName } from '../../frontend/src/utils/truncateDisplayName';

describe('truncateDisplayName', () => {
  it('returns original string when 30 chars or fewer', () => {
    expect(truncateDisplayName('Hello')).toBe('Hello');
    expect(truncateDisplayName('A'.repeat(30))).toBe('A'.repeat(30));
    expect(truncateDisplayName('')).toBe('');
  });

  it('truncates and adds ellipsis when exceeding 30 chars', () => {
    const input = 'A'.repeat(31);
    expect(truncateDisplayName(input)).toBe('A'.repeat(30) + '…');
  });

  it('truncates long strings to exactly 31 characters (30 + ellipsis)', () => {
    const input = 'A'.repeat(100);
    const result = truncateDisplayName(input);
    expect(result.length).toBe(31);
    expect(result.endsWith('…')).toBe(true);
  });
});
