import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FineTuningPage from '../FineTuningPage';

// Mock the graphqlClient module
vi.mock('../../../services/graphqlClient', () => ({
  getTrainingArtifactUrl: vi.fn(),
  registerCustomModel: vi.fn(),
}));

import { registerCustomModel } from '../../../services/graphqlClient';

const mockRegisterCustomModel = vi.mocked(registerCustomModel);

describe('FineTuningPage', () => {
  it('renders the page header with title', () => {
    render(<FineTuningPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fine-Tuning');
  });

  it('renders the workflow overview section', () => {
    render(<FineTuningPage />);
    expect(screen.getByRole('heading', { name: /How It Works/i })).toBeInTheDocument();
  });

  it('displays all five workflow steps', () => {
    const { container } = render(<FineTuningPage />);
    const content = container.textContent;

    expect(content).toContain('Step 1');
    expect(content).toContain('Download Sample Data');
    expect(content).toContain('Step 2');
    expect(content).toContain('Train in SageMaker');
    expect(content).toContain('Step 3');
    expect(content).toContain('Register Model');
    expect(content).toContain('Step 4');
    expect(content).toContain('Deploy for Inference');
    expect(content).toContain('Step 5');
    expect(content).toContain('Use in Agent Builder');
  });

  it('displays step descriptions', () => {
    const { container } = render(<FineTuningPage />);
    const content = container.textContent;

    expect(content).toContain('Download sample training datasets');
    expect(content).toContain('SageMaker console');
    expect(content).toContain('Register your completed SageMaker training job');
    expect(content).toContain('Deploy your registered model');
    expect(content).toContain('Select your deployed custom model in the Agent Builder');
  });

  describe('Custom Model Registration Form', () => {
    it('renders the registration form with model name and ARN fields', () => {
      render(<FineTuningPage />);
      expect(screen.getByRole('heading', { name: /Register Custom Model/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/Model Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Training Job ARN/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Register Model/i })).toBeInTheDocument();
    });

    it('shows validation error when model name is empty', async () => {
      render(<FineTuningPage />);
      const submitButton = screen.getByRole('button', { name: /Register Model/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Model name is required.')).toBeInTheDocument();
      });
    });

    it('shows validation error when ARN is empty', async () => {
      render(<FineTuningPage />);
      const modelNameInput = screen.getByLabelText(/Model Name/i);
      fireEvent.change(modelNameInput, { target: { value: 'My Model' } });

      const submitButton = screen.getByRole('button', { name: /Register Model/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Training Job ARN is required.')).toBeInTheDocument();
      });
    });

    it('shows validation error for invalid ARN format', async () => {
      render(<FineTuningPage />);
      const modelNameInput = screen.getByLabelText(/Model Name/i);
      fireEvent.change(modelNameInput, { target: { value: 'My Model' } });

      const arnInput = screen.getByLabelText(/Training Job ARN/i);
      fireEvent.change(arnInput, { target: { value: 'invalid-arn' } });

      const submitButton = screen.getByRole('button', { name: /Register Model/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Invalid ARN format/)).toBeInTheDocument();
      });
    });

    it('calls registerCustomModel on valid submission and shows success flash', async () => {
      mockRegisterCustomModel.mockResolvedValueOnce({
        RegisterCustomModel: {
          modelId: 'test-model-id',
          userId: 'user-123',
          name: 'My Model',
          trainingJobArn: 'arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job',
          deploymentArn: null,
          status: 'Registered',
          baseModelId: null,
          failureReason: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      });

      render(<FineTuningPage />);
      const modelNameInput = screen.getByLabelText(/Model Name/i);
      fireEvent.change(modelNameInput, { target: { value: 'My Model' } });

      const arnInput = screen.getByLabelText(/Training Job ARN/i);
      fireEvent.change(arnInput, { target: { value: 'arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job' } });

      const submitButton = screen.getByRole('button', { name: /Register Model/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockRegisterCustomModel).toHaveBeenCalledWith(
          'My Model',
          'arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job'
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/registered successfully/)).toBeInTheDocument();
      });
    });

    it('shows error flash when registration fails', async () => {
      mockRegisterCustomModel.mockRejectedValueOnce(new Error('Training job not found'));

      render(<FineTuningPage />);
      const modelNameInput = screen.getByLabelText(/Model Name/i);
      fireEvent.change(modelNameInput, { target: { value: 'My Model' } });

      const arnInput = screen.getByLabelText(/Training Job ARN/i);
      fireEvent.change(arnInput, { target: { value: 'arn:aws:sagemaker:us-east-1:123456789012:training-job/my-job' } });

      const submitButton = screen.getByRole('button', { name: /Register Model/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Training job not found/)).toBeInTheDocument();
      });
    });
  });
});
