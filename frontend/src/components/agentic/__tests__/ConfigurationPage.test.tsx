import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConfigurationPage from '../ConfigurationPage';

// Mock the settingsLoader module
vi.mock('../../../services/settingsLoader', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    graphql: { endpoint: 'https://test.appsync-api.aws/graphql' },
    graphqlApiKey: 'test-key',
    sagemakerStudioUrl: 'https://studio-test.sagemaker.aws',
    defaultModelId: 'us.amazon.nova-2-lite-v1:0',
  }),
}));

// Mock the graphqlClient module
vi.mock('../../../services/graphqlClient', () => ({
  getLlmConfiguration: vi.fn(),
  saveLlmConfiguration: vi.fn(),
  getCodeEditorStatus: vi.fn().mockResolvedValue({ GetCodeEditorStatus: { status: 'Stopped', message: null } }),
  startCodeEditor: vi.fn(),
  stopCodeEditor: vi.fn(),
  getSchemaModelConfig: vi.fn().mockResolvedValue({ GetSchemaModelConfig: { modelId: 'us.amazon.nova-2-lite-v1:0' } }),
  saveSchemaModelConfig: vi.fn(),
  resetConfiguration: vi.fn(),
}));

import { getLlmConfiguration, saveLlmConfiguration, getCodeEditorStatus, getSchemaModelConfig } from '../../../services/graphqlClient';
import { loadSettings } from '../../../services/settingsLoader';

const mockGetLlmConfiguration = vi.mocked(getLlmConfiguration);
const mockSaveLlmConfiguration = vi.mocked(saveLlmConfiguration);
const mockGetCodeEditorStatus = vi.mocked(getCodeEditorStatus);
const mockGetSchemaModelConfig = vi.mocked(getSchemaModelConfig);
const mockLoadSettings = vi.mocked(loadSettings);

describe('ConfigurationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSettings.mockResolvedValue({
      graphql: { endpoint: 'https://test.appsync-api.aws/graphql' },
      graphqlApiKey: 'test-key',
      sagemakerStudioUrl: 'https://studio-test.sagemaker.aws',
      defaultModelId: 'us.amazon.nova-2-lite-v1:0',
    });
    mockGetCodeEditorStatus.mockResolvedValue({ GetCodeEditorStatus: { status: 'Stopped', message: null } });
    mockGetSchemaModelConfig.mockResolvedValue({ GetSchemaModelConfig: { modelId: 'us.amazon.nova-2-lite-v1:0' } });
    mockGetLlmConfiguration.mockResolvedValue({
      GetLlmConfiguration: {
        defaultModel: 'us.amazon.nova-2-lite-v1:0',
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

  it('model costs alert renders with correct text', async () => {
    const { container } = render(<ConfigurationPage />);

    await waitFor(() => {
      const pageText = container.textContent || '';
      // Verify key phrases from the model costs alert
      expect(pageText).toContain('not typically covered by AWS credits');
      expect(pageText).toContain('Nova 2 Lite is covered by AWS credits');
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

  it('Claude Haiku cost warning is shown', async () => {
    const { container } = render(<ConfigurationPage />);

    await waitFor(() => {
      const pageText = container.textContent || '';
      expect(pageText).toContain('not typically covered by AWS credits');
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
        defaultModel: 'us.amazon.nova-2-lite-v1:0',
      }),
    );
  });

  it('reset returns all to default then save uses default model', async () => {
    mockGetLlmConfiguration.mockResolvedValue({
      GetLlmConfiguration: {
        defaultModel: 'us.amazon.nova-2-lite-v1:0',
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
        defaultModel: 'us.amazon.nova-2-lite-v1:0',
      }),
    );
  });
});
