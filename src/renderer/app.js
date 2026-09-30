'use strict';

/* =====================================================================
   DeepSeek 翻译器 · 渲染层
   ===================================================================== */

const api = window.bridge;
const $ = (id) => document.getElementById(id);

let cfg = {};
let currentTranslateId = null;
let translating = false;
let outputBuffer = '';
let hotkeyRecording = false;

let langList = [];              // 语种表（来自主进程）
let targetInfo = { mode: 'auto', target: 'English', fixedLang: 'English' };
let langPopAnchor = null;
let langFilter = '';
let langActive = 0;
let langChoices = [];           // 当前可点击项（供键盘上下选择）
let targetBadgeTimer = null;
let outPlaceholderHTML = '';   // 译文框的空态占位，清空后还原

/* ---------------- 工具 ---------------- */

function toast(text, type = 'info') {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'info' ? '' : ' ' + type);
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function fmtTime(ts) {
  if (!ts) return '尚未查询';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('zh-CN');
}

/** 按字符成分粗判源语言，仅用于界面提示，不影响翻译本身 */
/* 按字符所属文字体系粗判源语言。
 * 只用于界面提示，真正的源语言判定由模型完成；拉丁字母系语言之间
 * 靠字符无法区分，一律归为“英文”，因此标签统一带“自动 ·”前缀，
 * 避免读起来像一个确定的结论。 */
function detectLang(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(s)) return '日语';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(s)) return '韩语';
  if (/[\u0e00-\u0e7f]/.test(s)) return '泰语';
  if (/[\u0600-\u06ff\u0750-\u077f]/.test(s)) return '阿拉伯语';
  if (/[\u0590-\u05ff]/.test(s)) return '希伯来语';
  if (/[\u0370-\u03ff]/.test(s)) return '希腊语';
  if (/[\u0900-\u097f]/.test(s)) return '印地语';
  if (/[\u0400-\u04ff]/.test(s)) return '俄语';
  if (/[\u4e00-\u9fff]/.test(s)) return '中文';
  if (/[a-zA-Z]/.test(s)) return '英文';
  return '';
}

/** 左栏源语言徽标：空态显示“自动检测”，有内容时显示“自动 · 语种” */
function updateSrcLangBadge(text) {
  const value = text === undefined ? $('srcText').value : text;
  const lang = detectLang(value);
  $('srcLangBadge').textContent = lang ? `自动 · ${lang}` : '自动检测';
}

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$' };

/* ---------------- 页面切换 ---------------- */

function gotoPage(name) {
  closeLangPicker(); // 切页时收起语种浮层，否则会浮在新页面上
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.page === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (name === 'account') renderTxTable();
  if (name === 'settings') {
    renderStats();
    refreshHotkeyStats();
  }
}

/* ---------------- 配置渲染 ---------------- */

function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
}

function renderConfig(next) {
  cfg = next || cfg;
  document.body.classList.toggle('material-acrylic', cfg.material !== 'custom');
  document.body.classList.toggle('material-custom', cfg.material === 'custom');
  applyTheme(cfg.theme);

  $('modelChip').textContent = cfg.resolvedModel || '—';
  refreshTargetBadge();
  $('configPath').textContent = cfg.configPath || '—';
  $('aboutVersion').textContent = 'v' + (cfg.version || '1.0.0');

  renderHotkeySettings();

  // 接口
  $('inpApiKey').value = cfg.apiKey || '';
  $('inpBaseUrl').value = cfg.baseUrl || '';
  $('inpModel').value = cfg.resolvedModel || '';
  $('inpTemp').value = cfg.temperature ?? 1.3;
  $('tempVal').textContent = Number(cfg.temperature ?? 1.3).toFixed(1);
  paintRange($('inpTemp'));
  $('inpThinking').value = cfg.thinking || 'off';
  renderThinkingHints();
  $('inpMaxTokens').value = cfg.maxTokens || 8192;
  renderMaxTokensHint();
  $('inpPromptStyle').value = cfg.systemPromptStyle || 'strict';
  $('chkStreaming').checked = cfg.streaming !== false;
  $('promptView').textContent = cfg.systemPrompt || '';
  $('inpExtra').value = cfg.extraInstruction || '';

  // 快捷键与窗口
  $('chkMinimizeToTray').checked = cfg.minimizeToTray !== false;
  $('chkLaunchAtLogin').checked = Boolean(cfg.launchAtLogin);
  $('inpMaterial').value = cfg.material === 'custom' ? 'custom' : 'acrylic';
  $('inpTheme').value = cfg.theme || 'light';
  $('materialHint').textContent = cfg.supportsAcrylic
    ? (cfg.material === 'custom'
      ? '当前为自绘玻璃：有圆角和投影，但不会虚化桌面背景。'
      : '当前使用 Windows 11 系统亚克力材质，窗口背后是真实的桌面模糊。切换材质需要重建窗口。')
    : '系统版本低于 Windows 11，无法使用亚克力材质，已自动使用自绘玻璃。';

  // 剪贴板
  $('chkClipWatch').checked = Boolean(cfg.clipboardWatch);
  $('inpClipMin').value = cfg.clipboardMinLen || 4;
  $('inpClipInterval').value = cfg.clipboardInterval || 900;
  $('chkAutoCopy').checked = cfg.autoCopy !== false;

  // 账户
  $('chkCents').checked = Boolean(cfg.txAmountInCents);
  renderBalance(cfg.balance);
  renderStats();
  renderTxTable();
}

/* 1 token 约 1.5 个汉字（实测 12 汉字 = 8 token），与主进程的估算保持一致 */
const CHARS_PER_TOKEN = 1.5;

function renderMaxTokensHint() {
  const n = Number($('inpMaxTokens').value) || 8192;
  const chars = Math.round(n * CHARS_PER_TOKEN);
  $('maxTokensHint').textContent =
    `当前上限约可输出 ${chars.toLocaleString('zh-CN')} 个汉字（纯中文；夹英文或代码会更少）。` +
    '超出会从中途截断，程序会给出提示。';
}

