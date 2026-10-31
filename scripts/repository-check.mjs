// Heuristic guardrails, not a guarantee that a repository contains no secrets.
import { lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectText(text) {
  const patterns = [
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['provider-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => ({ kind }));
}

const protectedPaths = ['.watchbible/state.json', 'nested/.watchbible/token', '.env', '.env.local', 'nested/.env.production', 'secret.pem', 'nested/secret.key', 'backups/source.mjs', 'artifacts/report.json', 'plans/private.md', 'HANDOFF.md', 'AGENTS.md', 'examples/notes-import.txt', '__pycache__/x.pyc', 'x.pyc', '.DS_Store', 'x.log', 'logs/output.txt', 'node_modules/x', '.launcher-test-x/data', '.credential-test-x/data', '.setup-token-test-x/data'];
const publicPaths = ['README.md', 'server.mjs', 'src/app.mjs', 'docs/design.md', 'assets/icon.svg', 'examples/sample-import.txt', 'repository-readiness.test.mjs', '.github/workflows/check.yml'];
protectedPaths.push('watchbible-backup-example.json', 'nested/watchbible-export-example.json', 'exports/diary.json', 'downloads/diary.json', 'gui-verification.json');
function privatePath(name) {
  if (name === 'gui-verification.json' || name.split('/').some(part => ['exports', 'downloads'].includes(part) || /^watchbible-(?:backup|export)-.*\.json$/.test(part))) return true;
  return name.split('/').some(part => /^(?:\.watchbible|\.env(?:\..*)?|backups|artifacts|plans|HANDOFF\.md|AGENTS\.md|__pycache__|\.DS_Store|logs|node_modules|\.(?:launcher|credential|setup-token)-test-.*)$/.test(part) || /\.(?:pem|key|log|py[ cod])$/.test(part)) || name === 'examples/notes-import.txt';
}
function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
}
export async function inspectRepository({ directory }) {
  directory = path.resolve(directory);
  const findings = [];
  let candidates = [], scanned = 0, bytes = 0, temporary;
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error('unsafe-root');
    let args = ['-C', directory];
    try { await lstat(path.join(directory, '.git')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const artifacts = path.join(directory, 'artifacts');
      await mkdir(artifacts, { recursive: true });
      if (!(await lstat(artifacts)).isDirectory()) throw new Error('unsafe-artifacts');
      temporary = await mkdtemp(path.join(artifacts, 'repository-probe-'));
      const init = spawnSync('git', ['init', '--bare', '-q', path.join(temporary, 'metadata')], { env: gitEnvironment(), encoding: 'utf8' });
      if (init.status !== 0) throw new Error('git-unavailable');
      args = ['--git-dir', path.join(temporary, 'metadata'), '--work-tree', directory, '-c', 'core.bare=false'];
    }
    const git = (extra, input) => {
      const result = spawnSync('git', [...args, '-c', 'core.excludesFile=/dev/null', ...extra], { cwd: directory, env: gitEnvironment(), input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15000 });
      if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error('git-failed');
      return result;
    };
    for (const name of protectedPaths) if (git(['check-ignore', '--no-index', '--quiet', name]).status !== 0) findings.push({ path: name, kind: 'missing-ignore' });
    for (const name of publicPaths) if (git(['check-ignore', '--no-index', '--quiet', name]).status !== 1) findings.push({ path: name, kind: 'public-file-ignored' });
    const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (listed.status !== 0) throw new Error('enumeration-failed');
    candidates = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
    if (candidates.length > 10000) throw new Error('candidate-limit');
    for (const name of candidates) {
      // Classify paths BEFORE opening them, including ignored files in the index.
      if (privatePath(name)) { findings.push({ path: name, kind: 'private-path' }); continue; }
      if (path.isAbsolute(name) || name.split('/').some(part => !part || part === '..' || part === '.git') || /[\x00-\x1f\x7f]/.test(name)) { findings.push({ path: '<unsafe-path>', kind: 'unsafe-path' }); continue; }
      let handle;
      try {
        let cursor = directory;
        for (const part of name.split('/')) {
          cursor = path.join(cursor, part);
          if ((await lstat(cursor)).isSymbolicLink()) throw new Error('unsafe-path');
        }
        handle = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error('unsafe-path');
        if (stat.size > 2 * 1024 * 1024 || bytes + stat.size > 32 * 1024 * 1024) throw new Error('scan-limit');
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== stat.size) throw new Error('changed-file');
        bytes += bytesRead;
        scanned++;
        // Both text and binary bytes receive bounded known-pattern scanning.
        for (const finding of inspectText(buffer.subarray(0, bytesRead).toString('utf8'))) findings.push({ path: name, ...finding });
      } catch (error) { findings.push({ path: name, kind: ['unsafe-path', 'scan-limit', 'changed-file'].includes(error.message) ? error.message : 'unscannable-path' }); }
      finally { if (handle) await handle.close(); }
    }
  } catch { findings.push({ path: '.', kind: 'inspection-failed' }); }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  return { ok: findings.length === 0, candidates, scanned, bytes, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await inspectRepository({ directory: process.cwd() });
  console.log(`Repository check: ${result.candidates.length} candidates, ${result.scanned} scanned, ${result.findings.length} findings.`);
  for (const finding of result.findings) console.log(`${finding.kind}: ${JSON.stringify(finding.path)}`);
  console.log('Known-pattern guardrails only; review publishable files manually before publishing.');
  process.exitCode = result.ok ? 0 : 1;
}
