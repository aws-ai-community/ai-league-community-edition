import { type Page, expect } from '@playwright/test';

export class MapBuilderPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/map-builder');
    await expect(this.page.getByText('Map Builder')).toBeVisible({ timeout: 15_000 });
  }

  async verifyGridVisible() {
    await expect(this.page.locator('[role="grid"][aria-label="Map grid"]')).toBeVisible({ timeout: 15_000 });
  }

  async verifyPaletteVisible() {
    // TilePalette shows ExpandableSection headers: "Special", "Challenge", etc.
    await expect(this.page.getByText('Special')).toBeVisible();
  }

  async verifySettingsVisible() {
    await expect(this.page.getByText('Map Settings')).toBeVisible();
  }

  async dragTileToCell(tileName: string, row: number, col: number) {
    const tile = this.page.locator(`[aria-label="${tileName} tile"]`);
    const grid = this.page.locator('[role="grid"][aria-label="Map grid"]');
    const cells = grid.locator('[role="gridcell"]');
    const width = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await tile.dragTo(cells.nth(row * width + col));
  }

  async clickTileInPalette(tileName: string) {
    await this.page.locator(`[aria-label="${tileName} tile"]`).click();
  }

  async clickCell(row: number, col: number) {
    const grid = this.page.locator('[role="grid"][aria-label="Map grid"]');
    const cells = grid.locator('[role="gridcell"]');
    const width = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await cells.nth(row * width + col).click();
  }

  async verifyCellHasTile(row: number, col: number) {
    const grid = this.page.locator('[role="grid"][aria-label="Map grid"]');
    const cells = grid.locator('[role="gridcell"]');
    const width = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const cell = cells.nth(row * width + col);
    await expect(cell.locator('img')).toBeVisible({ timeout: 5_000 });
  }

  async saveMap(name: string) {
    await this.page.getByRole('button', { name: 'Save' }).click();
    const modal = this.page.getByRole('dialog');
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByLabel('Map name').fill(name);
      await modal.getByRole('button', { name: 'Save' }).click();
    }
  }

  async verifySaveSuccess() {
    // Wait for the success flashbar notification (not the hidden "unsaved changes" modal text)
    await expect(
      this.page.locator('[data-analytics-alert="success"], [class*="flashbar"] [class*="success"]').first()
        .or(this.page.getByText('Map saved successfully').first())
    ).toBeVisible({ timeout: 10_000 });
  }

  async loadMap(name: string) {
    await this.page.getByRole('button', { name: 'Load' }).click();
    await this.page.getByRole('dialog').getByText(name, { exact: false }).click();
  }

  async verifyMapLoaded(name: string) {
    await expect(this.page.getByText(`Editing: ${name}`, { exact: false })).toBeVisible({ timeout: 10_000 });
  }

  async deleteMap() {
    await this.page.getByRole('button', { name: 'Delete' }).first().click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  }

  async verifyMapDeleted(name: string) {
    await this.page.getByRole('button', { name: 'Load' }).click();
    await expect(this.page.getByRole('dialog').getByText(name, { exact: false })).not.toBeVisible({ timeout: 5_000 });
    await this.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  }
}
