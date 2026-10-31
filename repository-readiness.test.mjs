import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = import.meta.dirname;
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'].includes(key)) delete env[key];
async function fixture(t) {
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  const dir = await mkdtemp(path.join(root, 'artifacts/repository-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function git(dir, args, input) {
  const result = spawnSync('git', ['-C', dir, ...args], { env, input, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
test('secret findings never reflect synthetic credential values', async () => {
  const { inspectText } = await import('./scripts/repository-check.mjs');
  const values = ['gh' + 'p_' + 'a'.repeat(36), ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzeW50aGV0aWMifQ', 'a'.repeat(32)].join('.'), '-----BEGIN ' + 'PRIVATE KEY-----'];
  for (const value of values) {
    const findings = inspectText(value);
    assert.ok(findings.length > 0);
    assert.ok(!JSON.stringify(findings).includes(value));
  }
  assert.deepEqual(inspectText('public source, no credentials'), []);
});
test('repository inspection includes tracked ignored paths without reading them and rejects unsafe files', async t => {
  const { inspectRepository } = await import('./scripts/repository-check.mjs');
  const { symlink } = await import('node:fs/promises');
  const dir = await fixture(t);
  assert.equal(git(dir, ['init', '-q']).status, 0);
  await writeFile(path.join(dir, '.gitignore'), await readFile(path.join(root, '.gitignore')));
  const secret = 'gh' + 'p_' + 's'.repeat(36);
  await writeFile(path.join(dir, '.env'), secret);
  await writeFile(path.join(dir, 'public.mjs'), secret);
  await symlink('/definitely-missing-synthetic-target', path.join(dir, 'unsafe.txt'));
  assert.equal(git(dir, ['add', '-f', '.env']).status, 0);
  const result = await inspectRepository({ directory: dir });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.path === '.env' && f.kind === 'private-path'));
  assert.ok(!result.findings.some(f => f.path === '.env' && f.kind !== 'private-path'));
  assert.ok(result.findings.some(f => f.path === 'public.mjs' && f.kind === 'github-token'));
  assert.ok(result.findings.some(f => f.path === 'unsafe.txt' && f.kind === 'unsafe-path'));
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('pre-Git inspection uses disposable metadata and leaves project uninitialized', async t => {
  const { inspectRepository } = await import('./scripts/repository-check.mjs');
  const { access } = await import('node:fs/promises');
  const dir = await fixture(t);
  await writeFile(path.join(dir, '.gitignore'), await readFile(path.join(root, '.gitignore')));
  await writeFile(path.join(dir, 'README.md'), 'Synthetic public project');
  await writeFile(path.join(dir, '.env'), 'gh' + 'p_' + 's'.repeat(36));
  const result = await inspectRepository({ directory: dir });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.candidates.includes('README.md'));
  assert.ok(!result.candidates.includes('.env'));
  await assert.rejects(access(path.join(dir, '.git')));
});
test('developer commands are dependency-free, private and fail closed', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.engines.node, '>=24');
  assert.equal(pkg.scripts.start, 'node server.mjs');
  assert.equal(pkg.scripts.test, 'node --test *.test.mjs');
  assert.equal(pkg.scripts.qa, 'node verification-server.mjs');
  assert.equal(pkg.scripts.verify, 'node scripts/verify.mjs');
  assert.ok(!pkg.dependencies && !pkg.devDependencies);
  const { createPlan, runPlan } = await import('./scripts/verify.mjs');
  const plan = createPlan({ directory: root, candidates: ['server.mjs', 'app.test.mjs', 'scripts/verify.mjs', 'start-watchbible.zsh'] });
  assert.ok(plan.some(step => step.args.includes('--test')));
  assert.ok(plan.some(step => step.args.includes('--check')));
  assert.ok(plan.some(step => step.command === 'python3'));
  assert.ok(plan.some(step => step.command === 'zsh' && step.args.includes('-n')));
  assert.ok(plan.some(step => step.args.includes('scripts/repository-check.mjs')));
  let calls = 0;
  assert.equal(runPlan(plan, { directory: root, execute: () => { calls++; return { status: 1 }; } }), 1);
  assert.equal(calls, 1);
  assert.equal(runPlan(plan, { directory: root, execute: () => ({ status: null, error: new Error('synthetic failure') }) }), 1);
  assert.equal(runPlan(plan, { directory: root, execute: () => ({ status: 0 }) }), 0);
});
test('verification rejects an empty plan and thrown process-launch errors', async () => {
  const { runPlan } = await import('./scripts/verify.mjs');
  assert.equal(runPlan([], { directory: root }), 1);
  assert.equal(runPlan([{ command: 'synthetic', args: [] }], { directory: root, execute: () => { throw new Error('synthetic launch failure'); } }), 1);
});
test('verification cannot silently skip Node tests through an inherited runner context', async () => {
  const { runPlan } = await import('./scripts/verify.mjs');
  let received;
  assert.equal(runPlan([{ command: 'synthetic', args: [] }], { directory: root, execute: (_command, _args, options) => { received = options.env; return { status: 0 }; } }), 0);
  assert.equal(received.NODE_TEST_CONTEXT, undefined);
});
test('Git excludes diary downloads and historical local reports from publication', async t => {
  const dir = await fixture(t);
  assert.equal(git(dir, ['init', '-q']).status, 0);
  await writeFile(path.join(dir, '.gitignore'), await readFile(path.join(root, '.gitignore')));
  for (const name of ['watchbible-backup-example.json', 'nested/watchbible-export-example.json', 'downloads/diary.json', 'exports/diary.json', 'gui-verification.json']) {
    assert.equal(git(dir, ['check-ignore', '--no-index', '--quiet', name]).status, 0, name);
  }
});
test('CI uses pinned actions, a macOS Node matrix and no install or provider secrets', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /runs-on: macos-latest/);
  assert.match(workflow, /node: \[24, 26\]/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.match(workflow, /npm run verify/);
  assert.doesNotMatch(workflow, /npm (?:install|ci)|secrets\./);
});
test('Git ignore semantics protect private paths and retain public source', async t => {
  const dir = await fixture(t);
  assert.equal(git(dir, ['init', '-q']).status, 0);
  await writeFile(path.join(dir, '.gitignore'), await readFile(path.join(root, '.gitignore')));
  const privatePaths = ['.watchbible/token', 'nested/.watchbible/state.json', '.env', '.env.local', 'nested/.env.production', 'secret.pem', 'nested/private.key', 'backups/source.mjs', 'artifacts/report.json', 'plans/private.md', 'HANDOFF.md', 'AGENTS.md', 'examples/notes-import.txt', '__pycache__/x.pyc', 'x.pyc', '.DS_Store', 'x.log', 'node_modules/x', '.launcher-test-x/data', '.credential-test-x/data', '.setup-token-test-x/data'];
  for (const name of privatePaths) assert.equal(git(dir, ['check-ignore', '--no-index', '--quiet', name]).status, 0, name);
  for (const name of ['README.md', 'server.mjs', 'src/app.mjs', 'docs/design.md', 'assets/icon.svg', 'examples/sample-import.txt', 'repository-readiness.test.mjs', '.github/workflows/check.yml']) assert.equal(git(dir, ['check-ignore', '--no-index', '--quiet', name]).status, 1, name);
});