/**
 * 思考模式与温度的联动。
 * 关键事实：思考模式开启时 temperature 完全不生效（官方明确说明），
 * 所以这时候把滑块禁用掉，避免用户以为调了有用。
 */
function renderThinkingHints() {
  const mode = $('inpThinking').value;
  const off = mode === 'off';
  const slider = $('inpTemp');

  slider.disabled = !off;
  slider.style.opacity = off ? '' : '.45';
  $('tempHint').innerHTML = off
    ? 'DeepSeek 官方给出的建议值是：代码与数学 0.0、数据抽取 1.0、<b>翻译 1.3</b>、创意写作 1.5。调低会更贴近原文，调高会更通顺。'
    : '<b>当前思考模式已开启，temperature 不生效</b>（官方说明：思考模式下该参数会被忽略）。想用温度调节请先把思考模式关掉。';

  $('thinkingHint').innerHTML = off
    ? '官方把“翻译”明确列在<b>建议关闭思考</b>的场景里。关闭后：思维链 token 不再计费（实测同样一句话 completion 从 86 降到 8）、速度更快、<b>可翻译长度提升约十倍</b>。'
    : '思考模式会把推理过程按<b>输出 token</b> 计费，并且占用“最大输出 token”的额度，直接缩短可翻译长度。翻译场景一般用不上。';
}

