// Page « admin » (maître du jeu) : charge une grille par son numéro et
// affiche immédiatement ses solutions, sans chrono ni partie.
import { buildGridLetters, parseSeed, loadDictionary, solveGrid, scoreForWords } from './core.js';

const gridEl = document.getElementById('grid');
const seedInput = document.getElementById('seedInput');
const feedbackEl = document.getElementById('feedback');
const dictStatusEl = document.getElementById('dictStatus');
const resultsEl = document.getElementById('results');
const resWordCountEl = document.getElementById('resWordCount');
const resLongestEl = document.getElementById('resLongest');
const resMaxScoresEl = document.getElementById('resMaxScores');
const toggleWordsBtn = document.getElementById('toggleWordsBtn');
const allWordsEl = document.getElementById('allWords');

let letters = [];
let dictionary = null;
let sortedWords = [];
let dictReady = false;
let solvedWords = null;

function flashFeedback(msg, ok) {
  feedbackEl.textContent = msg;
  feedbackEl.className = ok ? 'ok' : '';
  setTimeout(() => {
    if (feedbackEl.textContent === msg) {
      feedbackEl.textContent = ' ';
      feedbackEl.className = '';
    }
  }, 1800);
}

function renderGrid() {
  gridEl.textContent = '';
  letters.forEach((letter) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.textContent = letter;
    gridEl.appendChild(tile);
  });
}

function renderResults() {
  if (!dictReady) return;
  solvedWords = solveGrid(letters, dictionary, sortedWords);

  const n = solvedWords.length;
  resWordCountEl.textContent = `${n} mot${n > 1 ? 's' : ''} possible${n > 1 ? 's' : ''}`;
  const longest = n > 0 ? solvedWords[0].length : 0; // liste triée du plus long au plus court
  resLongestEl.textContent = n > 0 ? `Mot le plus long : ${longest} lettres` : 'Aucun mot dans cette grille';
  resMaxScoresEl.textContent = 'Score max — simple : '
    + scoreForWords(solvedWords, 'simple') + ' pts · bonus : '
    + scoreForWords(solvedWords, 'bonus') + ' pts · tournoi : '
    + scoreForWords(solvedWords, 'tournoi') + ' pts';

  resultsEl.hidden = false;
  toggleWordsBtn.hidden = n === 0;
  renderAllWords();
}

// Liste complète groupée par longueur, du plus long au plus court
function renderAllWords() {
  allWordsEl.textContent = '';
  const byLength = new Map();
  solvedWords.forEach((w) => {
    if (!byLength.has(w.length)) byLength.set(w.length, []);
    byLength.get(w.length).push(w);
  });
  [...byLength.keys()].sort((a, b) => b - a).forEach((len) => {
    const group = byLength.get(len);
    const title = document.createElement('div');
    title.className = 'word-group-title';
    title.textContent = `${len} lettres (${group.length})`;
    const list = document.createElement('div');
    list.className = 'word-group-list';
    list.textContent = group.join(', ');
    allWordsEl.append(title, list);
  });
}

function loadGrid(seed) {
  letters = buildGridLetters(seed);
  solvedWords = null;
  renderGrid();
  renderResults();
}

document.getElementById('loadSeedBtn').addEventListener('click', () => {
  const seed = parseSeed(seedInput.value);
  if (seed === null) { flashFeedback('Entre un numéro de grille', false); return; }
  loadGrid(seed);
  flashFeedback(`Grille n°${seed} chargée`, true);
});

document.getElementById('randomSeedBtn').addEventListener('click', () => {
  const seed = Math.floor(Math.random() * 100000);
  seedInput.value = seed;
  loadGrid(seed);
  flashFeedback(`Grille n°${seed}`, true);
});

seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('loadSeedBtn').click();
});

toggleWordsBtn.addEventListener('click', () => {
  allWordsEl.hidden = !allWordsEl.hidden;
  toggleWordsBtn.textContent = allWordsEl.hidden ? 'Afficher tous les mots' : 'Masquer les mots';
});

// Initialisation : grille n°1 affichée tout de suite, stats dès que le
// dictionnaire est prêt
seedInput.value = 1;
letters = buildGridLetters(1);
renderGrid();

loadDictionary().then(({ set, sorted }) => {
  dictionary = set;
  sortedWords = sorted;
  dictReady = true;
  dictStatusEl.textContent = `Dictionnaire prêt — ${sorted.length.toLocaleString('fr-FR')} mots ✓`;
  dictStatusEl.classList.add('ready');
  renderResults();
}).catch(() => {
  dictStatusEl.textContent = 'Dictionnaire indisponible — impossible de calculer les solutions';
  dictStatusEl.classList.add('error');
});
