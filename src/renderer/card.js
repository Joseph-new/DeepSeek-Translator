'use strict';

/* 悬浮译文卡片 · 交互逻辑 */

const api = window.cardBridge;
const $ = (id) => document.getElementById(id);

let outBuffer = '';
let copyText = '';
let pinned = false;

/** 量文本节点的真实渲染高度。
 *  .out 是 flex:1，scrollHeight 会等于窗口高度本身，直接量会自我膨胀，
 *  所以用 Range 的 client rects 取内容真实包围盒。 */
function contentHeight(el) {
  if (!el.textContent) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  if (!rects.length) return 0;
  let top = Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    if (rect.width === 0 && rect.height === 0) continue;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (bottom <= top) return 0;
  return bottom - top;
}

function resize() {
  const header = document.querySelector('header').offsetHeight;
  const footer = document.querySelector('footer').offsetHeight;
  const srcEl = document.querySelector('.src');
  const srcH = srcEl.textContent ? srcEl.offsetHeight : 0;
  const outH = contentHeight(document.querySelector('.out'));
  const h = header + footer + srcH + outH + 32;
  api.resize(Math.max(150, Math.min(600, Math.round(h))));
}

function renderDone(p) {
  outBuffer = p.text !== undefined ? p.text : outBuffer;
  copyText = outBuffer;
  const out = $('out');
  out.classList.remove('error');
  out.classList.remove('streaming');
  out.textContent = outBuffer;
  const u = p.usage || {};
  const parts = [];
  if (p.target) parts.push('→ ' + p.target);
  if (p.model) parts.push(p.model);
  if (u.prompt || u.completion) parts.push(`输入 ${u.prompt || 0} / 输出 ${u.completion || 0} token`);
  if (p.ms) parts.push(`${(p.ms / 1000).toFixed(1)}s`);
  $('meta').textContent = parts.length ? parts.join(' · ') : '完成';
  resize();
}

function showError(msg) {
  const out = $('out');
  out.classList.remove('streaming');
  out.classList.add('error');
  out.textContent = msg || '翻译失败';
  $('meta').textContent = '出错';
  resize();
}

api.on('card:update', (p) => {
  if (p.status === 'error') return showError(p.error);
  $('tag').textContent = p.origin || '译文';
  $('src').textContent = p.source || '';
  const out = $('out');
  out.classList.remove('error');
  if (p.status === 'done') {
    return renderDone(p);
  }
  outBuffer = p.text || '';
  copyText = outBuffer;
  out.classList.add('streaming');
  out.textContent = outBuffer;
  $('meta').textContent = '翻译中…';
  resize();
});

api.on('card:delta', (p) => {
  outBuffer += p.delta;
  copyText = outBuffer;
  const out = $('out');
  out.textContent = outBuffer;
  out.scrollTop = out.scrollHeight;
  resize();
});

api.on('card:done', (p) => renderDone(p));

api.on('card:error', (p) => showError(p.error));

$('btnClose').addEventListener('click', () => api.hide());

$('btnCopy').addEventListener('click', async () => {
  if (!copyText) return;
  await api.copy(copyText);
  $('meta').textContent = '已复制到剪贴板';
});

$('btnPin').addEventListener('click', async () => {
  pinned = !pinned;
  await api.pin(pinned);
  $('btnPin').classList.toggle('active', pinned);
});

$('btnOpen').addEventListener('click', () => {
  api.openMain();
  api.hide();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.hide();
});

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.out') || e.target.closest('.src')) e.stopPropagation();
});

resize();