/** 温度滑块左侧已填充部分着色 */
function paintRange(el) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const pct = ((Number(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}

function displayHotkey(accel) {
  if (!accel) return '未设置';
  return String(accel)
    .replace(/Control/g, 'Ctrl')
    .replace(/`/g, '·')
    .replace(/\+/g, ' + ');
}

/* ---------------- 余额 ---------------- */

function renderBalance(balance) {
  if (!balance) {
    $('balanceTotal').textContent = '--';
    $('balanceTopup').textContent = '--';
    $('balanceGranted').textContent = '--';
    $('balanceUpdated').textContent = '尚未查询';
    $('balanceStateTag').textContent = '未获取';
    $('balanceStateTag').className = 'pill-tag';
    $('balanceChipText').textContent = '余额未获取';
    $('balanceDot').className = 'dot';
    return;
  }
  const sym = CURRENCY_SYMBOL[balance.currency] || '';
  $('curSymbol').textContent = sym;
  $('balanceTotal').textContent = balance.total;
  $('balanceTopup').textContent = sym + balance.toppedUp;
  $('balanceGranted').textContent = sym + balance.granted;
  $('balanceUpdated').textContent = '更新于 ' + fmtTime(balance.fetchedAt);
  $('balanceStateTag').textContent = balance.isAvailable ? '账户正常' : '余额不足';
  $('balanceStateTag').className = 'pill-tag ' + (balance.isAvailable ? 'ok' : 'bad');
  $('balanceChipText').textContent = '余额 ' + sym + balance.total;
  $('balanceDot').className = 'dot ' + (balance.isAvailable ? 'ok' : 'bad');
}

/* ---------------- 翻译 ---------------- */

function setBusy(busy) {
  translating = busy;
  $('btnTranslate').disabled = busy;
  $('btnStop').hidden = !busy;
}

function startTranslate(text) {
  const source = String(text ?? $('srcText').value ?? '');
  if (!source.trim()) {
    toast('没有可翻译的内容', 'error');
    return;
  }
  if (translating) {
    toast('正在翻译中，请稍候', 'error');
    return;
  }
  clearOutput();
  const out = $('outText');
  out.classList.add('streaming');
  updateSrcLangBadge(source);
  setBusy(true);

  api.translate({ text: source, origin: '主窗口' }).then((id) => {
    currentTranslateId = id;
  });
}

function finishTranslate(payload) {
  setBusy(false);
  currentTranslateId = null;
  const out = $('outText');
  out.classList.remove('streaming');
  if (payload.text !== undefined) {
    outputBuffer = payload.text;
    out.textContent = payload.text;
  }
  if (payload.usage) {
    const cached = payload.usage.cached ? ` · 缓存命中 ${fmtNum(payload.usage.cached)}` : '';
    $('usageInfo').textContent =
      `输入 ${fmtNum(payload.usage.prompt)} · 输出 ${fmtNum(payload.usage.completion)} · 合计 ${fmtNum(payload.usage.total)} token${cached}`;
  }
  if (payload.ms) $('elapsed').textContent = (payload.ms / 1000).toFixed(1) + ' s';
  if (payload.model) $('modelChip').textContent = payload.model;
  showTruncationWarning(payload.finishReason);
  updateOutCount();
}

function failTranslate(payload) {
  setBusy(false);
  currentTranslateId = null;
  const out = $('outText');
  out.classList.remove('streaming');
  if (payload.error === '已取消') {
    $('elapsed').textContent = '已取消';
    return;
  }
  out.classList.add('error');
  out.textContent = payload.error || '翻译失败';
  toast(payload.error || '翻译失败', 'error');
}

/* ---------------- 充值记录 ---------------- */

function cell(v) {
  const td = document.createElement('td');
  td.textContent = v === undefined || v === null || v === '' ? '—' : String(v);
  return td;
}

function convertAmount(raw) {
  if (!cfg.txAmountInCents) return raw;
  const num = Number(raw);
  if (isNaN(num)) return raw;
  return (num / 100).toFixed(2);
}

function renderTxTable() {
  const body = $('txBody');
  const list = (cfg.platformSession && cfg.platformSession.transactions) || cfg.transactions || [];
  body.innerHTML = '';
  if (!list.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = '还没有同步过充值记录，点右上角“登录并同步”';
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    list.forEach((r) => {
      const tr = document.createElement('tr');
      tr.appendChild(cell(r.time));
      tr.appendChild(cell(r.type || '充值'));
      const amount = cell(convertAmount(r.amount));
      amount.className = 'col-amount';
      tr.appendChild(amount);
      tr.appendChild(cell(r.status));
      tr.appendChild(cell(r.method));
      const idc = cell(r.id);
      idc.className = 'col-id';
      tr.appendChild(idc);
      body.appendChild(tr);
    });
  }

  const s = cfg.platformSession || {};
  const status = $('txStatus');
  if (s.lastSyncAt) {
    status.className = 'tx-status show ok';
    status.textContent = `已同步 ${list.length} 条记录 · 最近同步 ${fmtTime(s.lastSyncAt)}` +
      (s.txUrl ? ` · 数据接口 ${s.txUrl.replace(/^https?:\/\//, '')}` : '');
  } else if (s.hasToken) {
    status.className = 'tx-status show';
    status.textContent = '已获取网页会话凭证，但还没有抓到记录。点“登录并同步”并在打开的窗口里进入“充值记录”页面。';
  } else {
    status.className = 'tx-status';
    status.textContent = '';
  }
  renderDiag();
}

async function syncTransactions() {
  const status = $('txStatus');
  status.className = 'tx-status show busy';
  status.textContent = '正在打开登录窗口……登录完成后程序会自动抓取数据。';
  try {
    await api.platformOpen('https://platform.deepseek.com/transactions');
    toast('登录窗口已打开，登录后会窗口留在此页面，点主界面“抓取当前页面数据”即可', 'info');
  } catch (err) {
    status.className = 'tx-status show err';
    status.textContent = '打开登录窗口失败：' + err.message;
  }
}

async function quickRefresh() {
  const status = $('txStatus');
  status.className = 'tx-status show busy';
  status.textContent = '正在刷新……';
  try {
    const res = await api.platformRefresh();
    status.className = 'tx-status show ok';
    status.textContent = `刷新成功，共 ${res.records.length} 条记录`;
    const st = await api.platformState();
    cfg.platformSession = st;
    renderTxTable();
    toast('充值记录已刷新', 'ok');
  } catch (err) {
    status.className = 'tx-status show err';
    status.textContent = err.message;
    toast(err.message, 'error');
  }
}

/* ---------------- 用量统计 ---------------- */

function renderStats() {
  const u = cfg.usageTotal || { prompt: 0, completion: 0, calls: 0 };
  $('statCalls').textContent = fmtNum(u.calls);
  $('statPrompt').textContent = fmtNum(u.prompt);
  $('statCompletion').textContent = fmtNum(u.completion);
}

/* ---------------- 快捷键录制 ---------------- */

const KEY_ALIAS = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Escape: 'Esc', Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Delete'
};

function accelFromEvent(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  let key = e.key;
  if (!key || key === 'Dead' || key === 'Process' || key === 'Unidentified') return null;
  if (mods.length === 0) return { error: '必须包含至少一个修饰键（Ctrl / Alt / Shift）' };

  if (KEY_ALIAS[key]) key = KEY_ALIAS[key];
  else if (key.length === 1) key = /[a-z]/.test(key) ? key.toUpperCase() : key;
  else return null;

  return { accelerator: mods.join('+') + '+' + key };
}

/* ---------------- 快捷键 ---------------- */

const HOTKEY_SLOTS = {
  window: {
    input: 'inpHotkey',
    chips: 'hotkeySuggestions',
    defaultAccel: 'Alt+`',
    set: (accel) => api.setHotkey(accel),
    suggestions: () => api.hotkeySuggestions(),
    label: '显示 / 隐藏'
  },
  selection: {
    input: 'inpSelectionHotkey',
    chips: 'selectionHotkeySuggestions',
    defaultAccel: 'Alt+Q',
    set: (accel) => api.setSelectionHotkey(accel),
    suggestions: () => api.selectionHotkeySuggestions(),
    label: '划词翻译'
  }
};

function renderHotkeySettings() {
  const winAccel = cfg.hotkeyActive || cfg.hotkey || 'Alt+`';
  const selAccel = cfg.selectionHotkeyActive || cfg.selectionHotkey || 'Alt+Q';
  if (hotkeyRecording !== 'window') $('inpHotkey').value = displayHotkey(winAccel);
  if (hotkeyRecording !== 'selection') $('inpSelectionHotkey').value = displayHotkey(selAccel);
  $('hotkeyBadge').textContent = displayHotkey(winAccel);
  $('chkSelectFirst').checked = cfg.hotkeySelectFirst === true;
}

function startHotkeyRecord(kind) {
  const slot = HOTKEY_SLOTS[kind];
  if (!slot) return;
  // 上一个还在录就先清掉，避免两个监听同时挂着
  if (hotkeyRecording) stopHotkeyRecord();
  hotkeyRecording = kind;

  const input = $(slot.input);
  input.value = '请按下组合键…';
  input.focus();

  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopHotkeyRecord();
      renderHotkeySettings();
      return;
    }
    const parsed = accelFromEvent(e);
    if (!parsed) return;
    if (parsed.error) {
      toast(parsed.error, 'error');
      return;
    }

    const accel = parsed.accelerator;
    stopHotkeyRecord();
    const result = await slot.set(accel);
    applyHotkeyResult(kind, result);
  };

  const stop = () => stopHotkeyRecord();
  hotkeyRecordingHandler = onKey;
  window.addEventListener('keydown', onKey, true);
  void stop;
}

let hotkeyRecordingHandler = null;

function stopHotkeyRecord() {
  if (hotkeyRecordingHandler) {
    window.removeEventListener('keydown', hotkeyRecordingHandler, true);
    hotkeyRecordingHandler = null;
  }
  hotkeyRecording = null;
}

function applyHotkeyResult(kind, result) {
  const slot = HOTKEY_SLOTS[kind];
  const panel = kind === 'window' ? result : (result && result.selection);

  if (panel && panel.ok) {
    if (kind === 'window') {
      cfg.hotkey = panel.accelerator;
      cfg.hotkeyActive = panel.accelerator;
    } else {
      cfg.selectionHotkey = panel.accelerator;
      cfg.selectionHotkeyActive = panel.accelerator;
    }
    toast(`${slot.label} 已设置为 ${displayHotkey(panel.accelerator)}`, 'ok');
    renderHotkeySettings();
    clearSuggestions(slot.chips);
  } else if (panel) {
    toast(panel.error || '快捷键注册失败', 'error');
    renderHotkeySettings();
    renderSuggestions(slot.chips, panel.suggestions || [], kind);
  } else {
    toast('快捷键注册失败', 'error');
  }
  refreshHotkeyStats();
}

function clearSuggestions(hostId) {
  $(hostId).innerHTML = '';
}

function renderSuggestions(hostId, list, kind) {
  const host = $(hostId);
  host.innerHTML = '';
  if (!list || !list.length) return;
  const label = document.createElement('span');
  label.className = 'muted small';
  label.textContent = '可换这些组合：';
  host.appendChild(label);
  list.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = displayHotkey(k);
    b.addEventListener('click', async () => {
      const result = await HOTKEY_SLOTS[kind].set(k);
      applyHotkeyResult(kind, result);
    });
    host.appendChild(b);
  });
}

