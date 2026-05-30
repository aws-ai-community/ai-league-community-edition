import { useState, useCallback, useEffect } from 'react';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import { useAuth } from '../contexts/AuthProvider';
import { useProfile } from '../contexts/ProfileContext';
import { AvatarGrid, type AvatarId } from './AvatarGrid';

export interface ProfilePageProps {
  apiBaseUrl?: string;
}

export function ProfilePage(_props: ProfilePageProps) {
  const { changePassword } = useAuth();
  const { profile, isLoading: isLoadingProfile, updateDisplayName, updateAvatar } = useProfile();

  // Display name form state
  const [displayName, setDisplayName] = useState('');
  const [displayNameInitialized, setDisplayNameInitialized] = useState(false);
  const [displayNameError, setDisplayNameError] = useState('');
  const [displayNameSuccess, setDisplayNameSuccess] = useState('');
  const [isSubmittingDisplayName, setIsSubmittingDisplayName] = useState(false);

  // Avatar state
  const [avatarSuccess, setAvatarSuccess] = useState('');
  const [avatarError, setAvatarError] = useState('');

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Initialize display name from profile once loaded
  useEffect(() => {
    if (profile && !displayNameInitialized) {
      setDisplayName(profile.displayName ?? '');
      setDisplayNameInitialized(true);
    }
  }, [profile, displayNameInitialized]);

  // Avatar selection handler
  const handleAvatarSelect = useCallback(async (avatarId: AvatarId) => {
    setAvatarError('');
    setAvatarSuccess('');

    try {
      await updateAvatar(avatarId);
      setAvatarSuccess('Avatar updated successfully.');
    } catch {
      setAvatarError('Failed to update avatar. Please try again.');
    }
  }, [updateAvatar]);

  // Display name validation
  function validateDisplayName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return 'Display name cannot be empty.';
    }
    if (trimmed.length > 50) {
      return 'Display name must be 50 characters or fewer.';
    }
    return '';
  }

  // Display name submit handler
  const handleDisplayNameSubmit = useCallback(async () => {
    setDisplayNameError('');
    setDisplayNameSuccess('');

    const validationError = validateDisplayName(displayName);
    if (validationError) {
      setDisplayNameError(validationError);
      return;
    }

    setIsSubmittingDisplayName(true);
    try {
      await updateDisplayName(displayName.trim());
      setDisplayNameSuccess('Display name updated successfully.');
    } catch (err) {
      setDisplayNameError(err instanceof Error ? err.message : 'Failed to update display name.');
    } finally {
      setIsSubmittingDisplayName(false);
    }
  }, [displayName, updateDisplayName]);

  // Password submit handler
  const handlePasswordSubmit = useCallback(async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setIsSubmittingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAuthorizedException' || err.message.includes('Incorrect')) {
          setPasswordError('Incorrect current password.');
        } else if (err.name === 'InvalidPasswordException' || err.message.includes('password policy')) {
          setPasswordError(err.message);
        } else {
          setPasswordError(err.message);
        }
      } else {
        setPasswordError('Failed to change password. Please try again.');
      }
    } finally {
      setIsSubmittingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword, changePassword]);

  if (isLoadingProfile) {
    return (
      <Container header={<Header variant="h1">Profile</Header>}>
        <SpaceBetween size="l">
          <Box variant="p">Loading profile...</Box>
        </SpaceBetween>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      {/* Avatar Section */}
      <Container header={<Header variant="h2">Avatar</Header>}>
        <SpaceBetween size="m">
          {avatarSuccess && (
            <Alert type="success" dismissible onDismiss={() => setAvatarSuccess('')}>
              {avatarSuccess}
            </Alert>
          )}
          {avatarError && (
            <Alert type="error" dismissible onDismiss={() => setAvatarError('')}>
              {avatarError}
            </Alert>
          )}
          <AvatarGrid selectedAvatar={profile?.avatar ?? null} onSelect={handleAvatarSelect} />
        </SpaceBetween>
      </Container>

      {/* Display Name Section */}
      <Container header={<Header variant="h2">Display Name</Header>}>
        <SpaceBetween size="m">
          {displayNameSuccess && (
            <Alert type="success" dismissible onDismiss={() => setDisplayNameSuccess('')}>
              {displayNameSuccess}
            </Alert>
          )}
          {displayNameError && (
            <Alert type="error" dismissible onDismiss={() => setDisplayNameError('')}>
              {displayNameError}
            </Alert>
          )}
          <FormField
            label="Display name"
            description="Choose a display name between 1 and 50 characters."
          >
            <Input
              value={displayName}
              onChange={({ detail }) => setDisplayName(detail.value)}
              placeholder="Enter display name"
              ariaLabel="Display name"
            />
          </FormField>
          <Button
            variant="primary"
            onClick={handleDisplayNameSubmit}
            loading={isSubmittingDisplayName}
          >
            Save display name
          </Button>
        </SpaceBetween>
      </Container>

      {/* Password Change Section */}
      <Container header={<Header variant="h2">Change Password</Header>}>
        <SpaceBetween size="m">
          {passwordSuccess && (
            <Alert type="success" dismissible onDismiss={() => setPasswordSuccess('')}>
              {passwordSuccess}
            </Alert>
          )}
          {passwordError && (
            <Alert type="error" dismissible onDismiss={() => setPasswordError('')}>
              {passwordError}
            </Alert>
          )}
          <FormField label="Current password">
            <Input
              type="password"
              value={currentPassword}
              onChange={({ detail }) => setCurrentPassword(detail.value)}
              placeholder="Enter current password"
              ariaLabel="Current password"
            />
          </FormField>
          <FormField label="New password">
            <Input
              type="password"
              value={newPassword}
              onChange={({ detail }) => setNewPassword(detail.value)}
              placeholder="Enter new password"
              ariaLabel="New password"
            />
          </FormField>
          <FormField label="Confirm new password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={({ detail }) => setConfirmPassword(detail.value)}
              placeholder="Confirm new password"
              ariaLabel="Confirm new password"
            />
          </FormField>
          <Button
            variant="primary"
            onClick={handlePasswordSubmit}
            loading={isSubmittingPassword}
          >
            Change password
          </Button>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
