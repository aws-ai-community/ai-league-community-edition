import { type Page, expect } from '@playwright/test';

export class ConfigurationPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/configuration');
    await expect(this.page.getByText('Configuration')).toBeVisible({ timeout: 15_000 });
  }

  async verifyIdeSection() {
    await expect(this.page.getByText('Code Editor IDE')).toBeVisible({ timeout: 15_000 });
    await expect(this.page.getByRole('button', { name: 'Start IDE' })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Stop IDE' })).toBeVisible();
  }

  async startIde() {
    await this.page.getByRole('button', { name: 'Start IDE' }).click();
  }

  async stopIde() {
    await this.page.getByRole('button', { name: 'Stop IDE' }).click();
  }

  async verifyIdeStatus(status: 'Running' | 'Starting' | 'Stopping' | 'Stopped') {
    await expect(this.page.getByText(status)).toBeVisible({ timeout: 300_000 });
  }

  async selectSchemaModel(modelLabel: string) {
    await this.page.getByLabel('Select schema generation model').first().click();
    await this.page.locator('[role="option"]').filter({ hasText: modelLabel }).first().click();
  }

  async verifyModelOption(modelLabel: string) {
    await this.page.getByLabel('Select default LLM model').first().click();
    await expect(this.page.locator('[role="option"]').filter({ hasText: modelLabel }).first()).toBeVisible();
    await this.page.keyboard.press('Escape');
  }

  async saveConfiguration() {
    await this.page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(this.page.getByText('Configuration saved successfully.')).toBeVisible({ timeout: 10_000 });
  }

  async resetConfiguration() {
    await this.page.getByRole('button', { name: 'Reset Configuration' }).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
    await expect(this.page.getByText('Configuration reset to defaults successfully.')).toBeVisible({ timeout: 15_000 });
  }

  async verifyDefaultsRestored() {
    await expect(this.page.getByText('Nova 2 Lite').first()).toBeVisible({ timeout: 10_000 });
  }
}