function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function agoText(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 3) return '刚刚';
  if (sec < 60) return sec + ' 秒前';
  if (sec < 3600) return Math.round(sec / 60) + ' 分钟前';
  return Math.round(sec / 3600) + ' 小时前';
}

/** 快捷键状态：用来判断“按了没反应”到底卡在哪一环 */
async function refreshHotkeyStats() {
  let st;
  try {
    st = await api.hotkeyStats();
  } catch (_) {
    return;
  }
  const rows = [];

  rows.push(st.registered
    ? `<span class="diag-ok">显示 / 隐藏键已生效</span>　${esc(displayHotkey(st.accelerator))}`
    : `<span class="diag-bad">显示 / 隐藏键未注册</span>　${esc(displayHotkey(st.accelerator || cfg.hotkey))} 可能被其它软件占用`);

  if (cfg.selectionHotkey) {
    rows.push(st.selectionRegistered
      ? `<span class="diag-ok">划词键已生效</span>　${esc(displayHotkey(st.selectionAccelerator))}`
      : `<span class="diag-warn">划词键未生效</span>　${esc(displayHotkey(cfg.selectionHotkey))}`);
  }

  rows.push(`已触发：显示/隐藏 <b>${st.hits}</b> 次 · 划词 <b>${st.selectionHits}</b> 次`);
  if (st.lastAt) {
    rows.push(`最近一次 ${esc(agoText(st.lastAt))}${st.actionLabel ? '（' + esc(st.actionLabel) + '）' : ''}`);
  }
  rows.push('<span class="muted">按下快捷键后如果这里的次数不变，说明按键没被程序接收到——通常是输入法或别的软件抢先占用了这个组合，换一个即可。次数变了但窗口没反应，那就是我这边的逻辑问题，告诉我一声。</span>');

  $('hotkeyDiag').innerHTML = rows.join('<br>');
}

/* ---------------- 目标语种 ---------------- */

/** 刷新右栏徽标：自动模式下显示本次会译成什么 */
async function refreshTargetBadge() {
  try {
    targetInfo = await api.langDescribe($('srcText').value || '');
  } catch (_) {
    targetInfo = { mode: 'auto', target: 'English', fixedLang: cfg.targetLang || 'English' };
  }
  const hasText = $('srcText').value.trim().length > 0;
  let label;
  if (targetInfo.mode === 'fixed') {
    label = targetInfo.fixedLang;
  } else if (!hasText) {
    label = '自动识别';
  } else {
    label = `自动 · 译为 ${targetInfo.target}`;
  }
  $('targetBadge').textContent = label;
  renderTargetSettings();

  // 卡片窗口与托盘提示也一起更新
  if (cfg) cfg.resolvedTarget = targetInfo.target;
}

