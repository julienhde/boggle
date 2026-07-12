import {
  buildGridLetters, parseSeed, areAdjacent,
  loadDictionary, solveGrid, scoreForWords
} from './core.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

// Modes de jeu, pilotés par traits :
// - duration : secondes au départ (absent => 0)
// - lowAt : seuil sous lequel le chrono passe en rouge
// - gainPerLetter : secondes rendues par lettre d'un mot validé (attack)
// - countsUp : le chrono monte au lieu de descendre, jamais de fin auto
// - endsManually : le bouton devient « Terminer » pendant la partie
const GAME_MODES = {
  classique: { duration: 180, lowAt: 30 },
  eclair: { duration: 90, lowAt: 15 },
  flash: { duration: 45, lowAt: 10 },
  attack: { duration: 60, gainPerLetter: 1, lowAt: 10 },
  libre: { countsUp: true, endsManually: true }
};

// ---------------------------------------------------------------------------
// Éléments du DOM
// ---------------------------------------------------------------------------

const gridEl = document.getElementById('grid');
const timerEl = document.getElementById('timer');
const scoreEl = document.getElementById('score');
const currentWordEl = document.getElementById('currentWord');
const feedbackEl = document.getElementById('feedback');
const wordListEl = document.getElementById('wordList');
const seedInput = document.getElementById('seedInput');
const gameModeSelect = document.getElementById('gameMode');
const scoreModeSelect = document.getElementById('scoreMode');
const startBtn = document.getElementById('startBtn');
const endBanner = document.getElementById('endBanner');
const dictStatusEl = document.getElementById('dictStatus');

// ---------------------------------------------------------------------------
// État de la partie
// ---------------------------------------------------------------------------

let letters = [];       // 16 lettres de la grille courante
let currentSeed = null;
let path = [];          // indices des cases sélectionnées
let words = [];         // liste de mots trouvés (strings)
let score = 0;          // recalculé à chaque changement via recalcScore()
let gameMode = 'classique'; // figé au startGame() : changer le select ne touche pas la partie en cours
let timeLeft = GAME_MODES.classique.duration; // compte vers le haut depuis 0 si countsUp
let timerId = null;
let playing = false;
let locked = false;     // true pendant le flash vert/rouge post-validation

let dictionary = null;  // Set<string> une fois chargé
let sortedWords = [];   // même contenu, trié : recherche par préfixe du solveur
let dictState = 'loading'; // 'loading' | 'ready' | 'error'
let solvedWords = null; // cache des solutions de la grille courante (recalculé à chaque nouvelle grille)

// ---------------------------------------------------------------------------
// Dictionnaire
// ---------------------------------------------------------------------------

async function initDictionary() {
  try {
    const { set, sorted } = await loadDictionary();
    dictionary = set;
    sortedWords = sorted;
    dictState = 'ready';
    dictStatusEl.textContent = `Dictionnaire prêt — ${sorted.length.toLocaleString('fr-FR')} mots ✓`;
    dictStatusEl.classList.add('ready');
  } catch (e) {
    dictState = 'error';
    dictStatusEl.textContent = 'Dictionnaire indisponible — validation manuelle';
    dictStatusEl.classList.add('error');
  }
}

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

function generateGrid(seed) {
  letters = buildGridLetters(seed);
  solvedWords = null; // la grille change : les solutions mises en cache ne valent plus
  renderGrid();
}

function renderGrid() {
  gridEl.textContent = '';
  letters.forEach((letter, idx) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.idx = idx;
    tile.textContent = letter;
    gridEl.appendChild(tile);
  });
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

// Points d'un mot seul, hors bonus globaux (utilisé pour l'affichage sur le chip)
function wordBasePoints(word) {
  const mode = scoreModeSelect.value;
  // bonus : les majorations (+1/mot, +plus long) sont globales, la base du
  // chip reste 1 pt/lettre ; tous les autres barèmes délèguent au moteur
  if (mode === 'bonus') return word.length;
  return scoreForWords([word], mode);
}

function computeTotalScore() {
  return scoreForWords(words, scoreModeSelect.value);
}

