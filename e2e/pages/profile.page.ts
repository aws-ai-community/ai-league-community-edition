import { type Page, expect } from '@playwright/test';

export class ProfilePage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/profile');
    await expect(this.page.getByText('Display Name').first()).toBeVisible({ timeout: 15_000 });
  }

  async setDisplayName(name: string) {
    const input = this.page.getByLabel('Display name');
    await input.clear();
    await input.fill(name);
  }

  async saveDisplayName() {
    await this.page.getByRole('button', { name: 'Save display name' }).click();
  }

  async selectAvatar(index: number) {
    const avatars = this.page.locator('[role="button"][aria-label^="Select avatar"]');
    await avatars.nth(index).click();
  }

  async verifyDisplayNameSuccess() {
    await expect(this.page.getByText('Display name updated successfully.')).toBeVisible({ timeout: 10_000 });
  }

  async verifyAvatarSuccess() {
    await expect(this.page.getByText('Avatar updated successfully.')).toBeVisible({ timeout: 10_000 });
  }

  async verifyDisplayNameValue(expected: string) {
    await expect(this.page.getByLabel('Display name')).toHaveValue(expected, { timeout: 10_000 });
  }
}
