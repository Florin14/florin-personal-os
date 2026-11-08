import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CREDENTIALS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.e2e-user.json');

export interface Credentials {
  email: string;
  password: string;
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Creates a unique, MFA-less user through the backend CLI inside the compose stack. */
function createUser(prefix: string, displayName: string): Credentials {
  const stamp = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${prefix}-${stamp}@example.test`;
  const password = `e2e-password-${Math.random().toString(36).slice(2)}`;
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
      displayName,
      '--business-workspace',
      `E2E SRL ${stamp}`,
      '--password-stdin',
    ],
    { cwd: projectRoot, input: `${password}\n`, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  return { email, password };
}

export default function globalSetup(): void {
  const users = {
    auth: createUser('e2e-auth', 'E2E Tester'),
    automation: createUser('e2e-auto', 'E2E Automator'),
  };
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(users));
}
