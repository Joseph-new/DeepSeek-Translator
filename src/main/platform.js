'use strict';

/**
 * DeepSeek 开放平台“账户数据”同步
 * =====================================================================
 * 背景：DeepSeek 只公开了 /user/balance（余额），没有公开充值记录接口。
 *      充值记录只存在于 platform.deepseek.com 这个网页的内部接口里，
 *      需要网页登录态（localStorage.userToken）才能访问。
 *
 * 方案：不硬编码内部接口路径（会随平台改版失效），改用“运行时自动发现”——
 *   1. 开一个内嵌窗口，加载 https://platform.deepseek.com/transactions
 *   2. 在页面主世界里打补丁，劫持 fetch / XMLHttpRequest
 *   3. 页面自己请求什么接口，我们就把“请求头里的 Authorization”和
 *      “响应体 JSON”原样读出来（通过 console 通道回传）
 *   4. 从响应体里用启发式规则找出“记录数组”，自动映射成表格字段
 *   5. 存下 token + 命中的接口 URL，之后就能一键刷新，无需再开窗口
 *
 * 安全性：token 与抓到的数据只保存在本机 config.json，不外传。
 * =====================================================================
 */

const { BrowserWindow, session } = require('electron');
const path = require('path');

const PARTITION = 'persist:deepseek-platform';
const ORIGIN = 'https://platform.deepseek.com';
const TX_PAGE = ORIGIN + '/transactions';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ *
 * 注入到页面主世界的 Hook 脚本
 * 通过 console.log 把捕获到的数据回传（Electron 的 console-message 事件）
 * ------------------------------------------------------------------ */
const { HOOK_SCRIPT, HOOK_PREFIX } = require('./hook-source');
const net = require('./net');

/* ------------------------------------------------------------------ *
 * 字段启发式映射
 * ------------------------------------------------------------------ */

/* 顺序有讲究：优先取“支付完成时间”，未支付的订单该字段存在但值为空，
 * 这时要能回退到下单时间（inserted_at / created_at），否则时间列会是空的。 */
const TIME_KEYS = ['paid_at', 'paidAt', 'pay_time', 'payTime', 'paid_time', 'trade_time',
  'created_at', 'createdAt', 'create_time', 'createTime',
  'inserted_at', 'insertedAt', 'updated_at', 'updatedAt',
  'time', 'timestamp', 'date', 'datetime', 'occurred_at'];
const AMOUNT_KEYS = ['amount', 'total_amount', 'totalAmount', 'money', 'price', 'pay_amount',
  'payAmount', 'order_amount', 'value', 'fee', 'cny_amount'];
const STATUS_KEYS = ['payment_order_status', 'paymentOrderStatus',
  'status', 'state', 'pay_status', 'payStatus', 'order_status',
  'trade_status', 'tradeStatus', 'payment_status', 'paymentStatus', 'result', 'biz_status'];
const TYPE_KEYS = ['type', 'biz_type', 'bizType', 'category', 'kind', 'title', 'subject',
  'remark', 'description', 'desc', 'trade_type', 'tradeType', 'transaction_type',
  'transactionType', 'biz_name', 'bizName', 'name'];
const METHOD_KEYS = ['payment_method', 'paymentMethod', 'pay_method', 'payMethod', 'channel',
  'pay_channel', 'payment_channel', 'pay_channel_name', 'payChannel',
  'payment_type', 'paymentType', 'pay_type', 'payType', 'method'];
const ID_KEYS = ['payment_order_id', 'paymentOrderId',
  'order_no', 'orderNo', 'order_id', 'orderId', 'trade_no', 'tradeNo',
  'transaction_id', 'transactionId', 'transaction_no', 'transactionNo',
  'out_trade_no', 'outTradeNo', 'serial_no', 'serialNo', 'biz_no', 'bizNo',
  'payment_id', 'paymentId', 'bill_no', 'billNo', 'no', 'id', 'uuid'];
const CURRENCY_KEYS = ['currency', 'currency_code', 'unit'];

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return { key: k, value: obj[k] };
  }
  return null;
}