function renderTargetSettings() {
  const mode = targetInfo.mode || 'auto';
  document.querySelectorAll('#targetModeSeg .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const fixed = targetInfo.fixedLang || cfg.targetLang || 'English';
  $('inpFixedLang').value = fixed;
  const disabled = mode !== 'fixed';
  $('inpFixedLang').disabled = disabled;
  $('btnPickFixedLang').disabled = disabled;
  $('fixedLangHint').textContent = disabled
    ? '自动识别：原文是中文就译成英语，其他语言译成简体中文。切到“指定语种”可以固定每次的译文语种。'
    : `每次翻译都译成 ${fixed}。`;
}

/* ---------------- 语种选择浮层 ---------------- */

function buildLangChoices() {
  const q = langFilter.trim().toLowerCase();
  const auto = {
    kind: 'auto',
    value: 'auto',
    label: '自动识别',
    sub: '中文→English · 其他→简体中文',
    search: '自动 auto 智能 识别 detect'
  };
  const all = langList.map((l) => ({
    kind: 'lang',
    value: l.value,
    label: l.zh,
    sub: l.native === l.zh ? l.en : l.native,
    search: [l.zh, l.native, l.en, l.value, l.search].join(' ').toLowerCase()
  }));

  if (q) {
    const pool = [auto, ...all].filter((x) => x.search.toLowerCase().includes(q) || x.label.toLowerCase().includes(q));
    return [{ group: `搜索结果 ${pool.length} 项` }, ...pool];
  }

  const commonValues = ['English', '简体中文', '繁體中文', '日本語', '한국어'];
  const recent = (cfg.recentLangs || []).filter((v) => all.some((x) => x.value === v));
  const common = all.filter((x) => commonValues.includes(x.value));
  const rest = all.filter((x) => !commonValues.includes(x.value));

  const rows = [{ group: '模式' }, auto];
  if (recent.length) rows.push({ group: '最近使用' }, ...recent.map((v) => all.find((x) => x.value === v)));
  rows.push({ group: '常用' }, ...common, { group: '全部语种' }, ...rest);
  return rows;
}

function renderLangList() {
  const rows = buildLangChoices();
  const host = $('langList');
  host.innerHTML = '';
  langChoices = [];

  const current = targetInfo.mode === 'fixed' ? targetInfo.fixedLang : 'auto';

  rows.forEach((row) => {
    if (row.group) {
      const g = document.createElement('div');
      g.className = 'lang-group';
      g.textContent = row.group;
      host.appendChild(g);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'lang-item';
    btn.dataset.value = row.value;
    if (row.value === current) btn.classList.add('selected');

    const tick = document.createElement('span');
    tick.className = 'li-tick';
    tick.innerHTML = row.value === current ? '&#10003;' : '';
    btn.appendChild(tick);

    const main = document.createElement('span');
    main.className = 'li-main';
    main.textContent = row.label;
    btn.appendChild(main);

    if (row.sub) {
      const sub = document.createElement('span');
      sub.className = 'li-sub';
      sub.textContent = row.sub;
      btn.appendChild(sub);
    }

    btn.addEventListener('click', () => pickLang(row.value));
    host.appendChild(btn);
    langChoices.push(btn);
  });

  if (!langChoices.length) {
    const empty = document.createElement('div');
    empty.className = 'lang-empty';
    empty.textContent = '没有匹配的语种，换个关键词试试';
    host.appendChild(empty);
  }

  langActive = Math.max(0, Math.min(langActive, langChoices.length - 1));
  highlightLangActive();
}

function highlightLangActive() {
  langChoices.forEach((el, i) => el.classList.toggle('active', i === langActive));
  const el = langChoices[langActive];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

function onLangKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    langActive = Math.min(langActive + 1, langChoices.length - 1);
    highlightLangActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    langActive = Math.max(langActive - 1, 0);
    highlightLangActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const el = langChoices[langActive];
    if (el) pickLang(el.dataset.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeLangPicker();
  }
}

function openLangPicker(anchor) {
  langPopAnchor = anchor;
  langFilter = '';
  langActive = 0;
  $('langSearch').value = '';
  const pop = $('langPop');
  pop.hidden = false;
  renderLangList();

  // 贴着锚点定位，超出视口就翻转
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth || 296;
  const ph = pop.offsetHeight || 380;
  const margin = 8;
  let x = Math.round(r.left);
  let y = Math.round(r.bottom + 6);
  if (x + pw > window.innerWidth - margin) x = window.innerWidth - pw - margin;
  if (x < margin) x = margin;
  if (y + ph > window.innerHeight - margin) y = Math.max(margin, Math.round(r.top - ph - 6));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';

  setTimeout(() => $('langSearch').focus(), 30);
  document.addEventListener('mousedown', onDocMouseDown, true);
  window.addEventListener('resize', closeLangPicker);
}

function closeLangPicker() {
  const pop = $('langPop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  langPopAnchor = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  window.removeEventListener('resize', closeLangPicker);
}

function onDocMouseDown(e) {
  const pop = $('langPop');
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  if (langPopAnchor && langPopAnchor.contains(e.target)) return;
  closeLangPicker();
}

async function pickLang(value) {
  closeLangPicker();
  if (value === 'auto') {
    cfg = await api.setConfig({ targetMode: 'auto' });
  } else {
    const recent = [value, ...(cfg.recentLangs || []).filter((v) => v !== value)].slice(0, 5);
    cfg = await api.setConfig({ targetMode: 'fixed', targetLang: value, recentLangs: recent });
  }
  $('promptView').textContent = cfg.systemPrompt;
  await refreshTargetBadge();
  toast(value === 'auto' ? '已切换为自动识别' : `已切换：每次都译成 ${value}`, 'ok');
}

/* ---------------- 同步诊断 ---------------- */

const DIAG_STAGE = {
  idle: '待机',
  loading: '正在加载充值记录页',
  waiting: '等待页面发出请求',
  replaying: '正在重放接口取数',
  done: '本轮结束'
};

function renderDiag() {
  const session = cfg.platformSession || {};
  const d = session.diag;
  const wrap = $('txDiag');
  if (!d || (!d.seen && !d.responses && !d.error && d.stage === 'idle')) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $('txDiagSummary').textContent =
    `已发现 ${d.seen || 0} 个数据接口 · 收到 ${d.responses || 0} 个响应 · 解析成功 ${d.parsed || 0} 个` +
    (d.probed ? ` · 重放 ${d.probed} 个` : '') +
    ` · 阶段：${DIAG_STAGE[d.stage] || d.stage}`;

  const lines = [];
  if (d.error) lines.push('【问题】' + d.error);
  if (d.probeLog && d.probeLog.length) lines.push('', '【重放结果】', ...d.probeLog);
  if (d.endpoints && d.endpoints.length) lines.push('', '【页面用到的接口】', ...d.endpoints);
  $('txDiagBody').textContent = lines.length ? lines.join('\n') : '暂无诊断细节';
}

function diagText() {
  const session = cfg.platformSession || {};
  const d = session.diag || {};
  return [
    'DeepSeek 翻译器 · 充值记录同步诊断',
    '时间：' + new Date().toLocaleString('zh-CN'),
    '会话凭证：' + (session.hasToken ? '已获取' : '未获取'),
    '已发现接口数：' + (d.seen || 0),
    '收到响应：' + (d.responses || 0) + '，解析成功：' + (d.parsed || 0),
    '重放接口数：' + (d.probed || 0),
    '阶段：' + (d.stage || '-'),
    '问题：' + (d.error || '无'),
    '',
    '【重放结果】',
    ...(d.probeLog || []),
    '',
    '【页面用到的接口】',
    ...(d.endpoints || [])
  ].join('\n');
}

/* ---------------- 事件绑定 ---------------- */

function bindUI() {
  // 窗口控制
  $('btnClose').addEventListener('click', () => api.quitApp()); // 关闭 = 退出程序
  $('btnMin').addEventListener('click', () => api.hideWindow());
  $('btnMax').addEventListener('click', async () => {
    const st = await api.toggleMaximize();
    document.body.classList.toggle('maximized', st.maximized);
  });
  document.querySelector('.title-drag').addEventListener('dblclick', async () => {
    const st = await api.toggleMaximize();
    document.body.classList.toggle('maximized', st.maximized);
  });

  // 标签页
  document.querySelectorAll('.seg').forEach((b) => {
    b.addEventListener('click', () => gotoPage(b.dataset.page));
  });

  // 翻译
  $('btnTranslate').addEventListener('click', () => startTranslate());
  $('btnStop').addEventListener('click', () => {
    if (currentTranslateId) api.cancel(currentTranslateId);
  });
  $('btnPaste').addEventListener('click', async () => {
    const text = await api.readClipboard();
    if (!text) return toast('剪贴板是空的', 'error');
    $('srcText').value = text;
    updateSrcCount();
    updateSrcLangBadge();
    if (targetBadgeTimer) clearTimeout(targetBadgeTimer);
    setTimeout(refreshTargetBadge, 60);
  });
  $('btnClearSrc').addEventListener('click', () => {
    $('srcText').value = '';
    updateSrcCount();
    updateSrcLangBadge();
    if (targetBadgeTimer) clearTimeout(targetBadgeTimer);
    setTimeout(refreshTargetBadge, 60);
  });
  $('btnCopyOut').addEventListener('click', async () => {
    if (!outputBuffer) return toast('还没有译文', 'error');
    await api.writeClipboard(outputBuffer);
    toast('译文已复制', 'ok');
  });
  // 回译校对：把译文放回左侧原文框，再翻一次就能比对是否有偏差
  $('btnUseOutput').addEventListener('click', () => {
    if (!outputBuffer) return toast('还没有译文', 'error');
    $('srcText').value = outputBuffer;
    updateSrcCount();
    updateSrcLangBadge();
    if (targetBadgeTimer) clearTimeout(targetBadgeTimer);
    setTimeout(refreshTargetBadge, 60);
    toast('译文已回填到左侧原文框，可直接再翻一次做回译校对', 'ok');
  });
  $('btnClearOut').addEventListener('click', () => {
    const box = $('outText');
    const empty = !outputBuffer && box.querySelector('.placeholder');
    if (empty) {
      toast('译文框已经是空的', 'info');
      return;
    }
    // 正在翻译就先停掉：先关掉 busy，后续的增量与错误事件会被忽略，
    // 否则流式内容会立刻把刚清空的框又填回来
    if (currentTranslateId) {
      const id = currentTranslateId;
      setBusy(false);
      currentTranslateId = null;
      api.cancel(id);
    }
    clearOutput();
    toast('译文已清空', 'ok');
  });

  $('btnOpenMain').addEventListener('click', () => {
    if (!outputBuffer) return toast('还没有译文', 'error');
    api.showCardWith({ source: $('srcText').value, text: outputBuffer, origin: '主窗口译文' });
  });

  $('srcText').addEventListener('input', () => {
    updateSrcCount();
    updateSrcLangBadge();   // 源语言标识即时跟随输入
    // 目标语种依赖原文，输入时防抖刷新提示
    if (targetBadgeTimer) clearTimeout(targetBadgeTimer);
    targetBadgeTimer = setTimeout(refreshTargetBadge, 320);
  });
  $('srcText').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      startTranslate();
    }
  });

  // 余额
  $('btnRefreshBalance').addEventListener('click', async () => {
    const b = await api.fetchBalance();
    if (b) renderBalance(b);
  });
  $('balanceChip').addEventListener('click', async () => {
    const b = await api.fetchBalance();
    if (b) renderBalance(b);
  });
  $('btnOpenTopup').addEventListener('click', () => api.openExternal('https://platform.deepseek.com/top_up'));

  // 充值记录
  $('btnTxSync').addEventListener('click', syncTransactions);
  $('btnTxPull').addEventListener('click', async () => {
    const status = $('txStatus');
    status.className = 'tx-status show busy';
    status.textContent = '正在让登录窗口重新进入充值记录页并抓取…';
    try {
      const st = await api.platformPull();
      cfg.platformSession = st;
      renderTxTable();
      if ((st.transactions || []).length) toast('抓取成功', 'ok');
      else {
        status.className = 'tx-status show err';
        status.textContent = '没有抓到数据。请确认内嵌窗口里已登录，并且能看到“充值记录”页面内容，然后再点一次。';
      }
    } catch (err) {
      status.className = 'tx-status show err';
      status.textContent = err.message;
    }
  });
  $('btnTxRefresh').addEventListener('click', quickRefresh);
  $('btnTxExport').addEventListener('click', exportCsv);
  $('btnTxClearToken').addEventListener('click', async () => {
    await api.platformClearToken();
    cfg.platformSession = Object.assign({}, cfg.platformSession, { hasToken: false });
    cfg.transactions = [];
    renderTxTable();
    toast('已清除网页会话凭证', 'ok');
  });
  $('chkCents').addEventListener('change', async (e) => {
    const next = await api.setConfig({ txAmountInCents: e.target.checked });
    cfg = next;
    renderTxTable();
  });

  // 设置 - 接口
  bindText('inpApiKey', 'apiKey', 'change');
  bindText('inpBaseUrl', 'baseUrl');
  bindText('inpModel', 'model');
  bindText('inpMaxTokens', 'maxTokens', 'change', Number);
  $('inpMaxTokens').addEventListener('input', renderMaxTokensHint);
  bindText('inpExtra', 'extraInstruction', 'change');
  $('inpTemp').addEventListener('input', (e) => {
    $('tempVal').textContent = Number(e.target.value).toFixed(1);
    paintRange(e.target);
  });
  $('inpTemp').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ temperature: Number(e.target.value) });
  });
  $('inpThinking').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ thinking: e.target.value });
    renderThinkingHints();
    toast(
      e.target.value === 'off'
        ? '已关闭思考模式：更省 token、可译更长'
        : '已开启思考模式：推理 token 会计费，且会占用输出额度',
      'ok'
    );
  });
  // ---- 翻译方向 ----
  document.querySelectorAll('#targetModeSeg .seg').forEach((b) => {
    b.addEventListener('click', async () => {
      cfg = await api.setConfig({ targetMode: b.dataset.mode });
      $('promptView').textContent = cfg.systemPrompt;
      await refreshTargetBadge();
    });
  });
  $('btnPickFixedLang').addEventListener('click', (e) => openLangPicker(e.currentTarget));
  $('targetPicker').addEventListener('click', (e) => {
    if (!$('langPop').hidden) closeLangPicker();
    else openLangPicker(e.currentTarget);
  });
  $('langSearch').addEventListener('input', (e) => {
    langFilter = e.target.value;
    langActive = 0;
    renderLangList();
  });
  $('langSearch').addEventListener('keydown', onLangKeydown);
  $('btnDiagToggle').addEventListener('click', () => {
    const body = $('txDiagBody');
    body.hidden = !body.hidden;
    $('btnDiagToggle').textContent = body.hidden ? '展开详情' : '收起详情';
  });
  $('btnDiagCopy').addEventListener('click', async () => {
    await api.writeClipboard(diagText());
    toast('诊断信息已复制，可直接发给我', 'ok');
  });
  $('btnTxProbe').addEventListener('click', async () => {
    const status = $('txStatus');
    status.className = 'tx-status show busy';
    status.textContent = '正在用已保存的会话凭证重放页面用过的接口…';
    try {
      const r = await api.platformProbe();
      if (r.ok) {
        status.className = 'tx-status show ok';
        status.textContent = `重放成功，取到 ${r.count} 条记录（接口 ${r.url.replace(/^https?:\/\//, '')}）`;
        toast('已取到充值记录', 'ok');
      } else {
        status.className = 'tx-status show err';
        status.textContent = '重放没能取到记录，展开下方“同步诊断”可以看到每个接口的返回情况。';
      }
      const st = await api.platformState();
      cfg.platformSession = st;
      renderTxTable();
      renderDiag();
    } catch (err) {
      status.className = 'tx-status show err';
      status.textContent = err.message;
    }
  });
  $('inpPromptStyle').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ systemPromptStyle: e.target.value });
    $('promptView').textContent = cfg.systemPrompt;
  });
  $('chkStreaming').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ streaming: e.target.checked });
  });
  // Key 在界面上始终以掩码显示，无法从掩码还原真值，所以这里是“清空重填”
  $('btnToggleKey').addEventListener('click', () => {
    const input = $('inpApiKey');
    input.value = '';
    input.focus();
    toast('已清空，请粘贴完整的 API Key', 'info');
  });
  $('btnLoadModels').addEventListener('click', async () => {
    try {
      const models = await api.listModels();
      if (!models.length) return toast('接口没有返回任何模型', 'error');
      toast('可用模型：' + models.join(' / '), 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 设置 - 快捷键与窗口
  $('btnHotkeyRecord').addEventListener('click', () => startHotkeyRecord('window'));
  $('btnSelectionHotkeyRecord').addEventListener('click', () => startHotkeyRecord('selection'));
  $('btnHotkeyReset').addEventListener('click', async () => {
    applyHotkeyResult('window', await api.setHotkey('Alt+`'));
  });
  $('btnSelectionHotkeyReset').addEventListener('click', async () => {
    applyHotkeyResult('selection', await api.setSelectionHotkey('Alt+Q'));
  });
  $('btnHotkeyReapply').addEventListener('click', async () => {
    cfg = await api.setConfig({ hotkey: cfg.hotkeyActive || cfg.hotkey });
    renderHotkeySettings();
    await refreshHotkeyStats();
    toast('已重新注册快捷键', 'ok');
  });
  $('chkSelectFirst').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ hotkeySelectFirst: e.target.checked });
  });
  $('chkMinimizeToTray').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ minimizeToTray: e.target.checked });
  });
  $('chkLaunchAtLogin').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ launchAtLogin: e.target.checked });
    toast(e.target.checked ? '已设置开机自启' : '已取消开机自启', 'ok');
  });
  $('inpMaterial').addEventListener('change', async (e) => {
    const value = e.target.value;
    cfg = await api.setConfig({ material: value });
    renderConfig(cfg);
    toast('正在按新材质重建窗口…', 'info');
    setTimeout(() => api.recreateWindow(), 420);
  });
  $('inpTheme').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ theme: e.target.value });
    applyTheme(cfg.theme);
  });

  // 设置 - 剪贴板
  $('chkClipWatch').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ clipboardWatch: e.target.checked });
    if (e.target.checked) toast('剪贴板监听已开启，注意 token 消耗', 'ok');
  });
  bindText('inpClipMin', 'clipboardMinLen', 'change', Number);
  bindText('inpClipInterval', 'clipboardInterval', 'change', Number);
  $('chkAutoCopy').addEventListener('change', async (e) => {
    cfg = await api.setConfig({ autoCopy: e.target.checked });
  });
  $('btnTranslateClip').addEventListener('click', () => api.translateClipboard());

  // 设置 - 数据
  $('btnClearHistory').addEventListener('click', async () => {
    await api.historyClear();
    cfg = await api.getConfig();
    renderStats();
    toast('翻译记录已清空', 'ok');
  });
  $('btnOpenConfigDir').addEventListener('click', () => api.openConfigDir());
  $('btnResetConfig').addEventListener('click', async () => {
    cfg = await api.resetConfig();
    renderConfig(cfg);
    toast('已恢复默认设置', 'ok');
  });

  // 外链
  document.querySelectorAll('[data-ext]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      api.openExternal(el.dataset.ext);
    });
  });

  // 系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (cfg.theme === 'system') applyTheme('system');
  });
}

