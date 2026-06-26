import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Mock CloudScape SideNavigation to render testable output
vi.mock('@cloudscape-design/components/side-navigation', () => ({
  default: ({ header, items }: { header: { text: string; href: string }; items: Array<{ type: string; text: string; href: string; external?: boolean }> }) => (
    <nav data-testid="side-navigation">
      <h2>{header.text}</h2>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <a
              href={item.href}
              {...(item.external ? { target: '_blank', rel: 'noopener noreferrer', 'data-external': 'true' } : {})}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  ),
}));

import NavigationPanel, { navigationItems } from '../../frontend/src/components/NavigationPanel';

describe('NavigationPanel', () => {
  it('renders title "AWS AI League - Community Edition"', () => {
    render(<NavigationPanel />);

    expect(screen.getByText('AWS AI League - Community Edition')).toBeInTheDocument();
  });

  it('renders all links in correct order with correct URLs', () => {
    const expectedLinks = [
      { text: 'Map Builder', href: '/map-builder' },
      { text: 'Game Play', href: '/gameplay' },
      { text: 'Leaderboard', href: '/leaderboard' },
      { text: 'Submission History', href: '/submission-history' },
      { text: 'Configuration', href: '/configuration' },
      { text: 'Agent Builder', href: '/agent-builder' },
      { text: 'Fine-Tuning', href: '/fine-tuning' },
      { text: 'Agentic Workshop', href: 'https://catalog.us-east-1.prod.workshops.aws/workshops/0c1f072b-ebd1-4d8d-9340-dd47479481c0/en-US/introduction' },
      { text: 'Builder Center', href: 'https://builder.aws.com/connect/space/7e5f51ef-0919-32da-aaa7-ddf263651d69/aws-ai-league' },
      { text: 'Builder Center (Community)', href: 'https://builder.aws.com/connect/space/7148b02a-ef8c-3a67-97c9-53be6bd54999/ai-community' },
      { text: 'AWS AI League', href: 'https://aws.amazon.com/ai/aileague/' },
      { text: 'Official Rules', href: 'https://aileague.aws.dev/2026-AWS-AI-League-Championship-Official-Rules.pdf' },
      { text: 'Community Blog', href: 'https://blog.awsaicommunity.org/' },
      { text: 'Community Discord', href: 'https://discord.com/invite/FrEUMsZrAZ' },
      { text: 'Community GitHub', href: 'https://github.com/aws-ai-community' },
    ];

    render(<NavigationPanel />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(15);

    links.forEach((link, index) => {
      expect(link).toHaveTextContent(expectedLinks[index].text);
      expect(link).toHaveAttribute('href', expectedLinks[index].href);
    });
  });

  it('external links have external attribute for new tab behavior', () => {
    render(<NavigationPanel />);

    const links = screen.getAllByRole('link');
    // Filter to only external links (skip internal links: Map Builder, Game Play, Leaderboard, Submission History, Configuration, Agent Builder)
    const externalLinks = links.filter((link) => link.getAttribute('data-external') === 'true');
    expect(externalLinks).toHaveLength(8);

    externalLinks.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('data-external', 'true');
    });
  });

  describe('navigationItems data structure', () => {
    it('contains exactly 16 items (7 internal links + 1 divider + 8 external links)', () => {
      expect(navigationItems).toHaveLength(16);
    });

    it('all link items have correct type', () => {
      const linkItems = navigationItems.filter((item) => item.type === 'link');
      expect(linkItems).toHaveLength(15);
    });

    it('external link items have external true', () => {
      const externalItems = navigationItems.filter(
        (item) => item.type === 'link' && 'external' in item && item.external === true
      );
      expect(externalItems).toHaveLength(8);
    });

    it('items are in the correct order with correct hrefs', () => {
      const expectedOrder = [
        'Map Builder',
        'Game Play',
        'Leaderboard',
        'Submission History',
        'Configuration',
        'Agent Builder',
        'Fine-Tuning',
        'Agentic Workshop',
        'Builder Center',
        'Builder Center (Community)',
        'AWS AI League',
        'Official Rules',
        'Community Blog',
        'Community Discord',
        'Community GitHub',
      ];

      const linkItems = navigationItems.filter((item) => item.type === 'link');
      linkItems.forEach((item, index) => {
        expect((item as { text: string }).text).toBe(expectedOrder[index]);
      });
    });
  });
});
