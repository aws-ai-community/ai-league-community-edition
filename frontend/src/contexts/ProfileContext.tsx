import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { getConfig } from '../config';
import type { AvatarId } from '../components/AvatarGrid';

export interface UserProfile {
  userId: string;
  displayName: string | null;
  avatar: AvatarId | null;
}

interface ProfileContextValue {
  profile: UserProfile | null;
  isLoading: boolean;
  updateDisplayName: (name: string) => Promise<void>;
  updateAvatar: (avatarId: AvatarId) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

function getApiBaseUrl(): string {
  const config = getConfig();
  return config?.API.REST.RestApi.endpoint ?? '';
}

interface ProfileProviderProps {
  children: ReactNode;
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const { isAuthenticated, getAccessToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const token = await getAccessToken();
        const apiUrl = getApiBaseUrl();
        const response = await fetch(`${apiUrl}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to load profile');
        const data = await response.json();
        if (!cancelled) {
          setProfile(data);
        }
      } catch {
        // Profile may not exist yet
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessToken]);

  const updateDisplayName = useCallback(async (name: string) => {
    const token = await getAccessToken();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}/profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: name }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Update failed' }));
      throw new Error(body.error || 'Failed to update display name');
    }
    const updated = await response.json();
    setProfile(updated);
  }, [getAccessToken]);

  const updateAvatar = useCallback(async (avatarId: AvatarId) => {
    const token = await getAccessToken();
    const apiUrl = getApiBaseUrl();
    const response = await fetch(`${apiUrl}/profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ avatar: avatarId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Update failed' }));
      throw new Error(body.error || 'Failed to update avatar');
    }
    const updated = await response.json();
    setProfile(updated);
  }, [getAccessToken]);

  return (
    <ProfileContext.Provider value={{ profile, isLoading, updateDisplayName, updateAvatar }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
