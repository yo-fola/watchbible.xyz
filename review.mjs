import { parseTitleList } from './importer.mjs';
import { appStore } from './app.mjs';

const source = document.querySelector('#title-list');
const fileInput = document.querySelector('#text-file');
const list = document.querySelector('#review-list');
const summary = document.querySelector('#summary');
let entries = [];
let revision = 0;
const draftNotice = document.querySelector('#draft-state');

function persistDraft() {
  try {
    appStore.transact(draft => {
      draft.importDraft = source.value || entries.length ? {
        text: source.value,
        entries: entries.map(({ originalLine, title, status }) => ({ originalLine, title, status })),
      } : null;
    });
    draftNotice.textContent = 'Saved draft';
  } catch { draftNotice.textContent = 'Not saved · check Settings'; }
}

function updateSummary() {
  if (entries.length === 0) {
    summary.textContent = 'No titles';
    return;
  }
  const unchosen = entries.filter(entry => entry.status === null).length;
  const empty = entries.filter(entry => entry.title.trim() === '').length;
  summary.textContent = `${entries.length} titles · ${unchosen} need status${empty ? ` · ${empty} empty` : ''}`;
}

function renderReview(savedEntries = null, save = true) {
  entries = savedEntries ? savedEntries.map(entry => ({ ...entry })) : parseTitleList(source.value);
  list.replaceChildren();
  entries.forEach((entry, index) => {
    const row = document.createElement('article');
    row.className = 'review-row';
    const fields = document.createElement('div');
    fields.className = 'row-fields';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = `Title ${index + 1}`;
    const title = document.createElement('input');
    title.type = 'text';
    title.value = entry.title;
    title.required = true;
    title.addEventListener('input', () => {
      entry.title = title.value;
      title.setCustomValidity(title.value.trim() ? '' : 'Enter a title before continuing.');
      updateSummary();
      persistDraft();
    });
    titleLabel.append(title);
    const statusLabel = document.createElement('label');
    statusLabel.textContent = 'Status';
    const status = document.createElement('select');
    for (const [value, label] of [['', 'Choose status'], ['watched', 'Watched'], ['plan_to_watch', 'Watch later'], ['watching', 'Watching']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      status.append(option);
    }
    status.value = entry.status ?? '';
    status.addEventListener('change', () => {
      entry.status = status.value || null;
      updateSummary();
      persistDraft();
    });
    statusLabel.append(status);
    fields.append(titleLabel, statusLabel);
    const original = document.createElement('details');
    original.className = 'original';
    const originalHeading = document.createElement('summary');
    originalHeading.textContent = 'Original';
    const originalText = document.createElement('p');
    // Imported text is data, never executable HTML.
    originalText.textContent = entry.originalLine;
    original.append(originalHeading, originalText);
    row.append(fields, original);
    list.append(row);
  });
  updateSummary();
  if (save) persistDraft();
}

source.addEventListener('input', () => {
  revision += 1; // A pending file read must not replace newer pasted text.
  fileInput.value = '';
  renderReview();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const requestedRevision = ++revision;
  summary.textContent = 'Reading…';
  try {
    const text = await file.text();
    if (requestedRevision !== revision) return;
    source.value = text;
    renderReview();
  } catch {
    if (requestedRevision === revision) {
      summary.textContent = 'File unreadable. List unchanged—retry or paste.';
    }
  }
});

document.querySelector('#clear').addEventListener('click', () => {
  revision += 1;
  source.value = '';
  fileInput.value = '';
  renderReview();
  source.focus();
});

const savedDraft = appStore.getState().importDraft;
if (savedDraft) {
  source.value = savedDraft.text;
  renderReview(savedDraft.entries, false);
  draftNotice.textContent = 'Saved draft';
}
if (appStore.loadError) draftNotice.textContent = 'Recovery needed · Settings';
