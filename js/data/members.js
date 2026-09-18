/**
 * members.js - the people of each club: who stands where, what they say, and
 * who turns up to the tournament.
 *
 * A club's MEMBERS are its four regulars (clubs.js regularOpponentPool, who
 * already stand at the tournament hall, the practice room and the lounge)
 * plus the eight below. Every member can be met in the club or at its casual
 * venue, talked to and challenged for coins, and every member plays in the
 * club tournament. The Star Player is not a member: they wait in the final.
 *
 * `where`     the scene a member stands in: 'ext' garden, 'int' club floor,
 *             'up' upper floor (falls back to 'int' where there is none),
 *             'venue' the casual venue. Positions are GENERATED on the walkable
 *             floor by tools/place-members.mjs (js/data/memberSpots.js).
 * `rel`       strength inside the club, 0 (weakest) .. 1 (strongest). The Elo
 *             itself comes from the campaign tier (config.MEMBERS), so a club
 *             visited late is stronger, but its pecking order stays the same.
 * `openingId` the member's specialty: what the bot plays from book.
 * `lines`     one or two sentences each: the town, the specialty, a tip.
 *
 * Only the artist's character sheets are used (assets/characters/). Looks
 * match the city: Chennai is mostly Indian, with two exchange students.
 */

import { CLUBS } from './clubs.js';

const m = (id, name, sprite, style, rel, openingId, where, lines, extra = {}) =>
  ({ id, name, look: { sprite }, style, rel, openingId, where, lines, ...extra });

/* The regulars already in clubs.js: their strength, place and lines. */
const REGULARS = {
  'nyc-tony': { rel: 0.55, where: 'int', lines: ['Tournament hall is my second home. My first home is a sublet in Queens.', 'The Italian is simple: bishop to c4, aim at f7, and see who blinks first.'] },
  'nyc-grace': { rel: 0.7, where: 'int', lines: ['I teach the Tuesday beginners. Half of them are bankers, the other half are nine.', 'Castle early. Nobody ever lost a game because their king was too safe.'] },
  'nyc-jamal': { rel: 0.8, where: 'up', lines: ['I learned in Washington Square Park. Five-minute games, five dollars a game.', 'When you see a good move, sit on your hands and look for a better one.'] },
  'nyc-rosa': { rel: 0.4, where: 'venue', lines: ['The squirrels in Central Park have stolen two of my pawns. Real ones.', 'Knights before bishops. It is old advice because it keeps working.'] },
  'lon-harriet': { rel: 0.75, where: 'int', lines: ['The club was founded in a coffee house. We still take the tea very seriously.', 'The London System looks dull until you are the one being slowly squeezed.'] },
  'lon-sam': { rel: 0.6, where: 'int', lines: ['I play blitz on the Tube. Northern line, one game per stop.', 'In a bad position, make it messy. Tidy positions favour the better player.'] },
  'lon-declan': { rel: 0.45, where: 'venue', lines: ['Covent Garden buskers are tougher than they look. One of them beat me with a tuba on his back.', 'Put a rook on the open file before your opponent notices it is open.'] },
  'lon-imogen': { rel: 0.35, where: 'ext', lines: ['It is raining, so it must be a weekday. Or a weekend.', 'Check every capture your opponent has before you move. Every single one.'] },
  'vie-felix': { rel: 0.6, where: 'int', lines: ['Vienna had chess cafes before it had trams. We take our coffee and our gambits seriously.', 'The Vienna Game: Nc3, then f4. The f-pawn is a battering ram.'] },
  'vie-lena': { rel: 0.4, where: 'venue', lines: ['At Cafe Stephansplatz you can nurse one Melange for four hours. That is two long games.', 'Count the attackers and the defenders before you take anything.'] },
  'vie-matthias': { rel: 0.8, where: 'up', lines: ['I have played in this club for fifty-one years. The chairs are the same age.', 'A knight on the rim is dim. My grandfather said it, and he said it in German.'] },
  'vie-sophie': { rel: 0.7, where: 'int', lines: ['The State Opera is right round the corner. I prefer the drama on sixty-four squares.', 'Attack where you are stronger. Pawn storms go toward the side your pieces point at.'] },
  'ist-deniz': { rel: 0.55, where: 'int', lines: ['Tea first, chess second. That is the house rule and nobody argues.', 'The Sicilian is a fight from move one. If you want peace, play something else.'] },
  'ist-ayla': { rel: 0.75, where: 'up', lines: ['From the roof you can see two continents. I still only look at one board.', 'Open the c-file and your rook will thank you for the rest of the game.'] },
  'ist-kerem': { rel: 0.35, where: 'venue', lines: ['The ferries on the Bosphorus honk at every good move. Or so I tell myself.', 'Develop, castle, connect the rooks. Then think about being clever.'] },
  'ist-zeynep': { rel: 0.5, where: 'int', lines: ['My grandmother played in this club when it had one board and one lamp.', 'Before you attack, ask what your opponent wants to do. Then stop it.'] },
  'che-arjun': { rel: 0.65, where: 'int', lines: ['Chennai is India\'s chess capital. Half the kids on my street have a FIDE rating.', 'The Caro-Kann is solid, but solid is not passive. Hit back with c5 or e5 when you can.'] },
  'che-kavya': { rel: 0.5, where: 'venue', lines: ['Marina Beach at sunrise is the best time to play. Before the heat, before the crowds.', 'Endgames win tournaments. Learn king and pawn endings before openings.'] },
  'che-rahul': { rel: 0.8, where: 'int', lines: ['I trained at a chess academy in Mylapore. Six hours a day, filter coffee on the hour.', 'Calculate forcing moves first: checks, captures, then threats.'] },
  'che-divya': { rel: 0.4, where: 'ext', lines: ['The temple bells ring at six. That is our signal to start the evening blitz.', 'Trade pieces when you are ahead, trade pawns when you are behind.'] },
  'wen-hao': { rel: 0.6, where: 'int', lines: ['Wenzhou has produced more grandmasters than some whole countries. We are proud of that.', 'The French is patience. Let White overextend, then chip at the centre with c5 and f6.'] },
  'wen-mei': { rel: 0.75, where: 'up', lines: ['I play xiangqi with my grandfather and chess with everyone else.', 'Bad bishops protect good pawns. Do not be in a hurry to trade them.'] },
  'wen-jun': { rel: 0.4, where: 'venue', lines: ['The Ou River pavilion is free, shady, and there is always someone who wants a game.', 'When you are winning, stop looking for brilliancies. Just take the free material.'] },
  'wen-xiu': { rel: 0.5, where: 'int', lines: ['I solve ten puzzles every morning before school. My teacher thinks I am doing maths.', 'A pin is only a pin if the piece behind it matters.'] }
};

