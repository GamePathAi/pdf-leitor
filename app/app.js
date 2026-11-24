import * as pdfjsLib from './vendor/pdf.min.mjs';
import { buildPdf, TEXT_ASCENT, LINE_HEIGHT } from './export.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const DOC_OPTS = {
  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
};

const $ = (id) => document.getElementById(id);
const els = {
  viewer: $('viewer'), pages: $('pages'), empty: $('empty'), title: $('doc-title'),
  btnOpen: $('btn-open'), btnOpenBig: $('btn-open-big'), btnPages: $('btn-pages'), btnSave: $('btn-save'),
  btnNight: $('btn-night'), zoomGroup: $('zoom-group'), btnZoomIn: $('btn-zoom-in'), btnZoomOut: $('btn-zoom-out'),
  btnZoomFit: $('btn-zoom-fit'), indicator: $('page-indicator'), pageInput: $('page-input'), pageCount: $('page-count'),
  toolbar: $('toolbar'), btnColor: $('btn-color'), colorDot: $('color-dot'), btnUndo: $('btn-undo'),
  colorPop: $('color-pop'), colorList: $('color-list'), widthRow: $('width-row'),
  drawer: $('drawer'), backdrop: $('drawer-backdrop'), thumbs: $('thumbs'), btnMerge: $('btn-merge'),
  btnDrawerClose: $('btn-drawer-close'), textDialog: $('text-dialog'), textInput: $('text-input'),
  textSize: $('text-size'), toast: $('toast'), dropOverlay: $('drop-overlay'),
  fileInput: $('file-input'), mergeInput: $('merge-input'),
};

const COLORS = {
  highlight: ['#ffeb3b', '#8bc34a', '#ff80ab', '#4fc3f7', '#ffb74d'],
  pen: ['#e53935', '#1e88e5', '#000000', '#43a047', '#fdd835', '#ffffff'],
  text: ['#000000', '#e53935', '#1e88e5', '#43a047', '#ffffff'],
};
const MIN_SCALE = 0.2, MAX_SCALE = 6, MAX_FIT_WIDTH = 1100;

const S = {
  sources: [],      // { bytes, doc, name, locked }
  pages: [],        // { id, src, num, proxy, rot, annots, el, pdfCanvas, inkCanvas, vp, ... }
  name: '', fileKey: '',
  scale: 1, fitMode: true,
  tool: 'pan',
  color: { highlight: '#ffeb3b', pen: '#e53935', text: '#000000' },
  penWidth: 3,
  history: [], dirty: false,
  night: localStorage.getItem('night') === '1',
  current: 0, nextId: 1,
};
let draft = null;            // anotação sendo desenhada agora
const visible = new Set();   // páginas perto da área visível

// ---------- utilidades ----------
let toastTimer;
function toast(msg, ms = 2800) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const totalRot = (p) => (((p.proxy.rotate + p.rot) % 360) + 360) % 360;
const viewportFor = (p, scale) => p.proxy.getViewport({ scale, rotation: totalRot(p) });
function pixelRatio(vp) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.min(dpr, Math.sqrt(16e6 / (vp.width * vp.height)));
}
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(a) {
  measureCtx.font = `${a.size}px Helvetica, Arial, sans-serif`;
  return Math.max(...a.text.split('\n').map((l) => measureCtx.measureText(l).width));
}

// ---------- abrir ----------
function loadDoc(bytes, src) {
  const task = pdfjsLib.getDocument({ ...DOC_OPTS, data: bytes.slice() });
  task.onPassword = (update, reason) => {
    const pw = prompt(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? 'Senha incorreta. Tente de novo:' : 'Este PDF tem senha. Digite a senha:');
    if (pw === null) task.destroy();
    else { src.locked = true; update(pw); }
  };
  return task.promise;
}

