import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { truncateDisplayName } from '../../frontend/src/utils/truncateDisplayName';

/**
 * Property 3: Display Name Truncation
 *
 * For any non-empty string used as a display name, the User Header display logic
 * SHALL produce output that is at most 30 visible characters followed by an ellipsis (…)
 * if the original exceeds 30 characters, or the original string unchanged if it is
 * 30 characters or fewer.
 *
 * **Validates: Requirements 4.1**
 */

describe('Feature: aws-ai-league-community-edition, Property 3: Display name truncation', () => {
  it('strings longer than 30 chars are truncated to first 30 chars + ellipsis (31 chars total)', () => {
    fc.assert(
      fc.property(
        // Generate strings with length > 30 (31 to 200 chars)
        fc.string({ minLength: 31, maxLength: 200 }),
        (name) => {
          const result = truncateDisplayName(name);

          // Output must be exactly 31 characters (30 visible + ellipsis)
          expect(result.length).toBe(31);

          // Output must end with ellipsis character
          expect(result.endsWith('…')).toBe(true);

          // The first 30 characters must match the original string's first 30 characters
          expect(result.slice(0, 30)).toBe(name.slice(0, 30));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('strings of 30 chars or fewer are returned unchanged', () => {
    fc.assert(
      fc.property(
        // Generate strings with length 0 to 30 chars
        fc.string({ minLength: 0, maxLength: 30 }),
        (name) => {
          const result = truncateDisplayName(name);

          // Output must equal the input unchanged
          expect(result).toBe(name);
        }
      ),
      { numRuns: 100 }
    );
  });
});
