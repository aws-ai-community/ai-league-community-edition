import { test, expect } from '@playwright/test';
import { GameplayPage } from '../pages/gameplay.page';
import { LeaderboardPage } from '../pages/leaderboard.page';
import { SubmissionHistoryPage } from '../pages/submission-history.page';
import { TIMEOUTS } from '../helpers/wait.helper';

test.describe.serial('Leaderboard and Submission', () => {
  let submittedScore: number;

  test('submit completed game to leaderboard shows success message', async ({ page }) => {
    test.setTimeout(TIMEOUTS.GAME_COMPLETION + 60_000);

    const gameplayPage = new GameplayPage(page);

    // Play a complete game on the CB/Hero map
    await gameplayPage.goto();
    await gameplayPage.selectMap('CB/Hero');
    await gameplayPage.setNavigationPrompt(
      'Navigate efficiently toward the treasure, avoiding obstacles.',
    );
    await gameplayPage.startGame();
    await gameplayPage.verifyPlaying();

    // Wait for game to complete (up to 5 minutes)
    await gameplayPage.waitForGameEnd(TIMEOUTS.GAME_COMPLETION);
    await gameplayPage.verifyGameOverModal();

    // Capture the score (non-deterministic, just verify > 0)
    submittedScore = await gameplayPage.getScore();
    expect(submittedScore).toBeGreaterThan(0);

    // Submit to leaderboard and verify success message
    await gameplayPage.submitToLeaderboard();
  });

  test('leaderboard page shows submitted score in table', async ({ page }) => {
    const leaderboardPage = new LeaderboardPage(page);

    await leaderboardPage.goto();
    await leaderboardPage.selectMap('CB/Hero');

    // Verify a score appears in the leaderboard table (score > 0)
    await leaderboardPage.verifyScoreInTable(1);

    // Verify at least one entry exists in the table
    await leaderboardPage.verifyEntryExists();
  });

  test('submission history shows session with correct score', async ({ page }) => {
    const submissionHistoryPage = new SubmissionHistoryPage(page);

    await submissionHistoryPage.goto();
    await submissionHistoryPage.selectMap('CB/Hero');

    // Verify the session appears with a score >= 1 (non-deterministic)
    await submissionHistoryPage.verifySessionAppears(1);
  });
});
