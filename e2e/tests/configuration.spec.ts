import { test, expect } from '@playwright/test';
import { ConfigurationPage } from '../pages/configuration.page';

test.describe.serial('Configuration Page', () => {
  test('page loads with IDE section visible (Start/Stop buttons)', async ({ page }) => {
    const configPage = new ConfigurationPage(page);

    await configPage.goto();
    await configPage.verifyIdeSection();
  });

  test('change schema model selector, save, and verify persists after reload', async ({ page }) => {
    const configPage = new ConfigurationPage(page);

    await configPage.goto();

    // Change the schema model selector to a different model
    await configPage.selectSchemaModel('Nova 2 Lite');

    // Save the configuration
    await configPage.saveConfiguration();

    // Reload the page and verify the selection persisted
    await page.reload();
    await expect(page.getByText('Nova 2 Lite').first()).toBeVisible({ timeout: 10_000 });
  });

  test('verify Nova 2 Lite and Claude Haiku appear as model options', async ({ page }) => {
    const configPage = new ConfigurationPage(page);

    await configPage.goto();

    // Verify Nova 2 Lite is available as a model option
    await configPage.verifyModelOption('Nova 2 Lite');

    // Verify Claude Haiku appears as an option (do NOT select it for invocation)
    await configPage.verifyModelOption('Claude Haiku');
  });

  test('reset configuration restores defaults', async ({ page }) => {
    const configPage = new ConfigurationPage(page);

    await configPage.goto();

    // Click reset and confirm
    await configPage.resetConfiguration();

    // Verify defaults are restored (Nova 2 Lite should be selected)
    await configPage.verifyDefaultsRestored();
  });
});
