import { getProgress } from './gamification-model.mjs';

// A disclosure of ordinary links, not an ARIA menu or an account login.
export function mountUserMenu(store, { header = document.querySelector('.app-bar') } = {}) {
  if (!header || header.querySelector('#user-menu-button')) return () => {};
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => new URL(link.href).pathname.endsWith('/gamification.css'))) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./gamification.css', import.meta.url).href; document.head.append(style);
  }
  const host = document.createElement('div'); host.className = 'user-menu';
  const button = document.createElement('button'); button.id = 'user-menu-button'; button.type = 'button'; button.className = 'quiet-button user-menu-button';
  button.setAttribute('aria-label', 'User menu'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'user-menu-panel');
  const avatar = document.createElement('span'); avatar.className = 'user-avatar'; avatar.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.className = 'user-menu-label';
  button.append(avatar, label);
  const panel = document.createElement('div'); panel.id = 'user-menu-panel'; panel.className = 'user-menu-panel'; panel.hidden = true;
  const name = document.createElement('p'); name.className = 'user-menu-name';
  const summary = document.createElement('p'); summary.className = 'user-menu-summary';
  const meter = document.createElement('progress'); meter.max = 500; meter.setAttribute('aria-label', 'XP towards next level');
  const note = document.createElement('p'); note.className = 'note'; note.textContent = 'Local profile · this browser only';
  const links = document.createElement('div'); links.className = 'user-menu-links';
  for (const [text, href] of [['Profile', 'profile.html'], ['Collections', 'collections.html'], ['Achievements', 'achievements.html'], ['Preferences', 'onboarding.html?edit=1'], ['Settings & backups', 'setup.html']]) {
    const link = document.createElement('a'); link.textContent = text; link.href = href; links.append(link);
  }
  panel.append(name, summary, meter, note, links); host.append(button, panel); header.append(host);
  function close(restore = false) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (restore) button.focus(); }
  function toggle() { const opening = panel.hidden; panel.hidden = !opening; button.setAttribute('aria-expanded', String(opening)); }
  function outside(event) { if (!panel.hidden && !host.contains(event.target)) close(); }
  function escape(event) { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); } }
  function focusOut(event) { if (event.relatedTarget && !host.contains(event.relatedTarget)) close(); }
  function render() {
    if (store.loadError) { name.textContent = 'Your profile'; label.textContent = 'Profile'; avatar.textContent = '•'; summary.textContent = 'Saved progress unavailable · open Settings'; meter.hidden = true; return; }
    const state = store.getState(); const displayName = state.gamification.profile.displayName.trim(); const progress = getProgress(state);
    name.textContent = displayName || 'Your profile'; label.textContent = displayName || 'Profile';
    avatar.textContent = displayName ? displayName.split(/\s+/u).slice(0, 2).map(word => [...word][0]).join('').toLocaleUpperCase() : '•';
    summary.textContent = `Level ${progress.level} · ${progress.xp} XP`; meter.hidden = false; meter.value = progress.levelXP; meter.max = progress.nextLevelXP;
  }
  button.addEventListener('click', toggle); document.addEventListener('click', outside); document.addEventListener('keydown', escape); host.addEventListener('focusout', focusOut);
  const unsubscribe = store.subscribe(render); render();
  return () => { unsubscribe(); button.removeEventListener('click', toggle); document.removeEventListener('click', outside); document.removeEventListener('keydown', escape); host.removeEventListener('focusout', focusOut); host.remove(); };
}
