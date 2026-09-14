#!/usr/bin/env npx tsx
/**
 * Off-line password hasher for the production admin bootstrap.
 *
 * `KISHOLOY_ADMIN_PASSWORD_HASH` is the preferred way to seed the first
 * super administrator: the plaintext never enters the platform's environment
 * variables at all, only its scrypt hash. This script produces that value.
 *
 *   npx tsx scripts/hash-password.ts                      # hidden prompt
 *   npx tsx scripts/hash-password.ts --from-stdin < pw.txt # pipe it in
 *
 * The prompt uses a raw-mode stdin listener so the value is not echoed, and no
 * argument form is offered, because shell history would keep the secret.
 * Nothing is written to disk and nothing is sent anywhere.
 *
 * @license Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { hashPassword, passwordPolicyError } from '../server/security/passwords';

const args = process.argv.slice(2);
const fromStdin = args.includes('--from-stdin');

const readStdin = (): string => {
  try {
    return readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  } catch {
    return '';
  }
};

const askHidden = (question: string): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      resolve(readStdin());
      return;
    }
    const stdin = process.stdin;
    const out = process.stdout;
    let value = '';
    out.write(question);

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      out.write('\n');
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {
          finish();
          return;
        }
        if (code === 3) {
          // Ctrl+C
          stdin.setRawMode(false);
          out.write('\n');
          process.exit(130);
          return;
        }
        if (code === 127 || code === 8) {
          value = value.slice(0, -1);
          out.write('\b \b');
          continue;
        }
        if (code < 32) continue;
        value += ch; // deliberately not echoed
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('error', reject);
  });

const main = async () => {
  const inline = args.find((a) => !a.startsWith('--'));
  if (inline) {
    console.error('Refusing a password given as an argument — it would sit in your shell history.');
    console.error('Use the hidden prompt, or: npx tsx scripts/hash-password.ts --from-stdin < file');
    process.exit(2);
  }

  const plain = fromStdin ? readStdin() : await askHidden('Bootstrap password (input hidden): ');

  if (!plain) {
    console.error('No password supplied.');
    process.exit(2);
  }

  const policyProblem = passwordPolicyError(plain, 'Bootstrap password');
  if (policyProblem) {
    console.error(`Rejected: ${policyProblem}`);
    console.error('Fix it before deploying — the same policy is enforced on first login.');
    process.exit(3);
  }

  console.log(`\nKISHOLOY_ADMIN_PASSWORD_HASH="${hashPassword(plain)}"\n`);
  console.log('Set that in Vercel → Environment Variables (Sensitive) together with');
  console.log('KISHOLOY_ADMIN_EMAIL, and leave KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD unset.');
  console.log('Never commit it, and never paste it into .env.example.');
};

main().catch((err) => {
  console.error(`hashing failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
