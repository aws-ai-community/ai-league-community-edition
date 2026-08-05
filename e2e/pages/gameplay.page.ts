import { type Page, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export class GameplayPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/gameplay');
    await expect(this.page.getByText('Game Play')).toBeVisible({ timeout: 15_000 });
  }

  async selectMap(label: string) {
    // Cloudscape Select renders a button with aria-haspopup="listbox" as the trigger
    // The gameplay page Select has placeholder "Select a map"
    await this.page.locator('button[aria-haspopup="listbox"]').first().click({ timeout: 15_000 });
    await this.page.locator('[role="option"]').filter({ hasText: label }).first().click();
    // Wait for the map data to load
    await this.page.waitForTimeout(2000);
  }

  async setNavigationPrompt(text: string) {
    await this.page.getByLabel('Navigation Prompt').fill(text);
  }

  async startGame() {
    await this.page.getByRole('button', { name: 'Start Game' }).click();
  }

  async verifyPlaying() {
    await expect(
      this.page.getByText(/Replaying|Playing/),
    ).toBeVisible({ timeout: 30_000 });
  }

  async verifyTimerVisible() {
    await expect(
      this.page.locator('text=/\\d+:\\d{2}/'),
    ).toBeVisible({ timeout: 15_000 });
  }

  async waitForGameEnd(timeout = 300_000) {
    // Wait for the game over modal to become visible (Score Breakdown appears inside)
    await expect(
      this.page.getByText('Score Breakdown'),
    ).toBeVisible({ timeout });
  }

  async verifyGameOverModal() {
    await expect(this.page.getByText('Score Breakdown')).toBeVisible({ timeout: 10_000 });
  }

  async getScore(): Promise<number> {
    // The score bar shows "Score: {number}" — find the element containing "Score:" followed by a number
    const scoreText = await this.page.locator('text=/Score:\\s*\\d+/').first().textContent();
    const match = scoreText?.match(/Score:\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
    // Fallback: try "Final Score:" pattern
    const finalText = await this.page.locator('text=/Final Score:\\s*\\d+/').first().textContent().catch(() => null);
    const finalMatch = finalText?.match(/(\d+)/);
    return finalMatch ? parseInt(finalMatch[1], 10) : 0;
  }

  async downloadBattleLog(): Promise<object> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.getByRole('button', { name: 'Download Battle Log' }).click(),
    ]);
    const savePath = join(tmpdir(), `battle-log-${Date.now()}.json`);
    await download.saveAs(savePath);
    const content = readFileSync(savePath, 'utf-8');
    return JSON.parse(content);
  }

  async submitToLeaderboard() {
    await this.page.getByRole('button', { name: 'Submit to Leaderboard' }).click();
    await expect(this.page.getByText('Submitted!')).toBeVisible({ timeout: 15_000 });
  }

  async verifyCombatLogHasEvents() {
    // Combat log rendered in monospace div
    const logContainer = this.page.locator('div[style*="monospace"]');
    await expect(logContainer.locator('div').first()).toBeVisible({ timeout: 15_000 });
  }
}
