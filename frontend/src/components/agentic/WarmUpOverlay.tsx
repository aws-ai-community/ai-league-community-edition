import React from 'react';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';

import { WarmUpState } from '../../hooks/useModelWarmup';

interface WarmUpOverlayProps {
  state: WarmUpState;
  onCancel: () => void;
  onProceedAnyway: () => void;
}

export function WarmUpOverlay({ state, onCancel, onProceedAnyway }: WarmUpOverlayProps): React.ReactElement {
  const { phase, elapsedSeconds, errorMessage } = state;

  const isVisible = phase === 'warming' || phase === 'timeout' || phase === 'error';

  const renderContent = () => {
    if (phase === 'warming') {
      return (
        <SpaceBetween size="m">
          <Box textAlign="center">
            <SpaceBetween size="s" direction="vertical" alignItems="center">
              <Spinner size="large" />
              <Box variant="p">Warming up your fine-tuned model...</Box>
              <Box variant="small" color="text-body-secondary">
                Elapsed: {elapsedSeconds}s
              </Box>
            </SpaceBetween>
          </Box>
        </SpaceBetween>
      );
    }

    if (phase === 'timeout') {
      return (
        <SpaceBetween size="m">
          <Alert type="warning">
            Your model did not respond in time. It may be slow during gameplay.
          </Alert>
        </SpaceBetween>
      );
    }

    if (phase === 'error') {
      return (
        <SpaceBetween size="m">
          <Alert type="error">
            {errorMessage || 'An unexpected error occurred during warm-up.'}
          </Alert>
        </SpaceBetween>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (phase === 'warming') {
      return (
        <Box float="right">
          <Button variant="link" onClick={onCancel}>
            Cancel
          </Button>
        </Box>
      );
    }

    if (phase === 'timeout' || phase === 'error') {
      return (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onProceedAnyway}>
              Proceed Anyway
            </Button>
          </SpaceBetween>
        </Box>
      );
    }

    return undefined;
  };

  return (
    <Modal
      visible={isVisible}
      onDismiss={onCancel}
      header="Model Warm-Up"
      footer={renderFooter()}
    >
      {renderContent()}
    </Modal>
  );
}

export default WarmUpOverlay;
