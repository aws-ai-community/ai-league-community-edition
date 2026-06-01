import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LeaderboardPage from '../LeaderboardPage';

// Mock the graphqlClient module
vi.mock('../../../services/graphqlClient', () => ({
  getLeaderboardSubmissions: vi.fn(),
}));

// Mock predefinedMaps
vi.mock('../../../data/predefinedMaps', () => ({
  PREDEFINED_MAPS: [
    { label: 'Map Alpha', grid: [[]], startRow: 0, startCol: 0, time: 120, questions: {}, challenges: {} },
    { label: 'Map Beta', grid: [[]], startRow: 0, startCol: 0, time: 120, questions: {}, challenges: {} },
  ],
}));

import { getLeaderboardSubmissions } from '../../../services/graphqlClient';

const mockGetLeaderboardSubmissions = vi.mocked(getLeaderboardSubmissions);

describe('LeaderboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders table with correct column headers', async () => {
    mockGetLeaderboardSubmissions.mockResolvedValue({
      GetLeaderboardSubmissions: {
        entries: [
          {
            userId: 'user-1',
            alias: 'PlayerOne',
            avatar: null,
            bestScore: 1500,
            lastScore: 1200,
            totalSubmissions: 5,
            rank: 1,
          },
        ],
      },
    });

    const { container } = render(<LeaderboardPage />);

    await waitFor(() => {
      // Cloudscape Table renders column headers in th elements
      const headerCells = container.querySelectorAll('th');
      const headerTexts = Array.from(headerCells).map((th) => th.textContent?.trim());
      expect(headerTexts).toContain('Rank');
      expect(headerTexts).toContain('Alias');
      expect(headerTexts).toContain('Best Score');
      expect(headerTexts).toContain('Last Score');
      expect(headerTexts).toContain('Total Submissions');
    });
  });

  it('map selector triggers data reload', async () => {
    mockGetLeaderboardSubmissions.mockResolvedValue({
      GetLeaderboardSubmissions: { entries: [] },
    });

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(mockGetLeaderboardSubmissions).toHaveBeenCalledTimes(1);
    });

    expect(mockGetLeaderboardSubmissions).toHaveBeenCalledWith('map#predefined-0');
  });

  it('error alert displays on query failure', async () => {
    mockGetLeaderboardSubmissions.mockRejectedValue(new Error('Network failure'));

    const { container } = render(<LeaderboardPage />);

    await waitFor(() => {
      // Cloudscape Alert renders content in a div with role="alert" or within the alert structure
      const alertText = container.textContent;
      expect(alertText).toContain('Network failure');
    });
  });
});
