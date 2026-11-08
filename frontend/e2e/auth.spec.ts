import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

import { CREDENTIALS_FILE } from './global-setup';

interface Credentials {
  email: string;
  password: string;
}

const credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as Credentials;
const STEP_SECONDS = 30;

function currentStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

/** The server rejects reuse of a time step, so wait for a fresh one when needed. */
async function codeForNewStep(page: Page, totp: TOTP, usedStep: number): Promise<string> {
  while (currentStep() <= usedStep) {
    await page.waitForTimeout(1000);
  }
  return totp.generate();
}

async function signIn(page: Page, password = credentials.password): Promise<void> {
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.serial('authentication', () => {
  let secret = '';
  let lastUsedStep = 0;

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, 'definitely-not-the-password');
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('first login enforces TOTP enrollment and opens the dashboard', async ({ page }) => {
    await page.goto('/');
    await signIn(page);

    await expect(
      page.getByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Set up authenticator app' }).click();
    await expect(page.getByAltText('QR code for authenticator app setup')).toBeVisible();
    secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const totp = new TOTP({ secret, digits: 6, period: STEP_SECONDS });
    lastUsedStep = currentStep();
    await page.getByLabel('6-digit code').fill(totp.generate());
    await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();

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
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();

    const totp = new TOTP({ secret, digits: 6, period: STEP_SECONDS });
    const code = await codeForNewStep(page, totp, lastUsedStep);
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