async function makePages(srcIndex, doc) {
  const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
  return proxies.map((proxy, i) => ({ id: S.nextId++, src: srcIndex, num: i + 1, proxy, rot: 0, annots: [] }));
}

async function openFile(file) {
  if (!file) return;
  if (S.dirty && !confirm('Você tem edições não salvas. Abrir outro arquivo mesmo assim?')) return;
  toast('Abrindo…', 60000);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const src = { bytes, name: file.name, locked: false };
    src.doc = await loadDoc(bytes, src);
    closeDoc();
    S.sources = [src];
    S.name = file.name.replace(/\.pdf$/i, '') || 'documento';
    S.fileKey = `pos:${file.name}:${file.size}`;
    S.pages = await makePages(0, src.doc);
    S.history = [];
    S.dirty = false;
    S.fitMode = true;
    els.title.textContent = S.name;
    document.title = `${S.name} — PDF Leitor`;
    els.empty.hidden = true;
    els.toolbar.hidden = false;
    els.indicator.hidden = false;
    els.zoomGroup.hidden = false;
    els.btnPages.disabled = false;
    els.btnSave.disabled = false;
    buildPageEls();
    S.scale = fitScale();
    layout();
    updateUndo();
    const saved = JSON.parse(localStorage.getItem(S.fileKey) || 'null');
    if (saved && saved.page < S.pages.length) scrollToPage(saved.page, saved.frac || 0);
    else els.viewer.scrollTop = 0;
    updateCurrent();
    els.toast.hidden = true;
  } catch (e) {
    if (e?.name === 'PasswordException' || /destroyed/i.test(e?.message)) { els.toast.hidden = true; return; }
    console.error(e);
    toast('Não consegui abrir esse arquivo. Ele é mesmo um PDF?');
  }
}

function closeDoc() {
  for (const s of S.sources) s.doc?.destroy();
  S.sources = [];
  S.pages = [];
  visible.clear();
  io.disconnect();
  els.pages.innerHTML = '';
  closeDrawer();
}

// ---------- páginas na tela ----------
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const p = S.pages.find((x) => x.el === en.target);
    if (!p) continue;
    if (en.isIntersecting) { visible.add(p); renderPage(p); } else { visible.delete(p); release(p); }
  }
}, { root: els.viewer, rootMargin: '800px 0px' });

function createPageEl(p) {
  p.el = document.createElement('div');
  p.el.className = 'page';
  p.pdfCanvas = document.createElement('canvas');
  p.pdfCanvas.className = 'pdf';
  p.inkCanvas = document.createElement('canvas');
  p.inkCanvas.className = 'ink';
  p.el.append(p.pdfCanvas, p.inkCanvas);
  p.token = 0;
  attachInk(p);
}

function buildPageEls() {
  els.pages.innerHTML = '';
  for (const p of S.pages) {
    if (!p.el) createPageEl(p);
    els.pages.appendChild(p.el);
    io.observe(p.el);
  }
  els.pageCount.textContent = S.pages.length;
  els.pageInput.max = S.pages.length;
}

function fitScale() {
  const avail = Math.min(els.viewer.clientWidth - 24, MAX_FIT_WIDTH);
  let maxW = 1;
  for (const p of S.pages) maxW = Math.max(maxW, viewportFor(p, 1).width);
  return clamp(avail / maxW, MIN_SCALE, MAX_SCALE);
}

function layout() {
  for (const p of S.pages) {
    p.vp = viewportFor(p, S.scale);
    p.el.style.width = `${Math.floor(p.vp.width)}px`;
    p.el.style.height = `${Math.floor(p.vp.height)}px`;
    invalidate(p);
  }
  for (const p of visible) { drawInk(p); renderPage(p); }
  els.btnZoomFit.textContent = `${Math.round((S.scale / fitScale()) * 100)}%`;
}

function invalidate(p) {
  p.token++;
  p.task?.cancel();
  p.task = null;
  p.rendered = false;
}

