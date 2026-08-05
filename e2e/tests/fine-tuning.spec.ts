import { test, expect } from '@playwright/test';
import { FineTuningPage } from '../pages/fine-tuning.page';

test.describe('Fine-Tuning Page', () => {
  test('page loads with step-by-step instructions visible', async ({ page }) => {
    const fineTuningPage = new FineTuningPage(page);

    await fineTuningPage.goto();
    await fineTuningPage.verifyInstructionsVisible();
  });

  test('"Open SageMaker Studio" button click — presigned URL generated without error', async ({ page }) => {
    const fineTuningPage = new FineTuningPage(page);

    await fineTuningPage.goto();

    // Verify the button exists before clicking
    await fineTuningPage.verifyStudioLink();

    // Click the button and verify no error occurs (new tab or no error message)
    const success = await fineTuningPage.clickOpenStudio();
    expect(success).toBe(true);
  });
});