function scoreRecord(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  let score = 0;
  if (pick(obj, AMOUNT_KEYS)) score += 3;
  if (pick(obj, TIME_KEYS)) score += 2;
  if (pick(obj, STATUS_KEYS)) score += 1;
  if (pick(obj, TYPE_KEYS)) score += 1;
  if (pick(obj, ID_KEYS)) score += 1;
  if (pick(obj, CURRENCY_KEYS)) score += 1;
  if (pick(obj, METHOD_KEYS)) score += 1;
  return score;
}

/** 深度遍历，找出最像“记录列表”的数组 */
function findRecordArray(json) {
  const candidates = [];
  const seen = new WeakSet();

  (function walk(node, trail, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length && typeof node[0] === 'object' && node[0] !== null) {
        let best = 0;
        for (let i = 0; i < Math.min(node.length, 5); i++) {
          best = Math.max(best, scoreRecord(node[i]));
        }
        if (best >= 4) candidates.push({ arr: node, score: best, trail, length: node.length });
      }
      node.forEach((item, i) => walk(item, trail + '[' + i + ']', depth + 1));
      return;
    }

    for (const key of Object.keys(node)) {
      walk(node[key], trail ? trail + '.' + key : key, depth + 1);
    }
  })(json, '', 0);

  candidates.sort((a, b) => b.score - a.score || b.length - a.length);
  return candidates[0] || null;
}

function formatTime(value) {
  if (value === undefined || value === null || value === '') return '';
  let date;
  const raw = String(value).trim();
  if (typeof value === 'number' || /^\d{10}$|^\d{13}$/.test(raw)) {
    // 10 位 = 秒，13 位 = 毫秒
    const n = Number(value);
    date = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    // 先按标准时间格式解析：ISO 8601（带时区、毫秒）一律走这里
    date = new Date(raw);
    if (isNaN(date.getTime())) {
      // 退回处理 "2026-07-21 05:54:46" 这类非标准写法
      date = new Date(raw.replace(/-/g, '/'));
    }
  }
  if (isNaN(date.getTime())) return raw;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) return value;
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toFixed(2);
}

/* 平台返回的是 SUCCESS / WECHAT 这类枚举码，界面上按中文显示更直观。
 * 原始值仍保留在 raw 字段里，方便排查。 */
const STATUS_LABEL = {
  SUCCESS: '成功', PAID: '已支付', FINISHED: '成功', COMPLETED: '成功', DONE: '成功',
  PENDING: '处理中', PROCESSING: '处理中',
  INIT: '待支付', UNPAID: '待支付', WAITING: '待支付', CREATED: '待支付',
  CANCELED: '已取消', CANCELLED: '已取消', CLOSED: '已关闭', EXPIRED: '已过期',
  // 平台网页把 FAILED 显示为“已取消”，这里保持一致，避免和官网对不上
  FAILED: '已取消', FAIL: '已取消', REFUNDED: '已退款', REFUND: '已退款'
};

const METHOD_LABEL = {
  WECHAT: '微信支付', WECHATPAY: '微信支付', WX: '微信支付', WXPAY: '微信支付',
  ALIPAY: '支付宝', ALI: '支付宝',
  BANK: '银行卡', BANKCARD: '银行卡', CARD: '银行卡', UNIONPAY: '云闪付',
  STRIPE: 'Stripe', PAYPAL: 'PayPal', BALANCE: '账户余额', COUPON: '代金券'
};

function labelOf(map, value) {
  if (value === undefined || value === null || value === '') return '';
  const key = String(value).toUpperCase().replace(/[\s_\-]/g, '');
  return map[key] || String(value);
}

function normalizeRecords(arr) {
  return arr.map((item, index) => {
    if (item === null || typeof item !== 'object') {
      return { index, time: '', type: '', amount: String(item ?? ''), status: '', method: '', id: '' };
    }
    const t = pick(item, TIME_KEYS);
    const a = pick(item, AMOUNT_KEYS);
    const st = pick(item, STATUS_KEYS);
    const ty = pick(item, TYPE_KEYS);
    const m = pick(item, METHOD_KEYS);
    const id = pick(item, ID_KEYS);
    const cur = pick(item, CURRENCY_KEYS);
    return {
      index,
      time: t ? formatTime(t.value) : '',
      rawTime: t ? t.value : '',
      type: ty ? String(ty.value) : '',
      amount: a ? formatAmount(a.value) : '',
      amountKey: a ? a.key : '',
      status: st ? labelOf(STATUS_LABEL, st.value) : '',
      statusRaw: st ? String(st.value) : '',
      method: m ? labelOf(METHOD_LABEL, m.value) : '',
      methodRaw: m ? String(m.value) : '',
      id: id ? String(id.value) : '',
      idKey: id ? id.key : '',
      currency: cur ? String(cur.value) : '',
      raw: item
    };
  });
}

