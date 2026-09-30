'use strict';

/**
 * 配置存储层
 * 配置写入 Electron userData 目录下的 config.json，不污染项目交付目录。
 * API Key 等敏感信息仅保存在本机。
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  // ---- 接口 ----
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: '', // 留空时使用 FALLBACK_MODEL
  temperature: 1.3,
  // 思考模式。翻译场景官方明确建议关闭：
  //   - 思维链 token 按输出价计费，实测同样一句话 completion 从 8 涨到 86
  //   - 会挤占 max_tokens 额度，直接缩短可翻译长度
  //   - 思考模式下 temperature 完全不生效（设置里的温度滑块会变成摆设）
  // 取值：off（关闭，默认） | low | high
  thinking: 'off', // DeepSeek 官方建议：翻译任务 1.3
  maxTokens: 8192,
  streaming: true,

  // ---- 翻译行为 ----
  targetMode: 'auto', // auto：中文→English、其他→简体中文；fixed：一律用 targetLang
  targetLang: 'English', // targetMode 为 fixed 时生效
  recentLangs: [], // 最近用过的目标语种，置顶显示
  systemPromptStyle: 'strict', // strict | natural
  extraInstruction: '', // 可选附加要求（默认空，保持最低 token 消耗）
  autoCopy: true,

  // ---- 快捷方式与窗口 ----
  hotkey: 'Alt+`', // 显示 / 隐藏主窗口（键盘上 ~ 和 · 那颗键）
  selectionHotkey: 'Alt+Q', // 划词翻译（实测 Alt+Shift+` 在 Electron 里注册不上）
  // 让窗口快捷键顺便尝试划词。默认关闭：判断有没有选中要启动外部进程，
  // 会让“显示/隐藏”变成 0.5 秒以上才有反应，快捷键就时灵时不灵了。
  hotkeySelectFirst: false,
  material: 'acrylic', // acrylic（Win11 真毛玻璃）| custom（自绘玻璃）
  theme: 'light', // system | light | dark
  launchAtLogin: false,
  // 语义已拆开：最小化收进托盘；关闭则是直接退出程序。
  // 原来只有一个 closeToTray 同时管两种行为，容易混淆，已改名为 minimizeToTray。
  minimizeToTray: true,

  // ---- 剪贴板 / 划词 ----
  clipboardWatch: false,
  clipboardMinLen: 4,
  clipboardInterval: 900,

  // ---- 账户 ----
  autoRefreshBalance: true,
  balanceIntervalMin: 30,
  platformToken: '',
  platformTxUrl: '',
  platformSummaryUrl: '',
  balance: null,
  transactions: [],
  txAmountInCents: false,
  lastBalanceAt: 0,
  lastSyncAt: 0,

  // ---- 运行数据 ----
  history: [], // 最近翻译记录
  usageTotal: { prompt: 0, completion: 0, calls: 0 }
};

const SECRET_KEYS = new Set(['apiKey', 'platformToken']);

let cache = null;

function load() {
  if (cache) return cache;
  let disk = {};
  try {
    if (fs.existsSync(FILE())) {
      disk = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    }
  } catch (err) {
    console.error('[store] 读取配置失败，使用默认配置：', err.message);
    disk = {};
  }
  cache = Object.assign({}, DEFAULTS, disk);
  return cache;
}

function save() {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] 写入配置失败：', err.message);
  }
}

function get(key) {
  return key === undefined ? load() : load()[key];
}

/** 对外输出：敏感字段做掩码，避免渲染层意外泄漏 */
function getMasked() {
  const data = Object.assign({}, load());
  for (const key of SECRET_KEYS) {
    const val = data[key];
    data[key + 'Set'] = Boolean(val);
    data[key] = val ? mask(val) : '';
  }
  return data;
}

function mask(value) {
  const str = String(value);
  if (str.length <= 10) return '••••••••';
  return str.slice(0, 6) + '••••••••' + str.slice(-4);
}

/** 写入配置；若收到掩码值则不覆盖原值 */
function set(patch) {
  const data = load();
  for (const [key, value] of Object.entries(patch || {})) {
    if (SECRET_KEYS.has(key) && (value === '' || /\u2022{4,}/.test(String(value)))) {
      continue; // 空值 / 掩码值 = 不修改
    }
    data[key] = value;
  }
  save();
  return getMasked();
}

/** 强制写敏感字段（清除时使用） */
function setSecret(key, value) {
  load()[key] = value;
  save();
}

function reset() {
  cache = Object.assign({}, DEFAULTS);
  save();
  return getMasked();
}

function configPath() {
  return FILE();
}

module.exports = { get, set, setSecret, getMasked, reset, configPath, DEFAULTS };
