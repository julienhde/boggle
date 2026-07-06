(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  const GRID_SIZE = 4;
  const GAME_DURATION = 180; // secondes
  const DICT_URL = 'data/words_fr.txt.gz';

  // Dés Boggle version française classique (16 dés)
  const DICE = [
    'ETUKNO', 'EVGTIN', 'DECAMP', 'IELRUW',
    'EHIFSE', 'RECALS', 'ENTDOS', 'OFXRIA',
    'NAVEDZ', 'EIOATA', 'GLENYU', 'BMAQJO',
    'TLIBRA', 'SPULTE', 'AIMSOR', 'ENHRIS'
  ];

  // ---------------------------------------------------------------------------
  // PRNG déterministe : même seed => même grille sur tous les téléphones.
  // Ne pas modifier mulberry32/seededShuffle ni l'ordre des tirages dans
  // generateGrid, sinon les numéros de grille partagés changent de lettres.
  // ---------------------------------------------------------------------------

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Seed numérique direct, ou hash d'un texte ("vacances2026" par ex.)
  function parseSeed(str) {
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
  let timeLeft = GAME_DURATION;
  let timerId = null;
  let playing = false;
  let locked = false;     // true pendant le flash vert/rouge post-validation

  let dictionary = null;  // Set<string> une fois chargé
  let dictState = 'loading'; // 'loading' | 'ready' | 'error'

  // ---------------------------------------------------------------------------
  // Dictionnaire
  // ---------------------------------------------------------------------------

  async function loadDictionary() {
    try {
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
      const list = text.split('\n').filter(Boolean);
      dictionary = new Set(list);
      dictState = 'ready';
      dictStatusEl.textContent = `Dictionnaire prêt — ${list.length.toLocaleString('fr-FR')} mots ✓`;
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
    const rng = mulberry32(seed);
    const dice = seededShuffle(DICE, rng);
    letters = dice.map((die) => {
      const face = die[Math.floor(rng() * 6)];
      return face === 'Q' ? 'Qu' : face;
    });
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

  function areAdjacent(a, b) {
    const ra = Math.floor(a / GRID_SIZE), ca = a % GRID_SIZE;
    const rb = Math.floor(b / GRID_SIZE), cb = b % GRID_SIZE;
    return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1 && a !== b;
  }

  // ---------------------------------------------------------------------------
  // Score
  // ---------------------------------------------------------------------------

  // Barème "tournoi" officiel (Hasbro/Parker Brothers)
  function tournoiPoints(len) {
    if (len <= 4) return 1;
    if (len === 5) return 2;
    if (len === 6) return 3;
    if (len === 7) return 5;
    return 11;
  }

  // Points d'un mot seul, hors bonus globaux (utilisé pour l'affichage sur le chip)
  function wordBasePoints(word) {
    if (scoreModeSelect.value === 'tournoi') return tournoiPoints(word.length);
    return word.length; // simple et bonus partagent la même base : 1 pt/lettre
  }

  // Score total selon le mode actif, recalculé à partir de la liste de mots
  function computeTotalScore() {
    const mode = scoreModeSelect.value;
    if (words.length === 0) return 0;
    if (mode === 'tournoi') {
      return words.reduce((sum, w) => sum + tournoiPoints(w.length), 0);
    }
    const base = words.reduce((sum, w) => sum + w.length, 0);
    if (mode === 'simple') return base;
    // mode bonus : base + 1 pt par mot trouvé + bonus égal à la longueur du mot le plus long
    const longest = words.reduce((max, w) => Math.max(max, w.length), 0);
    return base + words.length + longest;
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
      flashFeedback(`+${pts} pt${pts > 1 ? 's' : ''}`, true);
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
    timeLeft = GAME_DURATION;
    timerEl.textContent = formatTime(timeLeft);
    timerEl.classList.remove('low');
    playing = true;
    gridEl.classList.remove('disabled');
    startBtn.textContent = 'Recommencer';
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 1000);
  }

  function tick() {
    timeLeft--;
    timerEl.textContent = formatTime(timeLeft);
    if (timeLeft <= 30) timerEl.classList.add('low');
    if (timeLeft <= 0) endGame();
  }

  function endGame() {
    clearInterval(timerId);
    timerId = null;
    playing = false;
    gridEl.classList.add('disabled');
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
    timeLeft = GAME_DURATION;
    timerEl.textContent = formatTime(timeLeft);
    timerEl.classList.remove('low');
    gridEl.classList.add('disabled');
    endBanner.style.display = 'none';
    startBtn.textContent = 'Démarrer';
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
    endBanner.style.display = 'block';
    endBanner.textContent = '';

    endBanner.append(`Temps écoulé — grille n°${currentSeed}`, document.createElement('br'), 'Score : ');
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

    endBanner.append(
      document.createElement('br'),
      smallNote(dictState === 'ready'
        ? 'Mots déjà vérifiés automatiquement'
        : 'Comparez vos listes, supprimez les mots refusés avec ×')
    );
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

  gridEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) tapTile(parseInt(tile.dataset.idx, 10));
  });

  scoreModeSelect.addEventListener('change', () => {
    renderWordList();
    if (endBanner.style.display === 'block') {
      showEndBanner();
    }
  });

  document.getElementById('validateBtn').addEventListener('click', validateWord);
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (locked) return;
    clearPath();
  });
  startBtn.addEventListener('click', startGame);

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  // Grille de démo au chargement
  generateGrid(1);
  seedInput.value = 1;
  currentSeed = 1;

  loadDictionary();

  // PWA : cache hors-ligne via service worker (HTTPS ou localhost uniquement)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