/** 从平台响应里提取交易记录 */
function extractTransactions(json) {
  const found = findRecordArray(json);
  if (!found) return { records: [], trail: '', score: 0 };
  return { records: normalizeRecords(found.arr), trail: found.trail, score: found.score };
}

/** URL 是否像“交易/订单/账单”接口 */
function looksLikeTransactionUrl(url) {
  return /transaction|order|bill|pay|recharge|topup|top_up|trade|invoice|record/i.test(String(url || ''));
}

/** URL 是否像“账户汇总”接口 */
function looksLikeSummaryUrl(url) {
  return /summary|overview|account|profile|user_info|wallet/i.test(String(url || ''));
}

/* ------------------------------------------------------------------ *
 * 同步窗口
 * ------------------------------------------------------------------ */

class PlatformSync {
  constructor({ store, onEvent }) {
    this.store = store;
    this.onEvent = onEvent || (() => {});
    this.win = null;
    this.discovered = { token: '', txUrl: '', summaryUrl: '', txCount: 0, summary: null };
    this.lastError = '';
    // 页面实际调用过的数据接口（来自 webRequest，与页面脚本无关，最可靠的清单来源）
    this.requests = new Map();
    // console 消息分片重组缓冲
    this.buffers = new Map();
    this.diag = {
      seen: 0,
      responses: 0,
      parsed: 0,
      candidates: 0,
      probed: 0,
      stage: 'idle',
      probeLog: [],
      hookErrors: []
    };
    this.lastProgressAt = 0;
  }

  ses() {
    return session.fromPartition(PARTITION);
  }

  isOpen() {
    return Boolean(this.win && !this.win.isDestroyed());
  }

