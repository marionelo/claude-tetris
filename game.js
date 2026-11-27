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

// ---- Skins ----
// Each skin: { name, colors[1..7], bg, grid, draw(ctx, x, y, size, colorIndex, alpha) }.
// draw() receives the block's top-left corner in pixels and is called as a method of
// the skin (uses this.colors); drawBlock() wraps it in save()/restore() and sets
// ctx.globalAlpha = alpha beforehand. Offsets scale with `size`. applySkin() publishes
// `bg` as the --canvas-bg CSS variable, which the canvases show behind the blocks.
const DEFAULT_SKIN = 'retro';
const SKIN_STORAGE_KEY = 'tetris.skin';

function roundedRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const SKINS = {
  // Flat square blocks with a top highlight (the original look).
  retro: {
    name: 'Retro',
    colors: COLORS,
    bg: '#1a1a25',
    grid: '#22222e',
    draw(c, x, y, size, colorIndex) {
      c.fillStyle = this.colors[colorIndex];
      c.fillRect(x + 1, y + 1, size - 2, size - 2);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(x + 1, y + 1, size - 2, 4);
    },
  },

  // Black background, glowing outlined blocks.
  neon: {
    name: 'Neón',
    colors: [
      null,
      '#00f0ff', // I
      '#fff200', // O
      '#d500f9', // T
      '#39ff14', // S
      '#ff1744', // Z
      '#2979ff', // J
      '#ff9100', // L
    ],
    bg: '#000000',
    grid: '#16162a',
    draw(c, x, y, size, colorIndex, alpha) {
      const color = this.colors[colorIndex];
      const m = size * 0.1;
      // Floor the outline alpha so the 0.2 ghost stays readable on a black board.
      c.globalAlpha = Math.max(alpha, 0.45);
      c.shadowColor = color;
      c.shadowBlur = size * 0.45;
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.strokeRect(x + m, y + m, size - 2 * m, size - 2 * m);
      // Reset the glow before the translucent core so it is not blurred as well.
      c.shadowBlur = 0;
      c.shadowColor = 'rgba(0,0,0,0)';
      c.globalAlpha = alpha * 0.3;
      c.fillStyle = color;
      c.fillRect(x + m, y + m, size - 2 * m, size - 2 * m);
    },
  },

  // Soft palette, rounded corners and a gentle gloss.
  pastel: {
    name: 'Pastel',
    colors: [
      null,
      '#a8e6f0', // I
      '#fff0a6', // O
      '#d9b8f5', // T
      '#b5e8bf', // S
      '#f7b3b8', // Z
      '#b4bef5', // J
      '#ffd3a3', // L
    ],
    bg: '#2b2540',
    grid: '#383152',
    draw(c, x, y, size, colorIndex) {
      c.fillStyle = this.colors[colorIndex];
      roundedRectPath(c, x + 1.5, y + 1.5, size - 3, size - 3, size * 0.3);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.38)';
      roundedRectPath(c, x + size * 0.2, y + size * 0.15, size * 0.6, size * 0.2, size * 0.1);
      c.fill();
    },
  },

  // 8-bit look: every block carries a grid of light/dark pixels.
  pixel: {
    name: 'Pixel art',
    colors: [
      null,
      '#29adff', // I
      '#ffec27', // O
      '#ff77a8', // T
      '#00e436', // S
      '#ff004d', // Z
      '#7e6bff', // J
      '#ffa300', // L
    ],
    bg: '#14172b',
    grid: '#1f2442',
    draw(c, x, y, size, colorIndex) {
      const n = 7;                  // 7x7 whole-pixel cells, centered in the block
      const px = Math.max(1, Math.floor((size - 2) / n));
      const inner = px * n;
      const ox = x + Math.floor((size - inner) / 2);
      const oy = y + Math.floor((size - inner) / 2);
      c.fillStyle = this.colors[colorIndex];
      c.fillRect(ox, oy, inner, inner);
      // dithered interior: light and dark pixels in a checkerboard
      c.beginPath();
      for (let i = 1; i < n - 1; i++)
        for (let j = 1; j < n - 1; j++)
          if ((i + j) % 2 === 0) c.rect(ox + j * px, oy + i * px, px, px);
      c.fillStyle = 'rgba(255,255,255,0.14)';
      c.fill();
      c.beginPath();
      for (let i = 1; i < n - 1; i++)
        for (let j = 1; j < n - 1; j++)
          if ((i + j) % 2 === 1) c.rect(ox + j * px, oy + i * px, px, px);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fill();
      // bevel: light top/left edge, dark bottom/right edge
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillRect(ox, oy, inner, px);
      c.fillRect(ox, oy + px, px, inner - px);
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.fillRect(ox + px, oy + inner - px, inner - px, px);
      c.fillRect(ox + inner - px, oy + px, px, inner - 2 * px);
      // specular pixel
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(ox + px, oy + px, px, px);
    },
  },
};

let currentSkin = SKINS[DEFAULT_SKIN];

const LINE_SCORES = [0, 100, 300, 500, 800];

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
  merge();
  clearLines();
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
  const a = alpha ?? 1;
  context.save(); // a skin can't leak shadow/stroke/alpha state into later blocks
  context.globalAlpha = a;
  currentSkin.draw(context, x * size, y * size, size, colorIndex, a);
  context.restore();
}

function drawGrid() {
  ctx.strokeStyle = currentSkin.grid;
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

// ---- Skin selector: apply / persist ----
const skinSelect = document.getElementById('skin-select');

function isSkinId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id);
}

function loadSavedSkin() {
  try {
    const saved = localStorage.getItem(SKIN_STORAGE_KEY);
    if (isSkinId(saved)) return saved;
  } catch (e) { /* storage unavailable: fall through to the default */ }
  return DEFAULT_SKIN;
}

function saveSkin(id) {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, id);
  } catch (e) { /* storage unavailable or full: the skin just won't persist */ }
}

// Switches the skin without touching game state. Safe to call before the game exists
// (board/current/next undefined), while paused and after game over.
function applySkin(id) {
  if (!isSkinId(id)) id = DEFAULT_SKIN;
  currentSkin = SKINS[id];
  document.body.dataset.skin = id;
  document.body.style.setProperty('--canvas-bg', currentSkin.bg);
  if (skinSelect) skinSelect.value = id;
  if (board && current) {
    draw();
    if (next) drawNext();
  }
  return id;
}

if (skinSelect) {
  for (const id of Object.keys(SKINS)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = SKINS[id].name;
    skinSelect.appendChild(option);
  }
  skinSelect.addEventListener('change', () => {
    saveSkin(applySkin(skinSelect.value));
    skinSelect.blur(); // so Space/arrows keep controlling the game, not the select
  });
  // If the select still has focus (e.g. its dropdown was dismissed without a change),
  // game keys must drive the game, not the select: cancel the select's own handling
  // and drop focus; the event still bubbles to the game's document listener.
  const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX', 'KeyP'];
  skinSelect.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || !GAME_KEYS.includes(e.code)) return;
    e.preventDefault();
    skinSelect.blur();
  });
}

applySkin(loadSavedSkin());

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
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

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

init();