function bindText(id, key, event = 'change', cast) {
  const el = $(id);
  el.addEventListener(event, async () => {
    let value = el.value;
    if (cast) value = cast(value);
    if (isNaN(value) && cast === Number) return;
    const next = await api.setConfig({ [key]: value });
    cfg = next;
    if (key === 'model') $('modelChip').textContent = cfg.resolvedModel;
  });
}

async function exportCsv() {
  const list = (cfg.platformSession && cfg.platformSession.transactions) || cfg.transactions || [];
  if (!list.length) return toast('没有可导出的记录', 'error');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['时间,类型/说明,金额,状态,支付方式,订单号'];
  list.forEach((r) => {
    lines.push([r.time, r.type, convertAmount(r.amount), r.status, r.method, r.id].map(esc).join(','));
  });
  const name = `DeepSeek充值记录-${new Date().toISOString().slice(0, 10)}.csv`;
  const res = await api.saveText({ defaultName: name, content: '\uFEFF' + lines.join('\r\n') });
  if (res && res.ok) toast('已导出到 ' + res.path, 'ok');
  else if (res && res.error) toast(res.error, 'error');
}

function updateSrcCount() {
  const n = $('srcText').value.length;
  $('srcCount').textContent = `${n} 字`;
}

/** 右栏字数与左栏对称显示 */
function updateOutCount() {
  $('outCount').textContent = `${outputBuffer.length} 字`;
}

