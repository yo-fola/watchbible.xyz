import { COLLECTIONS } from './collection-definitions.mjs';

const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };
const watchedMovies = state => [...new Map(state.library.filter(entry => entry.format === 'movie' && entry.status === 'watched')
  .map(entry => [entry.catalogueId, entry])).values()];
const memberIds = collection => [...new Set(collection.members.filter(member => member.format === 'movie')
  .map(member => member.catalogueId))];
const tierNames = ['bronze', 'silver', 'gold'];

export function getCollectionProgress(state, collection) {
  const members = new Set(memberIds(collection));
  const watched = watchedMovies(state).filter(movie => members.has(movie.catalogueId)).length;
  const total = members.size;
  return { watched, total, percent: total ? watched / total * 100 : 0, complete: total > 0 && watched === total };
}

function badgeRules(state, collections) {
  const rules = [];
  const movies = watchedMovies(state);
  for (const [scope, name, eligible] of [
    ['movie', 'Movies', movies], ['anime', 'Anime movies', movies.filter(movie => movie.anime === true)],
    ...Object.entries(GENRES).map(([id, name]) => [`genre:${id}`, name, movies.filter(movie => movie.genreIds?.includes(Number(id))) ]),
  ]) {
    for (const [index, target] of [5, 15, 30].entries()) {
      const tier = tierNames[index];
      rules.push({ id: `${scope}:${tier}`, name: `${name} · ${tier}`, family: scope.startsWith('genre:') ? 'genre' : 'type',
        tier, target, scope, definitionVersion: 1, eligibleIds: eligible.map(movie => movie.catalogueId),
        description: `Watch ${target} distinct ${name.toLowerCase()} movies.` });
    }
  }
  for (const collection of collections) {
    const eligibleIds = memberIds(collection);
    for (const [index, target] of collection.tiers.entries()) {
      const tier = tierNames[index];
      rules.push({ id: `franchise:${collection.id}:${tier}`, name: `${collection.name} · ${tier}`,
        family: 'franchise', tier, target, scope: collection.id, definitionVersion: collection.version,
        eligibleIds, description: `Watch ${target} distinct movies in ${collection.name}.` });
    }
    if (eligibleIds.length) rules.push({ id: `franchise:${collection.id}:complete:v${collection.version}`,
      name: `${collection.name} · Set Complete`, family: 'franchise', tier: 'complete', target: eligibleIds.length,
      scope: collection.id, definitionVersion: collection.version, eligibleIds,
      description: `Complete all ${eligibleIds.length} movies in ${collection.name}, version ${collection.version}.` });
  }
  return rules;
}

function awardRule(state, award, collections) {
  const rules = badgeRules(state, collections);
  const current = rules.find(rule => rule.id === award.id);
  if (current && current.definitionVersion >= award.definitionVersion) return { ...current,
    eligibleIds: award.eligibleIds, target: current.tier === 'complete' ? award.eligibleIds.length : current.target };
  const match = /^franchise:(.+):complete:v([1-9]\d*)$/.exec(award.id);
  const collection = match && collections.find(collection => collection.id === match[1]);
  if (!collection || Number(match[2]) !== award.definitionVersion || award.definitionVersion > collection.version) return null;
  return { id: award.id, name: `${collection.name} · Set Complete (v${award.definitionVersion})`, family: 'franchise',
    tier: 'complete', target: award.eligibleIds.length, scope: collection.id, definitionVersion: award.definitionVersion,
    eligibleIds: award.eligibleIds, description: `Complete the ${award.eligibleIds.length}-movie version ${award.definitionVersion} set.` };
}

export function awardHasEvidence(state, award, { collections = COLLECTIONS } = {}) {
  const rule = awardRule(state, award, collections);
  if (!rule || !rule.target || award.evidence.length !== rule.target) return false;
  if (rule.family === 'franchise') {
    const collection = collections.find(collection => collection.id === rule.scope);
    const members = memberIds(collection);
    if (award.eligibleIds.some(id => !members.includes(id))) return false;
    if (award.definitionVersion === collection.version && (award.eligibleIds.length !== members.length ||
      members.some(id => !award.eligibleIds.includes(id)))) return false;
  } else if (award.definitionVersion !== 1) return false;
  const movies = new Map(watchedMovies(state).map(movie => [movie.catalogueId, movie]));
  return award.evidence.every(id => {
    const movie = movies.get(id);
    return movie && award.eligibleIds.includes(id) &&
      (rule.scope !== 'anime' || movie.anime === true) &&
      (!rule.scope.startsWith('genre:') || movie.genreIds?.includes(Number(rule.scope.slice(6))));
  });
}

export function getProgress(state, { collections = COLLECTIONS } = {}) {
  const movies = watchedMovies(state);
  const watchedIds = new Set(movies.map(movie => movie.catalogueId));
  const credited = new Set(state.gamification.credits.map(credit => credit.catalogueId));
  const xp = movies.filter(movie => credited.has(movie.catalogueId)).length * 100;
  const rules = badgeRules(state, collections);
  for (const award of state.gamification.awards) {
    if (!rules.some(rule => rule.id === award.id) && awardHasEvidence(state, award, { collections })) {
      const rule = awardRule(state, award, collections);
      if (rule) rules.push(rule);
    }
  }
  const badges = rules.map(rule => {
    const count = rule.eligibleIds.filter(id => watchedIds.has(id)).length;
    const { eligibleIds, definitionVersion, ...badge } = rule;
    const award = state.gamification.awards.find(award => award.id === rule.id && awardHasEvidence(state, award, { collections }));
    return { ...badge, count, earned: count >= rule.target, earnedAt: award?.earnedAt ?? null };
  });
  return { xp, level: 1 + Math.floor(xp / 500), levelXP: xp % 500, nextLevelXP: 500,
    pendingRecognition: movies.filter(movie => !credited.has(movie.catalogueId)).map(movie => movie.catalogueId),
    watchedMovies: movies.length, badges };
}

export function recognizeHistory(draft, ids, now = new Date().toISOString()) {
  const selected = new Set(ids);
  const credited = new Set(draft.gamification.credits.map(credit => credit.catalogueId));
  for (const movie of watchedMovies(draft)) {
    if (selected.has(movie.catalogueId) && !credited.has(movie.catalogueId)) {
      draft.gamification.credits.push({ catalogueId: movie.catalogueId, recognizedAt: now });
      credited.add(movie.catalogueId);
    }
  }
}

export function syncGamification(previous, next, now = new Date().toISOString(), { collections = COLLECTIONS } = {}) {
  const priorWatched = new Set(watchedMovies(previous).map(movie => movie.catalogueId));
  const currentWatched = new Set(watchedMovies(next).map(movie => movie.catalogueId));
  next.gamification.credits = next.gamification.credits.filter(credit => currentWatched.has(credit.catalogueId));
  recognizeHistory(next, [...currentWatched].filter(id => !priorWatched.has(id)), now);
  const rules = badgeRules(next, collections);
  next.gamification.awards = next.gamification.awards.filter(award => awardHasEvidence(next, award, { collections }));
  for (const rule of rules) {
    if (next.gamification.awards.some(award => award.id === rule.id)) continue;
    const evidence = rule.eligibleIds.filter(id => currentWatched.has(id)).slice(0, rule.target);
    if (evidence.length < rule.target) continue;
    next.gamification.awards.push({ id: rule.id, definitionVersion: rule.definitionVersion,
      eligibleIds: [...rule.eligibleIds], evidence, earnedAt: now });
  }
}
