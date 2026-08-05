import { test, expect } from '@playwright/test';
import { GameplayPage } from '../pages/gameplay.page';
import { TIMEOUTS } from '../helpers/wait.helper';

test.describe.serial('Gameplay', () => {
  let gameplayPage: GameplayPage;

  test.beforeEach(async ({ page }) => {
    gameplayPage = new GameplayPage(page);
  });

  test('select map, enter prompt, and start game', async ({ page }) => {
    await gameplayPage.goto();

    // Select a predefined map (CB/Hero)
    await gameplayPage.selectMap('CB/Hero');

    // Enter a navigation prompt
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );

    // Start the game
    await gameplayPage.startGame();

    // Verify the game has started — status shows Playing
    await gameplayPage.verifyPlaying();
  });

  test('timer is counting down and status shows Playing', async ({ page }) => {
    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();

    // Verify timer is visible (shows countdown in mm:ss format)
    await gameplayPage.verifyTimerVisible();

    // Verify status indicates the game is in progress
    await gameplayPage.verifyPlaying();
  });

  test('game ends with game-over modal and score breakdown', async ({ page }) => {
    test.setTimeout(TIMEOUTS.GAME_COMPLETION + 60_000); // 5 min + buffer

    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();
    await gameplayPage.verifyPlaying();

    // Wait for game to complete (up to 5 minutes)
    await gameplayPage.waitForGameEnd(TIMEOUTS.GAME_COMPLETION);

    // Verify the game-over modal appears
    await gameplayPage.verifyGameOverModal();
  });

  test('score is greater than zero', async ({ page }) => {
    test.setTimeout(TIMEOUTS.GAME_COMPLETION + 60_000);

    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();
    await gameplayPage.verifyPlaying();
    await gameplayPage.waitForGameEnd(TIMEOUTS.GAME_COMPLETION);
    await gameplayPage.verifyGameOverModal();

    // Verify the score is a positive number (structural assertion, not exact value)
    const score = await gameplayPage.getScore();
    expect(score).toBeGreaterThan(0);
  });

  test('combat log has events including InputPrompt and MoveSpace', async ({ page }) => {
    test.setTimeout(TIMEOUTS.GAME_COMPLETION + 60_000);

    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();
    await gameplayPage.verifyPlaying();
    await gameplayPage.waitForGameEnd(TIMEOUTS.GAME_COMPLETION);

    // Verify combat log section has events rendered
    await gameplayPage.verifyCombatLogHasEvents();
  });

  test('Download Battle Log produces valid JSON with events and summary', async ({ page }) => {
    test.setTimeout(TIMEOUTS.GAME_COMPLETION + 60_000);

    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();
    await gameplayPage.verifyPlaying();
    await gameplayPage.waitForGameEnd(TIMEOUTS.GAME_COMPLETION);
    await gameplayPage.verifyGameOverModal();

    // Download the battle log and verify its structure
    const battleLog = (await gameplayPage.downloadBattleLog()) as Record<string, unknown>;

    // Structural assertions per Requirement 11 (no exact values)
    expect(battleLog).toHaveProperty('events');
    expect(battleLog).toHaveProperty('summary');
    expect(Array.isArray(battleLog.events)).toBe(true);
    expect((battleLog.events as unknown[]).length).toBeGreaterThan(0);
    expect(typeof battleLog.summary).toBe('object');

    // Verify at least InputPrompt event exists
    const events = battleLog.events as Array<Record<string, unknown>>;
    const hasInputPrompt = events.some((e) => e.type === 'InputPrompt');
    expect(hasInputPrompt).toBe(true);

    // Verify at least one MoveSpace event exists
    const hasMoveSpace = events.some((e) => e.type === 'MoveSpace');
    expect(hasMoveSpace).toBe(true);
  });
});
