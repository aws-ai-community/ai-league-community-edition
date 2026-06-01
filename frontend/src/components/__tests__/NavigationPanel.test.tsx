import { describe, it, expect } from 'vitest';
import { navigationItems } from '../NavigationPanel';

describe('NavigationPanel', () => {
  // Extract only the internal link items (non-external, non-divider)
  const internalLinks = navigationItems.filter(
    (item) => item.type === 'link' && !('external' in item && item.external),
  ) as Array<{ type: 'link'; text: string; href: string }>;

  it('renders all new links (Game Play, Leaderboard, Submission History, Configuration) in correct order after Map Builder', () => {
    const expectedOrder = [
      'Map Builder',
      'Game Play',
      'Leaderboard',
      'Submission History',
      'Configuration',
    ];

    const linkTexts = internalLinks.map((item) => item.text);

    // Verify all expected links are present
    for (const expected of expectedOrder) {
      expect(linkTexts).toContain(expected);
    }

    // Verify the order: each expected link appears after the previous one
    for (let i = 0; i < expectedOrder.length - 1; i++) {
      const currentIdx = linkTexts.indexOf(expectedOrder[i]);
      const nextIdx = linkTexts.indexOf(expectedOrder[i + 1]);
      expect(currentIdx).toBeLessThan(nextIdx);
    }
  });

  it('links have correct href values', () => {
    const expectedHrefs: Record<string, string> = {
      'Map Builder': '/map-builder',
      'Game Play': '/gameplay',
      'Leaderboard': '/leaderboard',
      'Submission History': '/submission-history',
      'Configuration': '/configuration',
    };

    for (const [text, href] of Object.entries(expectedHrefs)) {
      const link = internalLinks.find((item) => item.text === text);
      expect(link, `Link "${text}" should exist`).toBeDefined();
      expect(link!.href).toBe(href);
    }
  });
});
