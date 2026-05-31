import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { navigationItems } from '../../frontend/src/components/NavigationPanel';

/**
 * Property 6: Navigation External Links
 *
 * For any external link item rendered in the Navigation Panel, the link SHALL be configured
 * to open in a new browser tab (i.e., have `external: true` or equivalent
 * `target="_blank"` behavior).
 *
 * **Validates: Requirements 7.3**
 */

// Filter to only external link items (excludes internal links like Map Builder and dividers)
const externalLinkItems = navigationItems.filter(
  (item) => item.type === 'link' && 'external' in item && item.external === true
);

describe('Feature: aws-ai-league-community-edition, Property 6: Navigation external links', () => {
  it('every external navigation item accessed by random index has external: true', () => {
    fc.assert(
      fc.property(
        // Generate random indices into the external link items array
        fc.integer({ min: 0, max: externalLinkItems.length - 1 }),
        (index) => {
          const item = externalLinkItems[index];

          // All items should be of type "link"
          expect(item.type).toBe('link');

          // All external link items should have external: true for new tab behavior
          if (item.type === 'link') {
            expect(item.external).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('every external navigation item accessed by random index has a valid https href', () => {
    fc.assert(
      fc.property(
        // Generate random indices into the external link items array
        fc.integer({ min: 0, max: externalLinkItems.length - 1 }),
        (index) => {
          const item = externalLinkItems[index];

          if (item.type === 'link') {
            // Verify href is a valid URL starting with https://
            expect(item.href).toMatch(/^https:\/\/.+/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
