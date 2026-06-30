const els = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    word: document.querySelector("#wordView"),
    timeline: document.querySelector("#timelineView"),
  },
  canvas: document.querySelector("#wordCanvas"),
  timeline: document.querySelector("#timeline"),
  termNav: document.querySelector("#termNav"),
  music: document.querySelector("#bgMusic"),
  musicToggle: document.querySelector("#musicToggle"),
  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightboxImage"),
  lightboxDate: document.querySelector("#lightboxDate"),
  lightboxIndex: document.querySelector("#lightboxIndex"),
  closeLightbox: document.querySelector("#closeLightbox"),
  lightPrev: document.querySelector("#lightPrev"),
  lightNext: document.querySelector("#lightNext"),
};

const state = {
  photos: [],
  tiles: [],
  currentIndex: 0,
  drag: { active: false, x: 0, left: 0, scroller: null },
};

const terms = [
  { id: "small-a", name: "小班上学期", range: "2023.09 - 2024.01", start: "2023-09-01", end: "2024-01-31" },
  { id: "small-b", name: "小班下学期", range: "2024.02 - 2024.06", start: "2024-02-01", end: "2024-06-30" },
  { id: "middle-a", name: "中班上学期", range: "2024.09 - 2025.01", start: "2024-09-01", end: "2025-01-31" },
  { id: "middle-b", name: "中班下学期", range: "2025.02 - 2025.06", start: "2025-02-01", end: "2025-06-30" },
  { id: "big-a", name: "大班上学期", range: "2025.09 - 2026.01", start: "2025-09-01", end: "2026-01-31" },
  { id: "big-b", name: "大班下学期", range: "2026.03 - 2026.06", start: "2026-03-01", end: "2026-06-30" },
];

const imageCache = new Map();
const ctx = els.canvas.getContext("2d", { alpha: false });
const wordLines = ["毕业", "快乐"];

init();

async function init() {
  const photos = window.PHOTOS || [];
  state.photos = photos
    .filter((photo) => /\.(jpe?g|png|webp)$/i.test(photo.file))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((photo, index) => ({ ...photo, index }));

  bindEvents();
  renderTimeline();
  setCurrent(0, false);
  await warmImages(state.photos.slice(0, 60));
  renderWord();
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  window.addEventListener("resize", debounce(renderWord, 120));
  els.canvas.addEventListener("click", onCanvasClick);
  els.musicToggle.addEventListener("click", toggleMusic);
  els.closeLightbox.addEventListener("click", () => els.lightbox.close());
  els.lightPrev.addEventListener("click", () => openLightbox(wrapIndex(state.currentIndex - 1)));
  els.lightNext.addEventListener("click", () => openLightbox(wrapIndex(state.currentIndex + 1)));

  els.timeline.addEventListener("pointerdown", startTermDrag);
  els.timeline.addEventListener("pointermove", moveTermDrag);
  els.timeline.addEventListener("pointerup", stopTermDrag);
  els.timeline.addEventListener("pointercancel", stopTermDrag);

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") stepPhoto(-1);
    if (event.key === "ArrowRight") stepPhoto(1);
    if (event.key === "Escape" && els.lightbox.open) els.lightbox.close();
  });
}

async function toggleMusic() {
  if (els.music.paused) {
    try {
      await els.music.play();
      els.musicToggle.classList.add("is-playing");
      els.musicToggle.textContent = "♪ 暂停音乐";
      els.musicToggle.setAttribute("aria-label", "暂停背景音乐");
    } catch {
      els.musicToggle.textContent = "♪ 点击播放";
    }
  } else {
    els.music.pause();
    els.musicToggle.classList.remove("is-playing");
    els.musicToggle.textContent = "♪ 播放音乐";
    els.musicToggle.setAttribute("aria-label", "播放背景音乐");
  }
}

function switchView(view) {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  Object.entries(els.views).forEach(([key, section]) => section.classList.toggle("is-active", key === view));
  if (view === "word") renderWord();
  if (view === "timeline") scrollCurrentIntoView();
}

