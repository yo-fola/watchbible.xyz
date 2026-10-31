import { appStore } from './app.mjs';
import { createAppStore } from './app-state.mjs';

const status = document.querySelector('#tmdb-status');
const feedback = document.querySelector('#tmdb-feedback');
const testButton = document.querySelector('#test-tmdb');
const labels = { missing: 'Token not configured', untested: 'Ready to test', connected: 'Connected', failed: 'Check failed' };

async function loadStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.provider !== 'TMDB' || !(data.state in labels)) throw new Error('API unavailable');
    status.textContent = labels[data.state];
    status.title = data.checkedAt ? `Last verified: ${data.checkedAt}` : '';
    feedback.textContent = data.configured ? '' : 'Start the launcher to enter your token.';
    testButton.disabled = false;
  } catch {
    status.textContent = 'API server offline';
    feedback.textContent = 'Run start-watchbible.zsh, then open port 8766.';
    testButton.disabled = true;
  }
}

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  testButton.textContent = 'Testing…';
  feedback.textContent = '';
  try {
    const response = await fetch('/api/tmdb/test', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = response.status === 503 ? 'Token not configured' : 'Check failed';
      feedback.textContent = typeof data.error === 'string' ? data.error : 'Connection failed.';
      return;
    }
    if (data.provider !== 'TMDB' || data.status !== 'connected') throw new Error('Invalid response');
    status.textContent = 'Connected';
    status.title = `Verified: ${data.checkedAt}`;
    feedback.textContent = 'TMDB verified.';
  } catch {
    status.textContent = 'Check failed';
    feedback.textContent = 'Could not reach the local API server.';
  } finally {
    testButton.disabled = false;
    testButton.textContent = 'Test connection';
  }
});

const dataFeedback = document.querySelector('#data-feedback');
const restoreFile = document.querySelector('#restore-file');
const preview = document.querySelector('#restore-preview');
let pendingBackup = null;
let fileRevision = 0;

function renderDataStatus() {
  const state = appStore.getState();
  document.querySelector('#storage-state').textContent = appStore.loadError ? 'Recovery needed' : 'Saved on this browser';
  document.querySelector('#saved-count').textContent = appStore.loadError ? 'Unreadable · export before recovery' : `${state.library.length} titles`;
  document.querySelector('#hidden-count').textContent = appStore.loadError ? '—' : state.dismissed.length;
  if (appStore.loadError) dataFeedback.textContent = 'Local data could not be read. Export the recoverable data before restoring a valid backup.';
}

document.querySelector('#export-data').addEventListener('click', () => {
  try {
    const data = appStore.exportJSON();
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `watchbible-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dataFeedback.textContent = appStore.loadError ? 'Recovery export prepared. Keep this original file.' : 'Backup download prepared.';
  } catch { dataFeedback.textContent = 'Could not prepare a backup. Existing data is unchanged.'; }
});

restoreFile.addEventListener('change', async () => {
  const file = restoreFile.files[0];
  const revision = ++fileRevision;
  pendingBackup = null;
  preview.hidden = true;
  if (!file) return;
  try {
    const text = await file.text();
    if (revision !== fileRevision) return;
    // Run the exact state validator in an isolated in-memory store first.
    const validation = createAppStore({ getItem: () => null, setItem() {} });
    validation.restoreJSON(text);
    const incoming = validation.getState();
    pendingBackup = text;
    document.querySelector('#restore-summary').textContent = `${incoming.library.length} titles · ${incoming.dismissed.length} hidden picks`;
    preview.hidden = false;
    dataFeedback.textContent = 'Backup checked. Nothing replaced yet.';
  } catch {
    if (revision === fileRevision) dataFeedback.textContent = 'Invalid or unsupported backup. Nothing changed.';
  }
});

document.querySelector('#cancel-restore').addEventListener('click', () => {
  fileRevision += 1;
  pendingBackup = null;
  preview.hidden = true;
  restoreFile.value = '';
  dataFeedback.textContent = 'Restore cancelled. Nothing changed.';
});
document.querySelector('#confirm-restore').addEventListener('click', () => {
  if (pendingBackup === null) return;
  try {
    appStore.restoreJSON(pendingBackup);
    pendingBackup = null;
    fileRevision += 1;
    preview.hidden = true;
    restoreFile.value = '';
    dataFeedback.textContent = `Restored: ${appStore.getState().library.length} titles. Preferences and import draft restored too.`;
  } catch { dataFeedback.textContent = 'Restore failed. Nothing replaced; keep your backup and check browser storage.'; }
});

appStore.subscribe(renderDataStatus);
renderDataStatus();
loadStatus();
