/**
 * clubs.js - the six clubs and the Grand Finale venue: 13 locations in all.
 *
 * Everything the campaign knows about a city lives in its entry. UI screens
 * read from here and never name a city themselves.
 *
 * `difficultyRange` is informational: actual strength comes from the campaign
 * TIER when the tournament is entered (config.ELO), because clubs can be
 * visited in any order.
 */

export const CLUBS = Object.freeze([
  {
    clubId: 'nyc', city: 'New York', country: 'United States', cardCode: 'NYC',
    clubName: 'Manhattan Chess Club',
    casualLocationName: 'Bethesda Terrace, Central Park',
    openingId: 'italian',
    starPlayerId: 'maya',
    regularOpponentPool: [
      { id: 'nyc-tony', name: 'Tony Delgado', style: 'aggressive', look: { sprite: 'adult-navy', skin: '#d9a07a', hair: '#3b2a20', hairStyle: 'short', top: '#3d6ea8', bottom: '#2a2a2a' } },
      { id: 'nyc-grace', name: 'Grace Whitfield', style: 'positional', look: { sprite: 'girl-gold', skin: '#f1cfb4', hair: '#d9b46a', hairStyle: 'long', top: '#6aa36f', bottom: '#3a3a4a' } },
      { id: 'nyc-jamal', name: 'Jamal Pierce', style: 'tactical', look: { sprite: 'young-purple', skin: '#6e4630', hair: '#141414', hairStyle: 'short', top: '#e0b43c', bottom: '#2d3b55' } },
      { id: 'nyc-rosa', name: 'Rosa Kim', style: 'balanced', look: { sprite: 'girl-plum', skin: '#edc9a5', hair: '#1b1b22', hairStyle: 'bob', top: '#b04a7a', bottom: '#2c2c3a' } }
    ],
    tournamentConfig: { name: 'Manhattan Open', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Liberty Cup',
    postcardId: 'pc-nyc', puzzleMissionId: 'm-nyc',
    visualTheme: { accent: '#3d6ea8', trim: '#d9b46a' },
    mapPin: { x: 22.5, y: 35 },
    scenes: { exterior: 'nyc-ext', interior: 'nyc-int', upstairs: 'nyc-up', venue: 'nyc-venue' }
  },
  {
    clubId: 'lon', city: 'London', country: 'United Kingdom', cardCode: 'LON',
    clubName: 'Royal Chess Club',
    casualLocationName: 'South Bank Embankment',
    openingId: 'london',
    starPlayerId: 'oliver',
    regularOpponentPool: [
      { id: 'lon-harriet', name: 'Harriet Cole', style: 'positional', look: { sprite: 'girl-teal', skin: '#f2d2bc', hair: '#6b3e26', hairStyle: 'bob', top: '#2f4f6f', bottom: '#3b3b3b' } },
      { id: 'lon-sam', name: 'Sam Okafor', style: 'practical', look: { sprite: 'young-red', skin: '#5d3a26', hair: '#101010', hairStyle: 'short', top: '#9b3d3d', bottom: '#2a2f3a' } },
      { id: 'lon-declan', name: 'Declan Frost', style: 'defensive', look: { sprite: 'young-green', skin: '#f4d6c3', hair: '#c46a2e', hairStyle: 'short', top: '#4a6b4a', bottom: '#333' } },
      { id: 'lon-imogen', name: 'Imogen Hale', style: 'balanced', look: { sprite: 'girl-gold', skin: '#efcdb3', hair: '#e2c27a', hairStyle: 'long', top: '#7a5ca8', bottom: '#2b2b33' } }
    ],
    tournamentConfig: { name: 'Thames Invitational', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Big Ben Shield',
    postcardId: 'pc-lon', puzzleMissionId: 'm-lon',
    visualTheme: { accent: '#35496b', trim: '#b8903a' },
    mapPin: { x: 40.6, y: 25 },
    scenes: { exterior: 'lon-ext', interior: 'lon-int', upstairs: null, venue: 'lon-venue' }
  },
  {
    clubId: 'vie', city: 'Vienna', country: 'Austria', cardCode: 'VIE',
    clubName: 'Vienna Chess Club',
    casualLocationName: 'Café Stephansplatz',
    openingId: 'vienna',
    starPlayerId: 'clara',
    regularOpponentPool: [
      { id: 'vie-felix', name: 'Felix Brandt', style: 'tactical', look: { sprite: 'young-green', skin: '#f0cdb2', hair: '#4a3222', hairStyle: 'short', top: '#7a2e3b', bottom: '#2c2c2c' } },
      { id: 'vie-lena', name: 'Lena Hofer', style: 'balanced', look: { sprite: 'girl-green', skin: '#f4d7c1', hair: '#caa25a', hairStyle: 'braid', top: '#2f5f5a', bottom: '#3a3040' } },
      { id: 'vie-matthias', name: 'Matthias Gruber', style: 'positional', look: { sprite: 'older-brown', skin: '#ecc8ab', hair: '#8b8680', hairStyle: 'short', top: '#4b4b6b', bottom: '#2b2b2b' } },
      { id: 'vie-sophie', name: 'Sophie Lang', style: 'aggressive', look: { sprite: 'girl-plum', skin: '#f1cfb8', hair: '#2b1d17', hairStyle: 'bun', top: '#c9763a', bottom: '#2e3444' } }
    ],
    tournamentConfig: { name: 'Ringstrasse Rapid', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Golden Waltz',
    postcardId: 'pc-vie', puzzleMissionId: 'm-vie',
    visualTheme: { accent: '#7a2e3b', trim: '#e8d9a8' },
    mapPin: { x: 46.2, y: 28.6 },
    scenes: { exterior: 'vie-ext', interior: 'vie-int', upstairs: 'vie-up', venue: 'vie-venue' }
  },
  {
    clubId: 'ist', city: 'Istanbul', country: 'Türkiye', cardCode: 'IST',
    clubName: 'Istanbul Chess Club',
    casualLocationName: 'Galata Tea Garden',
    openingId: 'sicilian',
    starPlayerId: 'emre',
    regularOpponentPool: [
      { id: 'ist-deniz', name: 'Deniz Arslan', style: 'aggressive', look: { sprite: 'adult-brown', skin: '#cf9f7a', hair: '#231a16', hairStyle: 'short', top: '#2b5d8a', bottom: '#2f2f2f' } },
      { id: 'ist-ayla', name: 'Ayla Demir', style: 'tactical', look: { sprite: 'girl-gold', skin: '#dcae8a', hair: '#3a2419', hairStyle: 'long', top: '#a33b4a', bottom: '#2d2a38' } },
      { id: 'ist-kerem', name: 'Kerem Yildiz', style: 'practical', look: { sprite: 'young-purple', skin: '#c89670', hair: '#141414', hairStyle: 'curly', top: '#5a7a3a', bottom: '#33302b' } },
      { id: 'ist-zeynep', name: 'Zeynep Aydin', style: 'balanced', look: { sprite: 'girl-red', skin: '#e2b894', hair: '#5a321e', hairStyle: 'bob', top: '#d6a23a', bottom: '#2b3040' } }
    ],
    tournamentConfig: { name: 'Bosphorus Cup', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Crescent Trophy',
    postcardId: 'pc-ist', puzzleMissionId: 'm-ist',
    visualTheme: { accent: '#2f6f7a', trim: '#e0a94a' },
    mapPin: { x: 51.6, y: 34 },
    scenes: { exterior: 'ist-ext', interior: 'ist-int', upstairs: 'ist-up', venue: 'ist-venue' }
  },
  {
    clubId: 'che', city: 'Chennai', country: 'India', cardCode: 'MAA',
    clubName: 'Chennai Chess Club',
    casualLocationName: 'Marina Beach Promenade',
    openingId: 'caro',
    starPlayerId: 'priya',
    regularOpponentPool: [
      { id: 'che-arjun', name: 'Arjun Menon', style: 'positional', look: { sprite: 'adult-navy', skin: '#8f5d3d', hair: '#121212', hairStyle: 'short', top: '#e8e2d0', bottom: '#3b3b55' } },
      { id: 'che-kavya', name: 'Kavya Iyer', style: 'defensive', look: { sprite: 'girl-purple', skin: '#9a6444', hair: '#1a1212', hairStyle: 'braid', top: '#c2410c', bottom: '#2f3a4f' } },
      { id: 'che-rahul', name: 'Rahul Subramani', style: 'tactical', look: { sprite: 'student-board', skin: '#7a4a30', hair: '#171717', hairStyle: 'curly', top: '#3a7ab0', bottom: '#2b2b2b' } },
      { id: 'che-divya', name: 'Divya Nair', style: 'balanced', look: { sprite: 'girl-gold', skin: '#a06a48', hair: '#20120e', hairStyle: 'long', top: '#7a3a8a', bottom: '#2d2d3d' } }
    ],
    tournamentConfig: { name: 'Marina Masters', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Temple Lamp',
    postcardId: 'pc-che', puzzleMissionId: 'm-che',
    visualTheme: { accent: '#1f6b5a', trim: '#f0c14a' },
    mapPin: { x: 65.6, y: 52 },
    scenes: { exterior: 'che-ext', interior: 'che-int', upstairs: null, venue: 'che-venue' }
  },
  {
    clubId: 'wen', city: 'Wenzhou', country: 'China', cardCode: 'WNZ',
    clubName: 'Wenzhou Chess Club',
    casualLocationName: 'Ou River Pavilion',
    openingId: 'french',
    starPlayerId: 'zhou',
    regularOpponentPool: [
      { id: 'wen-hao', name: 'Zhang Hao', style: 'defensive', look: { sprite: 'adult-brown', skin: '#e6c09a', hair: '#161616', hairStyle: 'short', top: '#2f4f3f', bottom: '#2b2b2b' } },
      { id: 'wen-mei', name: 'Li Mei', style: 'positional', look: { sprite: 'girl-red', skin: '#edc9a6', hair: '#1c1418', hairStyle: 'bob', top: '#b03a3a', bottom: '#2a2f3f' } },
      { id: 'wen-jun', name: 'Wang Jun', style: 'practical', look: { sprite: 'student-board', skin: '#e1b890', hair: '#101014', hairStyle: 'short', top: '#3a4f8a', bottom: '#33302b' } },
      { id: 'wen-xiu', name: 'Chen Xiu', style: 'tactical', look: { sprite: 'girl-plum', skin: '#ebc5a2', hair: '#1a1a1f', hairStyle: 'bun', top: '#d0a040', bottom: '#2d2a38' } }
    ],
    tournamentConfig: { name: 'Ou River Open', rounds: 2 },
    difficultyRange: 'Tier-scaled: 500-1250 regulars, Star 800-1375',
    trophyName: 'The Jade Dragon',
    postcardId: 'pc-wen', puzzleMissionId: 'm-wen',
    visualTheme: { accent: '#8a2a2a', trim: '#d9b25a' },
    mapPin: { x: 82.8, y: 41.5 },
    scenes: { exterior: 'wen-ext', interior: 'wen-int', upstairs: 'wen-up', venue: 'wen-venue' }
  }
]);

/** The seventh destination. Locked until all six Club Trophies are won. */
export const FINALE = Object.freeze({
  id: 'mad', city: 'Madrid', country: 'Spain', cardCode: 'MAD',
  venueName: 'Palacio del Ajedrez',
  eventName: 'The Passport Grand Finale',
  trophyName: 'The Big League Qualifier',
  mapPin: { x: 40, y: 33.5 },
  /* Three knockout rounds against returning Star Players at finale strength.
     Round 3 is always your HOME club's Star Player: the rival you met first. */
  rounds: [
    { id: 'quarter', label: 'Quarter-final' },
    { id: 'semi', label: 'Semi-final' },
    { id: 'final', label: 'Final' }
  ],
  scenes: { exterior: 'mad-ext', interior: 'mad-int' }
});

export const clubById = (id) => CLUBS.find((c) => c.clubId === id) || null;

export default CLUBS;
