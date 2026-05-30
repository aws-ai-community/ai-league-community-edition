import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { loadConfig } from '../config';

export interface AuthUser {
  email: string;
  sub: string;
  [key: string]: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function extractUserFromSession(session: CognitoUserSession): AuthUser {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload();

  const user: AuthUser = {
    email: payload['email'] ?? '',
    sub: payload['sub'] ?? '',
  };

  for (const key of Object.keys(payload)) {
    if (key.startsWith('custom:')) {
      user[key] = payload[key];
    }
  }

  return user;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userPoolRef = useRef<CognitoUserPool | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const config = await loadConfig();
        const pool = new CognitoUserPool({
          UserPoolId: config.Auth.Cognito.userPoolId,
          ClientId: config.Auth.Cognito.userPoolClientId,
        });
        userPoolRef.current = pool;

        const cognitoUser = pool.getCurrentUser();
        if (!cognitoUser) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
          if (cancelled) return;
          if (err || !session || !session.isValid()) {
            setUser(null);
          } else {
            setUser(extractUserFromSession(session));
          }
          setIsLoading(false);
        });
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const pool = userPoolRef.current;
    if (!pool) {
      setUser(null);
      return;
    }
    const cognitoUser = pool.getCurrentUser();
    if (!cognitoUser) {
      setUser(null);
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        cognitoUser.globalSignOut({
          onSuccess: () => resolve(),
          onFailure: (err: Error) => reject(err),
        });
      });
    } catch {
      // Global sign-out failed (expired session, network error, etc.)
      // Fall back to local sign-out which clears local storage
      cognitoUser.signOut();
    }

    setUser(null);
  }, []);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const pool = userPoolRef.current;
    if (!pool) throw new Error('Auth not initialized');
    const cognitoUser = pool.getCurrentUser();
    if (!cognitoUser) {
      throw new Error('No authenticated user');
    }

    return new Promise<string>((resolve, reject) => {
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          reject(err ?? new Error('Session is invalid'));
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<void> => {
    const pool = userPoolRef.current;
    if (!pool) throw new Error('Auth not initialized');
    const cognitoUser = pool.getCurrentUser();
    if (!cognitoUser) {
      throw new Error('No authenticated user');
    }

    return new Promise<void>((resolve, reject) => {
      cognitoUser.getSession((sessionErr: Error | null, session: CognitoUserSession | null) => {
        if (sessionErr || !session || !session.isValid()) {
          reject(sessionErr ?? new Error('Session is invalid'));
          return;
        }

        cognitoUser.changePassword(oldPassword, newPassword, (err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    signOut,
    getAccessToken,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
