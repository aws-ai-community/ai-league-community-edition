import { type Page, expect } from '@playwright/test';

export class FineTuningPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/fine-tuning');
    await expect(this.page.getByText('Fine-Tuning')).toBeVisible({ timeout: 15_000 });
  }

  async verifyInstructionsVisible() {
    await expect(this.page.getByText('How It Works')).toBeVisible();
    await expect(this.page.getByText('Download Sample Data')).toBeVisible();
    await expect(this.page.getByText('Train in SageMaker')).toBeVisible();
    await expect(this.page.getByText('Register Model', { exact: true }).first()).toBeVisible();
    await expect(this.page.getByText('Deploy for Inference')).toBeVisible();
    await expect(this.page.getByText('Use in Agent Builder')).toBeVisible();
  }

  async verifyStudioLink() {
    await expect(this.page.getByRole('button', { name: /Open SageMaker Studio/i })).toBeVisible();
  }

  async clickOpenStudio() {
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null),
      this.page.getByRole('button', { name: /Open SageMaker Studio/i }).click(),
    ]);
    if (newPage) {
      await newPage.close();
      return true;
    }
    const hasError = await this.page.locator('[data-analytics-alert="error"]').isVisible().catch(() => false);
    return !hasError;
  }
}