function release(p) {
  invalidate(p);
  p.pdfCanvas.width = p.pdfCanvas.height = 0;
  p.inkCanvas.width = p.inkCanvas.height = 0;
}

async function renderPage(p) {
  if (p.rendered || p.task) return;
  const token = p.token;
  const vp = p.vp, dpr = pixelRatio(vp);
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf';
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  const task = p.proxy.render({
    canvasContext: canvas.getContext('2d'), viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  });
  p.task = task;
  try {
    await task.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
    return;
  } finally {
    if (p.task === task) p.task = null;
  }
  if (token !== p.token) return;
  p.el.replaceChild(canvas, p.pdfCanvas);
  p.pdfCanvas = canvas;
  p.rendered = true;
  drawInk(p);
}

// ---------- desenho das anotações ----------
function paintAnnot(ctx, a, vp, scale, rot) {
  const toV = (x, y) => vp.convertToViewportPoint(x, y);
  ctx.save();
  if (a.type === 'highlight' || a.type === 'whiteout') {
    const [x1, y1] = toV(a.x, a.y), [x2, y2] = toV(a.x + a.w, a.y + a.h);
    ctx.fillStyle = a.type === 'whiteout' ? '#ffffff' : a.color;
    ctx.globalAlpha = a.type === 'highlight' ? 0.38 : 1;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (a.type === 'pen') {
    ctx.strokeStyle = ctx.fillStyle = a.color;
    ctx.lineWidth = a.width * scale;
    ctx.lineCap = ctx.lineJoin = 'round';
    const pts = a.points.map(([x, y]) => toV(x, y));
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  } else if (a.type === 'text') {
    const [ax, ay] = toV(a.x, a.y);
    ctx.translate(ax, ay);
    ctx.rotate(((rot - a.rot) * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.fillStyle = a.color;
    ctx.font = `${a.size}px Helvetica, Arial, sans-serif`;
    a.text.split('\n').forEach((line, i) => {
      ctx.fillText(line, 0, a.size * TEXT_ASCENT + i * a.size * LINE_HEIGHT);
    });
  }
  ctx.restore();
}

function drawInk(p) {
  const vp = p.vp, dpr = pixelRatio(vp), c = p.inkCanvas;
  const W = Math.floor(vp.width * dpr), H = Math.floor(vp.height * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rot = totalRot(p);
  for (const a of p.annots) paintAnnot(ctx, a, vp, S.scale, rot);
  if (draft && draft.p === p && draft.a) paintAnnot(ctx, draft.a, vp, S.scale, rot);
}

// ---------- ferramentas (mouse, caneta, dedo) ----------
let touchCount = 0;
function pdfPoint(p, e) {
  const r = p.inkCanvas.getBoundingClientRect();
  return p.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
}

function attachInk(p) {
  const c = p.inkCanvas;
  c.addEventListener('pointerdown', (e) => onDown(p, e));
  c.addEventListener('pointermove', (e) => onMove(p, e));
  c.addEventListener('pointerup', (e) => onUp(p, e));
  c.addEventListener('pointercancel', () => { if (draft?.p === p) { draft = null; drawInk(p); } });
}

function onDown(p, e) {
  if (e.button > 0 || touchCount > 1) return;
  const pt = pdfPoint(p, e);
  const tool = S.tool;
  if (tool === 'eraser') {
    const a = hitTest(p, pt);
    if (a) removeAnnot(p, a);
    return;
  }
  e.preventDefault();
  if (tool === 'text') {
    draft = { p, tap: [e.clientX, e.clientY], pt };
    return;
  }
  p.inkCanvas.setPointerCapture(e.pointerId);
  if (tool === 'highlight' || tool === 'whiteout') {
    draft = { p, start: pt, a: { type: tool, x: pt[0], y: pt[1], w: 0, h: 0, color: S.color.highlight } };
  } else if (tool === 'pen') {
    draft = { p, last: [e.clientX, e.clientY], a: { type: 'pen', points: [pt], width: S.penWidth, color: S.color.pen } };
    drawInk(p);
  }
}

function onMove(p, e) {
  if (!draft || draft.p !== p || !draft.a) return;
  const a = draft.a;
  if (a.type === 'pen') {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      if (Math.hypot(ev.clientX - draft.last[0], ev.clientY - draft.last[1]) < 1.5) continue;
      draft.last = [ev.clientX, ev.clientY];
      a.points.push(pdfPoint(p, ev));
    }
  } else {
    const pt = pdfPoint(p, e), s = draft.start;
    a.x = Math.min(s[0], pt[0]); a.y = Math.min(s[1], pt[1]);
    a.w = Math.abs(pt[0] - s[0]); a.h = Math.abs(pt[1] - s[1]);
  }
  drawInk(p);
}

function onUp(p, e) {
  if (!draft || draft.p !== p) return;
  const d = draft;
  draft = null;
  if (S.tool === 'text' && d.tap) {
    if (Math.hypot(e.clientX - d.tap[0], e.clientY - d.tap[1]) < 12) {
      const existing = hitTest(p, d.pt, 'text');
      openTextDialog(p, d.pt, existing);
    }
    return;
  }
  const a = d.a;
  if ((a.type === 'highlight' || a.type === 'whiteout') && (a.w * S.scale < 4 || a.h * S.scale < 4)) {
    drawInk(p);
    return;
  }
  addAnnot(p, a);
}

function hitTest(p, [x, y], onlyType) {
  const tol = 8 / S.scale;
  for (let i = p.annots.length - 1; i >= 0; i--) {
    const a = p.annots[i];
    if (onlyType && a.type !== onlyType) continue;
    if (a.type === 'highlight' || a.type === 'whiteout') {
      if (x >= a.x - tol && x <= a.x + a.w + tol && y >= a.y - tol && y <= a.y + a.h + tol) return a;
    } else if (a.type === 'pen') {
      const lim = a.width / 2 + tol;
      for (let j = 0; j < a.points.length; j++) {
        const [x1, y1] = a.points[j], [x2, y2] = a.points[j + 1] || a.points[j];
        const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
        const t = len2 ? clamp(((x - x1) * dx + (y - y1) * dy) / len2, 0, 1) : 0;
        if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= lim) return a;
      }
    } else if (a.type === 'text') {
      const th = (a.rot * Math.PI) / 180, dx = x - a.x, dy = y - a.y;
      const u = dx * Math.cos(th) + dy * Math.sin(th);
      const v = dx * Math.sin(th) - dy * Math.cos(th);
      const h = a.text.split('\n').length * a.size * LINE_HEIGHT;
      if (u >= -tol && u <= textWidth(a) + tol && v >= -tol && v <= h + tol) return a;
    }
  }
  return null;
}

function openTextDialog(p, pt, existing) {
  const dlg = els.textDialog;
  els.textInput.value = existing ? existing.text : '';
  if (existing) els.textSize.value = String(existing.size);
  dlg.returnValue = '';
  dlg.addEventListener('close', () => {
    const text = els.textInput.value.replace(/\s+$/, '');
    if (dlg.returnValue !== 'ok') return;
    const size = Number(els.textSize.value);
    if (existing) {
      if (!text) { removeAnnot(p, existing); return; }
      const before = { text: existing.text, size: existing.size };
      Object.assign(existing, { text, size });
      pushHistory({ op: 'edit', p, a: existing, before, after: { text, size } });
      drawInk(p);
    } else if (text) {
      addAnnot(p, { type: 'text', x: pt[0], y: pt[1], text, size, rot: totalRot(p), color: S.color.text });
    }
  }, { once: true });
  dlg.showModal();
  els.textInput.focus();
}

// ---------- histórico (desfazer) ----------
function pushHistory(h) {
  S.history.push(h);
  S.dirty = true;
  updateUndo();
}
function updateUndo() { els.btnUndo.disabled = S.history.length === 0; }

function addAnnot(p, a) {
  p.annots.push(a);
  p.thumb = null;
  pushHistory({ op: 'add', p, a });
  drawInk(p);
}
function removeAnnot(p, a) {
  const i = p.annots.indexOf(a);
  if (i < 0) return;
  p.annots.splice(i, 1);
  p.thumb = null;
  pushHistory({ op: 'remove', p, a, i });
  drawInk(p);
}

function undo() {
  const h = S.history.pop();
  if (!h) return;
  updateUndo();
  S.dirty = true;
  switch (h.op) {
    case 'add': h.p.annots.splice(h.p.annots.indexOf(h.a), 1); break;
    case 'remove': h.p.annots.splice(h.i, 0, h.a); break;
    case 'edit': Object.assign(h.a, h.before); break;
    case 'rot': h.p.rot = (h.p.rot - h.d + 360) % 360; h.p.thumb = null; break;
    case 'move': { const [p] = S.pages.splice(h.to, 1); S.pages.splice(h.from, 0, p); break; }
    case 'del': S.pages.splice(h.i, 0, h.p); break;
    case 'merge': S.pages.splice(S.pages.length - h.count, h.count); break;
  }
  if (h.p) h.p.thumb = null;
  if (['rot', 'move', 'del', 'merge'].includes(h.op)) pagesChanged();
  else if (h.p.vp && visible.has(h.p)) drawInk(h.p);
}

// ---------- operações de página ----------
function pagesChanged() {
  for (const p of S.pages) if (!p.el) createPageEl(p);
  const keep = new Set(S.pages);
  for (const p of [...visible]) if (!keep.has(p)) visible.delete(p);
  io.disconnect();
  buildPageEls();
  if (S.fitMode) S.scale = fitScale();
  layout();
  updateCurrent();
  if (!els.drawer.hidden) renderThumbs();
}

function rotatePage(p) {
  p.rot = (p.rot + 90) % 360;
  p.thumb = null;
  pushHistory({ op: 'rot', p, d: 90 });
  pagesChanged();
}
function movePage(from, to) {
  if (to < 0 || to >= S.pages.length) return;
  const [p] = S.pages.splice(from, 1);
  S.pages.splice(to, 0, p);
  pushHistory({ op: 'move', from, to });
  pagesChanged();
}
function deletePage(i) {
  if (S.pages.length === 1) { toast('Não dá para apagar a única página.'); return; }
  const [p] = S.pages.splice(i, 1);
  release(p);
  pushHistory({ op: 'del', p, i });
  pagesChanged();
  toast(`Página ${i + 1} apagada. Use “Desfazer” se foi sem querer.`);
}

async function mergeFiles(files) {
  let added = 0;
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const src = { bytes, name: file.name, locked: false };
      src.doc = await loadDoc(bytes, src);
      S.sources.push(src);
      const pages = await makePages(S.sources.length - 1, src.doc);
      S.pages.push(...pages);
      added += pages.length;
    } catch (e) {
      console.error(e);
      toast(`Não consegui abrir ${file.name}.`);
    }
  }
  if (!added) return;
  pushHistory({ op: 'merge', count: added });
  pagesChanged();
  toast(`${added} página(s) adicionadas no final.`);
}