/* The eight new members per club. */
const NEW_MEMBERS = {
  nyc: [
    m('nyc-marco', 'Marco Russo', 'nyc-student', 'aggressive', 0.6, 'italian', 'venue', ['My nonna says the Italian Game was invented for our family. I believe her.', 'Giuoco Piano means quiet game. It is never quiet when I play it.']),
    m('nyc-ollie', 'Ollie Brennan', 'bug-catcher', 'tactical', 0.15, 'italian', 'venue', ['I came to catch beetles in the Ramble and stayed for the chess tables.', 'My coach says: look at your opponent\'s last move. What did it change?']),
    m('nyc-danny', 'Danny Cho', 'cs-student', 'positional', 0.5, 'caro', 'int', ['I am writing a chess engine for my Columbia class. It is rated about 400. So far.', 'Engines love the Caro-Kann. It is hard to crack a pawn chain that never moves.']),
    m('nyc-kevin', 'Kevin Liu', 'cn-student', 'practical', 0.45, 'italian', 'up', ['The subway is my study room. The A train is exactly one opening chapter long.', 'Play the clock too. A good move in time beats a perfect move too late.']),
    m('nyc-dev', 'Dev Patel', 'in-student', 'balanced', 0.3, 'sicilian', 'ext', ['I came from New Jersey just for the Tuesday blitz. Worth the PATH train.', 'Against 1.e4 I play the Sicilian. Imbalance is how you beat stronger players.']),
    m('nyc-aisha', 'Aisha Johnson', 'woman-coat', 'positional', 0.9, 'italian', 'up', ['I run the Harlem chess league on weekends. We play on folding tables in the park.', 'Every piece should have a job. Find your laziest piece and give it one.']),
    m('nyc-walter', 'Walter Stein', 'old-green', 'defensive', 0.65, 'french', 'int', ['I played at the old Manhattan Chess Club on 57th Street. The coffee was worse then.', 'Defend with the fewest pieces you can. The rest should be counter-attacking.']),
    m('nyc-hector', 'Hector Ramos', 'old-scarf', 'practical', 0.2, 'italian', 'ext', ['Forty years driving a cab. You learn to see three moves ahead in Midtown traffic.', 'When in doubt, improve your worst piece. It never hurts.'])
  ],
  lon: [
    m('lon-freddie', 'Freddie Ashworth', 'lon-boy', 'positional', 0.55, 'london', 'int', ['Our school chess club meets in the library. The librarian has a very fierce shush.', 'The London System: d4, Bf4, e3, and the same setup against almost anything.']),
    m('lon-poppy', 'Poppy Kendall', 'lon-girl', 'tactical', 0.5, 'london', 'int', ['I won the junior county cup with a bishop sacrifice on h7. I still dream about it.', 'Bishop on d3, queen on c2: in the London, h7 is always the target.']),
    m('lon-arthur', 'Arthur Blake', 'old-green', 'defensive', 0.85, 'french', 'int', ['I once drew with a grandmaster at the Hastings Congress. I tell everyone. Twice.', 'A draw is not a defeat. Save the lost positions and the points add up.']),
    m('lon-nikhil', 'Nikhil Shah', 'in-student', 'aggressive', 0.4, 'sicilian', 'venue', ['I study at King\'s College and play in Covent Garden between lectures.', 'The Sicilian keeps the game unbalanced. That is exactly where upsets happen.']),
    m('lon-amara', 'Amara Mensah', 'woman-coat', 'balanced', 0.7, 'london', 'venue', ['The courtyard tables fill up by noon on Saturdays. Get here early.', 'Trade your bad bishop, keep your good one. Half of positional chess is that.']),
    m('lon-tom', 'Tom Whitaker', 'bug-catcher', 'practical', 0.1, 'london', 'ext', ['I was looking for stag beetles in Hyde Park. Then someone taught me the knight move.', 'Do not bring your queen out early. Everyone will chase it around the board.']),
    m('lon-winston', 'Winston Clarke', 'old-scarf', 'positional', 0.65, 'london', 'ext', ['I have played the London System since before it was fashionable. Since 1974, in fact.', 'Build the house before you invite guests: pawns first, pieces behind them.']),
    m('lon-ben', 'Ben Hughes', 'cs-student', 'tactical', 0.3, 'vienna', 'int', ['I analyse every game I lose. My spreadsheet has a lot of rows.', 'Knight forks come from squares two moves away. Look where knights could land.'])
  ],
  vie: [
    m('vie-jakob', 'Jakob Steiner', 'vie-student', 'aggressive', 0.55, 'vienna', 'venue', ['My Schach book is older than my father. The Vienna Game is on page one.', 'In the Vienna, play f4 while Black is still thinking about development.']),
    m('vie-lukas', 'Lukas Bauer', 'cs-student', 'positional', 0.45, 'caro', 'int', ['I study at TU Wien. Chess is the only thing I do slower than my thesis.', 'A solid structure buys time. Use the time to put pieces on their best squares.']),
    m('vie-tobias', 'Tobias Wagner', 'bug-catcher', 'tactical', 0.1, 'vienna', 'ext', ['There are butterflies in the Volksgarten. And sometimes a free board.', 'If a piece is not protected, it is in danger. Loose pieces drop off.']),
    m('vie-elif', 'Elif Yilmaz', 'woman-coat', 'balanced', 0.75, 'sicilian', 'up', ['My family came from Izmir. I play the Sicilian at home and the Vienna at the club.', 'Your opening should suit your style. Mine suits a bad temper.']),
    m('vie-can', 'Can Öztürk', 'tr-student', 'aggressive', 0.3, 'vienna', 'venue', ['The Sachertorte here costs more than my chess set. It is worth it.', 'Attack the king only when your pieces are closer to it than his defenders are.']),
    m('vie-franz', 'Franz Leitner', 'old-green', 'positional', 0.9, 'vienna', 'up', ['Carl Schlechter played in cafes like this one. He drew almost everyone.', 'The quiet move is often the strongest. Not every move needs to threaten.']),
    m('vie-paul', 'Paul Winkler', 'young-blue', 'practical', 0.35, 'london', 'ext', ['I took the U-Bahn from Favoriten just for the club night. Every Thursday.', 'Spend your thinking time in the middlegame. The opening should be quick.']),
    m('vie-hanna', 'Hanna Egger', 'lon-girl', 'tactical', 0.5, 'vienna', 'int', ['At my Gymnasium the chess club is bigger than the football team.', 'The f7 square is weak until Black castles. The Vienna is built on that.'])
  ],
  ist: [
    m('ist-emir', 'Emir Çelik', 'tr-student', 'aggressive', 0.4, 'sicilian', 'venue', ['I play at the tea garden after school. The çay is free if you win.', 'In the Sicilian, Black gets the queenside and White gets the kingside. Race!']),
    m('ist-mehmet', 'Mehmet Koç', 'old-scarf', 'positional', 0.85, 'sicilian', 'up', ['I sold carpets in the Grand Bazaar for forty years. Chess is the same: patience and a good eye.', 'Do not hurry. A good position does not run away.']),
    m('ist-burak', 'Burak Şahin', 'young-red', 'tactical', 0.65, 'sicilian', 'int', ['Galatasaray lost on Sunday, so today I am playing extra aggressively.', 'In the Najdorf, a6 is not a waste of time. It controls b5 and prepares everything.']),
    m('ist-elifk', 'Elif Kaya', 'woman-coat', 'balanced', 0.7, 'caro', 'int', ['I am a doctor at the Cerrahpaşa hospital. Chess is how I rest.', 'Solid openings, sharp middlegames. That is how I like it.']),
    m('ist-ali', 'Ali Öztürk', 'bug-catcher', 'practical', 0.1, 'sicilian', 'ext', ['I catch crabs by the Bosphorus with my uncle. Then we play chess on the ferry.', 'Before you move, ask: is anything of mine hanging?']),
    m('ist-cem', 'Cem Doğan', 'cs-student', 'positional', 0.45, 'french', 'ext', ['I study at Boğaziçi University. The campus has the best view in the city.', 'The French is a bet: you give White space and hope it becomes a weakness.']),
    m('ist-hasan', 'Hasan Yurt', 'old-green', 'defensive', 0.55, 'sicilian', 'venue', ['From this terrace you can watch ships from the Black Sea all day.', 'Defend actively. A passive defender loses slowly, but he still loses.']),
    m('ist-orhan', 'Orhan Aksoy', 'young-blue', 'practical', 0.25, 'italian', 'int', ['I drive a dolmuş. You learn a lot of patience in Istanbul traffic.', 'Simple chess is strong chess. Do not complicate a winning position.'])
  ],
  che: [
    m('che-karthik', 'Karthik Raman', 'in-student', 'tactical', 0.6, 'caro', 'venue', ['I play on the Marina every evening. The sea breeze is the best air-conditioning.', 'In the Caro-Kann, the light bishop comes out BEFORE e6. Never lock it in.']),
    m('che-venkat', 'Venkat Krishnan', 'old-scarf', 'positional', 0.9, 'caro', 'up', ['I coached at this club when Anand was a boy. He was already faster than all of us.', 'Know your pawn structure and the plan follows. The pieces go where the pawns point.']),
    m('che-lakshmi', 'Lakshmi Sundaram', 'woman', 'balanced', 0.7, 'caro', 'int', ['I teach mathematics at a school in Adyar. Chess is just geometry with feelings.', 'A space advantage is only useful if you can use the space. Otherwise it is weaknesses.']),
    m('che-surya', 'Surya Prakash', 'young-red', 'aggressive', 0.55, 'sicilian', 'int', ['I skipped cricket practice for the club blitz. Please do not tell my coach.', 'Against the Caro-Kann, White pushes e5 and grabs space. Be ready to hit it with c5.']),
    m('che-meena', 'Meena Rajan', 'woman-coat', 'defensive', 0.45, 'caro', 'venue', ['I sell jasmine flowers by the beach and play between customers.', 'When your opponent attacks, find the one defensive move. There usually is one.']),
    m('che-pranav', 'Pranav Iyer', 'in-student', 'practical', 0.2, 'caro', 'ext', ['I am eleven and I am rated higher than my father. He says he lets me win.', 'Solve puzzles every day. Patterns come from repetition, not from talent.']),
    m('che-hiro', 'Hiro Tanaka', 'cs-student', 'positional', 0.4, 'french', 'int', ['I am an exchange student from Osaka. I came to Chennai because this is where chess lives.', 'The French and the Caro-Kann are cousins. Both give White the centre to attack it later.']),
    m('che-liu', 'Liu Yang', 'cn-student', 'tactical', 0.35, 'french', 'up', ['I am on exchange from Wenzhou. Both cities are crazy about chess.', 'Look at the whole board before you move, not just where the action is.'])
  ],
  wen: [
    m('wen-liuwei', 'Liu Wei', 'cn-student', 'tactical', 0.55, 'french', 'int', ['Wenzhou shoes are famous. Wenzhou chess players are more famous, I think.', 'The French advance: undermine White\'s chain from the base with c5. Always the base.']),
    m('wen-zhao', 'Zhao Ming', 'cs-student', 'positional', 0.45, 'caro', 'venue', ['I code during the day and play online at night. The river is my break.', 'Every opening has a pawn break. Know yours before move ten.']),
    m('wen-huang', 'Huang Lei', 'young-blue', 'aggressive', 0.65, 'sicilian', 'int', ['I work at my family\'s factory and play chess on my lunch break.', 'Initiative is worth a pawn. Sometimes it is worth two.']),
    m('wen-zheng', 'Zheng Hua', 'old-green', 'defensive', 0.85, 'french', 'up', ['This club has trained world champions. I taught one of them to sweep the floor.', 'The French bishop on c8 is bad. Trade it, or free it with b6 and Ba6.']),
    m('wen-sun', 'Sun Li', 'lon-girl', 'balanced', 0.5, 'french', 'int', ['Our school team trains here twice a week. Our coach is very strict.', 'Rooks belong behind passed pawns. Yours and your opponent\'s.']),
    m('wen-pan', 'Pan Tao', 'bug-catcher', 'practical', 0.1, 'french', 'ext', ['I catch dragonflies by the Ou River. They are faster than my bishops.', 'Take your time on move one. And on move two. And actually on every move.']),
    m('wen-lin', 'Lin Feng', 'cn-student', 'aggressive', 0.3, 'italian', 'venue', ['The pavilion lanterns come on at dusk. That is when the blitz gets serious.', 'If your opponent castles short, think about castling long and storming.']),
    m('wen-tom', 'Tom Becker', 'vie-student', 'positional', 0.4, 'vienna', 'ext', ['I am on exchange from Hamburg. Everyone here is so much faster than me.', 'The Vienna Game works against almost anything that answers e4 with e5.'])
  ]
};

