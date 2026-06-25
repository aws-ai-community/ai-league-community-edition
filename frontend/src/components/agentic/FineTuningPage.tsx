import { useState, useCallback, useEffect, useRef } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import Alert from '@cloudscape-design/components/alert';
import {
  getTrainingArtifactUrl,
  registerCustomModel,
  listCustomModels,
  deployCustomModel,
  deleteCustomModel,
  undeployCustomModel,
  getCustomModelStatus,
  getStudioPresignedUrl,
  CustomModelResponse,
} from '../../services/graphqlClient';

// --- Token Penalty Reduction Schedule ---

interface PenaltyReductionRow {
  customModelsUsed: string;
  reduction: string;
}

const TOKEN_PENALTY_REDUCTION_ITEMS: PenaltyReductionRow[] = [
  { customModelsUsed: '0', reduction: '0% (baseline)' },
  { customModelsUsed: '1', reduction: '50%' },
  { customModelsUsed: '2', reduction: '70%' },
  { customModelsUsed: '3', reduction: '85%' },
  { customModelsUsed: '4', reduction: '92%' },
  { customModelsUsed: '5', reduction: '95%' },
];

// --- Workflow Steps ---

interface WorkflowStep {
  number: number;
  title: string;
  description: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    number: 1,
    title: 'Download Sample Data',
    description: 'Download sample training datasets, evaluation data, and reward functions as starting points for fine-tuning.',
  },
  {
    number: 2,
    title: 'Train in SageMaker',
    description: 'Use the SageMaker console to create and run a fine-tuning training job with your data.',
  },
  {
    number: 3,
    title: 'Register Model',
    description: 'Register your completed SageMaker training job as a custom model in the application.',
  },
  {
    number: 4,
    title: 'Deploy for Inference',
    description: 'Deploy your registered model via Bedrock Custom Model Deployments for inference.',
  },
  {
    number: 5,
    title: 'Use in Agent Builder',
    description: 'Select your deployed custom model in the Agent Builder to use it with your agents and earn scoring bonuses.',
  },
];

// --- Component ---

interface ArtifactDownload {
  label: string;
  artifactKey: string;
  description: string;
}

const SAMPLE_ARTIFACTS: ArtifactDownload[] = [
  { label: 'Tool Call Training Data', artifactKey: 'tool-call-training.jsonl', description: 'JSONL training data for tool calling (500 entries)' },
  { label: 'Tool Call Eval Data', artifactKey: 'tool-call-eval.jsonl', description: 'JSONL evaluation data for tool calling (100 entries)' },
  { label: 'Faithfulness Training Data', artifactKey: 'faithfulness-training.jsonl', description: 'JSONL training data for faithfulness (403 entries)' },
  { label: 'Faithfulness Eval Data', artifactKey: 'faithfulness-eval.jsonl', description: 'JSONL evaluation data for faithfulness (81 entries)' },
  { label: 'Tool Call Reward Function', artifactKey: 'reward-function-tool-call.py', description: 'Python reward function for tool calling' },
  { label: 'Faithfulness Reward Function', artifactKey: 'reward-function-faithfulness.py', description: 'Python reward function for faithfulness' },
];

const TRAINING_JOB_ARN_PATTERN = /^arn:aws:sagemaker:[a-z0-9-]+:\d{12}:training-job\/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?$/;

