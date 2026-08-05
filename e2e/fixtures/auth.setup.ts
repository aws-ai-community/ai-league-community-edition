import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../.auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.ADMIN_EMAIL || 'admin@aileague.community';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    throw new Error('ADMIN_PASSWORD environment variable is required');
  }

  await page.goto('/');

  // Fill login form
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for successful login — Dashboard heading only appears after authentication
  await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });

  // Save authentication state
  await page.context().storageState({ path: authFile });
});