// ---------- miniaturas ----------
const thumbIO = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const p = S.pages.find((x) => x.id === Number(en.target.dataset.id));
    if (p) paintThumb(p, en.target);
  }
}, { root: els.thumbs, rootMargin: '300px 0px' });

async function paintThumb(p, img) {
  if (!p.thumb) {
    const vp1 = viewportFor(p, 1);
    const scale = 150 / vp1.width;
    const vp = viewportFor(p, scale), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width * dpr);
    c.height = Math.floor(vp.height * dpr);
    const ctx = c.getContext('2d');
    await p.proxy.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const a of p.annots) paintAnnot(ctx, a, vp, scale, totalRot(p));
    p.thumb = c.toDataURL('image/jpeg', 0.7);
  }
  img.src = p.thumb;
}

function renderThumbs() {
  thumbIO.disconnect();
  els.thumbs.innerHTML = '';
  S.pages.forEach((p, i) => {
    const vp = viewportFor(p, 1);
    const box = document.createElement('div');
    box.className = 'thumb' + (i === S.current ? ' current' : '');
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.dataset.id = p.id;
    img.width = 150;
    img.height = Math.round((150 * vp.height) / vp.width);
    img.alt = `Página ${i + 1}`;
    img.onclick = () => { scrollToPage(i); closeDrawer(); };
    const row = document.createElement('div');
    row.className = 'thumb-row';
    const btn = (label, title, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title; b.disabled = !!disabled; b.onclick = fn;
      return b;
    };
    const num = document.createElement('span');
    num.textContent = i + 1;
    row.append(
      btn('▲', 'Mover para cima', () => movePage(i, i - 1), i === 0),
      btn('▼', 'Mover para baixo', () => movePage(i, i + 1), i === S.pages.length - 1),
      num,
      btn('↻', 'Girar', () => rotatePage(p)),
      btn('🗑', 'Apagar página', () => deletePage(i)),
    );
    box.append(img, row);
    els.thumbs.appendChild(box);
    thumbIO.observe(img);
  });
}

