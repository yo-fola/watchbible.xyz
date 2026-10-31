// Curated catalogue data, NOT a user's watched list. Identities/artwork/genres
// verified through the running TMDB API; evidence: artifacts/verification/gamification-roster-*.json.
const genreNames = { 28: 'Action', 878: 'Science Fiction', 12: 'Adventure', 14: 'Fantasy' };
function movie(id, title, year, poster, overview, genres) {
  return { catalogueId: `tmdb:movie:${id}`, tmdbId: id, provider: 'TMDB', title, year, format: 'movie',
    posterUrl: `https://image.tmdb.org/t/p/w500/${poster}.jpg`, sourceUrl: `https://www.themoviedb.org/movie/${id}`,
    overview, genreIds: genres, genres: genres.map(id => ({ id, name: genreNames[id] })), anime: null };
}
export const COLLECTIONS = [{
  id: 'mcu-phase-one', name: 'MCU · Phase One', version: 1,
  description: 'The six Phase One feature films, in release order. Not every Marvel film or series.',
  sourceUrl: 'https://en.wikipedia.org/wiki/Marvel_Cinematic_Universe%3A_Phase_One',
  referenceUrl: 'https://marvel.com/articles/movies/the-essential-marvel-cinematic-universe-watch-guide',
  tiers: [1, 3, 5],
  members: [
    movie(1726, 'Iron Man', '2008', '78lPtwv72eTNqFW9COBYI0dWDJa', 'After being held captive in an Afghan cave, billionaire engineer Tony Stark creates a unique weaponized suit of armor to fight evil.', [28, 878, 12]),
    movie(1724, 'The Incredible Hulk', '2008', 'gKzYx79y0AQTL4UAk1cBQJ3nvrm', 'Scientist Bruce Banner scours the planet for an antidote to the unbridled force of rage within him: the Hulk. But when the military masterminds who dream of exploiting his powers force him back to civilization, he finds himself coming face to face with a new, deadly foe.', [878, 28, 12]),
    movie(10138, 'Iron Man 2', '2010', '6WBeq4fCfn7AN0o21W9qNcRF2l9', "With the world now aware of his dual life as the armored superhero Iron Man, billionaire inventor Tony Stark faces pressure from the government, the press and the public to share his technology with the military. Unwilling to let go of his invention, Stark, with Pepper Potts and James 'Rhodey' Rhodes at his side, must forge new alliances – and confront powerful enemies.", [12, 28, 878]),
    movie(10195, 'Thor', '2011', 'prSfAi1xGrhLQNxVSUFh61xQ4Qy', "Against his father Odin's will, The Mighty Thor - a powerful but arrogant warrior god - recklessly reignites an ancient war. Thor is cast down to Earth and forced to live among humans as punishment. Once here, Thor learns what it takes to be a true hero when the most dangerous villain of his world sends the darkest forces of Asgard to invade Earth.", [12, 14, 28]),
    movie(1771, 'Captain America: The First Avenger', '2011', 'vSNxAJTlD0r02V9sPYpOjqDZXUK', "During World War II, Steve Rogers is a sickly man from Brooklyn who's transformed into super-soldier Captain America to aid in the war effort. Rogers must stop the Red Skull – Adolf Hitler's ruthless head of weaponry, and the leader of an organization that intends to use a mysterious device of untold powers for world domination.", [28, 12, 878]),
    movie(24428, 'The Avengers', '2012', 'RYMX2wcKCBAr24UyPD7xwmjaTn', 'When an unexpected enemy emerges and threatens global safety and security, Nick Fury, director of the international peacekeeping agency known as S.H.I.E.L.D., finds himself in need of a team to pull the world back from the brink of disaster. Spanning the globe, a daring recruitment effort begins!', [878, 28, 12]),
  ],
}, {
  id: 'harry-potter', name: 'Harry Potter', version: 1,
  description: 'The eight original Harry Potter films, in release order. Excludes Fantastic Beasts and TV adaptations.',
  sourceUrl: 'https://www.harrypotter.com/discover/films',
  referenceUrl: 'https://www.themoviedb.org/collection/1241',
  tiers: [2, 4, 7],
  // Public API evidence: artifacts/verification/harry-potter-roster.json.
  members: [
    movie(671, "Harry Potter and the Philosopher's Stone", '2001', 'wuMc08IPKEatf9rnMNXvIDxqP4W', "Harry Potter has lived under the stairs at his aunt and uncle's house his whole life. But on his 11th birthday, he learns he's a powerful wizard—with a place waiting for him at the Hogwarts School of Witchcraft and Wizardry.", [12, 14]),
    movie(672, 'Harry Potter and the Chamber of Secrets', '2002', 'sdEOH0992YZ0QSxgXNIGLq1ToUi', 'Cars fly, trees fight back, and a mysterious house-elf comes to warn Harry Potter at the start of his second year at Hogwarts. Adventure and danger await when bloody writing on a wall announces: The Chamber Of Secrets Has Been Opened.', [12, 14]),
    movie(673, 'Harry Potter and the Prisoner of Azkaban', '2004', 'aWxwnYoe8p2d2fcxOqtvAtJ72Rw', 'Year three at Hogwarts means new fun and new challenges as Harry learns the delicate art of approaching a Hippogriff, transforming shape-shifting Boggarts into hilarity and even turning back time.', [12, 14]),
    movie(674, 'Harry Potter and the Goblet of Fire', '2005', 'fECBtHlr0RB3foNHDiCBXeg9Bv9', 'After his name emerges from the Goblet of Fire, Harry Potter becomes a competitor in a grueling battle for glory among three wizarding schools in the Triwizard Tournament.', [12, 14]),
    movie(675, 'Harry Potter and the Order of the Phoenix', '2007', '5aOyriWkPec0zUDxmHFP9qMmBaj', 'Returning for his fifth year at Hogwarts, Harry is stunned to find that his warnings about the return of Lord Voldemort have been ignored.', [12, 14]),
    movie(767, 'Harry Potter and the Half-Blood Prince', '2009', 'z7uo9zmQdQwU5ZJHFpv2Upl30i1', 'As Lord Voldemort tightens his grip on both the Muggle and wizarding worlds, Hogwarts is no longer a safe haven.', [12, 14]),
    movie(12444, 'Harry Potter and the Deathly Hallows: Part 1', '2010', 'iGoXIpQb7Pot00EEdwpwPajheZ5', "Harry, Ron and Hermione walk away from their last year at Hogwarts to find and destroy the remaining Horcruxes, putting an end to Voldemort's bid for immortality.", [12, 14]),
    movie(12445, 'Harry Potter and the Deathly Hallows: Part 2', '2011', 'c54HpQmuwXjHq2C9wmoACjxoom3', 'Harry, Ron and Hermione continue their quest to vanquish the evil Voldemort once and for all.', [12, 14]),
  ],
}];