function recalcScore() {
  score = computeTotalScore();
  scoreEl.textContent = `${score} pt${score > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Sélection des cases
// ---------------------------------------------------------------------------

function tapTile(idx) {
  if (!playing || locked) return;
  const pos = path.indexOf(idx);
  if (pos !== -1) {
    // re-tap sur la dernière case => on l'enlève (retour arrière)
    if (pos === path.length - 1) {
      path.pop();
      updateSelection();
    }
    return;
  }
  if (path.length > 0 && !areAdjacent(path[path.length - 1], idx)) {
    flashFeedback('Case non adjacente', false);
    return;
  }
  path.push(idx);
  updateSelection();
}

// Glisser le doigt sur la grille : étend le chemin case par case, ou revient
// en arrière si on repasse sur une case déjà tracée. Contrairement à
// tapTile, ignore silencieusement les cases non adjacentes (le doigt
// survole forcément des cases invalides pendant un geste rapide).
function extendDragTo(idx) {
  const pos = path.indexOf(idx);
  if (pos !== -1) {
    if (pos === path.length - 1) return false;
    path.length = pos + 1;
    updateSelection();
    return true;
  }
  if (path.length > 0 && !areAdjacent(path[path.length - 1], idx)) return false;
  path.push(idx);
  updateSelection();
  return true;
}

function updateSelection() {
  const tiles = gridEl.querySelectorAll('.tile');
  tiles.forEach((t) => {
    t.classList.remove('active');
    const badge = t.querySelector('.order');
    if (badge) badge.remove();
  });
  path.forEach((idx, i) => {
    const t = tiles[idx];
    t.classList.add('active');
    const badge = document.createElement('span');
    badge.className = 'order';
    badge.textContent = i + 1;
    t.appendChild(badge);
  });
  const w = path.map((i) => letters[i]).join('');
  currentWordEl.textContent = w || ' ';
  currentWordEl.classList.remove('valid', 'invalid');
}

function currentWord() {
  return path.map((i) => letters[i]).join('').toUpperCase();
}

function clearPath() {
  path = [];
  updateSelection();
}

// ---------------------------------------------------------------------------
// Validation des mots
// ---------------------------------------------------------------------------

function flashFeedback(msg, ok) {
  feedbackEl.textContent = msg;
  feedbackEl.className = ok ? 'ok' : '';
  setTimeout(() => {
    if (feedbackEl.textContent === msg) {
      feedbackEl.textContent = ' ';
      feedbackEl.className = '';
    }
  }, 1800);
}

function validateWord() {
  if (!playing || locked) return;
  const w = currentWord();
  if (w.length < 3) {
    flashFeedback('Minimum 3 lettres', false);
    return;
  }
  if (words.includes(w)) {
    flashFeedback('Déjà joué !', false);
    clearPath();
    return;
  }
  const isValid = dictState !== 'ready' || dictionary.has(w);
  flashResult(isValid);
  if (isValid) {
    words.push(w);
    renderWordList();
    const pts = wordBasePoints(w);
    let msg = `+${pts} pt${pts > 1 ? 's' : ''}`;
    if (GAME_MODES[gameMode].gainPerLetter) {
      // le mot validé rend du temps : +1 s par lettre
      const gain = w.length * GAME_MODES[gameMode].gainPerLetter;
      timeLeft += gain;
      timerEl.textContent = formatTime(timeLeft);
      timerEl.classList.toggle('low', timeLeft <= GAME_MODES[gameMode].lowAt);
      msg += ` · +${gain}s`;
    }
    flashFeedback(msg, true);
  } else {
    flashFeedback('Mot non reconnu', false);
  }
}

function flashResult(isValid) {
  locked = true;
  const tiles = gridEl.querySelectorAll('.tile');
  const cls = isValid ? 'valid' : 'invalid';
  path.forEach((idx) => tiles[idx].classList.add(cls));
  currentWordEl.classList.add(cls);
  setTimeout(() => {
    path.forEach((idx) => tiles[idx].classList.remove('valid', 'invalid'));
    currentWordEl.classList.remove('valid', 'invalid');
    locked = false;
    if (isValid) {
      clearPath();
    }
  }, 550);
}

function renderWordList() {
  wordListEl.textContent = '';
  words.forEach((word) => {
    const chip = document.createElement('div');
    chip.className = 'word-chip';

    const label = document.createElement('span');
    label.textContent = word;

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = wordBasePoints(word);

    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '×';
    del.addEventListener('click', () => {
      const i = words.indexOf(word);
      if (i !== -1) {
        words.splice(i, 1);
        renderWordList();
        if (!playing) showEndBanner();
      }
    });

    chip.append(label, pts, del);
    wordListEl.appendChild(chip);
  });
  recalcScore();
}

// ---------------------------------------------------------------------------
// Chrono et déroulement de la partie
// ---------------------------------------------------------------------------

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function startGame() {
  let seed = parseSeed(seedInput.value);
  if (seed === null) {
    seed = Math.floor(Math.random() * 100000);
    seedInput.value = seed;
  }
  currentSeed = seed;
  generateGrid(seed);
  words = [];
  renderWordList();
  endBanner.style.display = 'none';
  clearPath();
  gameMode = gameModeSelect.value;
  resetTimerDisplay();
  playing = true;
  gridEl.classList.remove('disabled', 'preview');
  startBtn.textContent = GAME_MODES[gameMode].endsManually ? 'Terminer' : 'Recommencer';
  if (timerId) clearInterval(timerId);
  timerId = setInterval(tick, 1000);
}

function tick() {
  if (GAME_MODES[gameMode].countsUp) {
    // pas de fin automatique : simple temps écoulé, à titre indicatif
    timeLeft++;
    timerEl.textContent = formatTime(timeLeft);
    return;
  }
  timeLeft--;
  timerEl.textContent = formatTime(timeLeft);
  // en attack le temps peut remonter au-dessus du seuil, d'où le toggle
  timerEl.classList.toggle('low', timeLeft <= GAME_MODES[gameMode].lowAt);
  if (timeLeft <= 0) endGame();
}

function endGame() {
  clearInterval(timerId);
  timerId = null;
  playing = false;
  gridEl.classList.add('disabled');
  startBtn.textContent = 'Recommencer';
  timerEl.classList.remove('low');
  clearPath();
  showEndBanner();
}

function stopCurrentGame() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  playing = false;
  locked = false;
  path = [];
  words = [];
  renderWordList();
  resetTimerDisplay();
  gridEl.classList.add('disabled', 'preview');
  endBanner.style.display = 'none';
  startBtn.textContent = 'Démarrer';
}

// Remet le chrono à sa valeur de départ pour le mode sélectionné
// (0 pour un mode qui compte vers le haut)
function resetTimerDisplay() {
  timeLeft = GAME_MODES[gameModeSelect.value].duration ?? 0;
  timerEl.textContent = formatTime(timeLeft);
  timerEl.classList.remove('low');
}

// ---------------------------------------------------------------------------
// Bannière de fin
// ---------------------------------------------------------------------------

function smallNote(text) {
  const small = document.createElement('small');
  small.style.color = '#aaa';
  small.textContent = text;
  return small;
}

function showEndBanner() {
  const mode = scoreModeSelect.value;
  const wasOpen = endBanner.querySelector('details.solutions')?.open ?? false;
  endBanner.style.display = 'block';
  endBanner.textContent = '';

  const title = GAME_MODES[gameMode].countsUp
    ? `Partie terminée — grille n°${currentSeed} (temps : ${formatTime(timeLeft)})`
    : `Temps écoulé — grille n°${currentSeed}`;
  endBanner.append(title, document.createElement('br'), 'Score : ');
  const strong = document.createElement('strong');
  strong.textContent = `${score} pts`;
  endBanner.append(strong, ` (${words.length} mot${words.length > 1 ? 's' : ''})`);

  if (mode === 'bonus' && words.length > 0) {
    const base = words.reduce((sum, w) => sum + w.length, 0);
    const longest = words.reduce((max, w) => Math.max(max, w.length), 0);
    endBanner.append(
      document.createElement('br'),
      smallNote(`Base ${base} + ${words.length} mot${words.length > 1 ? 's' : ''} + plus long mot (${longest}) = ${score}`)
    );
  }
  if (mode === 'tournoi') {
    endBanner.append(
      document.createElement('br'),
      smallNote('Barème : 3-4 lettres = 1 pt · 5 = 2 pts · 6 = 3 pts · 7 = 5 pts · 8+ = 11 pts')
    );
  }
  if (mode === 'scrabble') {
    endBanner.append(
      document.createElement('br'),
      smallNote('Barème Scrabble : 1 pt (E,A,I,N,O,R,S,T,U,L) · 2 (D,G,M) · 3 (B,C,P) · 4 (F,H,V) · 8 (J,Q) · 10 (K,W,X,Y,Z)')
    );
  }

  endBanner.append(
    document.createElement('br'),
    smallNote(dictState === 'ready'
      ? 'Mots déjà vérifiés automatiquement'
      : 'Comparez vos listes, supprimez les mots refusés avec ×')
  );

  if (dictState === 'ready') {
    if (solvedWords === null) solvedWords = solveGrid(letters, dictionary, sortedWords);
    const maxScore = scoreForWords(solvedWords, mode);
    endBanner.append(
      document.createElement('br'),
      smallNote(`Solutions possibles : ${solvedWords.length} mot${solvedWords.length > 1 ? 's' : ''} (score max : ${maxScore} pts)`)
    );

    const details = document.createElement('details');
    details.className = 'solutions';
    details.open = wasOpen;
    const summary = document.createElement('summary');
    summary.textContent = 'Voir les solutions';
    const list = document.createElement('div');
    list.className = 'solutions-list';
    list.textContent = solvedWords.join(', ');
    details.append(summary, list);
    endBanner.appendChild(details);
  }
}

// ---------------------------------------------------------------------------
// Écouteurs
// ---------------------------------------------------------------------------

// Prévisualiser une grille sans lancer le chrono
document.getElementById('loadSeedBtn').addEventListener('click', () => {
  const seed = parseSeed(seedInput.value);
  if (seed === null) { flashFeedback('Entre un numéro de grille', false); return; }
  stopCurrentGame();
  currentSeed = seed;
  generateGrid(seed);
  updateSelection();
  flashFeedback(`Grille n°${seed} chargée`, true);
});

document.getElementById('randomSeedBtn').addEventListener('click', () => {
  const seed = Math.floor(Math.random() * 100000);
  seedInput.value = seed;
  stopCurrentGame();
  currentSeed = seed;
  generateGrid(seed);
  updateSelection();
  flashFeedback(`Grille n°${seed}`, true);
});

// Sélection par pointeur (souris, tactile, stylet) : un tap simple se
// comporte comme avant (tapTile, validation manuelle). Un glissé qui
// modifie le chemin sur 2 cases ou plus valide automatiquement le mot au
// relâchement, comme dans les applis Boggle classiques.
let dragPointerId = null;
let dragLastIdx = null;
let dragExtended = false;

function tileIndexAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const tile = el && el.closest && el.closest('.tile');
  if (!tile || !gridEl.contains(tile)) return null;
  return parseInt(tile.dataset.idx, 10);
}

gridEl.addEventListener('pointerdown', (e) => {
  if (!playing || locked) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  dragPointerId = e.pointerId;
  dragLastIdx = parseInt(tile.dataset.idx, 10);
  dragExtended = false;
  gridEl.setPointerCapture(e.pointerId);
  tapTile(dragLastIdx);
});

gridEl.addEventListener('pointermove', (e) => {
  if (dragPointerId !== e.pointerId || !playing || locked) return;
  const idx = tileIndexAtPoint(e.clientX, e.clientY);
  if (idx === null || idx === dragLastIdx) return;
  dragLastIdx = idx;
  if (extendDragTo(idx)) dragExtended = true;
});

gridEl.addEventListener('pointerup', (e) => {
  if (dragPointerId !== e.pointerId) return;
  gridEl.releasePointerCapture(e.pointerId);
  dragPointerId = null;
  dragLastIdx = null;
  const shouldValidate = dragExtended;
  dragExtended = false;
  if (shouldValidate) validateWord();
});

gridEl.addEventListener('pointercancel', (e) => {
  if (dragPointerId !== e.pointerId) return;
  gridEl.releasePointerCapture(e.pointerId);
  dragPointerId = null;
  dragLastIdx = null;
  dragExtended = false;
});

scoreModeSelect.addEventListener('change', () => {
  renderWordList();
  if (endBanner.style.display === 'block') {
    showEndBanner();
  }
});

gameModeSelect.addEventListener('change', () => {
  // hors partie : prévisualise le chrono du mode choisi et efface le bilan
  // de la partie précédente (les deux ne peuvent pas cohabiter à l'écran)
  if (!playing) {
    resetTimerDisplay();
    endBanner.style.display = 'none';
  }
});

document.getElementById('validateBtn').addEventListener('click', validateWord);
document.getElementById('clearBtn').addEventListener('click', () => {
  if (locked) return;
  clearPath();
});
startBtn.addEventListener('click', () => {
  // pour un mode à fin manuelle, le bouton devient « Terminer » pendant la partie
  if (playing && GAME_MODES[gameMode].endsManually) {
    endGame();
    return;
  }
  startGame();
});

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

// Grille de démo au chargement ; resetTimerDisplay synchronise le chrono
// avec le mode restauré par le navigateur (Firefox conserve les <select>
// au rechargement, le « 3:00 » du HTML serait alors faux)
generateGrid(1);
seedInput.value = 1;
currentSeed = 1;
resetTimerDisplay();

initDictionary();

// PWA : cache hors-ligne via service worker (HTTPS ou localhost uniquement)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
