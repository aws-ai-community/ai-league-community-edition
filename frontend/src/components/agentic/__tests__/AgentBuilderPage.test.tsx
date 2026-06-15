import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AgentBuilderPage from '../AgentBuilderPage';

vi.mock('../../../services/graphqlClient', () => ({
  getSupervisorAgent: vi.fn(),
  updateSupervisorAgent: vi.fn(),
  listSubAgents: vi.fn(),
  listLambdaTools: vi.fn(),
  listMemoryTools: vi.fn(),
  listGuardrailTools: vi.fn(),
  listAgentVersions: vi.fn(),
  createSubAgent: vi.fn(),
  updateSubAgent: vi.fn(),
  deleteSubAgent: vi.fn(),
  updateLambdaTool: vi.fn(),
  deleteLambdaTool: vi.fn(),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  createGuardrail: vi.fn(),
  deleteGuardrail: vi.fn(),
}));

import {
  getSupervisorAgent,
  updateSupervisorAgent,
  listSubAgents,
  listLambdaTools,
  listMemoryTools,
  listGuardrailTools,
  listAgentVersions,
} from '../../../services/graphqlClient';

const mockGetSupervisorAgent = vi.mocked(getSupervisorAgent);
const mockUpdateSupervisorAgent = vi.mocked(updateSupervisorAgent);
const mockListSubAgents = vi.mocked(listSubAgents);
const mockListLambdaTools = vi.mocked(listLambdaTools);
const mockListMemoryTools = vi.mocked(listMemoryTools);
const mockListGuardrailTools = vi.mocked(listGuardrailTools);
const mockListAgentVersions = vi.mocked(listAgentVersions);

describe('AgentBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupervisorAgent.mockResolvedValue({
      GetSupervisorAgent: {
        name: 'My Agent',
        systemPrompt: 'Help users solve map challenges.',
        modelId: 'us.amazon.nova-2-lite-v1:0',
        subAgents: ['sub-1'],
        lambdaTools: ['tool-1'],
        memoryTool: 'mem-1',
        guardrailTool: 'gr-1',
      },
    });
    mockListSubAgents.mockResolvedValue({
      ListSubAgents: [
        {
          agentId: 'sub-1',
          name: 'Path Planner',
          systemPrompt: 'Plan a route.',
          modelId: 'us.amazon.nova-2-lite-v1:0',
          lambdaTools: ['tool-1'],
        },
      ],
    });
    mockListLambdaTools.mockResolvedValue({
      ListLambdaTool: [
        {
          toolId: 'tool-1',
          name: 'Pathfinder',
          functionName: 'arn:aws:lambda:us-east-1:123456789012:function:pathfinder',
          status: 'READY',
        },
      ],
    });
    mockListMemoryTools.mockResolvedValue({
      ListMemory: [{ toolId: 'mem-1', name: 'Memory A', status: 'READY' }],
    });
    mockListGuardrailTools.mockResolvedValue({
      ListGuardrail: [{ toolId: 'gr-1', name: 'Guardrail A', status: 'READY' }],
    });
    mockListAgentVersions.mockResolvedValue({
      ListAgentVersions: [],
    });
    mockUpdateSupervisorAgent.mockResolvedValue({
      UpdateSupervisorAgent: {
        name: 'My Agent',
        systemPrompt: 'Help users solve map challenges.',
        modelId: 'us.amazon.nova-2-lite-v1:0',
        subAgents: ['sub-1'],
        lambdaTools: ['tool-1'],
        memoryTool: 'mem-1',
        guardrailTool: 'gr-1',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and renders core sections', async () => {
    const { container } = render(<AgentBuilderPage />);

    // Wait for initial async load to complete (Promise.all + state updates)
    await waitFor(() => {
      expect(container.textContent).toContain('Path Planner');
    });

    expect(mockGetSupervisorAgent).toHaveBeenCalledTimes(1);
    expect(mockListSubAgents).toHaveBeenCalledTimes(1);
    expect(mockListLambdaTools).toHaveBeenCalledTimes(1);
    expect(mockListMemoryTools).toHaveBeenCalledTimes(1);
    expect(mockListGuardrailTools).toHaveBeenCalledTimes(1);
    expect(mockListAgentVersions).toHaveBeenCalledTimes(1);

    const pageText = container.textContent || '';
    expect(pageText).toContain('Agent Builder');
    expect(pageText).toContain('Supervisor Agent');
    expect(pageText).toContain('Tool Attachments');
    expect(pageText).toContain('Sub-Agents');
    expect(pageText).toContain('Tools');
    expect(pageText).toContain('Version History');
    expect(pageText).toContain('Path Planner');
  });

  it('saves supervisor configuration via graphql client', async () => {
    render(<AgentBuilderPage />);

    await waitFor(() => {
      const prompt = screen.getByLabelText('System prompt') as HTMLTextAreaElement;
      expect(prompt.value).toBe('Help users solve map challenges.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockUpdateSupervisorAgent).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateSupervisorAgent).toHaveBeenCalledWith({
      name: 'My Agent',
      systemPrompt: 'Help users solve map challenges.',
      modelId: 'us.amazon.nova-2-lite-v1:0',
      subAgents: ['sub-1'],
      lambdaTools: ['tool-1'],
      memoryTool: 'mem-1',
      guardrailTool: 'gr-1',
    });
  });

  it('shows an error when loading fails', async () => {
    mockGetSupervisorAgent.mockRejectedValueOnce(new Error('Load failed'));

    const { container } = render(<AgentBuilderPage />);

    await waitFor(() => {
      const pageText = container.textContent || '';
      expect(pageText).toContain('Failed to load agent configuration: Load failed');
    });
  });
});
