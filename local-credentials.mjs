// Server-only credential loader. Never add this module to the static allowlist.
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const MAX_BYTES = 8192;
const fail = () => new Error('Local TMDB credential unavailable: invalid format or unsafe permissions. Run /bin/zsh setup-watchbible-token.zsh privately.');
function validToken(token) {
  return typeof token === 'string' && token.length > 0 && Buffer.byteLength(token) <= MAX_BYTES
    && /^[\x21-\x7e]+$/.test(token) && !/^bearer/i.test(token)
    && !/^[a-f0-9]{32}$/i.test(token) && !/^["']|["']$/.test(token);
}
function privateMetadata(stat, mode, directory = false) {
  if (stat.uid !== process.getuid() || (stat.mode & 0o7777) !== mode
      || (directory ? !stat.isDirectory() : !stat.isFile())) throw fail();
}

export async function loadServerToken({ directory = projectRoot, env = process.env } = {}) {
  const override = env.TMDB_READ_ACCESS_TOKEN;
  if (override !== undefined && override !== '') {
    if (!validToken(override)) throw fail();
    return { token: override, source: 'environment' };
  }
  const folder = join(directory, '.watchbible');
  const file = join(folder, 'tmdb-read-access-token');
  let handle;
  try {
    const folderStat = await lstat(folder);
    privateMetadata(folderStat, 0o700, true);
    const fileStat = await lstat(file);
    privateMetadata(fileStat, 0o600);
    if (fileStat.size > MAX_BYTES + 1) throw fail();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    privateMetadata(opened, 0o600);
    if (opened.dev !== fileStat.dev || opened.ino !== fileStat.ino) throw fail();
    const bytes = Buffer.alloc(MAX_BYTES + 2);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES + 1) throw fail();
    let token = bytes.subarray(0, bytesRead).toString('utf8');
    if (token.endsWith('\n')) token = token.slice(0, -1);
    if (!token) return { token: '', source: 'missing' };
    if (!validToken(token)) throw fail();
    const folderAfter = await lstat(folder);
    privateMetadata(folderAfter, 0o700, true);
    if (folderAfter.ino !== folderStat.ino || folderAfter.dev !== folderStat.dev) throw fail();
    return { token, source: 'local_file' };
  } catch (error) {
    if (error.code === 'ENOENT') return { token: '', source: 'missing' };
    throw fail();
  } finally {
    if (handle) await handle.close();
  }
}
