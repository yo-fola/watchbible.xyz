import { createTitlePanel } from './title-panel.mjs';
import { appStore } from './app.mjs';

// onChoice(action, candidate) may return false (keep open) or throw (show failure).
// open(candidate, {region}) and close() never persist a choice themselves.
export function createDiscoveryDialog({ onChoice } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'discovery-dialog';
  dialog.setAttribute('aria-label', 'Title details');
  const heading = document.createElement('div');
  heading.className = 'dialog-heading';
  const title = document.createElement('h2');
  title.textContent = 'Title details';
  const closeButton = document.createElement('button');
  closeButton.type = 'button'; closeButton.className = 'quiet-button dialog-close';
  closeButton.setAttribute('aria-label', 'Close title dialog');
  closeButton.title = 'Close';
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  heading.append(title, closeButton);
  const container = document.createElement('div');
  const actions = document.createElement('div'); actions.className = 'film-actions';
  const feedback = document.createElement('p'); feedback.className = 'note'; feedback.setAttribute('role', 'status');
  dialog.append(heading, container, actions, feedback);
  document.body.append(dialog);
  let selected = null, opener = null, revision = 0;
  const panel = createTitlePanel(container);
  function restoreFocus() {
    if (opener?.isConnected && opener !== document.body && !dialog.contains(opener)) opener.focus();
    else (document.querySelector('#starter-stage:not([hidden]) #starter-heading') || document.getElementById('home-search') || document.querySelector('main[tabindex]'))?.focus();
  }
  function close() { ++revision; dialog.close(); panel.cancel(); restoreFocus(); }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Native close events may be queued after an immediate re-open.
  dialog.addEventListener('close', () => { if (!dialog.open) { panel.cancel(); restoreFocus(); } });
  for (const [value, label] of [['watch_later', 'Watch later'], ['watched', 'Watched'], ['not_for_me', 'Not for me']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.dataset.choice = value; button.textContent = label;
    button.addEventListener('click', async () => {
      if (!selected || !dialog.open) return;
      const current = revision;
      const metadata = panel.getMetadata();
      const candidate = metadata?.catalogueId === selected.catalogueId ? { ...selected, ...metadata } : selected;
      try {
        const result = await onChoice?.(value, candidate);
        if (current === revision && dialog.open && result !== false) close();
      } catch { if (current === revision && dialog.open) feedback.textContent = 'Could not save this choice. Nothing changed. Retry or open Settings.'; }
    });
    actions.append(button);
  }
  return {
    open(candidate, { region = appStore.getState().preferences.region } = {}) {
      ++revision; selected = structuredClone(candidate); opener = document.activeElement;
      feedback.textContent = '';
      if (!dialog.open) dialog.showModal();
      closeButton.focus();
      void panel.show(selected, { region });
    },
    close,
  };
}