/* General tips any member may add after their own lines. */
export const CHESS_TIPS = Object.freeze([
  'Every move, ask two questions: what does my opponent want, and what do I want?',
  'Checks, captures, threats: look at them in that order.',
  'A rook on the seventh rank eats pawns for breakfast.',
  'In the endgame the king is a fighting piece. Walk it to the centre.',
  'Doubled pawns are not always bad, but isolated pawns need defending forever.',
  'Two bishops in an open position are worth more than a bishop and a knight.',
  'If you cannot find a plan, improve your worst-placed piece.',
  'Pawns cannot move backwards. Think twice before every pawn push.',
  'A passed pawn is a criminal that should be kept under lock and key.',
  'Castle before the centre opens, not after.'
]);

/* Tournament visitors: names only, dressed from the city's own sheets. */
export const VISITORS = Object.freeze({
  nyc: { sprites: ['young-blue', 'young-red', 'nyc-student', 'woman', 'old-green', 'cs-student'], names: ['Sean Murphy', 'Nadia Hassan', 'Jordan Reyes', 'Chris Park', 'Maria Gonzalez', 'Eli Goldberg', 'Tyrone Banks', 'Leah Abrams', 'Victor Lopez', 'Brianna Scott', 'Andre Williams', 'Mei Chen', 'Sam Feldman', 'Omar Farouk', 'Gina Esposito', 'Luke Harris', 'Priscilla Adams', 'Ray Kowalski', 'Kenji Mori'] },
  lon: { sprites: ['lon-boy', 'lon-girl', 'young-blue', 'young-red', 'old-green', 'woman'], names: ['Harry Fletcher', 'Charlotte Price', 'Jack Turner', 'Sophie Lewis', 'George Barnes', 'Aaliyah Ahmed', 'Rory McDonald', 'Emily Carter', 'Callum Reid', 'Priya Desai', 'Alfie Moore', 'Grace Evans', 'Dominic West', 'Hannah Green', 'Kwame Asante', 'Isla Morgan', 'Rhys Jenkins', 'Zara Khan', 'Edward Pike'] },
  vie: { sprites: ['vie-student', 'young-blue', 'old-green', 'lon-girl', 'cs-student', 'woman-coat'], names: ['Stefan Hofmann', 'Anna Pichler', 'Florian Berger', 'Julia Fuchs', 'Markus Wolf', 'Katharina Schmid', 'David Novak', 'Laura Mayer', 'Simon Haas', 'Eva Weiss', 'Andreas Koller', 'Mira Horvat', 'Georg Lehner', 'Nina Reiter', 'Johannes Brunner', 'Sara Kraus', 'Dominik Auer', 'Theresa Wimmer', 'Martin Ebner'] },
  ist: { sprites: ['tr-student', 'young-red', 'young-blue', 'woman', 'old-scarf', 'woman-coat'], names: ['Ahmet Yıldırım', 'Merve Aslan', 'Mustafa Kılıç', 'Esra Polat', 'Kaan Erdem', 'Defne Kurt', 'Ömer Taş', 'Buse Güneş', 'Yusuf Aydın', 'İrem Çetin', 'Tolga Özkan', 'Seda Karaca', 'Murat Bulut', 'Aslı Tekin', 'Serkan Uçar', 'Gizem Koçak', 'Onur Acar', 'Nur Işık', 'Barış Güler'] },
  che: { sprites: ['in-student', 'young-red', 'woman', 'old-scarf', 'woman-coat', 'in-student'], names: ['Aravind Chandrasekar', 'Nandhini Babu', 'Gokul Murugan', 'Swathi Ramesh', 'Harish Balaji', 'Keerthana Mohan', 'Sanjay Natarajan', 'Revathi Kumar', 'Dinesh Pandian', 'Anitha Selvam', 'Vignesh Srinivasan', 'Priyanka Rao', 'Ashwin Gopal', 'Bhavani Shankar', 'Naveen Reddy', 'Deepa Varma', 'Kiran Pillai', 'Emma Collins', 'Arun Joseph'] },
  wen: { sprites: ['cn-student', 'young-blue', 'cs-student', 'lon-girl', 'old-green', 'cn-student'], names: ['Wu Jie', 'Zhou Ying', 'Xu Bin', 'Yang Fang', 'Ma Chao', 'Hu Jing', 'Guo Qiang', 'He Lin', 'Luo Peng', 'Gao Yu', 'Liang Kai', 'Song Qian', 'Tang Hui', 'Feng Rui', 'Deng Yi', 'Cao Xin', 'Yuan Hong', 'Jiang Tao', 'Ye Ning'] }
});

/** Every member of a club: its four regulars first, then the eight above. */
export function membersForClub(clubId) {
  const club = CLUBS.find((c) => c.clubId === clubId);
  if (!club) return [];
  const regulars = club.regularOpponentPool.map((r, i) => {
    const extra = REGULARS[r.id] || {};
    // Regulars 0 and 1 already stand at the tournament hall and the practice
    // room, and 2 in the lounge where there is an upper floor (scenes.js npc).
    const atHotspot = i < 2 || (i === 2 && !!club.scenes.upstairs);
    return {
      id: r.id, name: r.name, style: r.style, rel: extra.rel ?? 0.5, openingId: club.openingId,
      where: atHotspot ? null : (extra.where || 'int'), lines: extra.lines || [],
      look: r.look, regular: true
    };
  });
  return [...regulars, ...(NEW_MEMBERS[clubId] || [])];
}

export const MEMBERS = Object.freeze(Object.fromEntries(CLUBS.map((c) => [c.clubId, membersForClub(c.clubId)])));

export const memberById = (id) => {
  for (const list of Object.values(MEMBERS)) {
    const found = list.find((x) => x.id === id);
    if (found) return found;
  }
  return null;
};

export default MEMBERS;
