import { type Page, expect } from '@playwright/test';

export class SubmissionHistoryPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/submission-history');
    await expect(this.page.getByText('Submission History')).toBeVisible({ timeout: 15_000 });
  }

  async selectMap(label: string) {
    await this.page.getByLabel('Select map for submission history').first().click();
    await this.page.locator('[role="option"]').filter({ hasText: label }).first().click();
    await this.page.waitForTimeout(1000);
  }

  async verifySessionAppears(minScore: number) {
    await expect(this.page.getByText('Past Submissions')).toBeVisible({ timeout: 10_000 });
    await expect(this.page.locator('table tbody tr, [role="row"]').first()).toBeVisible({ timeout: 15_000 });
  }

  async verifySubmissionWithScore(score: number) {
    await expect(this.page.getByText(String(score))).toBeVisible({ timeout: 10_000 });
  }
}
