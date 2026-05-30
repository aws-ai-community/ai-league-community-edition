import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { navigationItems } from '../../frontend/src/components/NavigationPanel';

/**
 * Property 6: Navigation External Links
 *
 * For any link item rendered in the Navigation Panel, the link SHALL be configured
 * to open in a new browser tab (i.e., have `external: true` or equivalent
 * `target="_blank"` behavior).
 *
 * **Validates: Requirements 7.3**
 */

describe('Feature: aws-ai-league-community-edition, Property 6: Navigation external links', () => {
  it('every navigation item accessed by random index has external: true', () => {
    fc.assert(
      fc.property(
        // Generate random indices into the navigation items array
        fc.integer({ min: 0, max: navigationItems.length - 1 }),
        (index) => {
          const item = navigationItems[index];

          // All items should be of type "link"
          expect(item.type).toBe('link');

          // All link items should have external: true for new tab behavior
          if (item.type === 'link') {
            expect(item.external).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('every navigation item accessed by random index has a valid https href', () => {
    fc.assert(
      fc.property(
        // Generate random indices into the navigation items array
        fc.integer({ min: 0, max: navigationItems.length - 1 }),
        (index) => {
          const item = navigationItems[index];

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
