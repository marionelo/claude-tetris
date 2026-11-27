'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const RECORDS_KEY = 'tetris.records';
const MAX_RECORDS = 5;
const MAX_NAME_LENGTH = 12;

// In-memory copy of the records. It is also the fallback when localStorage is unavailable.
let records = emptyRecords();
let storageFailed = false; // set when a write to localStorage fails
let pendingRun = null;  // finished run that may still be saved: { score, lines, level }
let savedEntry = null;  // entry just saved on the game-over screen (highlighted)
let comboCount = 0;     // consecutive locks that cleared at least one line
let runBestCombo = 0;   // best combo of the current run

function emptyRecords() {
  return { scores: [], bestCombo: 0, maxLines: 0 };
}

function toCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeRecords(raw) {
  const clean = emptyRecords();
  if (!raw || typeof raw !== 'object') return clean;
  if (Array.isArray(raw.scores)) {
    for (const s of raw.scores) {
      if (!s || typeof s !== 'object' || toCount(s.score) === 0) continue;
      clean.scores.push({
        name: String(s.name ?? '').slice(0, MAX_NAME_LENGTH),
        score: toCount(s.score),
        lines: toCount(s.lines),
        level: toCount(s.level),
        date: typeof s.date === 'string' ? s.date : '',
      });
    }
    clean.scores.sort((a, b) => b.score - a.score);
    clean.scores.splice(MAX_RECORDS);
  }
  clean.bestCombo = toCount(raw.bestCombo);
  clean.maxLines = toCount(raw.maxLines);
  return clean;
}

function loadRecords() {
  if (storageFailed) return records; // memory holds data that storage could not take
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    records = raw === null ? emptyRecords() : sanitizeRecords(JSON.parse(raw));
  } catch (e) {
    // Storage unavailable or corrupt data: keep using the in-memory copy.
  }
  return records;
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    storageFailed = false;
  } catch (e) {
    // Storage unavailable or full: records only live in memory for this page.
    storageFailed = true;
  }
}

// Position a score would take in the (descending) table; ties go below older entries.
function insertionIndex(value) {
  const i = records.scores.findIndex(s => value > s.score);
  return i === -1 ? records.scores.length : i;
}

function qualifiesForTop(value) {
  return value > 0 && insertionIndex(value) < MAX_RECORDS;
}

function trackCombo(cleared) {
  if (cleared > 0) {
    comboCount++;
    runBestCombo = Math.max(runBestCombo, comboCount);
  } else {
    comboCount = 0;
  }
}

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (gameOver) return; // loop() keeps ticking after a game over triggered from inside it
  merge();
  const linesBefore = lines;
  clearLines();
  trackCombo(lines - linesBefore);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverRecords();
}

// ---- Records (local high-score table) ----
const recordsPanel = document.getElementById('records-panel');
const recordsBody = document.getElementById('records-body');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const recordForm = document.getElementById('record-form');
const recordName = document.getElementById('record-name');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const playBtn = document.getElementById('play-btn');

function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Draws the table from `records`; while a run is pending, its future row is shown highlighted.
function renderRecords() {
  const rows = records.scores.slice();
  let pendingAt = -1;
  if (pendingRun) {
    pendingAt = insertionIndex(pendingRun.score);
    rows.splice(pendingAt, 0, { name: 'Tú', ...pendingRun, date: new Date().toISOString() });
    rows.splice(MAX_RECORDS);
  }

  recordsBody.textContent = '';
  if (rows.length === 0) {
    const cell = recordsBody.insertRow().insertCell();
    cell.colSpan = 6;
    cell.className = 'records-empty';
    cell.textContent = 'Aún no hay records';
  }
  rows.forEach((entry, i) => {
    const tr = recordsBody.insertRow();
    if (i === pendingAt || entry === savedEntry) tr.className = 'is-new';
    [i + 1, entry.name, entry.score.toLocaleString(), entry.lines, entry.level, formatDate(entry.date)]
      .forEach(value => { tr.insertCell().textContent = value; });
  });

  bestComboEl.textContent = records.bestCombo;
  maxLinesEl.textContent = records.maxLines;
  recordForm.hidden = !pendingRun;
  recordsPanel.hidden = false;
}

// Called on every game over: stats always update, the score only enters the table once a name is saved.
function showGameOverRecords() {
  loadRecords();
  records.bestCombo = Math.max(records.bestCombo, runBestCombo);
  records.maxLines = Math.max(records.maxLines, lines);
  saveRecords();
  savedEntry = null;
  pendingRun = qualifiesForTop(score) ? { score, lines, level } : null;
  renderRecords();
  if (pendingRun) {
    recordName.value = '';
    // Focus after a short delay so keys still being pressed to play don't end up in the name.
    setTimeout(() => { if (pendingRun) recordName.focus(); }, 400);
  }
}

function showStartScreen() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = true; // keeps the key handler and togglePause inert until "Jugar"
  pendingRun = null;
  savedEntry = null;
  loadRecords();
  overlayTitle.textContent = 'TETRIS';
  overlayTitle.classList.add('is-start');
  overlayScore.textContent = '';
  restartBtn.hidden = true;
  playBtn.hidden = false;
  overlay.classList.remove('hidden');
  renderRecords();
  playBtn.focus();
}

// Called at the end of init(): clears per-run combo state and hides the records screen.
function resetRunState() {
  comboCount = 0;
  runBestCombo = 0;
  pendingRun = null;
  savedEntry = null;
  overlayTitle.classList.remove('is-start');
  if (overlay.contains(document.activeElement)) document.activeElement.blur();
  recordsPanel.hidden = true;
  playBtn.hidden = true;
  restartBtn.hidden = false;
}

recordForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!pendingRun) return;
  loadRecords();
  const entry = {
    name: recordName.value.trim().slice(0, MAX_NAME_LENGTH) || 'Anónimo',
    ...pendingRun,
    date: new Date().toISOString(),
  };
  records.scores.splice(insertionIndex(entry.score), 0, entry);
  records.scores.splice(MAX_RECORDS);
  savedEntry = entry;
  pendingRun = null;
  saveRecords();
  renderRecords();
});

// Keep typing in the name field away from the game's global key handler.
recordName.addEventListener('keydown', e => e.stopPropagation());

resetRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los records? Esta acción no se puede deshacer.')) return;
  records = emptyRecords();
  pendingRun = null;
  savedEntry = null;
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch (e) {
    // Storage unavailable: nothing persisted to remove.
  }
  renderRecords();
});

playBtn.addEventListener('click', init);

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  resetRunState();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

showStartScreen();
