import { useEffect, useState, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Grid from '@cloudscape-design/components/grid';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Toggle from '@cloudscape-design/components/toggle';
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar';
import Alert from '@cloudscape-design/components/alert';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Box from '@cloudscape-design/components/box';
import Table from '@cloudscape-design/components/table';
import Modal from '@cloudscape-design/components/modal';
import Tabs from '@cloudscape-design/components/tabs';
import {
  getSupervisorAgent,
  updateSupervisorAgent,
  listSubAgents,
  listLambdaTools,
  listMemoryTools,
  listGuardrailTools,
  listAgentVersions,
  createSubAgent,
  updateSubAgent,
  deleteSubAgent,
  updateLambdaTool,
  deleteLambdaTool,
  createMemory,
  deleteMemory,
  createGuardrail,
  deleteGuardrail,
  SupervisorAgentConfig,
  SubAgentConfig,
  LambdaToolConfig,
  MemoryToolConfig,
  GuardrailToolConfig,
  AgentVersionConfig,
} from '../../services/graphqlClient';

// --- Model definitions ---

interface ModelDefinition {
  modelId: string;
  displayName: string;
  provider: string;
  description?: string;
}

const AVAILABLE_MODELS: ModelDefinition[] = [
  { modelId: 'us.amazon.nova-2-lite-v1:0', displayName: 'Nova 2 Lite', provider: 'Amazon Nova', description: 'Default - covered by AWS credits' },
  { modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', displayName: 'Claude Haiku 4.5', provider: 'Anthropic', description: 'Higher quality - not typically covered by AWS credits' },
];

const DEFAULT_MODEL_ID = 'us.amazon.nova-2-lite-v1:0';

function buildModelOptions(): SelectProps.Options {
  const groups: Record<string, SelectProps.Option[]> = {};
  for (const model of AVAILABLE_MODELS) {
    if (!groups[model.provider]) {
      groups[model.provider] = [];
    }
    groups[model.provider].push({
      label: model.displayName,
      value: model.modelId,
      description: model.description,
    });
  }
  return Object.entries(groups).map(([provider, options]) => ({
    label: provider,
    options,
  }));
}

function findModelOption(modelId: string): SelectProps.Option | null {
  const model = AVAILABLE_MODELS.find((m) => m.modelId === modelId);
  if (!model) return null;
  return { label: model.displayName, value: model.modelId };
}

const NONE_OPTION: SelectProps.Option = { label: 'None', value: '__none__' };

// --- Component ---

export default function AgentBuilderPage() {
  // Supervisor config state
  const [name, setName] = useState('My Agent');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<SelectProps.Option | null>(
    findModelOption(DEFAULT_MODEL_ID),
  );
  const [selectedSubAgents, setSelectedSubAgents] = useState<Set<string>>(new Set());
  const [selectedLambdaTools, setSelectedLambdaTools] = useState<Set<string>>(new Set());
  const [selectedMemoryTool, setSelectedMemoryTool] = useState<SelectProps.Option>(NONE_OPTION);
  const [selectedGuardrailTool, setSelectedGuardrailTool] = useState<SelectProps.Option>(NONE_OPTION);

  // Available resources
  const [subAgents, setSubAgents] = useState<SubAgentConfig[]>([]);
  const [lambdaTools, setLambdaTools] = useState<LambdaToolConfig[]>([]);
  const [memoryTools, setMemoryTools] = useState<MemoryToolConfig[]>([]);
  const [guardrailTools, setGuardrailTools] = useState<GuardrailToolConfig[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  // Sub-Agent management state
  const [showSubAgentForm, setShowSubAgentForm] = useState(false);
  const [editingSubAgentId, setEditingSubAgentId] = useState<string | null>(null);
  const [subAgentFormName, setSubAgentFormName] = useState('');
  const [subAgentFormPrompt, setSubAgentFormPrompt] = useState('');
  const [subAgentFormModel, setSubAgentFormModel] = useState<SelectProps.Option | null>(
    findModelOption(DEFAULT_MODEL_ID),
  );
  const [subAgentFormTools, setSubAgentFormTools] = useState<Set<string>>(new Set());
  const [savingSubAgent, setSavingSubAgent] = useState(false);
  const [deleteSubAgentId, setDeleteSubAgentId] = useState<string | null>(null);
  const [deletingSubAgent, setDeletingSubAgent] = useState(false);

  // Lambda Tool management state
  const [lambdaToolFormName, setLambdaToolFormName] = useState('');
  const [lambdaToolFormArn, setLambdaToolFormArn] = useState('');
  const [savingLambdaTool, setSavingLambdaTool] = useState(false);
  const [deleteLambdaToolId, setDeleteLambdaToolId] = useState<string | null>(null);
  const [deletingLambdaTool, setDeletingLambdaTool] = useState(false);

  // Memory Tool management state
  const [memoryFormName, setMemoryFormName] = useState('');
  const [memoryFormDescription, setMemoryFormDescription] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);
  const [deleteMemoryToolId, setDeleteMemoryToolId] = useState<string | null>(null);
  const [deletingMemoryTool, setDeletingMemoryTool] = useState(false);

  // Guardrail Tool management state
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);
  const [guardrailFormName, setGuardrailFormName] = useState('');
  const [guardrailFormDescription, setGuardrailFormDescription] = useState('');
  const [guardrailFormBlockedInput, setGuardrailFormBlockedInput] = useState('I cannot help with that request.');
  const [guardrailFormBlockedOutput, setGuardrailFormBlockedOutput] = useState('I cannot help with that request.');
  const [guardrailContentFilters, setGuardrailContentFilters] = useState<
    { type: string; label: string; inputStrength: string; outputStrength: string; inputEnabled: boolean; outputEnabled: boolean }[]
  >([
    { type: 'SEXUAL', label: 'Sexual Content', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
    { type: 'VIOLENCE', label: 'Violence', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
    { type: 'HATE', label: 'Hate Speech', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
    { type: 'INSULTS', label: 'Insults', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
    { type: 'MISCONDUCT', label: 'Misconduct', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
    { type: 'PROMPT_ATTACK', label: 'Prompt Attack', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
  ]);
  const [guardrailDenyTopics, setGuardrailDenyTopics] = useState<
    { name: string; definition: string; inputAction: 'BLOCK' | 'LOG'; outputAction: 'BLOCK' | 'LOG'; samplePhrases: string[] }[]
  >([]);
  const [savingGuardrail, setSavingGuardrail] = useState(false);
  const [deleteGuardrailToolId, setDeleteGuardrailToolId] = useState<string | null>(null);
  const [deletingGuardrailTool, setDeletingGuardrailTool] = useState(false);
  const [editingGuardrailToolId, setEditingGuardrailToolId] = useState<string | null>(null);

  // Version History state
  const [agentVersions, setAgentVersions] = useState<AgentVersionConfig[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<AgentVersionConfig | null>(null);

  const addFlash = useCallback((type: FlashbarProps.Type, content: string) => {
    const id = Date.now().toString();
    setFlashItems((prev) => [
      ...prev,
      {
        type,
        content,
        id,
        dismissible: true,
        onDismiss: () => setFlashItems((items) => items.filter((item) => item.id !== id)),
      },
    ]);
  }, []);

  // Load all data in parallel on mount
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        const [supervisorRes, subAgentsRes, lambdaToolsRes, memoryToolsRes, guardrailToolsRes, versionsRes] =
          await Promise.all([
            getSupervisorAgent(),
            listSubAgents(),
            listLambdaTools(),
            listMemoryTools(),
            listGuardrailTools(),
            listAgentVersions(),
          ]);

        if (cancelled) return;

        // Populate sub-agents, tools
        const fetchedSubAgents = subAgentsRes.ListSubAgents || [];
        const fetchedLambdaTools = lambdaToolsRes.ListLambdaTool || [];
        const fetchedMemoryTools = memoryToolsRes.ListMemory || [];
        const fetchedGuardrailTools = guardrailToolsRes.ListGuardrail || [];
        const fetchedVersions = versionsRes.ListAgentVersions || [];

        setSubAgents(fetchedSubAgents);
        setLambdaTools(fetchedLambdaTools);
        setMemoryTools(fetchedMemoryTools);
        setGuardrailTools(fetchedGuardrailTools);
        // Sort versions by createdAt descending (most recent first)
        const sortedVersions = [...fetchedVersions].sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });
        setAgentVersions(sortedVersions);

        // Populate supervisor config
        const config: SupervisorAgentConfig = supervisorRes.GetSupervisorAgent;
        if (config) {
          setName(config.name || 'My Agent');
          setSystemPrompt(config.systemPrompt || '');
          setSelectedModel(findModelOption(config.modelId) || findModelOption(DEFAULT_MODEL_ID));
          setSelectedSubAgents(new Set(config.subAgents || []));
          setSelectedLambdaTools(new Set(config.lambdaTools || []));

          // Memory tool selector
          if (config.memoryTool) {
            const mem = fetchedMemoryTools.find((m) => m.toolId === config.memoryTool);
            setSelectedMemoryTool(mem ? { label: mem.name, value: mem.toolId } : NONE_OPTION);
          } else {
            setSelectedMemoryTool(NONE_OPTION);
          }

          // Guardrail tool selector
          if (config.guardrailTool) {
            const gr = fetchedGuardrailTools.find((g) => g.toolId === config.guardrailTool);
            setSelectedGuardrailTool(gr ? { label: gr.name, value: gr.toolId } : NONE_OPTION);
          } else {
            setSelectedGuardrailTool(NONE_OPTION);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          addFlash('error', `Failed to load agent configuration: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [addFlash]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSupervisorAgent({
        name,
        systemPrompt,
        modelId: selectedModel?.value || DEFAULT_MODEL_ID,
        subAgents: Array.from(selectedSubAgents),
        lambdaTools: Array.from(selectedLambdaTools),
        memoryTool: selectedMemoryTool.value === '__none__' ? null : selectedMemoryTool.value ?? null,
        guardrailTool: selectedGuardrailTool.value === '__none__' ? null : selectedGuardrailTool.value ?? null,
      });
      addFlash('success', 'Agent configuration saved successfully.');
    } catch (err: unknown) {
      addFlash('error', `Failed to save configuration: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleSubAgent = (agentId: string, checked: boolean) => {
    setSelectedSubAgents((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return next;
    });
  };

  const toggleLambdaTool = (toolId: string, checked: boolean) => {
    setSelectedLambdaTools((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(toolId);
      } else {
        next.delete(toolId);
      }
      return next;
    });
  };

  // Sub-Agent form helpers
  const resetSubAgentForm = () => {
    setShowSubAgentForm(false);
    setEditingSubAgentId(null);
    setSubAgentFormName('');
    setSubAgentFormPrompt('');
    setSubAgentFormModel(findModelOption(DEFAULT_MODEL_ID));
    setSubAgentFormTools(new Set());
  };

  const handleAddSubAgent = () => {
    resetSubAgentForm();
    setShowSubAgentForm(true);
  };

  const handleEditSubAgent = (agent: SubAgentConfig) => {
    setEditingSubAgentId(agent.agentId);
    setSubAgentFormName(agent.name);
    setSubAgentFormPrompt(agent.systemPrompt || '');
    setSubAgentFormModel(findModelOption(agent.modelId) || findModelOption(DEFAULT_MODEL_ID));
    setSubAgentFormTools(new Set(agent.lambdaTools || []));
    setShowSubAgentForm(true);
  };

  const handleSaveSubAgent = async () => {
    setSavingSubAgent(true);
    try {
      const config = {
        name: subAgentFormName,
        systemPrompt: subAgentFormPrompt,
        modelId: subAgentFormModel?.value || DEFAULT_MODEL_ID,
        lambdaTools: Array.from(subAgentFormTools),
      };

      if (editingSubAgentId) {
        await updateSubAgent(editingSubAgentId, config);
        addFlash('success', `Sub-agent "${subAgentFormName}" updated successfully.`);
      } else {
        await createSubAgent(config);
        addFlash('success', `Sub-agent "${subAgentFormName}" created successfully.`);
      }

      // Refresh sub-agents list
      const res = await listSubAgents();
      setSubAgents(res.ListSubAgents || []);
      resetSubAgentForm();
    } catch (err: unknown) {
      addFlash('error', `Failed to save sub-agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSubAgent(false);
    }
  };

  const handleConfirmDeleteSubAgent = async () => {
    if (!deleteSubAgentId) return;
    setDeletingSubAgent(true);
    try {
      await deleteSubAgent(deleteSubAgentId);
      addFlash('success', 'Sub-agent deleted successfully.');
      // Refresh sub-agents list
      const res = await listSubAgents();
      setSubAgents(res.ListSubAgents || []);
      // Remove from supervisor selection if attached
      setSelectedSubAgents((prev) => {
        const next = new Set(prev);
        next.delete(deleteSubAgentId);
        return next;
      });
    } catch (err: unknown) {
      addFlash('error', `Failed to delete sub-agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingSubAgent(false);
      setDeleteSubAgentId(null);
    }
  };

  const toggleSubAgentFormTool = (toolId: string, checked: boolean) => {
    setSubAgentFormTools((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(toolId);
      } else {
        next.delete(toolId);
      }
      return next;
    });
  };

  // --- Lambda Tool handlers ---
  const isPathfinderTool = (tool: LambdaToolConfig) =>
    tool.toolId === 'pathfinder-default' || tool.name.toLowerCase().includes('pathfinder');

  const handleRegisterLambdaTool = async () => {
    if (!lambdaToolFormName.trim() || !lambdaToolFormArn.trim()) return;
    setSavingLambdaTool(true);
    try {
      await updateLambdaTool({ name: lambdaToolFormName.trim(), functionName: lambdaToolFormArn.trim() });
      addFlash('success', `Lambda tool "${lambdaToolFormName}" registered successfully.`);
      setLambdaToolFormName('');
      setLambdaToolFormArn('');
      const res = await listLambdaTools();
      setLambdaTools(res.ListLambdaTool || []);
    } catch (err: unknown) {
      addFlash('error', `Failed to register Lambda tool: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingLambdaTool(false);
    }
  };

  const handleConfirmDeleteLambdaTool = async () => {
    if (!deleteLambdaToolId) return;
    setDeletingLambdaTool(true);
    try {
      await deleteLambdaTool(deleteLambdaToolId);
      addFlash('success', 'Lambda tool deleted successfully.');
      const res = await listLambdaTools();
      setLambdaTools(res.ListLambdaTool || []);
      // Remove from supervisor selection if attached
      setSelectedLambdaTools((prev) => {
        const next = new Set(prev);
        next.delete(deleteLambdaToolId);
        return next;
      });
    } catch (err: unknown) {
      addFlash('error', `Failed to delete Lambda tool: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingLambdaTool(false);
      setDeleteLambdaToolId(null);
    }
  };

  // --- Memory Tool handlers ---
  const handleCreateMemory = async () => {
    if (!memoryFormName.trim()) return;
    setSavingMemory(true);
    try {
      await createMemory({ name: memoryFormName.trim(), description: memoryFormDescription.trim() || undefined });
      addFlash('success', `Memory tool "${memoryFormName}" created successfully.`);
      setMemoryFormName('');
      setMemoryFormDescription('');
      const res = await listMemoryTools();
      setMemoryTools(res.ListMemory || []);
    } catch (err: unknown) {
      addFlash('error', `Failed to create memory tool: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingMemory(false);
    }
  };

  const handleConfirmDeleteMemory = async () => {
    if (!deleteMemoryToolId) return;
    setDeletingMemoryTool(true);
    try {
      await deleteMemory(deleteMemoryToolId);
      addFlash('success', 'Memory tool deleted successfully.');
      const res = await listMemoryTools();
      setMemoryTools(res.ListMemory || []);
      // Reset selector if deleted tool was selected
      if (selectedMemoryTool.value === deleteMemoryToolId) {
        setSelectedMemoryTool(NONE_OPTION);
      }
    } catch (err: unknown) {
      addFlash('error', `Failed to delete memory tool: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingMemoryTool(false);
      setDeleteMemoryToolId(null);
    }
  };

  // --- Guardrail Tool handlers ---
  const resetGuardrailForm = () => {
    setGuardrailFormName('');
    setGuardrailFormDescription('');
    setGuardrailFormBlockedInput('I cannot help with that request.');
    setGuardrailFormBlockedOutput('I cannot help with that request.');
    setGuardrailContentFilters([
      { type: 'SEXUAL', label: 'Sexual Content', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
      { type: 'VIOLENCE', label: 'Violence', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
      { type: 'HATE', label: 'Hate Speech', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
      { type: 'INSULTS', label: 'Insults', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
      { type: 'MISCONDUCT', label: 'Misconduct', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM', inputEnabled: true, outputEnabled: true },
      { type: 'PROMPT_ATTACK', label: 'Prompt Attack', inputStrength: 'NONE', outputStrength: 'NONE', inputEnabled: false, outputEnabled: false },
    ]);
    setGuardrailDenyTopics([]);
  };

  const handleCreateGuardrail = async () => {
    if (!guardrailFormName.trim()) return;
    setSavingGuardrail(true);
    try {
      // If editing, delete the old guardrail first
      if (editingGuardrailToolId) {
        await deleteGuardrail(editingGuardrailToolId);
      }

      const payload: { filtersConfig: { type: string; inputStrength: string; outputStrength: string }[]; topicsConfig?: { name: string; definition: string; type: string; inputAction: string; outputAction: string; examples: string[] }[] } = {
        filtersConfig: guardrailContentFilters
          .filter((f) => f.inputEnabled || f.outputEnabled)
          .map((f) => ({
            type: f.type,
            inputStrength: f.inputEnabled ? f.inputStrength : 'NONE',
            outputStrength: f.outputEnabled ? f.outputStrength : 'NONE',
          })),
      };
      if (guardrailDenyTopics.length > 0) {
        payload.topicsConfig = guardrailDenyTopics.map((t) => ({
          name: t.name,
          definition: t.definition,
          type: 'DENY',
          inputAction: t.inputAction || 'BLOCK',
          outputAction: t.outputAction || 'BLOCK',
          examples: (t.samplePhrases || []).filter((p) => p.trim()),
        }));
      }
      const contentPolicyConfig = JSON.stringify(payload);
      await createGuardrail({
        name: guardrailFormName.trim(),
        description: guardrailFormDescription.trim() || undefined,
        blockedInputMessaging: guardrailFormBlockedInput.trim() || undefined,
        blockedOutputsMessaging: guardrailFormBlockedOutput.trim() || undefined,
        contentPolicyConfig,
      });
      addFlash('success', editingGuardrailToolId
        ? `Guardrail "${guardrailFormName}" updated successfully.`
        : `Guardrail "${guardrailFormName}" created successfully.`);
      resetGuardrailForm();
      setEditingGuardrailToolId(null);
      setShowGuardrailModal(false);
      const res = await listGuardrailTools();
      setGuardrailTools(res.ListGuardrail || []);
    } catch (err: unknown) {
      addFlash('error', `Failed to create guardrail: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingGuardrail(false);
    }
  };

  const handleConfirmDeleteGuardrail = async () => {
    if (!deleteGuardrailToolId) return;
    setDeletingGuardrailTool(true);
    try {
      await deleteGuardrail(deleteGuardrailToolId);
      addFlash('success', 'Guardrail deleted successfully.');
      const res = await listGuardrailTools();
      setGuardrailTools(res.ListGuardrail || []);
      // Reset selector if deleted tool was selected
      if (selectedGuardrailTool.value === deleteGuardrailToolId) {
        setSelectedGuardrailTool(NONE_OPTION);
      }
    } catch (err: unknown) {
      addFlash('error', `Failed to delete guardrail: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingGuardrailTool(false);
      setDeleteGuardrailToolId(null);
    }
  };

  // Build memory tool options
  const memoryToolOptions: SelectProps.Options = [
    NONE_OPTION,
    ...memoryTools.map((m) => ({ label: m.name, value: m.toolId, description: m.status || '' })),
  ];

  // Build guardrail tool options
  const guardrailToolOptions: SelectProps.Options = [
    NONE_OPTION,
    ...guardrailTools.map((g) => ({ label: g.name, value: g.toolId, description: g.status || '' })),
  ];

  const modelOptions = buildModelOptions();

  if (loading) {
    return (
      <SpaceBetween size="l">
        <Header variant="h1">Agent Builder</Header>
        <Container>
          <Box textAlign="center" padding="xxl">
            <StatusIndicator type="loading">Loading agent configuration...</StatusIndicator>
          </Box>
        </Container>
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Agent Builder</Header>

      <Alert type="info" header="Model Costs">
        Nova 2 Lite is covered by AWS credits. Claude Haiku 4.5 is higher quality but not typically covered by AWS credits.
      </Alert>

      <Flashbar items={flashItems} />

      <Grid
        gridDefinition={[{ colspan: 8 }, { colspan: 4 }]}
      >
        {/* Left Column: Supervisor Configuration */}
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Supervisor Agent</Header>}>
            <SpaceBetween size="l">
              <FormField label="Agent Name">
                <Input
                  value={name}
                  onChange={({ detail }) => setName(detail.value)}
                  placeholder="My Agent"
                  ariaLabel="Agent name"
                />
              </FormField>

              <FormField label="System Prompt">
                <Textarea
                  value={systemPrompt}
                  onChange={({ detail }) => setSystemPrompt(detail.value)}
                  placeholder="Enter the system prompt for your supervisor agent..."
                  rows={8}
                  ariaLabel="System prompt"
                />
              </FormField>

              <FormField label="Model" description="Select the foundation model for your supervisor agent. Anthropic models are not covered by AWS credits and will incur direct charges.">
                <Select
                  selectedOption={selectedModel}
                  onChange={({ detail }) => setSelectedModel(detail.selectedOption)}
                  options={modelOptions}
                  placeholder="Select a model"
                  ariaLabel="Select model"
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Tool Attachments</Header>}>
            <SpaceBetween size="l">
              {/* Lambda Tools */}
              <FormField label="Lambda Tools" description="Toggle tools to attach them to your supervisor agent.">
                {lambdaTools.length === 0 ? (
                  <Box color="text-body-secondary">No Lambda tools registered. Use the Tools section to register tools.</Box>
                ) : (
                  <SpaceBetween size="xs">
                    {lambdaTools.map((tool) => (
                      <Toggle
                        key={tool.toolId}
                        checked={selectedLambdaTools.has(tool.toolId)}
                        onChange={({ detail }) => toggleLambdaTool(tool.toolId, detail.checked)}
                      >
                        {tool.name} ({tool.functionName})
                      </Toggle>
                    ))}
                  </SpaceBetween>
                )}
              </FormField>

              {/* Memory Tool Selector */}
              <FormField label="Memory Tool" description="Attach a memory instance for persistent recall.">
                <Select
                  selectedOption={selectedMemoryTool}
                  onChange={({ detail }) => setSelectedMemoryTool(detail.selectedOption)}
                  options={memoryToolOptions}
                  placeholder="None"
                  ariaLabel="Select memory tool"
                />
              </FormField>

              {/* Guardrail Tool Selector */}
              <FormField label="Guardrail Tool" description="Attach a guardrail to filter agent inputs/outputs.">
                <Select
                  selectedOption={selectedGuardrailTool}
                  onChange={({ detail }) => setSelectedGuardrailTool(detail.selectedOption)}
                  options={guardrailToolOptions}
                  placeholder="None"
                  ariaLabel="Select guardrail tool"
                />
              </FormField>

              {/* Sub-Agents */}
              <FormField label="Sub-Agents" description="Toggle sub-agents to delegate tasks from your supervisor.">
                {subAgents.length === 0 ? (
                  <Box color="text-body-secondary">No sub-agents configured. Use the Sub-Agents section to create them.</Box>
                ) : (
                  <SpaceBetween size="xs">
                    {subAgents.map((agent) => (
                      <Toggle
                        key={agent.agentId}
                        checked={selectedSubAgents.has(agent.agentId)}
                        onChange={({ detail }) => toggleSubAgent(agent.agentId, detail.checked)}
                      >
                        {agent.name}
                      </Toggle>
                    ))}
                  </SpaceBetween>
                )}
              </FormField>
            </SpaceBetween>
          </Container>

          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>

          {/* Sub-Agents Section */}
          <Container
            header={
              <Header
                variant="h2"
                actions={
                  !showSubAgentForm ? (
                    <Button onClick={handleAddSubAgent}>Add Sub-Agent</Button>
                  ) : undefined
                }
              >
                Sub-Agents
              </Header>
            }
          >
            <SpaceBetween size="l">
              {/* Sub-Agent Table */}
              <Table
                items={subAgents}
                columnDefinitions={[
                  {
                    id: 'name',
                    header: 'Name',
                    cell: (item) => item.name,
                  },
                  {
                    id: 'modelId',
                    header: 'Model',
                    cell: (item) => {
                      const model = AVAILABLE_MODELS.find((m) => m.modelId === item.modelId);
                      return model ? model.displayName : item.modelId;
                    },
                  },
                  {
                    id: 'lambdaTools',
                    header: 'Tools',
                    cell: (item) => item.lambdaTools && item.lambdaTools.length > 0
                      ? item.lambdaTools.map((id: string) => lambdaTools.find(t => t.toolId === id)?.name || id).join(', ')
                      : '—',
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    cell: (item) => (
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button
                          variant="inline-link"
                          onClick={() => handleEditSubAgent(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="inline-link"
                          onClick={() => setDeleteSubAgentId(item.agentId)}
                        >
                          Delete
                        </Button>
                      </SpaceBetween>
                    ),
                  },
                ]}
                empty={
                  <Box textAlign="center" color="text-body-secondary" padding="l">
                    No sub-agents configured. Click "Add Sub-Agent" to create one.
                  </Box>
                }
                variant="embedded"
              />

              {/* Inline Sub-Agent Form */}
              {showSubAgentForm && (
                <Container
                  header={
                    <Header variant="h3">
                      {editingSubAgentId ? 'Edit Sub-Agent' : 'New Sub-Agent'}
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <FormField label="Name">
                      <Input
                        value={subAgentFormName}
                        onChange={({ detail }) => setSubAgentFormName(detail.value)}
                        placeholder="e.g., Code Executor"
                        ariaLabel="Sub-agent name"
                      />
                    </FormField>

                    <FormField label="System Prompt">
                      <Textarea
                        value={subAgentFormPrompt}
                        onChange={({ detail }) => setSubAgentFormPrompt(detail.value)}
                        placeholder="Enter the system prompt for this sub-agent..."
                        rows={4}
                        ariaLabel="Sub-agent system prompt"
                      />
                    </FormField>

                    <FormField label="Model">
                      <Select
                        selectedOption={subAgentFormModel}
                        onChange={({ detail }) => setSubAgentFormModel(detail.selectedOption)}
                        options={modelOptions}
                        placeholder="Select a model"
                        ariaLabel="Sub-agent model selection"
                      />
                    </FormField>

                    <FormField label="Lambda Tools" description="Toggle tools to attach to this sub-agent.">
                      {lambdaTools.length === 0 ? (
                        <Box color="text-body-secondary">No Lambda tools available.</Box>
                      ) : (
                        <SpaceBetween size="xs">
                          {lambdaTools.map((tool) => (
                            <Toggle
                              key={tool.toolId}
                              checked={subAgentFormTools.has(tool.toolId)}
                              onChange={({ detail }) => toggleSubAgentFormTool(tool.toolId, detail.checked)}
                            >
                              {tool.name} ({tool.functionName})
                            </Toggle>
                          ))}
                        </SpaceBetween>
                      )}
                    </FormField>

                    <SpaceBetween direction="horizontal" size="xs">
                      <Button
                        variant="primary"
                        onClick={handleSaveSubAgent}
                        loading={savingSubAgent}
                        disabled={!subAgentFormName.trim()}
                      >
                        {editingSubAgentId ? 'Update' : 'Create'}
                      </Button>
                      <Button variant="link" onClick={resetSubAgentForm}>
                        Cancel
                      </Button>
                    </SpaceBetween>
                  </SpaceBetween>
                </Container>
              )}
            </SpaceBetween>
          </Container>

          {/* Tools Section */}
          <Container header={<Header variant="h2">Tools</Header>}>
            <Tabs
              tabs={[
                {
                  label: 'Lambda Tools',
                  id: 'lambda-tools',
                  content: (
                    <SpaceBetween size="l">
                      {/* TODO: Phase 3/4 — Add Lambda function creation with SageMaker Code Editor integration.
                          Currently users register existing Lambda ARNs. Future phases will allow creating new
                          Lambda functions with hello-world templates and editing them in-browser via the IDE. */}
                      <Table
                        columnDefinitions={[
                          { id: 'name', header: 'Name', cell: (item: LambdaToolConfig) => item.name },
                          { id: 'functionName', header: 'Function ARN', cell: (item: LambdaToolConfig) => item.functionName },
                          {
                            id: 'actions',
                            header: 'Actions',
                            cell: (item: LambdaToolConfig) =>
                              isPathfinderTool(item) ? (
                                <StatusIndicator type="info">Default</StatusIndicator>
                              ) : (
                                <Button
                                  variant="icon"
                                  iconName="remove"
                                  ariaLabel={`Delete ${item.name}`}
                                  onClick={() => setDeleteLambdaToolId(item.toolId)}
                                />
                              ),
                          },
                        ]}
                        items={lambdaTools}
                        empty={
                          <Box textAlign="center" color="text-body-secondary" padding="s">
                            No Lambda tools registered.
                          </Box>
                        }
                        variant="embedded"
                      />
                      <SpaceBetween size="s">
                        <Header variant="h3">Register Tool</Header>
                        <FormField label="Tool Name">
                          <Input
                            value={lambdaToolFormName}
                            onChange={({ detail }) => setLambdaToolFormName(detail.value)}
                            placeholder="e.g., Code Interpreter"
                            ariaLabel="Lambda tool name"
                          />
                        </FormField>
                        <FormField label="Function ARN">
                          <Input
                            value={lambdaToolFormArn}
                            onChange={({ detail }) => setLambdaToolFormArn(detail.value)}
                            placeholder="arn:aws:lambda:us-east-1:123456789:function:my-tool"
                            ariaLabel="Lambda function ARN"
                          />
                        </FormField>
                        <Button
                          variant="primary"
                          onClick={handleRegisterLambdaTool}
                          loading={savingLambdaTool}
                          disabled={!lambdaToolFormName.trim() || !lambdaToolFormArn.trim()}
                        >
                          Register Tool
                        </Button>
                      </SpaceBetween>
                    </SpaceBetween>
                  ),
                },
                {
                  label: 'Memory Tools',
                  id: 'memory-tools',
                  content: (
                    <SpaceBetween size="l">
                      <Table
                        columnDefinitions={[
                          { id: 'name', header: 'Name', cell: (item: MemoryToolConfig) => item.name },
                          { id: 'memoryId', header: 'Memory ID', cell: (item: MemoryToolConfig) => item.memoryId },
                          { id: 'status', header: 'Status', cell: (item: MemoryToolConfig) => item.status || '—' },
                          {
                            id: 'actions',
                            header: 'Actions',
                            cell: (item: MemoryToolConfig) => (
                              <Button
                                variant="icon"
                                iconName="remove"
                                ariaLabel={`Delete ${item.name}`}
                                onClick={() => setDeleteMemoryToolId(item.toolId)}
                              />
                            ),
                          },
                        ]}
                        items={memoryTools}
                        empty={
                          <Box textAlign="center" color="text-body-secondary" padding="s">
                            No memory tools created.
                          </Box>
                        }
                        variant="embedded"
                      />
                      <SpaceBetween size="s">
                        <Header variant="h3">Create Memory</Header>
                        <FormField label="Name">
                          <Input
                            value={memoryFormName}
                            onChange={({ detail }) => setMemoryFormName(detail.value)}
                            placeholder="e.g., Game Memory"
                            ariaLabel="Memory tool name"
                          />
                        </FormField>
                        <FormField label="Description">
                          <Input
                            value={memoryFormDescription}
                            onChange={({ detail }) => setMemoryFormDescription(detail.value)}
                            placeholder="Optional description"
                            ariaLabel="Memory tool description"
                          />
                        </FormField>
                        <Button
                          variant="primary"
                          onClick={handleCreateMemory}
                          loading={savingMemory}
                          disabled={!memoryFormName.trim()}
                        >
                          Create Memory
                        </Button>
                      </SpaceBetween>
                    </SpaceBetween>
                  ),
                },
                {
                  label: 'Guardrails',
                  id: 'guardrails',
                  content: (
                    <SpaceBetween size="l">
                      <Table
                        columnDefinitions={[
                          { id: 'name', header: 'Name', cell: (item: GuardrailToolConfig) => item.name },
                          { id: 'guardrailId', header: 'Guardrail ID', cell: (item: GuardrailToolConfig) => item.guardrailId },
                          { id: 'status', header: 'Status', cell: (item: GuardrailToolConfig) => item.status || '—' },
                          {
                            id: 'actions',
                            header: 'Actions',
                            cell: (item: GuardrailToolConfig) => (
                              <SpaceBetween direction="horizontal" size="xs">
                                <Button
                                  variant="icon"
                                  iconName="edit"
                                  ariaLabel={`Edit ${item.name}`}
                                  onClick={() => {
                                    // Pre-populate form with existing guardrail data
                                    setGuardrailFormName(item.name || '');
                                    setGuardrailFormDescription(item.description || '');
                                    // Load content filters from fullSDKResponse if available
                                    if (item.fullSDKResponse) {
                                      const sdk = typeof item.fullSDKResponse === 'string' ? JSON.parse(item.fullSDKResponse) : item.fullSDKResponse;
                                      setGuardrailFormBlockedInput(sdk.blockedInputMessaging || 'I cannot help with that request.');
                                      setGuardrailFormBlockedOutput(sdk.blockedOutputsMessaging || 'I cannot help with that request.');
                                      // Load content filters
                                      const filters = sdk.contentPolicy?.filtersConfig || [];
                                      if (filters.length > 0) {
                                        setGuardrailContentFilters(filters.map((f: { type: string; inputStrength: string; outputStrength: string }) => ({
                                          type: f.type || '',
                                          inputStrength: f.inputStrength || 'HIGH',
                                          outputStrength: f.outputStrength || 'HIGH',
                                        })));
                                      }
                                      // Load deny topics
                                      const topics = sdk.topicPolicy?.topicsConfig || [];
                                      if (topics.length > 0) {
                                        setGuardrailDenyTopics(topics.map((t: { name: string; definition: string }) => ({
                                          name: t.name || '',
                                          definition: t.definition || '',
                                        })));
                                      }
                                    }
                                    setEditingGuardrailToolId(item.toolId);
                                    setShowGuardrailModal(true);
                                  }}
                                />
                                <Button
                                  variant="icon"
                                  iconName="remove"
                                  ariaLabel={`Delete ${item.name}`}
                                  onClick={() => setDeleteGuardrailToolId(item.toolId)}
                                />
                              </SpaceBetween>
                            ),
                          },
                        ]}
                        items={guardrailTools}
                        empty={
                          <Box textAlign="center" color="text-body-secondary" padding="s">
                            No guardrails created.
                          </Box>
                        }
                        variant="embedded"
                      />
                      <Button variant="primary" onClick={() => { resetGuardrailForm(); setEditingGuardrailToolId(null); setShowGuardrailModal(true); }}>
                        Create Guardrail
                      </Button>
                    </SpaceBetween>
                  ),
                },
              ]}
            />
          </Container>
        </SpaceBetween>

        {/* Right Column: Version History */}
        <Container header={<Header variant="h2">Version History</Header>}>
          {agentVersions.length === 0 ? (
            <Box textAlign="center" padding="l" color="text-body-secondary">
              No versions yet. Versions are created when you submit to the leaderboard.
            </Box>
          ) : (
            <SpaceBetween size="s">
              {agentVersions.map((version) => (
                <Container
                  key={version.versionId}
                  footer={
                    <Button
                      variant="inline-link"
                      onClick={() => setSelectedVersion(version)}
                    >
                      View Details
                    </Button>
                  }
                >
                  <SpaceBetween size="xxs">
                    <Box variant="h4">
                      {version.name || `Version ${version.createdAt ? new Date(version.createdAt).toLocaleDateString() : version.versionId}`}
                    </Box>
                    <Box variant="small" color="text-body-secondary">
                      {version.createdAt ? new Date(version.createdAt).toLocaleString() : '—'}
                    </Box>
                    <SpaceBetween direction="horizontal" size="m">
                      <Box>
                        <Box variant="awsui-key-label">Score</Box>
                        <Box>{version.finalScore != null ? version.finalScore : '—'}</Box>
                      </Box>
                      <Box>
                        <Box variant="awsui-key-label">Sub-Agents</Box>
                        <Box>{version.subAgentCount != null ? version.subAgentCount : '—'}</Box>
                      </Box>
                    </SpaceBetween>
                  </SpaceBetween>
                </Container>
              ))}
            </SpaceBetween>
          )}
        </Container>
      </Grid>

      {/* Delete Sub-Agent Confirmation Modal */}
      <Modal
        visible={deleteSubAgentId !== null}
        onDismiss={() => setDeleteSubAgentId(null)}
        header="Delete Sub-Agent"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteSubAgentId(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmDeleteSubAgent}
                loading={deletingSubAgent}
              >
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to delete this sub-agent? This action cannot be undone.
      </Modal>

      {/* Delete Lambda Tool Confirmation Modal */}
      <Modal
        visible={deleteLambdaToolId !== null}
        onDismiss={() => setDeleteLambdaToolId(null)}
        header="Delete Lambda Tool"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteLambdaToolId(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleConfirmDeleteLambdaTool} loading={deletingLambdaTool}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to delete this Lambda tool? This action cannot be undone.
      </Modal>

      {/* Delete Memory Tool Confirmation Modal */}
      <Modal
        visible={deleteMemoryToolId !== null}
        onDismiss={() => setDeleteMemoryToolId(null)}
        header="Delete Memory Tool"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteMemoryToolId(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleConfirmDeleteMemory} loading={deletingMemoryTool}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to delete this memory tool? This action cannot be undone.
      </Modal>

      {/* Delete Guardrail Confirmation Modal */}
      <Modal
        visible={deleteGuardrailToolId !== null}
        onDismiss={() => setDeleteGuardrailToolId(null)}
        header="Delete Guardrail"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteGuardrailToolId(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleConfirmDeleteGuardrail} loading={deletingGuardrailTool}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Are you sure you want to delete this guardrail? This action cannot be undone.
      </Modal>

      {/* Create/Edit Guardrail Modal */}
      <Modal
        visible={showGuardrailModal}
        onDismiss={() => setShowGuardrailModal(false)}
        header={editingGuardrailToolId ? 'Edit Guardrail' : 'Create Guardrail'}
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => { resetGuardrailForm(); setShowGuardrailModal(false); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateGuardrail}
                loading={savingGuardrail}
                disabled={!guardrailFormName.trim()}
              >
                Create Guardrail
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Name" constraintText="Required">
            <Input
              value={guardrailFormName}
              onChange={({ detail }) => setGuardrailFormName(detail.value)}
              placeholder="e.g., Content Safety Guardrail"
              ariaLabel="Guardrail name"
            />
          </FormField>

          <FormField label="Description">
            <Input
              value={guardrailFormDescription}
              onChange={({ detail }) => setGuardrailFormDescription(detail.value)}
              placeholder="Optional description"
              ariaLabel="Guardrail description"
            />
          </FormField>

          <FormField label="Blocked Input Messaging" description="Message returned when input is blocked.">
            <Input
              value={guardrailFormBlockedInput}
              onChange={({ detail }) => setGuardrailFormBlockedInput(detail.value)}
              placeholder="I cannot help with that request."
              ariaLabel="Blocked input messaging"
            />
          </FormField>

          <FormField label="Blocked Output Messaging" description="Message returned when output is blocked.">
            <Input
              value={guardrailFormBlockedOutput}
              onChange={({ detail }) => setGuardrailFormBlockedOutput(detail.value)}
              placeholder="I cannot help with that request."
              ariaLabel="Blocked output messaging"
            />
          </FormField>

          {/* Content Policy Filters */}
          <Container header={<Header variant="h3">Content Policy Filters</Header>}>
            <SpaceBetween size="m">
              {guardrailContentFilters.map((filter) => (
                <SpaceBetween key={filter.type} size="xs">
                  <SpaceBetween direction="horizontal" size="m">
                    <Toggle
                      checked={filter.inputEnabled || filter.outputEnabled}
                      onChange={({ detail }) => {
                        setGuardrailContentFilters((prev) =>
                          prev.map((f) =>
                            f.type === filter.type
                              ? { ...f, inputEnabled: detail.checked, outputEnabled: detail.checked }
                              : f
                          )
                        );
                      }}
                    >
                      {filter.label}
                    </Toggle>
                  </SpaceBetween>
                  {(filter.inputEnabled || filter.outputEnabled) && (
                    <SpaceBetween direction="horizontal" size="m">
                      <FormField label="Input Strength">
                        <Select
                          selectedOption={{ label: filter.inputStrength, value: filter.inputStrength }}
                          onChange={({ detail }) => {
                            setGuardrailContentFilters((prev) =>
                              prev.map((f) =>
                                f.type === filter.type
                                  ? { ...f, inputStrength: detail.selectedOption.value || 'MEDIUM' }
                                  : f
                              )
                            );
                          }}
                          options={[
                            { label: 'NONE', value: 'NONE' },
                            { label: 'LOW', value: 'LOW' },
                            { label: 'MEDIUM', value: 'MEDIUM' },
                            { label: 'HIGH', value: 'HIGH' },
                          ]}
                          ariaLabel={`Input strength for ${filter.type}`}
                        />
                      </FormField>
                      <FormField label="Output Strength">
                        <Select
                          selectedOption={{ label: filter.outputStrength, value: filter.outputStrength }}
                          onChange={({ detail }) => {
                            setGuardrailContentFilters((prev) =>
                              prev.map((f) =>
                                f.type === filter.type
                                  ? { ...f, outputStrength: detail.selectedOption.value || 'MEDIUM' }
                                  : f
                              )
                            );
                          }}
                          options={[
                            { label: 'NONE', value: 'NONE' },
                            { label: 'LOW', value: 'LOW' },
                            { label: 'MEDIUM', value: 'MEDIUM' },
                            { label: 'HIGH', value: 'HIGH' },
                          ]}
                          ariaLabel={`Output strength for ${filter.type}`}
                        />
                      </FormField>
                    </SpaceBetween>
                  )}
                </SpaceBetween>
              ))}
            </SpaceBetween>
          </Container>

          {/* Topic Policy */}
          <Container header={<Header variant="h3">Topic Policy (Deny Topics)</Header>}>
            <SpaceBetween size="m">
              {guardrailDenyTopics.length === 0 ? (
                <Box color="text-body-secondary">No deny topics configured.</Box>
              ) : (
                guardrailDenyTopics.map((topic, index) => (
                  <Container key={index}>
                    <SpaceBetween size="s">
                      <SpaceBetween direction="horizontal" size="m">
                        <FormField label="Topic Name">
                          <Input
                            value={topic.name}
                            onChange={({ detail }) => {
                              setGuardrailDenyTopics((prev) =>
                                prev.map((t, i) => (i === index ? { ...t, name: detail.value } : t))
                              );
                            }}
                            placeholder="e.g., Competitor Products"
                            ariaLabel={`Deny topic name ${index + 1}`}
                          />
                        </FormField>
                        <FormField label="Definition">
                          <Input
                            value={topic.definition}
                            onChange={({ detail }) => {
                              setGuardrailDenyTopics((prev) =>
                                prev.map((t, i) => (i === index ? { ...t, definition: detail.value } : t))
                              );
                            }}
                            placeholder="Description of what this topic covers"
                            ariaLabel={`Deny topic definition ${index + 1}`}
                          />
                        </FormField>
                      </SpaceBetween>
                      <SpaceBetween direction="horizontal" size="m">
                        <FormField label="Input Action">
                          <Select
                            selectedOption={{ label: topic.inputAction, value: topic.inputAction }}
                            onChange={({ detail }) => {
                              setGuardrailDenyTopics((prev) =>
                                prev.map((t, i) =>
                                  i === index ? { ...t, inputAction: (detail.selectedOption.value as 'BLOCK' | 'LOG') || 'BLOCK' } : t
                                )
                              );
                            }}
                            options={[
                              { label: 'BLOCK', value: 'BLOCK' },
                              { label: 'LOG', value: 'LOG' },
                            ]}
                            ariaLabel={`Input action for topic ${index + 1}`}
                          />
                        </FormField>
                        <FormField label="Output Action">
                          <Select
                            selectedOption={{ label: topic.outputAction, value: topic.outputAction }}
                            onChange={({ detail }) => {
                              setGuardrailDenyTopics((prev) =>
                                prev.map((t, i) =>
                                  i === index ? { ...t, outputAction: (detail.selectedOption.value as 'BLOCK' | 'LOG') || 'BLOCK' } : t
                                )
                              );
                            }}
                            options={[
                              { label: 'BLOCK', value: 'BLOCK' },
                              { label: 'LOG', value: 'LOG' },
                            ]}
                            ariaLabel={`Output action for topic ${index + 1}`}
                          />
                        </FormField>
                      </SpaceBetween>
                      <FormField label="Sample Phrases" description="One phrase per line">
                        <Textarea
                          value={topic.samplePhrases.join('\n')}
                          onChange={({ detail }) => {
                            setGuardrailDenyTopics((prev) =>
                              prev.map((t, i) =>
                                i === index ? { ...t, samplePhrases: detail.value.split('\n') } : t
                              )
                            );
                          }}
                          placeholder="Enter sample phrases, one per line"
                          rows={3}
                          ariaLabel={`Sample phrases for topic ${index + 1}`}
                        />
                      </FormField>
                      <Button
                        variant="icon"
                        iconName="remove"
                        ariaLabel={`Remove topic ${index + 1}`}
                        onClick={() => {
                          setGuardrailDenyTopics((prev) => prev.filter((_, i) => i !== index));
                        }}
                      />
                    </SpaceBetween>
                  </Container>
                ))
              )}
              <Button
                iconName="add-plus"
                onClick={() => setGuardrailDenyTopics((prev) => [...prev, { name: '', definition: '', inputAction: 'BLOCK', outputAction: 'BLOCK', samplePhrases: [] }])}
              >
                Add Topic
              </Button>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Modal>

      {/* Version Detail Modal */}
      <Modal
        visible={selectedVersion !== null}
        onDismiss={() => setSelectedVersion(null)}
        header={`Version: ${selectedVersion?.name || (selectedVersion?.createdAt ? new Date(selectedVersion.createdAt).toLocaleDateString() : selectedVersion?.versionId || '')}`}
        size="large"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setSelectedVersion(null)}>
              Close
            </Button>
          </Box>
        }
      >
        {selectedVersion && (
          <SpaceBetween size="l">
            <SpaceBetween size="m">
              <FormField label="Version ID">
                <Box>{selectedVersion.versionId}</Box>
              </FormField>
              <FormField label="Name">
                <Box>{selectedVersion.name || '—'}</Box>
              </FormField>
              <FormField label="Final Score">
                <Box>{selectedVersion.finalScore != null ? selectedVersion.finalScore : '—'}</Box>
              </FormField>
              <FormField label="Sub-Agent Count">
                <Box>{selectedVersion.subAgentCount != null ? selectedVersion.subAgentCount : '—'}</Box>
              </FormField>
              <FormField label="Created At">
                <Box>{selectedVersion.createdAt ? new Date(selectedVersion.createdAt).toLocaleString() : '—'}</Box>
              </FormField>
            </SpaceBetween>
            {selectedVersion.supervisorConfig && (
              <Container header={<Header variant="h3">Supervisor Configuration</Header>}>
                {(() => {
                  try {
                    const config = JSON.parse(selectedVersion.supervisorConfig);
                    return (
                      <SpaceBetween size="m">
                        {config.name && (
                          <FormField label="Agent Name">
                            <Box>{config.name}</Box>
                          </FormField>
                        )}
                        {config.modelId && (
                          <FormField label="Model">
                            <Box>{AVAILABLE_MODELS.find((m) => m.modelId === config.modelId)?.displayName || config.modelId}</Box>
                          </FormField>
                        )}
                        {config.systemPrompt && (
                          <FormField label="System Prompt">
                            <Box variant="code">{config.systemPrompt}</Box>
                          </FormField>
                        )}
                        {config.subAgents && config.subAgents.length > 0 && (
                          <FormField label="Sub-Agents">
                            <Box>{config.subAgents.join(', ')}</Box>
                          </FormField>
                        )}
                        {config.lambdaTools && config.lambdaTools.length > 0 && (
                          <FormField label="Lambda Tools">
                            <Box>{config.lambdaTools.join(', ')}</Box>
                          </FormField>
                        )}
                        {config.memoryTool && (
                          <FormField label="Memory Tool">
                            <Box>{config.memoryTool}</Box>
                          </FormField>
                        )}
                        {config.guardrailTool && (
                          <FormField label="Guardrail Tool">
                            <Box>{config.guardrailTool}</Box>
                          </FormField>
                        )}
                      </SpaceBetween>
                    );
                  } catch {
                    return (
                      <Box variant="code">{selectedVersion.supervisorConfig}</Box>
                    );
                  }
                })()}
              </Container>
            )}
          </SpaceBetween>
        )}
      </Modal>
    </SpaceBetween>
  );
}
