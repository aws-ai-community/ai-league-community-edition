import type { Page, Locator } from '@playwright/test';

/**
 * Timeout presets for various async operations in the e2e test suite.
 * These align with Requirement 11.3 — appropriate timeouts for
 * non-deterministic AI operations and infrastructure provisioning.
 */
export const TIMEOUTS = {
  /** Game completion — agent navigating the map (up to 5 minutes) */
  GAME_COMPLETION: 5 * 60 * 1_000,
  /** SageMaker IDE startup (up to 3 minutes) */
  IDE_START: 3 * 60 * 1_000,
  /** Memory tool creation to ACTIVE status (up to 3 minutes) */
  MEMORY_ACTIVE: 3 * 60 * 1_000,
  /** Schema regeneration after Lambda code update (up to 60 seconds) */
  SCHEMA_REGENERATION: 60 * 1_000,
  /** Standard page navigation (15 seconds) */
  PAGE_NAVIGATION: 15 * 1_000,
  /** Login completion (10 seconds) */
  LOGIN: 10 * 1_000,
} as const;

export interface WaitForOptions {
  /** Maximum time to wait in milliseconds */
  timeoutMs: number;
  /** Polling interval in milliseconds (default: 2000) */
  intervalMs?: number;
  /** Descriptive message for timeout errors */
  message?: string;
}

/**
 * Generic polling utility that waits for a condition function to return true.
 * Throws a descriptive error if the timeout is exceeded.
 *
 * Use this for operations where Playwright's built-in waitFor isn't sufficient,
 * e.g. waiting for backend state changes reflected in the UI.
 */
export async function waitFor(
  conditionFn: () => Promise<boolean>,
  options: WaitForOptions,
): Promise<void> {
  const { timeoutMs, intervalMs = 2_000, message } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await conditionFn();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const errorMessage = message
    ? `Timed out after ${timeoutMs}ms: ${message}`
    : `Timed out after ${timeoutMs}ms waiting for condition`;
  throw new Error(errorMessage);
}

/**
 * Waits for a game to complete by watching for the game-over modal to appear.
 * Uses the extended gameplay timeout (5 minutes) since AI agent navigation
 * can take variable time depending on map complexity and LLM responses.
 */
export async function waitForGameEnd(
  page: Page,
  gameOverSelector: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeout = options.timeoutMs ?? TIMEOUTS.GAME_COMPLETION;

  await page.locator(gameOverSelector).waitFor({
    state: 'visible',
    timeout,
  });
}

/**
 * Waits for IDE status to transition to a target state by polling a status locator.
 * Used for SageMaker IDE start/stop verification (3 minute timeout).
 */
export async function waitForIdeStatus(
  statusLocator: Locator,
  targetStatus: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = TIMEOUTS.IDE_START, intervalMs = 5_000 } = options;

  await waitFor(
    async () => {
      const text = await statusLocator.textContent();
      return text?.toLowerCase().includes(targetStatus.toLowerCase()) ?? false;
    },
    {
      timeoutMs,
      intervalMs,
      message: `IDE status to become "${targetStatus}"`,
    },
  );
}

/**
 * Waits for a memory tool to reach ACTIVE status by polling a status locator.
 * Memory tools transition through provisioning states before becoming usable
 * (3 minute timeout).
 */
export async function waitForMemoryActive(
  statusLocator: Locator,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = TIMEOUTS.MEMORY_ACTIVE, intervalMs = 5_000 } = options;

  await waitFor(
    async () => {
      const text = await statusLocator.textContent();
      return text?.toUpperCase().includes('ACTIVE') ?? false;
    },
    {
      timeoutMs,
      intervalMs,
      message: 'Memory tool to reach ACTIVE status',
    },
  );
}
