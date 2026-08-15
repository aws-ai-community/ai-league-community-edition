import { type Page, expect } from '@playwright/test';

export class AgentBuilderPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/agent-builder');
    // Wait for loading to complete — the page shows "Loading agent configuration..." then renders
    await expect(this.page.getByText('Agent Builder')).toBeVisible({ timeout: 15_000 });
    // Wait for the supervisor section to appear (means data loaded)
    await expect(this.page.getByText('Supervisor Agent').first()).toBeVisible({ timeout: 30_000 });
  }

  // --- Supervisor ---

  async verifySupervisorVisible() {
    await expect(this.page.getByText('Supervisor Agent').first()).toBeVisible();
    await expect(this.page.getByLabel('Agent name')).toBeVisible();
    await expect(this.page.getByLabel('System prompt')).toBeVisible();
    await expect(this.page.getByLabel('Select model').first()).toBeVisible();
  }

  async getSupervisorName(): Promise<string> {
    return await this.page.getByLabel('Agent name').inputValue();
  }

  async saveSupervisor() {
    // The save button text is just "Save" (not "Save Configuration")
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
  }

  async verifySaveSuccess() {
    await expect(this.page.getByText('Agent configuration saved successfully.')).toBeVisible({ timeout: 10_000 });
  }

  // --- Sub-Agents ---

  async createSubAgent(name: string, prompt: string) {
    await this.page.getByRole('button', { name: 'Add Sub-Agent' }).click();
    // Wait for the sub-agent form to appear
    await expect(this.page.getByText('New Sub-Agent')).toBeVisible({ timeout: 5_000 });
    await this.page.getByLabel('Sub-agent name').first().fill(name);
    // Cloudscape Textarea inside FormField uses aria-labelledby from FormField label
    // The sub-agent form's textarea is the last one on the page
    await this.page.locator('textarea').last().fill(prompt);
    await this.page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(this.page.getByText(`Sub-agent "${name}" created successfully.`)).toBeVisible({ timeout: 15_000 });
  }

  async verifySubAgentExists(name: string) {
    await expect(this.page.locator('table, [role="table"]').first().getByText(name)).toBeVisible({ timeout: 10_000 });
  }

  async editSubAgent(currentName: string, newName: string) {
    const row = this.page.locator('tr, [role="row"]').filter({ hasText: currentName });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(this.page.getByText('Edit Sub-Agent')).toBeVisible({ timeout: 5_000 });
    const nameInput = this.page.getByLabel('Sub-agent name').first();
    await nameInput.clear();
    await nameInput.fill(newName);
    await this.page.getByRole('button', { name: 'Update' }).click();
    await expect(this.page.getByText(`Sub-agent "${newName}" updated successfully.`)).toBeVisible({ timeout: 15_000 });
  }

  async deleteSubAgent(name: string) {
    const row = this.page.locator('tr, [role="row"]').filter({ hasText: name });
    await row.getByRole('button', { name: 'Delete' }).click();
    // Confirm in the Delete Sub-Agent modal
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(this.page.getByText('Sub-agent deleted successfully.')).toBeVisible({ timeout: 10_000 });
  }

  async verifySubAgentRemoved(name: string) {
    // Wait for table to update, then verify name is gone from the Sub-Agents table
    await this.page.waitForTimeout(1000);
    await expect(this.page.locator('table, [role="table"]').first().getByText(name)).not.toBeVisible({ timeout: 5_000 });
  }

  // --- Lambda Tools ---

  async createLambdaTool(name: string) {
    // Click the Lambda Tools tab first
    await this.page.getByRole('tab', { name: 'Lambda Tools' }).click();
    await this.page.getByRole('button', { name: 'Create Tool' }).click();
    // Fill the modal form
    await this.page.getByLabel('New Lambda tool name').fill(name);
    await this.page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(this.page.getByText(`Lambda tool "${name}" created successfully.`)).toBeVisible({ timeout: 15_000 });
  }

  async verifyLambdaToolExists(name: string) {
    await this.page.getByRole('tab', { name: 'Lambda Tools' }).click();
    await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  async deleteLambdaTool(name: string) {
    await this.page.getByRole('tab', { name: 'Lambda Tools' }).click();
    const row = this.page.locator('tr, [role="row"]').filter({ hasText: name });
    await row.getByRole('button', { name: 'Delete' }).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(this.page.getByText('Lambda tool deleted successfully.')).toBeVisible({ timeout: 10_000 });
  }

  async verifyLambdaToolRemoved(name: string) {
    await this.page.getByRole('tab', { name: 'Lambda Tools' }).click();
    await expect(this.page.getByText(name)).not.toBeVisible({ timeout: 5_000 });
  }

  // --- Memory Tools ---

  async createMemoryTool(name: string, description?: string) {
    await this.page.getByRole('tab', { name: 'Memory Tools' }).click();
    await this.page.getByPlaceholder('e.g., Game Memory').fill(name);
    if (description) {
      await this.page.getByLabel('Memory tool description').fill(description);
    }
    await this.page.getByRole('button', { name: 'Create Memory' }).click();
    // Memory creation involves backend API call — wait up to 30s for success flash
    await expect(this.page.getByText(/created successfully/i).first()).toBeVisible({ timeout: 30_000 });
  }

  async verifyMemoryToolInSelector(name: string) {
    await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }

  async waitForMemoryActive(_name: string, timeout = 30_000) {
    // Memory takes a long time to become ACTIVE. Verify it's at least CREATING or ACTIVE.
    await expect(
      this.page.getByText('CREATING').or(this.page.getByText('ACTIVE')).or(this.page.getByText('Active')).first(),
    ).toBeVisible({ timeout });
  }

  async deleteMemoryTool(name: string) {
    await this.page.getByRole('tab', { name: 'Memory Tools' }).click();
    await this.page.locator(`[aria-label="Delete ${name}"]`).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(this.page.getByText('Memory tool deleted successfully.')).toBeVisible({ timeout: 10_000 });
  }

  // --- Guardrails ---

  async createGuardrail(name: string, description?: string) {
    await this.page.getByRole('tab', { name: 'Guardrails' }).click();
    await this.page.getByRole('button', { name: 'Create Guardrail' }).first().click();
    await this.page.getByLabel('Guardrail name').fill(name);
    if (description) {
      await this.page.getByLabel('Guardrail description').fill(description);
    }
    // Click the Create Guardrail button inside the modal
    await this.page.getByRole('dialog').getByRole('button', { name: 'Create Guardrail' }).click();
    await expect(this.page.getByText(`Guardrail "${name}" created successfully.`)).toBeVisible({ timeout: 10_000 });
  }

  async verifyGuardrailInSelector(name: string) {
    await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }

  async deleteGuardrail(name: string) {
    await this.page.getByRole('tab', { name: 'Guardrails' }).click();
    await this.page.locator(`[aria-label="Delete ${name}"]`).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(this.page.getByText('Guardrail deleted successfully.')).toBeVisible({ timeout: 10_000 });
  }

  // --- Attach to Supervisor ---

  async attachSubAgentToSupervisor(name: string) {
    // Cloudscape Toggle: wrapper span contains both the checkbox and label text
    // Find the wrapper that has both our text AND a checkbox inside it
    const wrapper = this.page.locator('[class*="wrapper"]')
      .filter({ hasText: name })
      .filter({ has: this.page.locator('input[type="checkbox"]') });
    await wrapper.first().locator('input[type="checkbox"]').check();
  }

  async attachLambdaToolToSupervisor(name: string) {
    const wrapper = this.page.locator('[class*="wrapper"]')
      .filter({ hasText: name })
      .filter({ has: this.page.locator('input[type="checkbox"]') });
    await wrapper.first().locator('input[type="checkbox"]').check();
  }
}
