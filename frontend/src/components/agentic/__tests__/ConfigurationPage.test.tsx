import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConfigurationPage from '../ConfigurationPage';

// Mock the graphqlClient module
vi.mock('../../../services/graphqlClient', () => ({
  getLlmConfiguration: vi.fn(),
  saveLlmConfiguration: vi.fn(),
}));

import { getLlmConfiguration, saveLlmConfiguration } from '../../../services/graphqlClient';

const mockGetLlmConfiguration = vi.mocked(getLlmConfiguration);
const mockSaveLlmConfiguration = vi.mocked(saveLlmConfiguration);

describe('ConfigurationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLlmConfiguration.mockResolvedValue({
      GetLlmConfiguration: {
        defaultModel: 'amazon.nova-lite-v1:0',
        challengeGeneration: null,
        challengeGrading: null,
        gameCommentary: null,
      },
    });
    mockSaveLlmConfiguration.mockResolvedValue({
      SaveLlmConfiguration: { success: true, statusCode: 200, message: null },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wealth warning alert renders with correct text', async () => {
    const { container } = render(<ConfigurationPage />);

    await waitFor(() => {
      const pageText = container.textContent || '';
      // Verify key phrases from the wealth warning
      expect(pageText).toContain('Claude models are explicitly NOT covered by AWS credits');
      expect(pageText).toContain('You are responsible for all LLM costs incurred');
    });
  });

  it('model selector section renders', async () => {
    const { container } = render(<ConfigurationPage />);

    await waitFor(() => {
      expect(mockGetLlmConfiguration).toHaveBeenCalledTimes(1);
    });

    const pageText = container.textContent || '';
    expect(pageText).toContain('Default Model');
    expect(pageText).toContain('Per-Purpose Overrides');
    expect(pageText).toContain('Challenge Generation');
    expect(pageText).toContain('Challenge Grading');
    expect(pageText).toContain('Game Commentary');
  });

  it('Claude models warning is mentioned in the wealth warning', async () => {
    const { container } = render(<ConfigurationPage />);

    await waitFor(() => {
      const pageText = container.textContent || '';
      expect(pageText).toContain('Claude models are explicitly NOT covered by AWS credits');
    });
  });

  it('save persists configuration via graphqlClient', async () => {
    render(<ConfigurationPage />);

    await waitFor(() => {
      expect(mockGetLlmConfiguration).toHaveBeenCalledTimes(1);
    });

    const saveButton = screen.getByText('Save Configuration');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveLlmConfiguration).toHaveBeenCalledTimes(1);
    });

    expect(mockSaveLlmConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'amazon.nova-lite-v1:0',
      }),
    );
  });

  it('reset returns all to default then save uses default model', async () => {
    mockGetLlmConfiguration.mockResolvedValue({
      GetLlmConfiguration: {
        defaultModel: 'amazon.nova-pro-v1:0',
        challengeGeneration: 'meta.llama3-3-70b-instruct-v1:0',
        challengeGrading: null,
        gameCommentary: null,
      },
    });

    render(<ConfigurationPage />);

    await waitFor(() => {
      expect(mockGetLlmConfiguration).toHaveBeenCalledTimes(1);
    });

    const resetButton = screen.getByText('Reset All to Default');
    fireEvent.click(resetButton);

    const saveButton = screen.getByText('Save Configuration');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveLlmConfiguration).toHaveBeenCalledTimes(1);
    });

    expect(mockSaveLlmConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'amazon.nova-lite-v1:0',
      }),
    );
  });
});
