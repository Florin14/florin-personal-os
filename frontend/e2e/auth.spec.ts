import { expect, test } from '@playwright/test';

import {
  codeForNewStep,
  currentStep,
  loadCredentials,
  signIn,
  signInAndEnroll,
  totpFor,
} from './helpers';

const credentials = loadCredentials().auth;

test.describe.serial('authentication', () => {
  let secret = '';
  let lastUsedStep = 0;

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, credentials, 'definitely-not-the-password');
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('first login enforces TOTP enrollment and opens the dashboard', async ({ page }) => {
    const enrolled = await signInAndEnroll(page, credentials);
    secret = enrolled.secret;
    lastUsedStep = enrolled.usedStep;

    await expect(page.getByRole('heading', { level: 1, name: /E2E Tester/ })).toBeVisible();
    const workspaces = page.getByRole('region', { name: 'Workspaces' });
    await expect(workspaces.getByText('Personal', { exact: true })).toBeVisible();
    await expect(workspaces.getByText(/E2E SRL/)).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'System status' }).getByText('Online'),
    ).toBeVisible();
  });

  test('sign out, then sign in again with a TOTP code', async ({ page }) => {
    expect(secret, 'enrollment test must run first').not.toBe('');
    await page.goto('/');
    await signIn(page, credentials);
    await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();

    const code = await codeForNewStep(page, totpFor(secret), lastUsedStep);
    lastUsedStep = currentStep();
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /E2E Tester/ })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings & Security' })
      .click();
    const sessions = page.getByRole('list', { name: 'Active sessions' });
    await expect(sessions.getByText('This device')).toBeVisible();

    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // The old session is gone: protected pages redirect to login.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });
});
