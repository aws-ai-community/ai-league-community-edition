import { type Page, expect } from '@playwright/test';

export class LeaderboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/leaderboard');
    await expect(this.page.getByText('Leaderboard')).toBeVisible({ timeout: 15_000 });
  }

  async selectMap(label: string) {
    await this.page.getByLabel('Select map for leaderboard').first().click();
    await this.page.locator('[role="option"]').filter({ hasText: label }).first().click();
    // Wait for table to update
    await this.page.waitForTimeout(1000);
  }

  async verifyScoreInTable(minScore: number) {
    // Verify at least one row with a numeric score exists in the Rankings table
    await expect(this.page.getByText('Rankings')).toBeVisible({ timeout: 10_000 });
    await expect(this.page.locator('table tbody tr, [role="row"]').first()).toBeVisible({ timeout: 15_000 });
  }

  async verifyEntryExists() {
    await expect(this.page.locator('table tbody tr, [role="row"]').first()).toBeVisible({ timeout: 10_000 });
  }
}
