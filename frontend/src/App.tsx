import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import { AuthProvider, useAuth } from './contexts/AuthProvider';
import { ProfileProvider, useProfile } from './contexts/ProfileContext';
import NavigationPanel from './components/NavigationPanel';
import { ProfilePage } from './components/ProfilePage';
import MapBuilderPage from './components/map-builder/MapBuilderPage';
import GameplayPage from './components/agentic/GameplayPage';
import LeaderboardPage from './components/agentic/LeaderboardPage';
import SubmissionHistoryPage from './components/agentic/SubmissionHistoryPage';
import ConfigurationPage from './components/agentic/ConfigurationPage';
import { getConfig } from './config';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = () => {
    setError('');
    setIsLoading(true);

    const config = getConfig();
    if (!config) {
      setError('Application configuration not loaded. Please refresh.');
      setIsLoading(false);
      return;
    }

    const pool = new CognitoUserPool({
      UserPoolId: config.Auth.Cognito.userPoolId,
      ClientId: config.Auth.Cognito.userPoolClientId,
    });

    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: pool,
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: () => {
        setIsLoading(false);
        window.location.reload();
      },
      onFailure: (err) => {
        setIsLoading(false);
        setError(err.message || 'Authentication failed. Please try again.');
      },
      newPasswordRequired: () => {
        setIsLoading(false);
        setError('Password change required. Please contact your administrator.');
      },
    });
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '0 16px' }}>
        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
          <SpaceBetween size="l">
            <Box textAlign="center" margin={{ bottom: 'l' }}>
              <Box variant="h1" fontSize="heading-xl">AWS AI League</Box>
              <Box variant="p" color="text-body-secondary">Community Edition</Box>
            </Box>
            <Container header={<Header variant="h2">Sign In</Header>}>
              <SpaceBetween size="l">
                {error && (
                  <Alert type="error" dismissible onDismiss={() => setError('')}>
                    {error}
                  </Alert>
                )}
                <FormField label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={({ detail }) => setEmail(detail.value)}
                    placeholder="Enter your email"
                    ariaLabel="Email"
                  />
                </FormField>
                <FormField label="Password">
                  <Input
                    type="password"
                    value={password}
                    onChange={({ detail }) => setPassword(detail.value)}
                    placeholder="Enter your password"
                    ariaLabel="Password"
                  />
                </FormField>
                <Button variant="primary" formAction="submit" loading={isLoading} fullWidth>
                  Sign In
                </Button>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </form>
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <Container header={<Header variant="h1">Dashboard</Header>}>
      <Box variant="p">Welcome to AWS AI League - Community Edition</Box>
    </Container>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { mode, toggleTheme } = useTheme();
  const { profile } = useProfile();

  const themeLabel = mode === 'light' ? 'Dark mode' : 'Light mode';
  const displayLabel = profile?.displayName || user?.email || '';

  return (
    <TopNavigation
      identity={{
        href: '/',
        title: 'AWS AI League - Community Edition',
      }}
      utilities={[
        {
          type: 'menu-dropdown',
          text: displayLabel,
          description: profile?.avatar ? undefined : user?.email,
          iconName: 'user-profile',
          items: [
            { id: 'profile', text: 'Profile' },
            { id: 'theme', text: themeLabel },
            { id: 'signout', text: 'Sign Out' },
          ],
          onItemClick: ({ detail }) => {
            switch (detail.id) {
              case 'profile':
                navigate('/profile');
                break;
              case 'theme':
                toggleTheme();
                break;
              case 'signout':
                signOut();
                break;
            }
          },
        },
      ]}
    />
  );
}

function AuthenticatedApp() {
  return (
    <ProfileProvider>
      <div id="h">
        <TopBar />
      </div>
      <AppLayout
        headerSelector="#h"
        navigation={<NavigationPanel />}
        toolsHide={true}
        content={
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/map-builder" element={<MapBuilderPage />} />
            <Route path="/gameplay" element={<GameplayPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/submission-history" element={<SubmissionHistoryPage />} />
            <Route path="/configuration" element={<ConfigurationPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        }
      />
    </ProfileProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box margin={{ top: 'xxxl' }} textAlign="center">
        <Box variant="p">Loading...</Box>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
