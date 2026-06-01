import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import SubmissionHistoryPage from '../SubmissionHistoryPage';

// Mock the graphqlClient module
vi.mock('../../../services/graphqlClient', () => ({
  getSubmissionHistory: vi.fn(),
}));

// Mock predefinedMaps
vi.mock('../../../data/predefinedMaps', () => ({
  PREDEFINED_MAPS: [
    { label: 'Map Alpha', grid: [[]], startRow: 0, startCol: 0, time: 120, questions: {}, challenges: {} },
    { label: 'Map Beta', grid: [[]], startRow: 0, startCol: 0, time: 120, questions: {}, challenges: {} },
  ],
}));

import { getSubmissionHistory } from '../../../services/graphqlClient';

const mockGetSubmissionHistory = vi.mocked(getSubmissionHistory);

describe('SubmissionHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders table with correct column headers', async () => {
    mockGetSubmissionHistory.mockResolvedValue({
      GetSubmissionHistory: {
        items: [
          {
            updatedTime: '2026-06-01T12:00:00Z',
            mapId: 'map-1',
            leaderboardId: 'lb-1',
            finalScore: 2500,
            correctAnswers: 8,
            totalChallenges: 10,
            qaScore: 1800,
            lifeBonusScore: 200,
            givenTokenBonus: 500,
            livesRemaining: 3,
          },
        ],
      },
    });

    const { container } = render(<SubmissionHistoryPage />);

    await waitFor(() => {
      const headerCells = container.querySelectorAll('th');
      const headerTexts = Array.from(headerCells).map((th) => th.textContent?.trim());
      expect(headerTexts).toContain('Final Score');
      expect(headerTexts).toContain('Correct Answers');
      expect(headerTexts).toContain('Total Challenges');
      expect(headerTexts).toContain('Lives Remaining');
      expect(headerTexts).toContain('Token Bonus');
    });
  });

  it('map selector triggers data reload', async () => {
    mockGetSubmissionHistory.mockResolvedValue({
      GetSubmissionHistory: { items: [] },
    });

    render(<SubmissionHistoryPage />);

    await waitFor(() => {
      expect(mockGetSubmissionHistory).toHaveBeenCalledTimes(1);
    });

    expect(mockGetSubmissionHistory).toHaveBeenCalledWith('predefined-0');
  });

  it('error alert displays on query failure', async () => {
    mockGetSubmissionHistory.mockRejectedValue(new Error('Server unavailable'));

    const { container } = render(<SubmissionHistoryPage />);

    await waitFor(() => {
      const pageText = container.textContent;
      expect(pageText).toContain('Server unavailable');
    });
  });
});
