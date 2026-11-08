import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CREDENTIALS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.e2e-user.json');

/** Creates a unique, MFA-less user through the backend CLI inside the compose stack. */
export default function globalSetup(): void {
  const email = `e2e-${Date.now()}@example.test`;
  const password = `e2e-password-${Math.random().toString(36).slice(2)}`;
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const composeFile = process.env.E2E_COMPOSE_FILE ?? 'compose.yaml';
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'backend',
      'python',
      '-m',
      'app.cli',
      'create-user',
      '--email',
      email,
      '--display-name',
      'E2E Tester',
      '--business-workspace',
      `E2E SRL ${Date.now()}`,
      '--password-stdin',
    ],
    { cwd: projectRoot, input: `${password}\n`, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  writeFileSync(CREDENTIALS_FILE, JSON.stringify({ email, password }));
}
