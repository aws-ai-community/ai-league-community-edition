import { useEffect, useState, useRef, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Alert from '@cloudscape-design/components/alert';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import {
  getLlmConfiguration,
  saveLlmConfiguration,
  getCodeEditorStatus,
  startCodeEditor,
  stopCodeEditor,
  getSchemaModelConfig,
  saveSchemaModelConfig,
  resetConfiguration,
} from '../../services/graphqlClient';
import { loadSettings } from '../../services/settingsLoader';

// Model definitions
interface ModelDefinition {
  modelId: string;
  displayName: string;
  family: string;
  hasCostWarning: boolean;
}

function getRegionPrefix(defaultModelId?: string): string {
  if (defaultModelId) {
    const prefix = defaultModelId.split('.')[0];
    if (['us', 'eu', 'ap'].includes(prefix)) return prefix;
  }
  return 'us';
}

function getAvailableModels(regionPrefix: string): ModelDefinition[] {
  return [
    { modelId: `${regionPrefix}.amazon.nova-2-lite-v1:0`, displayName: 'Nova 2 Lite', family: 'Amazon Nova', hasCostWarning: false },
    { modelId: `${regionPrefix}.anthropic.claude-haiku-4-5-20251001-v1:0`, displayName: 'Claude Haiku 4.5', family: 'Anthropic', hasCostWarning: true },
  ];
}

// Fallback values used before settings are loaded
const FALLBACK_REGION_PREFIX = 'us';
const FALLBACK_MODELS: ModelDefinition[] = getAvailableModels(FALLBACK_REGION_PREFIX);
const FALLBACK_DEFAULT_MODEL_ID = `${FALLBACK_REGION_PREFIX}.amazon.nova-2-lite-v1:0`;

const USE_DEFAULT_OPTION: SelectProps.Option = {
  label: 'Use Default',
  value: '__use_default__',
};

function buildModelOptions(models: ModelDefinition[]): SelectProps.Options {
  const groups: Record<string, SelectProps.Option[]> = {};
  for (const model of models) {
    if (!groups[model.family]) {
      groups[model.family] = [];
    }
    groups[model.family].push({
      label: model.displayName,
      value: model.modelId,
      description: model.hasCostWarning ? 'Not covered by AWS credits' : undefined,
    });
  }

  return Object.entries(groups).map(([family, options]) => ({
    label: family,
    options,
  }));
}

function buildDefaultModelOptions(models: ModelDefinition[]): SelectProps.Options {
  const groups: Record<string, SelectProps.Option[]> = {};
  for (const model of models) {
    if (!groups[model.family]) {
      groups[model.family] = [];
    }
    groups[model.family].push({
      label: model.displayName,
      value: model.modelId,
      description: model.hasCostWarning ? 'Not covered by AWS credits' : undefined,
    });
  }

  return Object.entries(groups).map(([family, options]) => ({
    label: family,
    options,
  }));
}

function buildOverrideOptions(models: ModelDefinition[]): SelectProps.Options {
  return [
    { label: 'Use Default', value: '__use_default__', options: undefined } as unknown as SelectProps.OptionGroup,
    ...buildModelOptions(models) as SelectProps.OptionGroup[],
  ];
}

function findModelOption(modelId: string | null, models: ModelDefinition[]): SelectProps.Option | null {
  if (!modelId) return null;
  const model = models.find((m) => m.modelId === modelId);
  if (!model) return null;
  return { label: model.displayName, value: model.modelId };
}

function findOverrideOption(modelId: string | null, models: ModelDefinition[]): SelectProps.Option {
  if (!modelId) return USE_DEFAULT_OPTION;
  const model = models.find((m) => m.modelId === modelId);
  if (!model) return USE_DEFAULT_OPTION;
  return { label: model.displayName, value: model.modelId };
}

export default function ConfigurationPage() {
  const [availableModels, setAvailableModels] = useState<ModelDefinition[]>(FALLBACK_MODELS);
  const [defaultModelId, setDefaultModelId] = useState<string>(FALLBACK_DEFAULT_MODEL_ID);
  const [defaultModel, setDefaultModel] = useState<SelectProps.Option | null>(
    findModelOption(FALLBACK_DEFAULT_MODEL_ID, FALLBACK_MODELS),
  );
  const [challengeGeneration, setChallengeGeneration] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);
  const [challengeGrading, setChallengeGrading] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);
  const [gameCommentary, setGameCommentary] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // IDE Controls state
  const [ideStatus, setIdeStatus] = useState<string>('Stopped');
  const [ideLoading, setIdeLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Schema Generation Model state
  const [schemaModel, setSchemaModel] = useState<SelectProps.Option | null>(
    findModelOption(FALLBACK_DEFAULT_MODEL_ID, FALLBACK_MODELS),
  );
  const [schemaModelLoading, setSchemaModelLoading] = useState(false);

  // Reset Configuration state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);

  const pollIdeStatus = useCallback(async () => {
    try {
      const res = await getCodeEditorStatus();
      const status = res.GetCodeEditorStatus.status;
      setIdeStatus(status);
      // Stop polling if we've reached a stable state
      if (status !== 'Pending' && status !== 'Deleting') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch {
      setIdeStatus('Stopped');
    }
  }, []);

  // Start polling when status is transitional
  useEffect(() => {
    if (ideStatus === 'Pending' || ideStatus === 'Deleting') {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(pollIdeStatus, 10000);
      }
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [ideStatus, pollIdeStatus]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError(null);
      try {
        // Load settings to get region-aware default model ID
        const settings = await loadSettings();
        const resolvedDefaultModelId = settings.defaultModelId || FALLBACK_DEFAULT_MODEL_ID;
        const regionPrefix = getRegionPrefix(resolvedDefaultModelId);
        const models = getAvailableModels(regionPrefix);

        if (!cancelled) {
          setAvailableModels(models);
          setDefaultModelId(resolvedDefaultModelId);
        }

        const [llmResult, ideResult, schemaResult] = await Promise.all([
          getLlmConfiguration(),
          getCodeEditorStatus().catch(() => ({ GetCodeEditorStatus: { status: 'Stopped', message: null } })),
          getSchemaModelConfig().catch(() => ({ GetSchemaModelConfig: { modelId: resolvedDefaultModelId } })),
        ]);
        if (!cancelled) {
          const config = llmResult.GetLlmConfiguration;
          setDefaultModel(findModelOption(config.defaultModel, models) ?? findModelOption(resolvedDefaultModelId, models));
          setChallengeGeneration(findOverrideOption(config.challengeGeneration, models));
          setChallengeGrading(findOverrideOption(config.challengeGrading, models));
          setGameCommentary(findOverrideOption(config.gameCommentary, models));

          // IDE status
          setIdeStatus(ideResult.GetCodeEditorStatus.status);

          // Schema model config
          const schemaModelId = schemaResult?.GetSchemaModelConfig?.modelId;
          setSchemaModel(findModelOption(schemaModelId ?? null, models) ?? findModelOption(resolvedDefaultModelId, models));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadConfig();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveLlmConfiguration({
        defaultModel: defaultModel?.value ?? defaultModelId,
        challengeGeneration: challengeGeneration.value === '__use_default__' ? undefined : challengeGeneration.value,
        challengeGrading: challengeGrading.value === '__use_default__' ? undefined : challengeGrading.value,
        gameCommentary: gameCommentary.value === '__use_default__' ? undefined : gameCommentary.value,
      });
      setSuccess('Configuration saved successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDefaultModel(findModelOption(defaultModelId, availableModels));
    setChallengeGeneration(USE_DEFAULT_OPTION);
    setChallengeGrading(USE_DEFAULT_OPTION);
    setGameCommentary(USE_DEFAULT_OPTION);
    setSuccess(null);
  };

  const handleStartIde = async () => {
    setIdeLoading(true);
    try {
      const res = await startCodeEditor();
      setIdeStatus(res.StartCodeEditor.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIdeLoading(false);
    }
  };

  const handleStopIde = async () => {
    setIdeLoading(true);
    try {
      const res = await stopCodeEditor();
      setIdeStatus(res.StopCodeEditor.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIdeLoading(false);
    }
  };

  const handleSchemaModelChange = async (option: SelectProps.Option) => {
    setSchemaModel(option);
    setSchemaModelLoading(true);
    try {
      await saveSchemaModelConfig(option.value || defaultModelId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSchemaModelLoading(false);
    }
  };

  const handleResetConfiguration = async () => {
    setResetting(true);
    try {
      await resetConfiguration();
      setSuccess('Configuration reset to defaults successfully.');
      setShowResetModal(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  const defaultModelOptions = buildDefaultModelOptions(availableModels);
  const overrideOptions: SelectProps.Options = [
    USE_DEFAULT_OPTION,
    ...buildModelOptions(availableModels) as SelectProps.OptionGroup[],
  ];

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Configuration</Header>

      <Alert type="info" header="Model Costs">
        Nova 2 Lite is covered by AWS credits. Claude Haiku 4.5 is higher quality but not typically covered by AWS credits.
      </Alert>

      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert type="success" dismissible onDismiss={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Container header={<Header variant="h2">Default Model</Header>}>
        <FormField
          label="Default LLM"
          description="Applies to all purposes unless overridden below."
        >
          <Select
            selectedOption={defaultModel}
            onChange={({ detail }) => setDefaultModel(detail.selectedOption)}
            options={defaultModelOptions}
            placeholder="Select default model"
            ariaLabel="Select default LLM model"
            loadingText="Loading configuration..."
            statusType={loading ? 'loading' : 'finished'}
          />
        </FormField>
      </Container>

      <Container header={<Header variant="h2">Per-Purpose Overrides</Header>}>
        <ColumnLayout columns={1}>
          <SpaceBetween size="l">
            <FormField
              label="Challenge Generation"
              description="Model used to generate challenge questions in the Map Builder."
            >
              <Select
                selectedOption={challengeGeneration}
                onChange={({ detail }) => setChallengeGeneration(detail.selectedOption)}
                options={overrideOptions}
                placeholder="Use Default"
                ariaLabel="Select model for challenge generation"
              />
            </FormField>

            <FormField
              label="Challenge Grading"
              description="Model used to grade challenge responses during gameplay."
            >
              <Select
                selectedOption={challengeGrading}
                onChange={({ detail }) => setChallengeGrading(detail.selectedOption)}
                options={overrideOptions}
                placeholder="Use Default"
                ariaLabel="Select model for challenge grading"
              />
            </FormField>

            <FormField
              label="Game Commentary"
              description="Model used to generate game commentary and narration."
            >
              <Select
                selectedOption={gameCommentary}
                onChange={({ detail }) => setGameCommentary(detail.selectedOption)}
                options={overrideOptions}
                placeholder="Use Default"
                ariaLabel="Select model for game commentary"
              />
            </FormField>
          </SpaceBetween>
        </ColumnLayout>
      </Container>

      <SpaceBetween size="s" direction="horizontal">
        <Button onClick={handleReset}>Reset All to Default</Button>
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save Configuration
        </Button>
      </SpaceBetween>

      {/* Code Editor IDE Section */}
      <Container header={<Header variant="h2">Code Editor IDE</Header>}>
        <SpaceBetween size="m">
          <FormField label="Status">
            {ideStatus === 'InService' && (
              <StatusIndicator type="success">Running</StatusIndicator>
            )}
            {ideStatus === 'Pending' && (
              <StatusIndicator type="loading">Starting</StatusIndicator>
            )}
            {ideStatus === 'Deleting' && (
              <StatusIndicator type="loading">Stopping</StatusIndicator>
            )}
            {ideStatus === 'Stopped' && (
              <StatusIndicator type="stopped">Stopped</StatusIndicator>
            )}
            {ideStatus === 'Error' && (
              <StatusIndicator type="error">Error</StatusIndicator>
            )}
          </FormField>
          <SpaceBetween size="s" direction="horizontal">
            <Button
              onClick={handleStartIde}
              loading={ideLoading}
              disabled={ideStatus === 'InService' || ideStatus === 'Pending'}
            >
              Start IDE
            </Button>
            <Button
              onClick={handleStopIde}
              loading={ideLoading}
              disabled={ideStatus === 'Stopped' || ideStatus === 'Deleting'}
            >
              Stop IDE
            </Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>

      {/* Schema Generation Model Section */}
      <Container header={<Header variant="h2">Schema Generation Model</Header>}>
        <FormField
          label="Model"
          description="The model used to auto-generate MCP tool schemas when you deploy Lambda tool code."
        >
          <Select
            selectedOption={schemaModel}
            onChange={({ detail }) => handleSchemaModelChange(detail.selectedOption)}
            options={defaultModelOptions}
            placeholder="Select schema generation model"
            ariaLabel="Select schema generation model"
            statusType={schemaModelLoading ? 'loading' : 'finished'}
          />
        </FormField>
      </Container>

      {/* Reset Configuration Section */}
      <Container header={<Header variant="h2">Reset Configuration</Header>}>
        <SpaceBetween size="s">
          <Box color="text-body-secondary">
            Reset your entire agent configuration to factory defaults. This will delete all custom sub-agents, Lambda tools (except Pathfinder), and restore the default supervisor configuration.
          </Box>
          <Button
            variant="primary"
            onClick={() => setShowResetModal(true)}
            formAction="none"
          >
            <span style={{ color: 'white' }}>Reset Configuration</span>
          </Button>
        </SpaceBetween>
      </Container>

      {/* Reset Configuration Confirmation Modal */}
      <Modal
        visible={showResetModal}
        onDismiss={() => setShowResetModal(false)}
        header="Reset Configuration"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowResetModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleResetConfiguration}
                loading={resetting}
              >
                Reset
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning">
          This will permanently delete all your custom sub-agents, Lambda tool functions (except
          Pathfinder), Gateway targets, and reset the supervisor to defaults. This action cannot be undone.
        </Alert>
      </Modal>
    </SpaceBetween>
  );
}
