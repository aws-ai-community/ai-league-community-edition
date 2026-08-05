import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ProfilePage } from '../pages/profile.page';

test.describe('Authentication and Profile', () => {
  test.describe('Login', () => {
    // Login tests use a fresh browser context (no storageState)
    test.use({ storageState: { cookies: [], origins: [] } });

    test('successful login reaches dashboard', async ({ page }) => {
      const email = process.env.ADMIN_EMAIL || 'admin@aileague.community';
      const password = process.env.ADMIN_PASSWORD;

      if (!password) {
        throw new Error('ADMIN_PASSWORD environment variable is required');
      }

      const loginPage = new LoginPage(page);
      const dashboardPage = new DashboardPage(page);

      await loginPage.goto();
      await loginPage.login(email, password);
      await dashboardPage.verifyWelcomeText();
    });

    test('invalid credentials shows error message', async ({ page }) => {
      const loginPage = new LoginPage(page);

      await loginPage.goto();
      await loginPage.login('invalid@example.com', 'WrongPassword123!');
      await loginPage.verifyErrorMessage();
    });
  });

  test.describe('Profile', () => {
    // Profile test uses the authenticated storageState from auth setup
    test('set display name and select avatar persists after reload', async ({ page }) => {
      const profilePage = new ProfilePage(page);
      const displayName = `E2E Tester ${Date.now()}`;

      // Navigate to profile page
      await profilePage.goto();

      // Set display name and save
      await profilePage.setDisplayName(displayName);
      await profilePage.saveDisplayName();
      await profilePage.verifyDisplayNameSuccess();

      // Select an avatar (index 0 = first avatar)
      await profilePage.selectAvatar(0);
      await profilePage.verifyAvatarSuccess();

      // Reload the page and verify persistence
      await page.reload();
      await profilePage.verifyDisplayNameValue(displayName);
    });
  });
});
