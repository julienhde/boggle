// Moteur partagé entre le jeu (app.js) et la page admin (admin.js).
// Aucune dépendance au DOM : uniquement de la logique pure + le fetch du
// dictionnaire.

export const GRID_SIZE = 4;

const DICT_URL = 'data/words_fr.txt.gz';

// Dés Boggle version française classique (16 dés)
export const DICE = [
  'ETUKNO', 'EVGTIN', 'DECAMP', 'IELRUW',
  'EHIFSE', 'RECALS', 'ENTDOS', 'OFXRIA',
  'NAVEDZ', 'EIOATA', 'GLENYU', 'BMAQJO',
  'TLIBRA', 'SPULTE', 'AIMSOR', 'ENHRIS'
];

// ---------------------------------------------------------------------------
// PRNG déterministe : même seed => même grille sur tous les téléphones.
// Ne pas modifier mulberry32/seededShuffle ni l'ordre des tirages dans
// buildGridLetters, sinon les numéros de grille partagés changent de lettres.
// ---------------------------------------------------------------------------

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seed numérique direct, ou hash d'un texte ("vacances2026" par ex.)
export function parseSeed(str) {
  str = (str || '').trim();
  if (!str) return null;
  const n = parseInt(str, 10);
  if (!isNaN(n)) return n;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Grilles forcées : seed => 16 lettres fixes, en dehors du tirage normal des
// dés. Vérifiées à la main (chemins de cases adjacentes valides).
const FORCED_GRIDS = {
  202607: ['P', 'R', 'O', 'V', 'E', 'C', 'N', 'I', 'S', 'M', 'I', 'T', 'M', 'A', 'R', 'I']
  // contient "provinces" (0,1,2,3,7,6,5,4,8) et "maritimes" (12,13,14,15,11,10,9,4,8)
};

// Les 16 lettres de la grille pour un seed donné
export function buildGridLetters(seed) {
  if (FORCED_GRIDS[seed]) return FORCED_GRIDS[seed].slice();
  const rng = mulberry32(seed);
  const dice = seededShuffle(DICE, rng);
  return dice.map((die) => {
    const face = die[Math.floor(rng() * 6)];
    return face === 'Q' ? 'Qu' : face;
  });
}

export function areAdjacent(a, b) {
  const ra = Math.floor(a / GRID_SIZE), ca = a % GRID_SIZE;
  const rb = Math.floor(b / GRID_SIZE), cb = b % GRID_SIZE;
  return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1 && a !== b;
}

// ---------------------------------------------------------------------------
// Dictionnaire
// ---------------------------------------------------------------------------

// Renvoie { set, sorted } : le Set pour les recherches exactes, le tableau
// trié (ordre du fichier source) pour la recherche par préfixe du solveur.
// Lève une erreur en cas d'échec ; chaque page gère son propre affichage.
export async function loadDictionary() {
  const res = await fetch(DICT_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    // Fichier gzip servi tel quel : décompression côté client
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    // Le serveur a déjà décompressé (Content-Encoding: gzip)
    text = new TextDecoder().decode(buf);
  }
  const sorted = text.split('\n').filter(Boolean);
  return { set: new Set(sorted), sorted };
}

// ---------------------------------------------------------------------------
// Solveur : tous les mots trouvables sur une grille
// ---------------------------------------------------------------------------

// sorted est trié : une recherche dichotomique suffit à savoir si un
// préfixe existe, sans construire de trie.
function hasPrefix(sorted, prefix) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < prefix) lo = mid + 1; else hi = mid;
  }
  return lo < sorted.length && sorted[lo].startsWith(prefix);
}

// Renvoie les mots trouvables, triés du plus long au plus court puis alphabétique
export function solveGrid(letters, dictionarySet, sortedWords) {
  const found = new Set();
  const visited = new Array(letters.length).fill(false);

  function dfs(idx, word) {
    // toUpperCase : la tuile « Qu » est stockée avec un u minuscule, le
    // dictionnaire est tout en majuscules
    word += letters[idx].toUpperCase();
    if (!hasPrefix(sortedWords, word)) return;
    if (word.length >= 3 && dictionarySet.has(word)) found.add(word);
    visited[idx] = true;
    for (let n = 0; n < letters.length; n++) {
      if (!visited[n] && areAdjacent(idx, n)) dfs(n, word);
    }
    visited[idx] = false;
  }

  for (let i = 0; i < letters.length; i++) dfs(i, '');
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b, 'fr'));
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

// Barème "tournoi" officiel (Hasbro/Parker Brothers)
export function tournoiPoints(len) {
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

// Barème officiel du Scrabble français. La tuile « Qu » contribue « QU »
// dans le mot, donc elle vaut naturellement Q+U = 9.
export const SCRABBLE_POINTS = {
  E: 1, A: 1, I: 1, N: 1, O: 1, R: 1, S: 1, T: 1, U: 1, L: 1,
  D: 2, G: 2, M: 2,
  B: 3, C: 3, P: 3,
  F: 4, H: 4, V: 4,
  J: 8, Q: 8,
  K: 10, W: 10, X: 10, Y: 10, Z: 10
};

export function scrabbleWordPoints(word) {
  let sum = 0;
  for (const ch of word) sum += SCRABBLE_POINTS[ch] || 0;
  return sum;
}

// Score d'une liste de mots pour un mode donné
// ('simple' | 'bonus' | 'tournoi' | 'scrabble')
export function scoreForWords(list, mode) {
  if (list.length === 0) return 0;
  if (mode === 'tournoi') {
    return list.reduce((sum, w) => sum + tournoiPoints(w.length), 0);
  }
  if (mode === 'scrabble') {
    return list.reduce((sum, w) => sum + scrabbleWordPoints(w), 0);
  }
  const base = list.reduce((sum, w) => sum + w.length, 0);
  if (mode === 'simple') return base;
  // mode bonus : base + 1 pt par mot trouvé + bonus égal à la longueur du mot le plus long
  const longest = list.reduce((max, w) => Math.max(max, w.length), 0);
  return base + list.length + longest;
}
