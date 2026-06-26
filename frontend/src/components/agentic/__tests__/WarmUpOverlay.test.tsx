import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WarmUpOverlay } from '../WarmUpOverlay';
import { WarmUpState } from '../../../hooks/useModelWarmup';

function createState(overrides: Partial<WarmUpState> = {}): WarmUpState {
  return {
    phase: 'idle',
    elapsedSeconds: 0,
    models: [],
    ...overrides,
  };
}

describe('WarmUpOverlay', () => {
  const defaultProps = {
    onCancel: vi.fn(),
    onProceedAnyway: vi.fn(),
  };

  it('renders spinner and warming message during warming phase', () => {
    const state = createState({ phase: 'warming', elapsedSeconds: 5 });
    render(<WarmUpOverlay state={state} {...defaultProps} />);

    expect(screen.getByText('Warming up your fine-tuned model...')).toBeInTheDocument();
  });

  it('renders elapsed time text during warming phase', () => {
    const state = createState({ phase: 'warming', elapsedSeconds: 15 });
    render(<WarmUpOverlay state={state} {...defaultProps} />);

    expect(screen.getByText('Elapsed: 15s')).toBeInTheDocument();
  });

  it('renders warning alert on timeout phase', () => {
    const state = createState({ phase: 'timeout', elapsedSeconds: 180 });
    render(<WarmUpOverlay state={state} {...defaultProps} />);

    expect(
      screen.getByText('Your model did not respond in time. It may be slow during gameplay.')
    ).toBeInTheDocument();
  });

  it('"Proceed Anyway" button calls onProceedAnyway', () => {
    const onProceedAnyway = vi.fn();
    const state = createState({ phase: 'timeout', elapsedSeconds: 180 });
    render(<WarmUpOverlay state={state} onCancel={vi.fn()} onProceedAnyway={onProceedAnyway} />);

    const proceedButton = screen.getByRole('button', { name: 'Proceed Anyway' });
    fireEvent.click(proceedButton);

    expect(onProceedAnyway).toHaveBeenCalledTimes(1);
  });

  it('"Cancel" button calls onCancel during warming phase', () => {
    const onCancel = vi.fn();
    const state = createState({ phase: 'warming', elapsedSeconds: 10 });
    render(<WarmUpOverlay state={state} onCancel={onCancel} onProceedAnyway={vi.fn()} />);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('modal is not visible when phase is idle', () => {
    const state = createState({ phase: 'idle' });
    const { container } = render(<WarmUpOverlay state={state} {...defaultProps} />);

    // Cloudscape Modal renders header in DOM but hides the dialog when visible=false
    expect(screen.queryByText('Warming up your fine-tuned model...')).not.toBeInTheDocument();
    // The modal dialog should not have the visible/open state
    const dialog = container.querySelector('[class*="visible"]');
    expect(dialog).toBeNull();
  });

  it('modal is not visible when phase is ready', () => {
    const state = createState({ phase: 'ready' });
    const { container } = render(<WarmUpOverlay state={state} {...defaultProps} />);

    expect(screen.queryByText('Warming up your fine-tuned model...')).not.toBeInTheDocument();
    const dialog = container.querySelector('[class*="visible"]');
    expect(dialog).toBeNull();
  });

  it('renders error alert with errorMessage on error phase', () => {
    const state = createState({
      phase: 'error',
      errorMessage: 'Failed to connect to warm-up service',
    });
    render(<WarmUpOverlay state={state} {...defaultProps} />);

    expect(screen.getByText('Failed to connect to warm-up service')).toBeInTheDocument();
  });
});