function openDrawer() {
  els.drawer.hidden = false;
  els.backdrop.hidden = false;
  renderThumbs();
  els.thumbs.querySelector('.current')?.scrollIntoView({ block: 'center' });
}
function closeDrawer() {
  els.drawer.hidden = true;
  els.backdrop.hidden = true;
}

// ---------- navegação e zoom ----------
function scrollToPage(i, frac = 0) {
  const p = S.pages[i];
  if (!p) return;
  els.viewer.scrollTop = p.el.offsetTop - 12 + frac * p.el.offsetHeight;
}

function pageAtY(y) { // y no conteúdo do visualizador
  let best = 0;
  for (let i = 0; i < S.pages.length; i++) {
    if (S.pages[i].el.offsetTop <= y) best = i; else break;
  }
  return best;
}

let saveTimer;
function updateCurrent() {
  if (!S.pages.length) return;
  const v = els.viewer;
  const i = pageAtY(v.scrollTop + v.clientHeight * 0.35);
  S.current = i;
  if (document.activeElement !== els.pageInput) els.pageInput.value = i + 1;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = S.pages[S.current];
    if (!p || !S.fileKey) return;
    const frac = clamp((v.scrollTop + 12 - p.el.offsetTop) / p.el.offsetHeight, 0, 1);
    localStorage.setItem(S.fileKey, JSON.stringify({ page: S.current, frac }));
  }, 400);
}

