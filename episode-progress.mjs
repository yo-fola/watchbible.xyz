import { toLibraryEntry } from './library-actions.mjs';

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const validSeason = value => Number.isSafeInteger(value) && value >= 0;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function seasonIdentity(season) {
  return season && positiveId(season.seriesId) && validSeason(season.seasonNumber) &&
    season.catalogueId === `tmdb:series:${season.seriesId}`;
}
function episodeIdentity(season, episode) {
  return episode && positiveId(episode.episodeId) && positiveId(episode.episodeNumber) &&
    episode.seasonNumber === season.seasonNumber;
}

export function setEpisodeStatus(draft, series, season, episode, status) {
  if (!series || series.provider !== 'TMDB' || series.format !== 'series' || !positiveId(series.tmdbId) ||
    series.catalogueId !== `tmdb:series:${series.tmdbId}` || !seasonIdentity(season) ||
    season.seriesId !== series.tmdbId || !episodeIdentity(season, episode) ||
    ![null, 'watched', 'watching'].includes(status)) throw new TypeError('Invalid episode action identity/status.');
  if (status !== null && (!validDate(episode.airDate) || episode.airDate > new Date().toISOString().slice(0, 10))) {
    throw new TypeError('Episode has not aired or its air date is unknown.');
  }
  const record = { seriesId: season.seriesId, seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber, episodeId: episode.episodeId, status };
  const index = draft.episodeProgress.findIndex(old => old.seriesId === record.seriesId &&
    old.seasonNumber === record.seasonNumber && old.episodeNumber === record.episodeNumber && old.episodeId === record.episodeId);
  if (status === null) {
    if (index !== -1) draft.episodeProgress.splice(index, 1);
    return;
  }
  if (index === -1) draft.episodeProgress.push(record);
  else draft.episodeProgress[index] = record;
  const existing = draft.library.find(entry => entry.catalogueId === series.catalogueId);
  if (!existing) draft.library.push({ ...toLibraryEntry(series), status: 'watching' });
  else if (existing.status === 'plan_to_watch') existing.status = 'watching';
}

// Progress is evidence about this exact provider roster, never a whole-show inference.
export function getSeasonProgress(state, season, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!validDate(today)) throw new TypeError('Invalid progress date.');
  const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
  const result = { watched: 0, total: episodes.length, watching: 0, complete: false,
    caughtUp: false, unreleased: 0, unknownAirDates: 0 };
  let validRoster = Boolean(seasonIdentity(season)) && episodes.length > 0;
  let aired = 0;
  let airedWatched = 0;
  const ids = new Set();
  const positions = new Set();
  const records = Array.isArray(state?.episodeProgress) ? state.episodeProgress : [];
  for (const episode of episodes) {
    if (!validDate(episode?.airDate)) result.unknownAirDates++;
    else if (episode.airDate > today) result.unreleased++;
    const valid = seasonIdentity(season) && episodeIdentity(season, episode) &&
      !ids.has(episode.episodeId) && !positions.has(episode.episodeNumber);
    if (!valid) { validRoster = false; continue; }
    ids.add(episode.episodeId); positions.add(episode.episodeNumber);
    const record = records.find(old => old?.seriesId === season.seriesId && old.seasonNumber === season.seasonNumber &&
      old.episodeNumber === episode.episodeNumber && old.episodeId === episode.episodeId);
    if (record?.status === 'watched') result.watched++;
    if (record?.status === 'watching') result.watching++;
    if (validDate(episode.airDate) && episode.airDate <= today) {
      aired++;
      if (record?.status === 'watched') airedWatched++;
    }
  }
  result.complete = validRoster && result.unreleased === 0 && result.unknownAirDates === 0 && result.watched === result.total;
  result.caughtUp = validRoster && aired > 0 && airedWatched === aired;
  return result;
}
