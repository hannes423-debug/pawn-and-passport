/**
 * starPlayers.js - the six named rivals.
 *
 * Fictional people. Nobody here is modelled on a real player, and nothing
 * about how they play is measured from anyone's games: each is a target Elo
 * (set by campaign progress, see config.ELO), an archetype the existing bot
 * already understands, and their club's opening.
 *
 * Dialogue is linear. `lines` is a table of short sequences keyed by moment;
 * js/core/dialogue.js picks one sequence with a few simple conditions and
 * never branches on player choices.
 *
 * `look` feeds the procedural pixel sprite (js/ui/sprites.js).
 */

export const STAR_PLAYERS = Object.freeze([
  {
    id: 'maya', name: 'Maya Castellano', clubId: 'nyc', openingId: 'italian', style: 'aggressive',
    title: 'The Bethesda Blitz Queen',
    personality: 'Seventeen, fast-talking and faster-moving. Learned chess taking dollars off tourists by the fountain and never lost the habit of attacking f7.',
    look: { sprite: 'girl-red', skin: '#c68a5e', hair: '#2a1a14', hairStyle: 'curly', top: '#d8433b', bottom: '#2e3a57', accent: '#f3c34a' },
    lines: {
      intro: ['Another tourist with a pocket set? Cute.', 'I\'m Maya. I run this club\'s top board, and I don\'t do slow games.', 'Win the tournament and I\'ll be waiting at the end of it.'],
      challenge: ['Clock\'s not running, but I am. Italian Game, if you\'re brave enough to let me.'],
      knowsOpening: ['You play the Italian too? Then you know where my bishop is going. Knowing isn\'t stopping.'],
      playerWon: ['...Okay. OKAY. That was real.', 'Take the trophy. And take the Italian with you, you clearly earned it.'],
      playerLost: ['Told you. Speed kills.', 'Come back when your bishops stop sleeping.'],
      rematch: ['Round two? I was hoping you\'d say that.'],
      beaten: ['Hey, champ. Still thinking about that game. Next time I\'m bringing a faster opening.'],
      finale: ['Madrid! Look at us, huh? Park kid, big stage.', 'I\'ve been practising. You should be scared.'],
      postcards: ['Wait, you collected the park postcard? Flip it over. Nobody ever flips it over.']
    }
  },
  {
    id: 'oliver', name: 'Oliver Pembrook', clubId: 'lon', openingId: 'london', style: 'positional',
    title: 'The Unhurried Gentleman',
    personality: 'A retired railway timetable planner who plays exactly the same first six moves every game and considers that a virtue.',
    look: { sprite: 'old-green', skin: '#f0c7a4', hair: '#c9c4bb', hairStyle: 'bald', top: '#35496b', bottom: '#4b4136', accent: '#b8903a' },
    lines: {
      intro: ['Good afternoon. Tea? No? Pity.', 'Oliver Pembrook. I have played the London System for forty-one years.', 'Reach the end of our little tournament and we shall have a proper game.'],
      challenge: ['d4, Bf4, e3. You may as well know now. It will not help you.'],
      knowsOpening: ['Ah, a fellow systems player. Then this will be a game about who is more patient.'],
      playerWon: ['Well played. Genuinely well played.', 'The trophy is yours, and so is the System. Do look after the bishop on f4.'],
      playerLost: ['A solid structure, and time. That is all chess ever asks for.', 'Do try again when you have both.'],
      rematch: ['Again? Splendid. I have nowhere to be.'],
      beaten: ['My conqueror returns. I have been analysing our game on the train. Twice.'],
      finale: ['Madrid is rather warm for a London System.', 'I shall play the same first six moves. You knew that.'],
      postcards: ['You found the embankment postcard. Did you read the back? I did not write it, before you ask.']
    }
  },
  {
    id: 'clara', name: 'Clara Vogelsang', clubId: 'vie', openingId: 'vienna', style: 'tactical',
    title: 'The Conservatory Tactician',
    personality: 'A violin student who hears openings as music. The Vienna Game is her favourite overture: quiet first bars, then f4.',
    look: { sprite: 'girl-purple', skin: '#f3d0b5', hair: '#a8452c', hairStyle: 'bun', top: '#6b2c43', bottom: '#2b2b33', accent: '#e8d9a8' },
    lines: {
      intro: ['Shh, listen. Every opening has a tempo.', 'I am Clara. The Vienna Game is the first piece I ever learned by heart.', 'Play the tournament. I will hear you coming.'],
      challenge: ['Knight to c3, and then the f-pawn sings. Shall we begin?'],
      knowsOpening: ['You know the Vienna already? Then we are playing the same score. Let\'s see who keeps time.'],
      playerWon: ['Bravo. That ending had a real crescendo.', 'The trophy is yours. So is the Vienna. Play it loudly.'],
      playerLost: ['A little out of tune in the middlegame, I think.', 'Practise, and come back.'],
      rematch: ['An encore? I never refuse an encore.'],
      beaten: ['I wrote a little waltz about our game. It is in a minor key. For me.'],
      finale: ['The golden hall in Madrid has wonderful acoustics.', 'I hope you brought your best tempo.'],
      postcards: ['The cafe postcard! Hold it to the light, there is writing under the stamp.']
    }
  },
  {
    id: 'emre', name: 'Emre Kaplan', clubId: 'ist', openingId: 'sicilian', style: 'aggressive',
    title: 'The Ferry Mechanic',
    personality: 'Fixes ferry engines on the Bosphorus by day, plays the sharpest Sicilian in the city by night. Loves complications, hates draws.',
    look: { sprite: 'young-red', skin: '#c99a73', hair: '#1f1b1a', hairStyle: 'short', top: '#2f6f7a', bottom: '#3a3530', accent: '#e0a94a' },
    lines: {
      intro: ['Welcome, friend! Sit, sit. You play chess? Real chess? Sharp chess?', 'Emre. I fix engines. Sometimes I break openings.', 'Win the tournament, and I will play you properly.'],
      challenge: ['1.e4 and I answer c5. Then everything is on fire. You like fire?'],
      knowsOpening: ['You know the Sicilian? Good, good! Then you know nobody is safe.'],
      playerWon: ['Ha! You broke my engine!', 'Take the trophy, take the Sicilian. Keep it sharp or it will cut you.'],
      playerLost: ['A draw would have been a crime. This was better.', 'Come back with more fire.'],
      rematch: ['Again! I already put the tea on.'],
      beaten: ['My champion! I tell everyone at the harbour about you. I make it sound closer than it was.'],
      finale: ['Madrid! No ferries, but plenty of fire.', 'This time I am not losing. Probably.'],
      postcards: ['The tea garden postcard, eh? My aunt Selin says the message on the back is older than the garden.']
    }
  },
  {
    id: 'priya', name: 'Priya Raghavan', clubId: 'che', openingId: 'caro', style: 'defensive',
    title: 'The Unbreakable Wall',
    personality: 'An engineering student who treats every game like a structure under load. Almost never loses a pawn; almost never lets you have one either.',
    look: { sprite: 'girl-green', skin: '#8d5a3b', hair: '#141013', hairStyle: 'braid', top: '#1f6b5a', bottom: '#5a3d6b', accent: '#f0c14a' },
    lines: {
      intro: ['Hello. Please do not lean on the tables, they are antiques.', 'Priya. I play the Caro-Kann because I like knowing exactly where my weaknesses are.', 'Finish the tournament. I will be here. I am always here.'],
      challenge: ['c6, then d5. Solid first, clever second.'],
      knowsOpening: ['You play the Caro-Kann? Then neither of us will blunder early. This could take a while.'],
      playerWon: ['You found the load-bearing pawn. Impressive.', 'The trophy is yours. So is the Caro-Kann. Build carefully.'],
      playerLost: ['Your attack had a structural flaw. I found it.', 'Rest, recalculate, return.'],
      rematch: ['A second test. Good. One test is never enough.'],
      beaten: ['I rebuilt my whole repertoire after our game. It is sturdier now. You are welcome to test it.'],
      finale: ['Madrid. I have calculated that I am under-rested and over-prepared.', 'It balances.'],
      postcards: ['Coach Vel gave you the Marina postcard? He only gives it to people who can hold a king and pawn ending.']
    }
  },
  {
    id: 'zhou', name: 'Zhou Lan', clubId: 'wen', openingId: 'french', style: 'practical',
    title: 'The River Counter-Puncher',
    personality: 'Quiet, patient and a little mischievous. Lets you build a big centre on purpose, then knocks the bottom brick out with c5.',
    look: { sprite: 'girl-teal', skin: '#e8c29c', hair: '#15151c', hairStyle: 'long', top: '#8a2a2a', bottom: '#23303f', accent: '#d9b25a' },
    lines: {
      intro: ['You walked all the way from the gate. Good. Patience is the first lesson.', 'I am Zhou Lan. I play the French Defence.', 'The tournament first. Then the river decides.'],
      challenge: ['e6, d5, and then I wait for your centre to grow too tall.'],
      knowsOpening: ['You know the French already. Then you know I am waiting for c5. Try to stop it.'],
      playerWon: ['The river went your way today.', 'The trophy, and the French Defence. It rewards patience; so will you.'],
      playerLost: ['Your centre was tall, and tall things fall.', 'Come back slower.'],
      rematch: ['Again. The river is still running.'],
      beaten: ['I have played our game through many times by the water. I still like your move twenty.'],
      finale: ['Madrid is loud. I will be quiet.', 'That is my advantage.'],
      postcards: ['Master Hu gave you the river postcard. He writes something different on every one. He says it is the same message.']
    }
  }
]);

export const starById = (id) => STAR_PLAYERS.find((s) => s.id === id) || null;
export const starForClub = (clubId) => STAR_PLAYERS.find((s) => s.clubId === clubId) || null;

export default STAR_PLAYERS;
