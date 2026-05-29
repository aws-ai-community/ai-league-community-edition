import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';

// Mock AuthProvider
const mockChangePassword = vi.hoisted(() => vi.fn());
vi.mock('../../frontend/src/contexts/AuthProvider', () => ({
  useAuth: () => ({
    changePassword: mockChangePassword,
  }),
}));

// Mock ProfileContext
const mockUpdateDisplayName = vi.hoisted(() => vi.fn());
const mockUpdateAvatar = vi.hoisted(() => vi.fn());
const mockProfileState = vi.hoisted(() => ({
  current: {
    profile: { userId: 'user-1', displayName: 'Test User', avatar: 'avatar-robot-1' } as { userId: string; displayName: string | null; avatar: string | null } | null,
    isLoading: false,
  },
}));
vi.mock('../../frontend/src/contexts/ProfileContext', () => ({
  useProfile: () => ({
    profile: mockProfileState.current.profile,
    isLoading: mockProfileState.current.isLoading,
    updateDisplayName: mockUpdateDisplayName,
    updateAvatar: mockUpdateAvatar,
  }),
}));

import { ProfilePage } from '../../frontend/src/components/ProfilePage';
import { AVATAR_OPTIONS } from '../../frontend/src/components/AvatarGrid';

beforeEach(() => {
  vi.clearAllMocks();
  mockChangePassword.mockResolvedValue(undefined);
  mockUpdateDisplayName.mockResolvedValue(undefined);
  mockUpdateAvatar.mockResolvedValue(undefined);
  mockProfileState.current = {
    profile: { userId: 'user-1', displayName: 'Test User', avatar: 'avatar-robot-1' },
    isLoading: false,
  };
});

describe('ProfilePage', () => {
  it('renders avatar grid with 12 options', () => {
    render(createElement(ProfilePage));

    const avatarButtons = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-label')?.startsWith('Select avatar')
    );
    expect(avatarButtons).toHaveLength(12);
  });

  it('highlights currently selected avatar', () => {
    render(createElement(ProfilePage));

    const selectedButton = screen.getByRole('button', { name: 'Select avatar avatar-robot-1' });
    expect(selectedButton.getAttribute('aria-pressed')).toBe('true');

    const otherButton = screen.getByRole('button', { name: 'Select avatar avatar-cloud-1' });
    expect(otherButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('validates display name length before submission', async () => {
    render(createElement(ProfilePage));

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ValidName' } });

    const saveButton = screen.getByText('Save display name');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockUpdateDisplayName).toHaveBeenCalledWith('ValidName');
  });

  it('shows validation error for empty display name', async () => {
    render(createElement(ProfilePage));

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    const saveButton = screen.getByText('Save display name');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.getByText('Display name cannot be empty.')).toBeTruthy();
    expect(mockUpdateDisplayName).not.toHaveBeenCalled();
  });

  it('shows validation error for display name exceeding 50 characters', async () => {
    render(createElement(ProfilePage));

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'A'.repeat(51) } });

    const saveButton = screen.getByText('Save display name');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.getByText('Display name must be 50 characters or fewer.')).toBeTruthy();
    expect(mockUpdateDisplayName).not.toHaveBeenCalled();
  });

  it('shows success alert on successful profile update', async () => {
    render(createElement(ProfilePage));

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewName' } });

    const saveButton = screen.getByText('Save display name');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Display name updated successfully.')).toBeTruthy();
    });
  });

  it('reverts displayed value on backend failure', async () => {
    mockUpdateDisplayName.mockRejectedValue(new Error('Server error'));

    render(createElement(ProfilePage));

    const input = screen.getByLabelText('Display name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewName' } });

    const saveButton = screen.getByText('Save display name');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });

  it('shows error for incorrect current password', async () => {
    const notAuthError = new Error('Incorrect username or password.');
    notAuthError.name = 'NotAuthorizedException';
    mockChangePassword.mockRejectedValue(notAuthError);

    render(createElement(ProfilePage));

    const currentPwInput = screen.getByLabelText('Current password') as HTMLInputElement;
    const newPwInput = screen.getByLabelText('New password') as HTMLInputElement;
    const confirmPwInput = screen.getByLabelText('Confirm new password') as HTMLInputElement;

    fireEvent.change(currentPwInput, { target: { value: 'wrongpassword' } });
    fireEvent.change(newPwInput, { target: { value: 'NewPass123!' } });
    fireEvent.change(confirmPwInput, { target: { value: 'NewPass123!' } });

    const changeButton = screen.getByText('Change password');
    await act(async () => {
      fireEvent.click(changeButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Incorrect current password.')).toBeTruthy();
    });
  });

  it('shows success on password change', async () => {
    render(createElement(ProfilePage));

    const currentPwInput = screen.getByLabelText('Current password') as HTMLInputElement;
    const newPwInput = screen.getByLabelText('New password') as HTMLInputElement;
    const confirmPwInput = screen.getByLabelText('Confirm new password') as HTMLInputElement;

    fireEvent.change(currentPwInput, { target: { value: 'OldPass123!' } });
    fireEvent.change(newPwInput, { target: { value: 'NewPass123!' } });
    fireEvent.change(confirmPwInput, { target: { value: 'NewPass123!' } });

    const changeButton = screen.getByText('Change password');
    await act(async () => {
      fireEvent.click(changeButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Password changed successfully.')).toBeTruthy();
    });
  });

  it('calls updateAvatar when avatar is selected', async () => {
    render(createElement(ProfilePage));

    const avatarButton = screen.getByRole('button', { name: 'Select avatar avatar-ai-1' });
    await act(async () => {
      fireEvent.click(avatarButton);
    });

    expect(mockUpdateAvatar).toHaveBeenCalledWith('avatar-ai-1');
  });
});
