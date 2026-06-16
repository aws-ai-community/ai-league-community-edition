import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Alert from '@cloudscape-design/components/alert';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import {
  getLlmConfiguration,
  saveLlmConfiguration,
} from '../../services/graphqlClient';

// Model definitions
interface ModelDefinition {
  modelId: string;
  displayName: string;
  family: string;
  hasCostWarning: boolean;
}

const AVAILABLE_MODELS: ModelDefinition[] = [
  { modelId: 'us.amazon.nova-2-lite-v1:0', displayName: 'Nova 2 Lite', family: 'Amazon Nova', hasCostWarning: false },
  { modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', displayName: 'Claude Haiku 4.5', family: 'Anthropic', hasCostWarning: true },
];

const DEFAULT_MODEL_ID = 'us.amazon.nova-2-lite-v1:0';

const USE_DEFAULT_OPTION: SelectProps.Option = {
  label: 'Use Default',
  value: '__use_default__',
};

function buildModelOptions(): SelectProps.Options {
  const groups: Record<string, SelectProps.Option[]> = {};
  for (const model of AVAILABLE_MODELS) {
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

function buildDefaultModelOptions(): SelectProps.Options {
  const groups: Record<string, SelectProps.Option[]> = {};
  for (const model of AVAILABLE_MODELS) {
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

function buildOverrideOptions(): SelectProps.Options {
  return [
    { label: 'Use Default', value: '__use_default__', options: undefined } as unknown as SelectProps.OptionGroup,
    ...buildModelOptions() as SelectProps.OptionGroup[],
  ];
}

function findModelOption(modelId: string | null): SelectProps.Option | null {
  if (!modelId) return null;
  const model = AVAILABLE_MODELS.find((m) => m.modelId === modelId);
  if (!model) return null;
  return { label: model.displayName, value: model.modelId };
}

function findOverrideOption(modelId: string | null): SelectProps.Option {
  if (!modelId) return USE_DEFAULT_OPTION;
  const model = AVAILABLE_MODELS.find((m) => m.modelId === modelId);
  if (!model) return USE_DEFAULT_OPTION;
  return { label: model.displayName, value: model.modelId };
}

export default function ConfigurationPage() {
  const [defaultModel, setDefaultModel] = useState<SelectProps.Option | null>(
    findModelOption(DEFAULT_MODEL_ID),
  );
  const [challengeGeneration, setChallengeGeneration] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);
  const [challengeGrading, setChallengeGrading] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);
  const [gameCommentary, setGameCommentary] = useState<SelectProps.Option>(USE_DEFAULT_OPTION);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError(null);
      try {
        const result = await getLlmConfiguration();
        if (!cancelled) {
          const config = result.GetLlmConfiguration;
          setDefaultModel(findModelOption(config.defaultModel) ?? findModelOption(DEFAULT_MODEL_ID));
          setChallengeGeneration(findOverrideOption(config.challengeGeneration));
          setChallengeGrading(findOverrideOption(config.challengeGrading));
          setGameCommentary(findOverrideOption(config.gameCommentary));
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
        defaultModel: defaultModel?.value ?? DEFAULT_MODEL_ID,
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
    setDefaultModel(findModelOption(DEFAULT_MODEL_ID));
    setChallengeGeneration(USE_DEFAULT_OPTION);
    setChallengeGrading(USE_DEFAULT_OPTION);
    setGameCommentary(USE_DEFAULT_OPTION);
    setSuccess(null);
  };

  const defaultModelOptions = buildDefaultModelOptions();
  const overrideOptions: SelectProps.Options = [
    USE_DEFAULT_OPTION,
    ...buildModelOptions() as SelectProps.OptionGroup[],
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
    </SpaceBetween>
  );
}