  /** 打开（或聚焦）登录/同步窗口 */
  async open({ url } = {}) {
    if (this.isOpen()) {
      this.win.show();
      this.win.focus();
      if (url) await this.win.loadURL(url, { userAgent: UA });
      return this.win;
    }

    const win = new BrowserWindow({
      width: 520,
      height: 780,
      minWidth: 420,
      minHeight: 560,
      title: '登录 DeepSeek 开放平台',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: PARTITION,
        preload: path.join(__dirname, '..', 'preload', 'login.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        backgroundThrottling: false
      }
    });

    this.win = win;
    this.lastError = '';

    // 兜底通道：即使 Hook 没装上，也能从请求头里拿到会话 token。
    // 这是原生回调，里面抛错会直接终止整个应用，必须整体兜住。
    if (!this.headerHookInstalled) {
      try {
        this.ses().webRequest.onBeforeSendHeaders(
          { urls: [ORIGIN + '/api/*'] },
          (details, callback) => {
            try {
              const headers = details.requestHeaders || {};
              for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'authorization') this.captureToken(headers[key]);
              }
              callback({ requestHeaders: headers });
            } catch (err) {
              console.error('[platform] 请求头回调异常（已忽略）：', err && err.message);
              try { callback({ requestHeaders: details.requestHeaders || {} }); } catch (_) {}
            }
          }
        );
        this.headerHookInstalled = true;
      } catch (err) {
        console.error('[platform] 注册请求头监听失败：', err.message);
      }
    }

    // 记录页面实际发起的所有 xhr / fetch。
    // 这条通道在渲染层之外，不受注入时机影响，是最可靠的接口清单来源；
    // 钩子没抓到响应体时，还能按这份清单原样重放请求把数据取回来。
    if (!this.requestRecorderInstalled) {
      try {
        this.ses().webRequest.onBeforeRequest({ urls: [ORIGIN + '/*'] }, (details, callback) => {
          try {
            if (details.resourceType === 'xhr' || details.resourceType === 'fetch') {
              this.noteRequest(details.url, details.method, details.uploadData);
            }
          } catch (_) {}
          callback({});
        });
        this.requestRecorderInstalled = true;
      } catch (err) {
        console.error('[platform] 注册接口清单监听失败：', err && err.message);
      }
    }

    const inject = () => this.inject(win);
    win.webContents.on('dom-ready', inject);
    win.webContents.on('did-navigate', inject);
    win.webContents.on('did-navigate-in-page', inject);

    // 保持我们自己的标题，并把加载进度反馈到标题栏（平台 SPA 包体不小，
    // 没有反馈会让人以为卡死了）
    win.on('page-title-updated', (event) => event.preventDefault());
    win.webContents.on('did-start-loading', () => {
      try { win.setTitle('正在加载 DeepSeek 开放平台…'); } catch (_) {}
    });
    win.webContents.on('did-stop-loading', () => {
      try { win.setTitle('登录 DeepSeek 开放平台 · 登录后程序会自动抓取数据'); } catch (_) {}
    });

    // 兼容不同 Electron 版本的 console-message 签名
    win.webContents.on('console-message', (...args) => {
      const message = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
      if (message) this.onConsole(String(message));
    });

    win.on('close', () => this.detachDebugger(win));
    win.on('closed', () => {
      this.win = null;
      this.cdpReady = false;
      this.onEvent('window-closed', this.state());
    });

    // Hook 的注入由 preload 完成（早于页面脚本，且不像 CDP 那样拖慢加载）。
    // 首屏加载完再确认一次；万一 preload 没生效，才启用 CDP 兜底。
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => this.ensureHook(win), 500);
    });

    // 已登录就直接进充值记录页；未登录先进登录页（更轻，打开更快）
    const cfg = this.store.get();
    const target = url || (cfg.platformToken ? TX_PAGE : ORIGIN + '/');
    await win.loadURL(target, { userAgent: UA });
    return win;
  }

  /** preload 注入是否生效？没生效才退回 CDP */
  async ensureHook(win) {
    if (!win || win.isDestroyed()) return;
    let installed = false;
    try {
      installed = await win.webContents.executeJavaScript('!!window.__dsHook', true);
    } catch (err) {
      console.warn('[platform] 检测 Hook 失败：', err && err.message);
    }
    if (installed) {
      this.cdpReady = false;
      return;
    }
    console.warn('[platform] preload 未生效，改用 CDP 预注入 + 当前文档补注入');
    try {
      await this.attachCdp(win);
    } catch (err) {
      console.error('[platform] CDP 注入失败：', err && err.message);
    }
    this.inject(win); // 当前文档补一次
  }

  async attachCdp(win) {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: HOOK_SCRIPT });
    this.cdpReady = true;
  }

  detachDebugger(win) {
    try {
      const dbg = win && win.webContents && win.webContents.debugger;
      if (dbg && dbg.isAttached()) dbg.detach();
    } catch (err) {
      console.warn('[platform] 分离调试器失败（忽略）：', err && err.message);
    }
    this.cdpReady = false;
  }

  inject(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(HOOK_SCRIPT, true)
      .catch((err) => console.error('[platform] Hook 注入失败：', err && err.message));
  }

  /* 钩子回传格式：PREFIX|kind|url|序号/总数|内容
     内容要分片，因为 Chromium 对单条 console 消息有长度上限，
     几十 KB 的接口响应会被截断，JSON.parse 失败后就静默丢数据了。 */
  onConsole(message) {
    if (!message.startsWith(HOOK_PREFIX)) return;
    const rest = message.slice(HOOK_PREFIX.length + 1);
    const p1 = rest.indexOf('|');
    if (p1 < 0) return;
    const kind = rest.slice(0, p1);
    const tail = rest.slice(p1 + 1);
    const p2 = tail.indexOf('|');
    const url = p2 < 0 ? tail : tail.slice(0, p2);
    const payload = p2 < 0 ? '' : tail.slice(p2 + 1);

    if (kind === 'READY') {
      this.onEvent('ready', this.state());
      return;
    }
    if (kind === 'AUTH') {
      this.captureToken(payload);
      return;
    }
    if (kind === 'URL') {
      this.noteRequest(url, payload);
      return;
    }
    if (kind !== 'RES') return;

    const p3 = payload.indexOf('|');
    const marker = p3 < 0 ? '0/1' : payload.slice(0, p3);
    const chunk = p3 < 0 ? payload : payload.slice(p3 + 1);
    const m = /^(\d+)\/(\d+)$/.exec(marker);
    if (!m) return;

    const index = Number(m[1]);
    const total = Number(m[2]);
    if (total <= 1) {
      this.handleResponse(url, chunk);
      return;
    }

    const key = 'RES|' + url;
    let buf = this.buffers.get(key);
    if (!buf || buf.total !== total) {
      buf = { parts: new Array(total).fill(null), total, at: Date.now() };
      this.buffers.set(key, buf);
    }
    buf.parts[index] = chunk;
    if (buf.parts.every((x) => x !== null)) {
      this.buffers.delete(key);
      this.handleResponse(url, buf.parts.join(''));
    } else if (Date.now() - buf.at > 20000) {
      this.buffers.delete(key); // 分片没收齐，丢弃避免泄漏
    }
  }

  handleResponse(url, body) {
    this.diag.responses++;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return;
    }
    const status = parsed && parsed.status;
    if (status && status !== 200) return;
    this.diag.parsed++;
    this.considerPayload(url, parsed && parsed.data);
  }

  /** 记下页面用过的数据接口（含方法，必要时可重放） */
  noteRequest(url, method, uploadData) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (this.requests.has(url)) return;
    let body = null;
    try {
      if (Array.isArray(uploadData)) {
        const parts = uploadData
          .map((d) => (d && d.bytes ? Buffer.from(d.bytes).toString('utf8') : ''))
          .filter(Boolean);
        if (parts.length) body = parts.join('');
      }
    } catch (_) {}
    this.requests.set(url, {
      url,
      method: String(method || 'GET').toUpperCase(),
      body,
      at: Date.now()
    });
    this.diag.seen = this.requests.size;

    // 进度事件节流，避免每个请求都刷一次界面
    const now = Date.now();
    if (now - this.lastProgressAt > 900) {
      this.lastProgressAt = now;
      this.onEvent('progress', this.state());
    }
  }

  captureToken(authValue) {
    const token = String(authValue || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length < 12) return;
    if (token.startsWith('sk-')) return; // 这是公开 API Key，不是网页会话 token
    if (this.discovered.token === token) return;
    this.discovered.token = token;
    this.store.setSecret('platformToken', token);
    this.onEvent('token', this.state());

    // 登录成功 → 自动进入充值记录页（此时页面才需要去取记录数据）
    setTimeout(() => {
      try {
        if (!this.isOpen()) return;
        const cfg = this.store.get();
        if (cfg.platformTxUrl && (cfg.transactions || []).length) return; // 已有记录，不必再跑
        const current = this.win.webContents.getURL();
        if (!/\/transactions/.test(current)) {
          this.win.loadURL(TX_PAGE, { userAgent: UA }).catch(() => {});
        }
      } catch (err) {
        console.warn('[platform] 自动进入充值记录页失败：', err && err.message);
      }
    }, 1000);
  }

  /** 判断这份响应是不是我们要的数据，并记下接口地址 */
  considerPayload(url, data) {
    if (!data || typeof data !== 'object') return;

    if (looksLikeSummaryUrl(url)) {
      this.discovered.summaryUrl = this.purify(url);
      this.discovered.summary = data;
      this.store.set({ platformSummaryUrl: this.discovered.summaryUrl });
      this.onEvent('summary', this.state());
    }

    const { records, score } = extractTransactions(data);
    const hitByUrl = looksLikeTransactionUrl(url);
    if (!records.length) return;
    if (score < 5 && !hitByUrl) return;

    // 只在“更像交易记录”时覆盖，避免被用量明细之类的小表格顶掉
    const current = this.store.get('transactions') || [];
    const better =
      !current.length ||
      (hitByUrl && records.length >= Math.min(current.length, 3)) ||
      records.length > current.length;

    if (better) {
      this.discovered.txUrl = this.purify(url);
      this.store.set({
        platformTxUrl: this.discovered.txUrl,
        transactions: records,
        lastSyncAt: Date.now()
      });
      this.onEvent('transactions', this.state());
    }
  }

  /** 统一成绝对地址，相对路径按平台域名补全 */
  purify(url) {
    const u = String(url || '');
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    try {
      return new URL(u, ORIGIN).href;
    } catch (_) {
      return u;
    }
  }

  /** 用户点"已完成登录，开始抓取"：重新加载交易页触发页面自身请求 */
  /** Re-load the transactions page so the platform's own JS re-issues its requests */
  async pull() {
    if (!this.isOpen()) throw new Error('同步窗口未打开');
    const win = this.win;
    const before = (this.store.get('transactions') || []).length;

    // 重置计数，方便诊断时看清“这一轮”到底发生了什么
    this.diag.responses = 0;
    this.diag.parsed = 0;
    this.diag.probeLog = [];
    this.buffers.clear();

    this.diag.stage = 'loading';
    this.onEvent('progress', this.state());
    await win.loadURL(TX_PAGE, { userAgent: UA }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3400));

    let after = (this.store.get('transactions') || []).length;
    if (after === before || !after) {
      this.diag.stage = 'waiting';
      this.onEvent('progress', this.state());
      await new Promise((r) => setTimeout(r, 3200)); // 页面较慢时再等一轮
      after = (this.store.get('transactions') || []).length;
    }

    // 钩子没抓到 → 按页面实际用过的接口清单重放，把数据取回来
    if (after === before || !after) {
      this.diag.stage = 'replaying';
      this.onEvent('progress', this.state());
      try {
        await this.probeEndpoints();
      } catch (err) {
        this.lastError = err.message;
        console.warn('[platform] 接口重放失败：', err && err.message);
      }
    }

    this.diag.stage = 'done';
    this.onEvent('progress', this.state());
    return this.state();
  }

  /* ------------------------------------------------------------------ *
   * 接口重放：钩子只负责“顺手捞”，真正兜底靠这里
   * 页面实际调用过的接口（含方法、请求体）都在 this.requests 里，
   * 用会话 token 原样重放一遍，就能绕开注入时机、console 截断等一切问题。
   * ------------------------------------------------------------------ */

  isSafeToReplay(req) {
    const u = String(req.url || '');
    if (!/^https?:\/\//i.test(u)) return false;
    // 绝不重放任何可能产生副作用的写操作
    if (/(create|delete|update|remove|cancel|submit|purchase|bind|unbind|login|logout|verify|send_code|otp|pay\b)/i.test(u)) {
      return false;
    }
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    // POST 只在明显是查询类接口时才重放
    return looksLikeTransactionUrl(u) || looksLikeSummaryUrl(u);
  }

  replayScore(req) {
    let s = 0;
    const u = req.url;
    if (/transaction|order|bill|trade|recharge|topup|invoice|record/i.test(u)) s += 12;
    if (/history|list|page|search|query|records/i.test(u)) s += 4;
    if (looksLikeTransactionUrl(u)) s += 6;
    if (looksLikeSummaryUrl(u)) s += 2;
    if (req.method === 'GET') s += 2;
    if (req.method === 'POST') s -= 1;
    return s;
  }

  async replayRequest(req, token) {
    const ses = session.fromPartition(PARTITION);
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'x-client-platform': 'web',
      'User-Agent': UA
    };
    const init = { method: req.method, headers };
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      init.body = req.body;
    }
    // 重放同样需要超时：否则某个接口不返回就会一直挂着，
    // 而这条路径连取消按钮都没有
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), net.TIMEOUT_SHORT);
    init.signal = controller.signal;
    try {
      const doFetch = typeof ses.fetch === 'function' ? ses.fetch.bind(ses) : fetch;
      return await doFetch(req.url, init);
    } catch (err) {
      if (controller.signal.aborted) throw net.timeoutError(net.TIMEOUT_SHORT);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async probeEndpoints({ limit = 16 } = {}) {
    const token = this.store.get('platformToken');
    if (!token) throw new Error('尚未获取网页会话凭证，请先登录');

    const list = Array.from(this.requests.values())
      .filter((r) => this.isSafeToReplay(r))
      .sort((a, b) => this.replayScore(b) - this.replayScore(a))
      .slice(0, limit);

    this.diag.probed = list.length;
    const tried = [];

    for (const req of list) {
      try {
        const res = await this.replayRequest(req, token);
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}
        if (!json) {
          tried.push(`${req.method} ${req.url} → 非 JSON（HTTP ${res.status}）`);
          continue;
        }
        const status = json.status;
        if (status && status !== 200) {
          tried.push(`${req.method} ${req.url} → 业务码 ${status}`);
          continue;
        }
        const payload = json.data !== undefined ? json.data : json;
        const { records, score } = extractTransactions(payload);
        tried.push(`${req.method} ${req.url} → 记录 ${records.length} 条，匹配度 ${score}`);
        if (records.length && score >= 5) {
          this.diag.probeLog = tried;
          this.discovered.txUrl = req.url;
          this.store.set({
            platformTxUrl: req.url,
            transactions: records,
            lastSyncAt: Date.now()
          });
          this.onEvent('transactions', this.state());
          return { ok: true, url: req.url, count: records.length, tried };
        }
      } catch (err) {
        tried.push(`${req.method} ${req.url} → 失败：${err && err.message}`);
      }
    }

    this.diag.probeLog = tried;
    this.lastError = list.length
      ? '重放了 ' + list.length + ' 个接口但都没解析出记录'
      : '没有记录到任何数据接口，请确认内嵌窗口已登录并进入了充值记录页';
    return { ok: false, tried };
  }

  state() {
    const cfg = this.store.get();
    return {
      open: this.isOpen(),
      hasToken: Boolean(cfg.platformToken),
      tokenPreview: cfg.platformToken ? cfg.platformToken.slice(0, 6) + '…' : '',
      txUrl: cfg.platformTxUrl || this.discovered.txUrl || '',
      transactions: cfg.transactions || [],
      lastSyncAt: cfg.lastSyncAt || 0,
      diag: {
        seen: this.diag.seen,
        responses: this.diag.responses,
        parsed: this.diag.parsed,
        probed: this.diag.probed,
        stage: this.diag.stage,
        error: this.lastError,
        probeLog: this.diag.probeLog.slice(-24),
        endpoints: Array.from(this.requests.keys()).slice(-40)
      }
    };
  }

  close() {
    if (this.isOpen()) this.win.close();
  }
}