function renderTimeline() {
  const fragment = document.createDocumentFragment();
  const nav = document.createDocumentFragment();
  const grouped = terms.map((term) => ({
    ...term,
    photos: state.photos.filter((photo) => photo.date >= term.start && photo.date <= term.end),
  }));

  grouped.forEach((term) => {
    const navButton = document.createElement("button");
    navButton.className = "term-nav-button";
    navButton.type = "button";
    navButton.dataset.termTarget = term.id;
    navButton.textContent = term.name;
    navButton.addEventListener("click", () => {
      document.querySelector(`[data-term="${term.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
    nav.append(navButton);

    const row = document.createElement("section");
    row.className = "term-row";
    row.dataset.term = term.id;
    row.innerHTML = `
      <div class="term-label">
        <strong>${term.name}</strong>
        <span>${term.range}</span>
        <em>${term.photos.length} 张</em>
      </div>
      <div class="term-body">
        <div class="term-scroll">
          <div class="term-strip">
            <div class="term-axis" aria-hidden="true"></div>
            <div class="term-track"></div>
          </div>
        </div>
      </div>
    `;
    const track = row.querySelector(".term-track");
    const axis = row.querySelector(".term-axis");
    renderTermAxis(axis, term);

    term.photos.forEach((photo) => {
      const card = document.createElement("button");
      card.className = "photo-card";
      card.type = "button";
      card.dataset.index = photo.index;
      card.innerHTML = `
        <img src="${photo.src}" loading="lazy" alt="${formatDate(photo.date)}" />
        <time datetime="${photo.date}">${formatDate(photo.date)}</time>
      `;
      card.addEventListener("click", () => openLightbox(photo.index));
      track.append(card);
    });

    fragment.append(row);
  });

  els.termNav.replaceChildren(nav);
  els.timeline.replaceChildren(fragment);
}

function renderTermAxis(axis, term) {
  let cursor = new Date(`${term.start}T00:00:00`);
  const end = new Date(`${term.end}T00:00:00`);

  while (cursor <= end) {
    const month = document.createElement("span");
    month.textContent = `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    axis.append(month);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
}

function startTermDrag(event) {
  if (event.target.closest("button")) return;
  const scroller = event.target.closest(".term-scroll");
  if (!scroller) return;
  state.drag = { active: true, x: event.clientX, left: scroller.scrollLeft, scroller };
  scroller.classList.add("is-dragging");
  scroller.setPointerCapture(event.pointerId);
}

function moveTermDrag(event) {
  if (!state.drag.active || !state.drag.scroller) return;
  state.drag.scroller.scrollLeft = state.drag.left - (event.clientX - state.drag.x);
}

function stopTermDrag() {
  state.drag.scroller?.classList.remove("is-dragging");
  state.drag = { active: false, x: 0, left: 0, scroller: null };
}

function renderWord() {
  if (!state.photos.length) return;

  const rect = els.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.canvas.width = Math.round(rect.width * dpr);
  els.canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const mask = makeWordMask(rect.width, rect.height);
  const candidates = buildWordCells(rect.width, rect.height, mask);

  const selected = pickEvenly(candidates, state.photos.length);
  state.tiles = selected.map((tile, index) => ({ ...tile, photo: state.photos[index % state.photos.length] }));
  drawTiles();
}

function makeWordMask(width, height) {
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  maskCanvas.width = Math.ceil(width);
  maskCanvas.height = Math.ceil(height);
  maskCtx.fillStyle = "#000";
  maskCtx.fillRect(0, 0, width, height);
  maskCtx.fillStyle = "#fff";
  maskCtx.textAlign = "center";
  maskCtx.textBaseline = "middle";
  drawWordText(maskCtx, width, height, "fill");
  const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;

  return (x, y) => {
    const safeX = Math.max(0, Math.min(maskCanvas.width - 1, x));
    const safeY = Math.max(0, Math.min(maskCanvas.height - 1, y));
    const index = (safeY * maskCanvas.width + safeX) * 4;
    return data[index] > 120;
  };
}

function buildWordCells(width, height, mask) {
  const aspect = width / height;
  let columns = Math.max(42, Math.ceil(Math.sqrt((state.photos.length / 0.34) * aspect)));
  let candidates = [];

  while (candidates.length < state.photos.length && columns < 90) {
    const cell = width / columns;
    const rows = Math.floor(height / cell);
    candidates = [];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const cx = Math.floor((x + 0.5) * cell);
        const cy = Math.floor((y + 0.5) * cell);
        if (mask(cx, cy)) candidates.push({ x: x * cell, y: y * cell, size: cell });
      }
    }

    columns += 3;
  }

  return candidates;
}

function drawTiles() {
  state.tiles.forEach((tile, tileIndex) => {
    const photo = tile.photo;
    getImage(photo).then((img) => {
      drawCoverImage(img, tile.x, tile.y, tile.size - 2, tile.size - 2);
      ctx.strokeStyle = "rgba(255, 253, 248, 0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(tile.x, tile.y, tile.size - 2, tile.size - 2);
      if (tileIndex === state.tiles.length - 1) drawWordOutline();
    });
  });
}

function drawWordOutline() {
  const rect = els.canvas.getBoundingClientRect();
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = Math.max(2, rect.width * 0.004);
  ctx.strokeStyle = "#f4efe7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawWordText(ctx, rect.width, rect.height, "stroke");
  ctx.restore();
}

function getWordFont(width, height) {
  const fontSize = Math.floor(Math.min(width / 2.18, height / 2.18));
  return {
    font: `900 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`,
    lineHeight: fontSize * 1.02,
  };
}

function drawWordText(targetCtx, width, height, mode) {
  const { font, lineHeight } = getWordFont(width, height);
  const centerY = height / 2 - height * 0.025;
  targetCtx.font = font;
  wordLines.forEach((line, index) => {
    const y = centerY + (index - (wordLines.length - 1) / 2) * lineHeight;
    if (mode === "stroke") targetCtx.strokeText(line, width / 2, y);
    else targetCtx.fillText(line, width / 2, y);
  });
}

function drawCoverImage(img, x, y, width, height) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

function onCanvasClick(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tile = state.tiles.find((item) => x >= item.x && x <= item.x + item.size && y >= item.y && y <= item.y + item.size);
  if (tile) openLightbox(tile.photo.index);
}

function openLightbox(index) {
  setCurrent(index, true);
  const photo = state.photos[index];
  els.lightboxImage.src = photo.src;
  els.lightboxImage.alt = formatDate(photo.date);
  els.lightboxDate.textContent = formatDate(photo.date);
  els.lightboxIndex.textContent = `${index + 1} / ${state.photos.length}`;
  if (!els.lightbox.open) els.lightbox.showModal();
}

function setCurrent(index, shouldScroll) {
  state.currentIndex = Math.max(0, Math.min(state.photos.length - 1, index));
  const currentTerm = findTerm(state.photos[state.currentIndex]);
  document.querySelectorAll(".photo-card").forEach((card) => {
    card.classList.toggle("is-current", Number(card.dataset.index) === state.currentIndex);
  });
  document.querySelectorAll(".term-nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.termTarget === currentTerm?.id);
  });
  if (shouldScroll) scrollCurrentIntoView();
}

function scrollCurrentIntoView() {
  const card = document.querySelector(`.photo-card[data-index="${state.currentIndex}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function stepPhoto(delta) {
  const next = wrapIndex(state.currentIndex + delta);
  if (els.lightbox.open) openLightbox(next);
  else setCurrent(next, true);
}

function wrapIndex(index) {
  return (index + state.photos.length) % state.photos.length;
}

function getImage(photo) {
  if (imageCache.has(photo.src)) return imageCache.get(photo.src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(new Image());
    img.src = photo.src;
  });
  imageCache.set(photo.src, promise);
  return promise;
}

function warmImages(photos) {
  return Promise.all(photos.map(getImage));
}

function pickEvenly(items, count) {
  if (items.length <= count) return items;
  const picked = [];
  const step = items.length / count;
  for (let i = 0; i < count; i += 1) {
    picked.push(items[Math.floor(i * step)]);
  }
  return picked;
}

function formatDate(date) {
  const [year, month, day] = date.split("-");
  return `${year}.${month}.${day}`;
}

function findTerm(photo) {
  return terms.find((term) => photo.date >= term.start && photo.date <= term.end);
}

function debounce(fn, wait) {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, wait);
  };
}