export default function FineTuningPage() {
  const [downloadingArtifact, setDownloadingArtifact] = useState<string | null>(null);
  const [openingStudio, setOpeningStudio] = useState(false);

  // Registration form state
  const [modelName, setModelName] = useState('');
  const [trainingJobArn, setTrainingJobArn] = useState('');
  const [modelNameError, setModelNameError] = useState('');
  const [arnError, setArnError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  // Custom models table state
  const [customModels, setCustomModels] = useState<CustomModelResponse[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [deployingModelId, setDeployingModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [undeployingModelId, setUndeployingModelId] = useState<string | null>(null);

  // Polling ref for deploying models
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Load custom models on mount
  const loadCustomModels = useCallback(async () => {
    try {
      const response = await listCustomModels();
      setCustomModels(response.ListCustomModels || []);
    } catch (error) {
      console.error('Failed to load custom models:', error);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadCustomModels();
  }, [loadCustomModels]);

  // Poll status for deploying models every 10 seconds
  useEffect(() => {
    const deployingModels = customModels.filter((m) => m.status === 'Deploying');

    if (deployingModels.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(async () => {
      let updated = false;
      for (const model of deployingModels) {
        try {
          const statusRes = await getCustomModelStatus(model.modelId);
          const updatedModel = statusRes.GetCustomModelStatus;
          if (updatedModel && updatedModel.status !== 'Deploying') {
            updated = true;
          }
        } catch {
          // Ignore polling errors
        }
      }
      if (updated) {
        await loadCustomModels();
      }
    }, 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [customModels, loadCustomModels]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  const handleRegisterModel = async () => {
    // Client-side validation
    let hasError = false;

    if (!modelName.trim()) {
      setModelNameError('Model name is required.');
      hasError = true;
    } else {
      setModelNameError('');
    }

    if (!trainingJobArn.trim()) {
      setArnError('Training Job ARN is required.');
      hasError = true;
    } else if (!TRAINING_JOB_ARN_PATTERN.test(trainingJobArn.trim())) {
      setArnError('Invalid ARN format. Expected: arn:aws:sagemaker:{region}:{account}:training-job/{job-name}');
      hasError = true;
    } else {
      setArnError('');
    }

    if (hasError) return;

    setRegistering(true);
    try {
      await registerCustomModel(modelName.trim(), trainingJobArn.trim());
      addFlash('success', `Model "${modelName.trim()}" registered successfully.`);
      setModelName('');
      setTrainingJobArn('');
      setModelNameError('');
      setArnError('');
      // Refresh the custom models table
      await loadCustomModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      addFlash('error', `Failed to register model: ${message}`);
    } finally {
      setRegistering(false);
    }
  };

  const handleOpenStudio = async () => {
    setOpeningStudio(true);
    try {
      const response = await getStudioPresignedUrl();
      const url = response.GetStudioPresignedUrl.url;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        addFlash('error', response.GetStudioPresignedUrl.error || 'Failed to generate Studio URL');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open SageMaker Studio';
      addFlash('error', message);
    } finally {
      setOpeningStudio(false);
    }
  };

  const handleDownloadArtifact = async (artifactKey: string) => {
    setDownloadingArtifact(artifactKey);
    try {
      const response = await getTrainingArtifactUrl(artifactKey);
      const url = response.GetTrainingArtifactUrl.url;
      // S3 presigned URL includes ResponseContentDisposition=attachment header
      // which forces the browser to download instead of displaying
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error(`Failed to download artifact ${artifactKey}:`, error);
    } finally {
      setDownloadingArtifact(null);
    }
  };

  const handleDeployModel = async (modelId: string) => {
    setDeployingModelId(modelId);
    try {
      await deployCustomModel(modelId);
      addFlash('success', 'Model deployment initiated successfully.');
      await loadCustomModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      addFlash('error', `Failed to deploy model: ${message}`);
    } finally {
      setDeployingModelId(null);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    setDeletingModelId(modelId);
    try {
      const response = await deleteCustomModel(modelId);
      if (response.DeleteCustomModel.success) {
        addFlash('success', 'Model deleted successfully.');
        await loadCustomModels();
      } else {
        addFlash('error', `Failed to delete model: ${response.DeleteCustomModel.message || 'Unknown error'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      addFlash('error', `Failed to delete model: ${message}`);
    } finally {
      setDeletingModelId(null);
    }
  };

  const handleUndeployModel = async (modelId: string) => {
    setUndeployingModelId(modelId);
    try {
      const response = await undeployCustomModel(modelId);
      if (response.UndeployCustomModel.success) {
        addFlash('success', 'Model undeployed successfully.');
        await loadCustomModels();
      } else if (response.UndeployCustomModel.statusCode === 409) {
        addFlash('error', response.UndeployCustomModel.message || 'Model is currently in use by agent configurations.');
      } else {
        addFlash('error', `Failed to undeploy model: ${response.UndeployCustomModel.message || 'Unknown error'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      addFlash('error', `Failed to undeploy model: ${message}`);
    } finally {
      setUndeployingModelId(null);
    }
  };
  return (
    <SpaceBetween size="l">
      <Header variant="h1" description="Create and deploy custom fine-tuned models to optimize your agent's performance and earn token penalty reduction bonuses.">
        Fine-Tuning
      </Header>

      {/* Cost Warning */}
      <Alert type="warning" header="Cost Warning">
        Fine-tuning models on SageMaker costs $80/hour. These costs may be covered by AWS credits if they are applied to your account.
      </Alert>

      {/* Workflow Overview */}
      <Container header={<Header variant="h2">How It Works</Header>}>
        <Table
          columnDefinitions={[
            {
              id: 'step',
              header: 'Step',
              cell: (item: WorkflowStep) => item.number,
              width: 80,
            },
            {
              id: 'title',
              header: 'Title',
              cell: (item: WorkflowStep) => <Box fontWeight="bold">{item.title}</Box>,
              width: 200,
            },
            {
              id: 'description',
              header: 'Description',
              cell: (item: WorkflowStep) => item.description,
            },
          ]}
          items={WORKFLOW_STEPS}
          variant="embedded"
        />
      </Container>

      {/* SageMaker Console Link and Sample Artifacts */}
      <Container header={<Header variant="h2" description="Open the SageMaker console to create training jobs, and download sample artifacts to get started.">Training Resources</Header>}>
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            <Box variant="h3">SageMaker Console</Box>
            <Box variant="p" color="text-body-secondary">
              Create and manage your fine-tuning training jobs directly in the SageMaker console.
            </Box>
            <Button
              variant="primary"
              iconName="external"
              onClick={handleOpenStudio}
              loading={openingStudio}
            >
              Open SageMaker Studio
            </Button>
            <Box variant="small" color="text-body-secondary">
              If you see an "Invalid or Expired Auth Token" error, you may need to add <code>{window.location.origin}</code> to your browser's list of sites allowed to use third-party cookies.
            </Box>
            <Box variant="small" color="text-body-secondary">
              You may need to request a quota increase for "Maximum number of concurrent model customization serverless jobs per Region" in your deployment region before submitting a training job.
            </Box>
          </SpaceBetween>

          <SpaceBetween size="m">
            <Box variant="h3">Sample Artifacts</Box>
            <Box variant="p" color="text-body-secondary">
              Download sample training data, evaluation data, and reward functions as starting points for your fine-tuning jobs.
            </Box>
            <SpaceBetween size="s">
              <Box variant="small" color="text-body-secondary" fontWeight="bold">Tool Call</Box>
              <SpaceBetween size="xs" direction="horizontal">
                <Button iconName="download" loading={downloadingArtifact === 'tool-call-training.jsonl'} onClick={() => handleDownloadArtifact('tool-call-training.jsonl')}>Training (500)</Button>
                <Button iconName="download" loading={downloadingArtifact === 'tool-call-eval.jsonl'} onClick={() => handleDownloadArtifact('tool-call-eval.jsonl')}>Evaluation (100)</Button>
                <Button iconName="download" loading={downloadingArtifact === 'reward-function-tool-call.py'} onClick={() => handleDownloadArtifact('reward-function-tool-call.py')}>Reward Function</Button>
              </SpaceBetween>
              <Box variant="small" color="text-body-secondary" fontWeight="bold">Faithfulness</Box>
              <SpaceBetween size="xs" direction="horizontal">
                <Button iconName="download" loading={downloadingArtifact === 'faithfulness-training.jsonl'} onClick={() => handleDownloadArtifact('faithfulness-training.jsonl')}>Training (403)</Button>
                <Button iconName="download" loading={downloadingArtifact === 'faithfulness-eval.jsonl'} onClick={() => handleDownloadArtifact('faithfulness-eval.jsonl')}>Evaluation (81)</Button>
                <Button iconName="download" loading={downloadingArtifact === 'reward-function-faithfulness.py'} onClick={() => handleDownloadArtifact('reward-function-faithfulness.py')}>Reward Function</Button>
              </SpaceBetween>
            </SpaceBetween>
          </SpaceBetween>
        </SpaceBetween>
      </Container>

      {/* Token Penalty Reduction Table */}
      <Container
        header={
          <Header
            variant="h2"
            description="Using custom fine-tuned models reduces the token consumption penalty on your leaderboard scores. The more custom models you use in your agent configuration, the greater the reduction."
          >
            Token Penalty Reduction
          </Header>
        }
      >
        <Table
          columnDefinitions={[
            {
              id: 'customModelsUsed',
              header: 'Custom Models Used',
              cell: (item: PenaltyReductionRow) => item.customModelsUsed,
            },
            {
              id: 'reduction',
              header: 'Token Penalty Reduction',
              cell: (item: PenaltyReductionRow) => item.reduction,
            },
          ]}
          items={TOKEN_PENALTY_REDUCTION_ITEMS}
          variant="embedded"
        />
        <Box variant="p" color="text-body-secondary" padding={{ top: 's' }}>
          The first customized model gives you the biggest jump — a 50% reduction in your token penalty. Additional models provide diminishing but still meaningful returns.
        </Box>
      </Container>

      {/* Flash notifications */}
      <Flashbar items={flashItems} />

      {/* Custom Model Registration Form */}
      <Container
        header={
          <Header
            variant="h2"
            description="Register a completed SageMaker training job as a custom model to deploy and use with your agents."
          >
            Register Custom Model
          </Header>
        }
      >
        <SpaceBetween size="l">
          <FormField
            label="Model Name"
            errorText={modelNameError}
          >
            <Input
              value={modelName}
              onChange={({ detail }) => {
                setModelName(detail.value);
                if (modelNameError) setModelNameError('');
              }}
              placeholder="Enter a name for your custom model"
            />
          </FormField>
          <FormField
            label="Training Job ARN"
            errorText={arnError}
            constraintText="Format: arn:aws:sagemaker:{region}:{account-id}:training-job/{job-name}"
          >
            <Input
              value={trainingJobArn}
              onChange={({ detail }) => {
                setTrainingJobArn(detail.value);
                if (arnError) setArnError('');
              }}
              placeholder="arn:aws:sagemaker:us-east-1:123456789012:training-job/my-fine-tuning-job"
            />
          </FormField>
          <Button
            variant="primary"
            onClick={handleRegisterModel}
            loading={registering}
          >
            Register Model
          </Button>
        </SpaceBetween>
      </Container>

      {/* Custom Models Table */}
      <Container
        header={
          <Header
            variant="h2"
            description="View and manage your registered custom models. Deploy models to use them in your agent configurations."
            counter={`(${customModels.length})`}
          >
            Custom Models
          </Header>
        }
      >
        <Table
          columnDefinitions={[
            {
              id: 'name',
              header: 'Name',
              cell: (item: CustomModelResponse) => item.name,
            },
            {
              id: 'trainingJobArn',
              header: 'Training Job ARN',
              cell: (item: CustomModelResponse) => item.trainingJobArn,
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item: CustomModelResponse) => {
                switch (item.status) {
                  case 'Registered':
                    return <StatusIndicator type="info">Registered</StatusIndicator>;
                  case 'Deploying':
                    return <StatusIndicator type="loading">Deploying</StatusIndicator>;
                  case 'Deployed':
                    return <StatusIndicator type="success">Deployed</StatusIndicator>;
                  case 'Failed':
                    return <StatusIndicator type="error">Failed</StatusIndicator>;
                  default:
                    return <StatusIndicator type="info">{item.status}</StatusIndicator>;
                }
              },
            },
            {
              id: 'actions',
              header: 'Actions',
              cell: (item: CustomModelResponse) => (
                <SpaceBetween size="xs" direction="horizontal">
                  {(item.status === 'Registered' || item.status === 'Failed') && (
                    <Button
                      variant="normal"
                      onClick={() => handleDeployModel(item.modelId)}
                      loading={deployingModelId === item.modelId}
                    >
                      Deploy
                    </Button>
                  )}
                  {item.status === 'Deployed' && (
                    <Button
                      variant="normal"
                      onClick={() => handleUndeployModel(item.modelId)}
                      loading={undeployingModelId === item.modelId}
                    >
                      Undeploy
                    </Button>
                  )}
                  <Button
                    variant="normal"
                    onClick={() => handleDeleteModel(item.modelId)}
                    loading={deletingModelId === item.modelId}
                    disabled={item.status === 'Deployed' || item.status === 'Deploying'}
                  >
                    Delete
                  </Button>
                </SpaceBetween>
              ),
            },
          ]}
          items={customModels}
          loading={loadingModels}
          loadingText="Loading custom models..."
          empty={
            <Box textAlign="center" color="inherit">
              <b>No custom models</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                Register a SageMaker training job above to get started.
              </Box>
            </Box>
          }
          variant="embedded"
        />
      </Container>

    </SpaceBetween>
  );
}
