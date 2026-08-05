import { type Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/');
  }

  async fillEmail(email: string) {
    await this.page.getByLabel('Email').fill(email);
  }

  async fillPassword(password: string) {
    await this.page.getByLabel('Password').fill(password);
  }

  async clickSignIn() {
    await this.page.getByRole('button', { name: 'Sign In' }).click();
  }

  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickSignIn();
  }

  async verifyDashboard() {
    await expect(
      this.page.getByText('Welcome to AWS AI League - Community Edition'),
    ).toBeVisible({ timeout: 15_000 });
  }

  async verifyErrorMessage() {
    await expect(
      this.page.locator('[data-analytics-alert="error"]'),
    ).toBeVisible({ timeout: 10_000 });
  }
}
