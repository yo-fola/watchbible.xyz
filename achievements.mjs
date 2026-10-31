import { appStore } from './app.mjs';
import { getProgress } from './gamification-model.mjs';

const statusOf = badge => badge.earned ? 'earned' : badge.count > 0 ? 'in-progress' : 'locked';
const labels = { earned: 'Earned', 'in-progress': 'In progress', locked: 'Locked' };
const families = { franchise: 'Franchise', genre: 'Genre', type: 'Type' };
const textNode = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

function badgeCard(badge) {
  const card = document.createElement('article');
  const status = statusOf(badge);
  card.className = 'achievement-card';
  card.dataset.status = status;
  card.dataset.family = badge.family;
  card.dataset.badgeId = badge.id;
  card.dataset.tier = badge.tier;
  const header = document.createElement('div'); header.className = 'achievement-card-heading';
  const tier = String(badge.tier);
  header.append(textNode('p', `${families[badge.family]} · ${tier.charAt(0).toUpperCase() + tier.slice(1)}`, 'achievement-tier'), textNode('p', labels[status], 'achievement-state'));
  card.append(header, textNode('h3', badge.name), textNode('p', badge.scope, 'achievement-scope'), textNode('p', badge.description, 'achievement-description'));
  card.append(textNode('p', `${badge.count} / ${badge.target} qualifying watched movies`, 'achievement-requirement'));
  const meter = document.createElement('progress');
  meter.max = badge.target;
  meter.value = Math.min(badge.count, badge.target);
  meter.setAttribute('aria-label', `${badge.name}: ${badge.count} of ${badge.target} qualifying watched movies`);
  card.append(meter);
  card.append(textNode('p', badge.earned
    ? `Earned by meeting the ${badge.target}-movie requirement for this scope.`
    : `Watch ${Math.max(0, badge.target - badge.count)} more qualifying ${badge.target - badge.count === 1 ? 'movie' : 'movies'} to earn this badge.`, 'achievement-reason'));
  if (badge.earned && badge.earnedAt) {
    const recognised = textNode('p', '', 'achievement-date');
    recognised.append(document.createTextNode('Recognition recorded: '));
    const time = textNode('time', badge.earnedAt); time.dateTime = badge.earnedAt;
    recognised.append(time); card.append(recognised);
  }
  return card;
}

export function mountAchievements({ root = document.querySelector('#achievements-root'), store = appStore } = {}) {
  if (!root) return () => {};
  const $ = selector => root.querySelector(selector);
  const family = $('#achievement-family');
  const status = $('#achievement-status');
  function render() {
    const failed = Boolean(store.loadError);
    $('#achievements-recovery').hidden = !failed;
    $('#achievements-data').hidden = failed;
    if (failed) {
      $('#achievements-feedback').textContent = 'Saved data could not be read. Achievements are unavailable; recover your local data in Settings.';
      return;
    }
    const badges = getProgress(store.getState()).badges;
    const earned = badges.filter(badge => badge.earned).length;
    $('#achievements-summary').textContent = `${earned} earned ${earned === 1 ? 'badge' : 'badges'} · ${badges.length} available milestones`;
    const visible = badges.filter(badge => (!family.value || badge.family === family.value) && (!status.value || statusOf(badge) === status.value));
    $('#achievement-results').textContent = `${visible.length} ${visible.length === 1 ? 'achievement' : 'achievements'}`;
    $('#achievements-empty').hidden = visible.length !== 0;
    $('#achievement-groups').replaceChildren();
    for (const state of ['earned', 'in-progress', 'locked']) {
      const group = visible.filter(badge => statusOf(badge) === state);
      if (group.length === 0) continue;
      const section = document.createElement('section'); section.className = 'achievement-group';
      const heading = textNode('h2', `${labels[state]} · ${group.length}`);
      heading.id = `achievement-group-${state}`;
      section.setAttribute('aria-labelledby', heading.id);
      const grid = document.createElement('div'); grid.className = 'achievement-grid';
      grid.append(...group.map(badgeCard));
      section.append(heading, grid);
      $('#achievement-groups').append(section);
    }
    $('#achievements-feedback').textContent = '';
  }
  function reset() { family.value = ''; status.value = ''; render(); }
  family.addEventListener('change', render);
  status.addEventListener('change', render);
  $('#reset-achievement-filters').addEventListener('click', reset);
  const unsubscribe = store.subscribe(render);
  render();
  return () => {
    unsubscribe();
    family.removeEventListener('change', render);
    status.removeEventListener('change', render);
    $('#reset-achievement-filters').removeEventListener('click', reset);
  };
}

if (typeof document !== 'undefined' && document.querySelector('#achievements-root')) mountAchievements();