/** 清空译文框：还原成初始的空态占位，并复位底部信息 */
function clearOutput() {
  outputBuffer = '';
  const out = $('outText');
  out.classList.remove('error', 'streaming');
  out.innerHTML = outPlaceholderHTML;
  $('usageInfo').textContent = '';
  $('elapsed').textContent = '';
  showTruncationWarning('');
  updateOutCount();
}

/**
 * 译文撞到“最大输出 token”时会从中间断掉。
 * 以前完全不提示，用户可能把半篇译文当成完整的 —— 对翻译工具这是危险的。
 */
function showTruncationWarning(finishReason) {
  const el = $('truncWarn');
  const hit = finishReason === 'length';
  el.hidden = !hit;
  if (!hit) return;
  el.title =
    '模型撞到了“单次最大输出 token”的上限，译文在中间被截断了。' +
    '解决办法：到设置页调大该上限，或者把原文分成几段分别翻译。';
  toast('译文被截断：撞到了最大输出 token 上限', 'error');
}

/* ---------------- 主进程事件 ---------------- */

function wireEvents() {
  api.on('config:changed', (data) => renderConfig(data));
  api.on('nav:goto', (page) => gotoPage(page));
  api.on('toast', (t) => toast(t.text, t.type === 'ok' ? 'ok' : t.type === 'error' ? 'error' : 'info'));

  api.on('translate:start', (p) => {
    if (p.origin !== '主窗口') return;
    outputBuffer = '';
    const out = $('outText');
    out.classList.remove('error');
    out.textContent = '';
    out.classList.add('streaming');
    updateSrcLangBadge(p.source);
    updateOutCount();
    setBusy(true);
  });

  api.on('translate:delta', (p) => {
    // 悬浮卡片场景由卡片窗口自行处理
    if (!translating) return;
    outputBuffer += p.delta;
    const out = $('outText');
    out.textContent = outputBuffer;
    out.scrollTop = out.scrollHeight;
    $('elapsed').textContent = '翻译中…';
    updateOutCount();
  });

  api.on('translate:done', (p) => {
    if (!translating) return;
    finishTranslate(p);
  });

  api.on('translate:error', (p) => {
    if (!translating) return;
    failTranslate(p);
  });

  api.on('balance:updated', (b) => renderBalance(b));
  api.on('usage:updated', (u) => {
    cfg.usageTotal = u;
    renderStats();
  });

  api.on('platform:state', (s) => {
    cfg.platformSession = s;
    renderTxTable();
    renderDiag();
  });

  api.on('platform:event', (e) => {
    const status = $('txStatus');
    if (e.type === 'token') {
      status.className = 'tx-status show busy';
      status.textContent = '已捕获网页会话凭证，正在等待充值记录接口响应…';
    }
    if (e.type === 'progress') {
      cfg.platformSession = e;
      const d = e.diag || {};
      if (d.stage && d.stage !== 'idle') {
        status.className = 'tx-status show busy';
        status.textContent =
          `${DIAG_STAGE[d.stage] || d.stage} · 已发现 ${d.seen || 0} 个接口 · 解析成功 ${d.parsed || 0} 个响应`;
      }
      renderDiag();
    }
    if (e.type === 'transactions') {
      cfg.platformSession = e;
      renderTxTable();
      toast(`已抓取到 ${(e.transactions || []).length} 条充值记录`, 'ok');
    }
  });

  api.on('window:state', (s) => document.body.classList.toggle('maximized', s.maximized));
  api.on('hotkey:fired', () => {
    if ($('page-settings').classList.contains('active')) refreshHotkeyStats();
  });
}

/* ---------------- 启动 ---------------- */

(async function boot() {
  outPlaceholderHTML = $('outText').innerHTML;
  bindUI();
  wireEvents();
  updateSrcCount();
  updateOutCount();
  updateSrcLangBadge();
  const info = await api.info();
  renderConfig(info);
  if (info.platformSession) cfg.platformSession = info.platformSession;

  const usage = await api.usageGet();
  cfg.usageTotal = usage;
  renderStats();

  try {
    langList = await api.langList();
  } catch (_) {
    langList = [];
  }
  await refreshTargetBadge();

  setTimeout(() => $('srcText').focus(), 200);
})();
