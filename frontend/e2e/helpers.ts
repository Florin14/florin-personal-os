import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

import { CREDENTIALS_FILE, type Credentials } from './global-setup';

export const STEP_SECONDS = 30;

export function loadCredentials(): { auth: Credentials; automation: Credentials } {
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as {
    auth: Credentials;
    automation: Credentials;
  };
}

export function currentStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

export function totpFor(secret: string): TOTP {
  return new TOTP({ secret, digits: 6, period: STEP_SECONDS });
}

/** The server rejects reuse of a time step, so wait for a fresh one when needed. */
export async function codeForNewStep(page: Page, totp: TOTP, usedStep: number): Promise<string> {
  while (currentStep() <= usedStep) {
    await page.waitForTimeout(1000);
  }
  return totp.generate();
}

export async function signIn(page: Page, credentials: Credentials, password?: string) {
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(password ?? credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** First login: enroll TOTP; returns the secret and the time step that was used. */
export async function signInAndEnroll(
  page: Page,
  credentials: Credentials,
): Promise<{ secret: string; usedStep: number }> {
  await page.goto('/');
  await signIn(page, credentials);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  const usedStep = currentStep();
  await page.getByLabel('6-digit code').fill(totpFor(secret).generate());
  await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { secret, usedStep };
}
