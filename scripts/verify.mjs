import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRepository } from './repository-check.mjs';

export function createPlan({ directory, candidates, syntaxOnly = false }) {
  const node = process.execPath;
  const syntax = candidates.filter(name => /\.(?:mjs|js|cjs)$/.test(name)).map(name => ({ label: `Syntax: ${name}`, command: node, args: ['--check', name] }));
  const shell = candidates.filter(name => name.endsWith('.zsh')).map(name => ({ label: `Zsh syntax: ${name}`, command: 'zsh', args: ['-n', name] }));
  if (syntaxOnly) return [...syntax, ...shell];
  const tests = candidates.filter(name => !name.includes('/') && name.endsWith('.test.mjs'));
  if (!tests.length) throw new Error('No Node tests found');
  return [
    { label: 'Node tests (synthetic/local only)', command: node, args: ['--test', ...tests] },
    ...syntax,
    { label: 'Python tests', command: 'python3', args: ['-m', 'unittest', 'discover', '-s', '.', '-p', '*_test.py'] },
    ...shell,
    { label: 'Repository publication guardrails', command: node, args: ['scripts/repository-check.mjs'] },
  ];
}
export function runPlan(plan, { directory, execute = spawnSync }) {
  if (!Array.isArray(plan) || !plan.length) return 1;
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  delete env.NODE_TEST_CONTEXT; // Nested runners must execute tests, not skip them.
  // Verification never consumes an inherited live provider credential.
  for (const key of Object.keys(env)) if (/^(?:TMDB_|WATCHBIBLE_)/i.test(key)) delete env[key];
  for (const step of plan) {
    try {
      const result = execute(step.command, step.args, { cwd: directory, env, stdio: 'inherit', timeout: 120000 });
      if (!result || result.error || result.status !== 0) return 1;
    } catch { return 1; }
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = process.argv.slice(2);
  if (options.some(option => option !== '--syntax') || options.length > 1) {
    console.error('Usage: node scripts/verify.mjs [--syntax]');
    process.exitCode = 1;
  } else {
    const directory = path.resolve(import.meta.dirname, '..');
    const repository = await inspectRepository({ directory });
    if (!repository.ok) {
      console.error('Repository preflight failed; run node scripts/repository-check.mjs for sanitized findings.');
      process.exitCode = 1;
    } else {
      try {
        const plan = createPlan({ directory, candidates: repository.candidates, syntaxOnly: options.includes('--syntax') });
        process.exitCode = runPlan(plan, { directory });
        if (!process.exitCode) console.log(`Verified ${plan.length} local checks; no live provider verification performed.`);
      } catch {
        console.error('Verification failed to initialize.');
        process.exitCode = 1;
      }
    }
  }
}