/* ------------------------------------------------------------------ *
 * 用已保存的 token 直接刷新（不再开窗口）
 * ------------------------------------------------------------------ */

async function refreshWithToken(store) {
  const cfg = store.get();
  const token = cfg.platformToken;
  const url = cfg.platformTxUrl;
  if (!token) throw new Error('尚未获取网页会话凭证，请先点击“登录并同步”');
  if (!url) throw new Error('尚未发现充值记录接口，请先点击“登录并同步”');

  const ses = session.fromPartition(PARTITION);
  const doFetch = async (target) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), net.TIMEOUT_SHORT);
    const options = {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        'x-client-platform': 'web',
        'User-Agent': UA
      },
      signal: controller.signal
    };
    try {
      if (typeof ses.fetch === 'function') return await ses.fetch(target, options);
      return await fetch(target, options);
    } catch (err) {
      if (controller.signal.aborted) throw net.timeoutError(net.TIMEOUT_SHORT);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const res = await doFetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new Error('网页会话已过期，请点“登录并同步”重新登录一次');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`平台接口返回 HTTP ${res.status}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error('平台接口返回的不是 JSON，可能是接口已改版');
  }

  const { records } = extractTransactions(json);
  if (!records.length) {
    throw new Error('接口有响应但没有解析到记录，可能平台已改版，请重新登录同步');
  }
  store.set({ transactions: records, lastSyncAt: Date.now() });

  // 顺便取账户汇总
  if (cfg.platformSummaryUrl) {
    try {
      const sres = await doFetch(cfg.platformSummaryUrl);
      if (sres.ok) {
        const summary = JSON.parse(await sres.text());
        store.set({ platformSummary: summary });
      }
    } catch (_) {
      /* 忽略 */
    }
  }

  return { records, lastSyncAt: Date.now() };
}

module.exports = {
  PlatformSync,
  refreshWithToken,
  extractTransactions,
  findRecordArray,
  normalizeRecords,
  formatTime,
  formatAmount,
  HOOK_SCRIPT,
  ORIGIN,
  TX_PAGE,
  PARTITION,
  UA
};
