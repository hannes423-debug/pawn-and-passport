/**
 * missions.js - the six casual-venue puzzle missions.
 *
 * Each mission is a short themed set drawn from js/data/puzzles.js (generated
 * and engine-verified by tools/verify-puzzles.mjs). Finishing every puzzle in
 * the set awards the venue's postcard.
 */

export const MISSIONS = Object.freeze([
  {
    id: 'm-nyc', clubId: 'nyc', postcardId: 'pc-nyc', theme: 'Forks',
    title: 'The Fountain Hustle',
    host: { id: 'marcus', name: 'Marcus "Two-Minute" Bell', look: { sprite: 'old-scarf', skin: '#6b4430', hair: '#bdb7ad', hairStyle: 'short', top: '#4f7a3a', bottom: '#3a3a3a', accent: '#e0c050' } },
    intro: ['Step right up! Four boards, four forks. Solve my hustle and the postcard\'s yours.', 'No clocks, no money. I got too old for money.'],
    outro: ['Four for four! Here, take the card. Read the back when nobody is looking.']
  },
  {
    id: 'm-lon', clubId: 'lon', postcardId: 'pc-lon', theme: 'Back-rank mates',
    title: 'Mind the Back Rank',
    host: { id: 'nell', name: 'Nell the Busker', look: { sprite: 'girl', skin: '#f0cdb5', hair: '#7a2f5a', hairStyle: 'bob', top: '#2d5f7a', bottom: '#3b3030', accent: '#e6c26a' } },
    intro: ['Oi! I paint chess positions on the courtyard stones for coins.', 'Solve these four and I\'ll give you my favourite postcard. They all end on the back rank, like my career.'],
    outro: ['Mind the gap, mind the back rank. Postcard\'s yours, love.']
  },
  {
    id: 'm-vie', clubId: 'vie', postcardId: 'pc-vie', theme: 'Opening traps',
    title: 'The Coffeehouse Traps',
    host: { id: 'anton', name: 'Herr Anton', look: { sprite: 'old-green', skin: '#efcbb0', hair: '#e6e2da', hairStyle: 'bald', top: '#1c1c22', bottom: '#1c1c22', accent: '#f4f1ea' } },
    intro: ['Guten Tag. In this cafe, people have fallen into the same four traps for a hundred years.', 'Show me you would not. The postcard comes with a Melange.'],
    outro: ['Sehr gut. You would have ruined many afternoons here. Your postcard.']
  },
  {
    id: 'm-ist', clubId: 'ist', postcardId: 'pc-ist', theme: 'Pins, skewers and discoveries',
    title: 'Lines over Tea',
    host: { id: 'selin', name: 'Aunt Selin', look: { sprite: 'woman', skin: '#d5a784', hair: '#c9c2b8', hairStyle: 'bun', top: '#7a3a5a', bottom: '#3a3348', accent: '#e8b04a' } },
    intro: ['Sit, child, drink. My nephew Emre says you play.', 'Every one of these is about a LINE: a pin, a skewer, a piece stepping out of the way. Four glasses of tea, four puzzles.'],
    outro: ['Good eyes. Take the postcard. Do not tell Emre I gave it to you first.']
  },
  {
    id: 'm-che', clubId: 'che', postcardId: 'pc-che', theme: 'Endgame technique',
    title: 'Endgames by the Sea',
    host: { id: 'vel', name: 'Coach Vel', look: { sprite: 'old-scarf', skin: '#7a4c33', hair: '#d8d4cc', hairStyle: 'short', top: '#f2efe4', bottom: '#8a6a4a', accent: '#c2410c' } },
    intro: ['Filter coffee first. Then endgames.', 'Openings are fashion. Endgames are rent. Four positions: solve them and the Marina postcard is yours.'],
    outro: ['Clean technique. The sea approves. Postcard.']
  },
  {
    id: 'm-wen', clubId: 'wen', postcardId: 'pc-wen', theme: 'Sacrifices and mating patterns',
    title: 'Offerings at the River',
    host: { id: 'hu', name: 'Old Master Hu', look: { sprite: 'old-green', skin: '#e3bd98', hair: '#eeeeee', hairStyle: 'long', top: '#3d5a4a', bottom: '#2a2a2a', accent: '#d9b25a' } },
    intro: ['The river gives nothing for free. Neither do I.', 'Four patterns that masters have admired for centuries. Find each one and the river postcard is yours.'],
    outro: ['You gave, and you received. That is the whole lesson. Take the card.']
  }
]);

export const missionById = (id) => MISSIONS.find((m) => m.id === id) || null;
export const missionForClub = (clubId) => MISSIONS.find((m) => m.clubId === clubId) || null;

export default MISSIONS;