function setScale(s, anchor, fit = false) {
  if (!S.pages.length) return;
  s = clamp(s, MIN_SCALE, MAX_SCALE);
  S.fitMode = fit;
  const v = els.viewer;
  const ax = anchor ? anchor.x : v.clientWidth / 2;
  const ay = anchor ? anchor.y : v.clientHeight / 2;
  const i = pageAtY(v.scrollTop + ay);
  const el = S.pages[i].el;
  const fy = (v.scrollTop + ay - el.offsetTop) / el.offsetHeight;
  const fx = (v.scrollLeft + ax) / Math.max(1, els.pages.scrollWidth);
  S.scale = s;
  layout();
  v.scrollTop = el.offsetTop + fy * el.offsetHeight - ay;
  v.scrollLeft = fx * els.pages.scrollWidth - ax;
  updateCurrent();
}
const zoomBy = (f, anchor) => setScale(S.scale * f, anchor);
const zoomFit = () => setScale(fitScale(), null, true);

// Pinça (dois dedos) no celular
let pinch = null;
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
els.viewer.addEventListener('touchstart', (e) => {
  touchCount = e.touches.length;
  if (e.touches.length === 2 && S.pages.length) {
    if (draft) { const p = draft.p; draft = null; drawInk(p); }
    const r = els.viewer.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    pinch = { d0: dist(e.touches), mx, my, cx: els.viewer.scrollLeft + mx, cy: els.viewer.scrollTop + my, r: 1 };
    els.pages.style.transformOrigin = `${pinch.cx}px ${pinch.cy}px`;
  }
}, { passive: true });
els.viewer.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  pinch.r = clamp(dist(e.touches) / pinch.d0, MIN_SCALE / S.scale, MAX_SCALE / S.scale);
  els.pages.style.transform = `scale(${pinch.r})`;
}, { passive: false });
els.viewer.addEventListener('touchend', (e) => {
  touchCount = e.touches.length;
  if (pinch && e.touches.length < 2) {
    const { r, mx, my } = pinch;
    pinch = null;
    els.pages.style.transform = '';
    if (Math.abs(r - 1) > 0.02) zoomBy(r, { x: mx, y: my });
  }
});
els.viewer.addEventListener('touchcancel', (e) => { touchCount = e.touches.length; });

