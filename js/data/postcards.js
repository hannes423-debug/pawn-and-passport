/**
 * postcards.js - the six optional collectibles and the secret they add up to.
 *
 * A postcard is won by finishing its casual venue's puzzle mission. The back
 * of each carries one line of a message. Read in the journal's order, the
 * first letters of the six lines spell B-E-Y-O-N-D; the reveal page only
 * unlocks once all six are held, and it grants no gameplay advantage.
 *
 * These lines TEASE the larger Chess: World Tour. They must stay rumours and
 * never read as promises of shipped features.
 */

export const POSTCARDS = Object.freeze([
  {
    id: 'pc-nyc', clubId: 'nyc', order: 1, letter: 'B', image: 'assets/postcards/nyc.webp',
    front: 'Greetings from Bethesda Terrace',
    stamp: 'NYC', from: 'Marcus, by the fountain',
    secret: 'Born on park benches, most players never leave the park. You will. Keep this card: there are five more, and somebody is counting.'
  },
  {
    id: 'pc-lon', clubId: 'lon', order: 2, letter: 'E', image: 'assets/postcards/lon.webp',
    front: 'Greetings from the South Bank',
    stamp: 'LON', from: 'Nell, the busker',
    secret: 'Every club you have visited sits on a much larger map. Past the amateur circuit the boards are ranked, and the rankings travel with you.'
  },
  {
    id: 'pc-vie', clubId: 'vie', order: 3, letter: 'Y', image: 'assets/postcards/vie.webp',
    front: 'Greetings from Stephansplatz',
    stamp: 'VIE', from: 'Herr Anton, head waiter',
    secret: 'You collect openings. Out there, they say, people collect PLAYERS: every rival worth remembering, written down on a card of their own.'
  },
  {
    id: 'pc-ist', clubId: 'ist', order: 4, letter: 'O', image: 'assets/postcards/ist.webp',
    front: 'Greetings from Galata',
    stamp: 'IST', from: 'Aunt Selin',
    secret: 'Out past the Bosphorus a tournament is not always one board. Sometimes it is five boards, one flag, and a team that wins or loses together.'
  },
  {
    id: 'pc-che', clubId: 'che', order: 5, letter: 'N', image: 'assets/postcards/che.webp',
    front: 'Greetings from Marina Beach',
    stamp: 'MAA', from: 'Coach Vel',
    secret: 'Not every season ends in a final. Some end in an invitation, with gold edges and a date, to a hall where nobody is an amateur.'
  },
  {
    id: 'pc-wen', clubId: 'wen', order: 6, letter: 'D', image: 'assets/postcards/wen.webp',
    front: 'Greetings from the Ou River',
    stamp: 'WNZ', from: 'Old Master Hu',
    secret: 'Don\'t unpack yet. The circuit you are winning is only the first page of a very thick passport.'
  }
]);

/** Shown on the hidden journal page once all six postcards are collected. */
export const BEYOND_THE_TOUR = Object.freeze({
  word: 'BEYOND',
  title: 'Beyond the Tour',
  lead: 'You have only seen the amateur circuit.',
  body: [
    'Six cards, six strangers, one word. Somewhere past Madrid the map keeps going.',
    'Nobody who sent these cards will say what is out there. They only leave shapes on the page.'
  ],
  /* Silhouettes on the teaser page. Deliberately vague: rumours, not features. */
  silhouettes: [
    { id: 'leagues', label: 'International leagues', glyph: '🌐' },
    { id: 'cards', label: 'A player you can collect', glyph: '🂠' },
    { id: 'elite', label: 'Elite invitationals', glyph: '♛' },
    { id: 'teams', label: 'Teams under one flag', glyph: '⚑' },
    { id: 'events', label: 'Events that arrive with the seasons', glyph: '✦' },
    { id: 'circuit', label: 'A world circuit', glyph: '✈' }
  ],
  signoff: 'Same game. A bigger world. See you on the World Tour.'
});

export const postcardById = (id) => POSTCARDS.find((p) => p.id === id) || null;
export const postcardForClub = (clubId) => POSTCARDS.find((p) => p.clubId === clubId) || null;

export default POSTCARDS;
