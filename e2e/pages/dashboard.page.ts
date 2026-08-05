import { type Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/');
  }

  async verifyWelcomeText() {
    await expect(
      this.page.getByText('Welcome to AWS AI League - Community Edition'),
    ).toBeVisible({ timeout: 15_000 });
  }
}