// Ctrl + roda do mouse no computador
let wheelAcc = 1, wheelAnchor = null, wheelRaf = 0;
els.viewer.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !S.pages.length) return;
  e.preventDefault();
  const r = els.viewer.getBoundingClientRect();
  wheelAcc *= Math.exp(-e.deltaY * 0.0025);
  wheelAnchor = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (!wheelRaf) wheelRaf = requestAnimationFrame(() => {
    wheelRaf = 0;
    const f = wheelAcc;
    wheelAcc = 1;
    zoomBy(f, wheelAnchor);
  });
}, { passive: false });

let scrollRaf = 0;
els.viewer.addEventListener('scroll', () => {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCurrent(); });
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (S.pages.length && S.fitMode && Math.abs(fitScale() - S.scale) > 0.001) zoomFit();
  }, 150);
}).observe(els.viewer);

// ---------- salvar ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function deliver(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  const file = new File([blob], name, { type: 'application/pdf' });
  if (isIOS && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function save() {
  if (!S.pages.length || els.btnSave.disabled) return;
  if (S.sources.some((s) => s.locked)) {
    toast('Esse PDF tem senha, então não dá para salvar edições nele.', 4000);
    return;
  }
  els.btnSave.disabled = true;
  els.btnSave.textContent = 'Salvando…';
  try {
    const bytes = await buildPdf(window.PDFLib, S.sources, S.pages.map((p) => ({
      src: p.src, num: p.num, rotation: totalRot(p), annots: p.annots,
    })));
    await deliver(bytes, `${S.name}-editado.pdf`);
    S.dirty = false;
    toast('PDF salvo ✔');
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.error(e);
    if (/encrypt/i.test(e?.message || '')) toast('Esse PDF é protegido contra edição, não dá para salvar.', 4000);
    else toast(`Erro ao salvar: ${e.message}`, 5000);
  } finally {
    els.btnSave.disabled = false;
    els.btnSave.textContent = 'Salvar';
  }
}

// ---------- interface ----------
function setTool(t) {
  S.tool = t;
  for (const b of els.toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  document.body.classList.toggle('drawing', t !== 'pan');
  document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim();
  document.body.classList.add(`tool-${t}`);
  const hasColor = t in COLORS;
  els.btnColor.disabled = !hasColor;
  els.colorDot.style.background = hasColor ? S.color[t] : 'transparent';
  els.colorPop.hidden = true;
}

function openColorPop() {
  const t = S.tool;
  if (!(t in COLORS)) return;
  els.colorList.innerHTML = '';
  for (const c of COLORS[t]) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.classList.toggle('sel', c === S.color[t]);
    b.onclick = () => { S.color[t] = c; setTool(t); };
    els.colorList.appendChild(b);
  }
  els.widthRow.hidden = t !== 'pen';
  for (const b of els.widthRow.querySelectorAll('button')) b.classList.toggle('sel', Number(b.dataset.width) === S.penWidth);
  els.colorPop.hidden = !els.colorPop.hidden;
}

function setNight(on) {
  S.night = on;
  document.body.classList.toggle('night', on);
  els.btnNight.textContent = on ? '☀️' : '🌙';
  els.btnNight.title = on ? 'Modo claro' : 'Modo noturno';
  localStorage.setItem('night', on ? '1' : '0');
}

const pickFile = () => { els.fileInput.value = ''; els.fileInput.click(); };
els.btnOpen.onclick = pickFile;
els.btnOpenBig.onclick = pickFile;
els.fileInput.onchange = () => openFile(els.fileInput.files[0]);
els.btnMerge.onclick = () => { els.mergeInput.value = ''; els.mergeInput.click(); };
els.mergeInput.onchange = () => mergeFiles([...els.mergeInput.files]);
els.btnSave.onclick = save;
els.btnNight.onclick = () => setNight(!S.night);
els.btnZoomIn.onclick = () => zoomBy(1.25);
els.btnZoomOut.onclick = () => zoomBy(0.8);
els.btnZoomFit.onclick = zoomFit;
els.btnPages.onclick = openDrawer;
els.btnDrawerClose.onclick = closeDrawer;
els.backdrop.onclick = closeDrawer;
els.btnUndo.onclick = undo;
els.btnColor.onclick = (e) => { e.stopPropagation(); openColorPop(); };
for (const b of els.toolbar.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
for (const b of els.widthRow.querySelectorAll('button')) {
  b.onclick = () => { S.penWidth = Number(b.dataset.width); els.colorPop.hidden = true; };
}
document.addEventListener('pointerdown', (e) => {
  if (!els.colorPop.hidden && !els.colorPop.contains(e.target) && !els.btnColor.contains(e.target)) els.colorPop.hidden = true;
});
els.pageInput.addEventListener('change', () => {
  const n = clamp(Math.round(Number(els.pageInput.value)) || 1, 1, S.pages.length);
  scrollToPage(n - 1);
  els.pageInput.blur();
});
els.pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.pageInput.blur(); });

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFile(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  else if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.25); }
  else if (mod && e.key === '-') { e.preventDefault(); zoomBy(0.8); }
  else if (mod && e.key === '0') { e.preventDefault(); zoomFit(); }
  else if (e.key === 'Escape' && !typing) { closeDrawer(); setTool('pan'); }
});

// Arrastar e soltar
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; els.dropOverlay.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!files.length) { toast('Solte um arquivo PDF.'); return; }
  if (S.pages.length && !els.drawer.hidden) mergeFiles(files);
  else openFile(files[0]);
});

window.addEventListener('beforeunload', (e) => {
  if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// Abrir PDF vindo de "Compartilhar" (Android) ou "Abrir com" (computador)
async function openShared() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  if (!('caches' in window)) return;
  const cache = await caches.open('shared-files');
  const key = new URL('shared-file', location.href).href;
  const res = await cache.match(key);
  if (!res) return;
  const name = decodeURIComponent(res.headers.get('x-file-name') || 'documento.pdf');
  const blob = await res.blob();
  await cache.delete(key);
  openFile(new File([blob], name, { type: 'application/pdf' }));
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files?.length) openFile(await params.files[0].getFile());
  });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
}

setNight(S.night);
setTool('pan');
openShared();

// Exposto para testes automatizados.
window.__pdfLeitor = { S, openFile, setTool, save, undo, zoomBy, zoomFit, rotatePage, deletePage, movePage, mergeFiles };
