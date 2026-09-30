'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

/** 只订阅已知通道，避免渲染层拿到任意 IPC 能力 */
function on(channel, handler) {
  const allowed = [
    'config:changed', 'translate:start', 'translate:delta', 'translate:done',
    'translate:error', 'balance:updated', 'platform:event', 'platform:state',
    'toast', 'nav:goto', 'window:state', 'usage:updated', 'hotkey:fired'
  ];
  if (!allowed.includes(channel)) return () => {};
  const listener = (_event, data) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('bridge', {
  info: () => invoke('app:info'),
  getConfig: () => invoke('config:get'),
  setConfig: (patch) => invoke('config:set', patch),
  resetConfig: () => invoke('config:reset'),
  openConfigDir: () => invoke('config:open-dir'),

  listModels: () => invoke('models:list'),
  fetchBalance: () => invoke('balance:fetch'),

  translate: (payload) => invoke('translate', payload),
  cancel: (id) => invoke('translate:cancel', id),
  readClipboard: () => invoke('clipboard:read'),
  writeClipboard: (text) => invoke('clipboard:write', text),
  selectionTranslate: () => invoke('selection:translate'),
  translateClipboard: () => invoke('clipboard:translate'),

  setHotkey: (accelerator) => invoke('hotkey:set', accelerator),
  setSelectionHotkey: (accelerator) => invoke('hotkey:set-selection', accelerator),
  hotkeySuggestions: () => invoke('hotkey:suggestions'),
  selectionHotkeySuggestions: () => invoke('hotkey:selection-suggestions'),
  hotkeyStats: () => invoke('hotkey:stats'),

  hideWindow: () => invoke('window:hide'),
  quitApp: () => invoke('app:quit'),
  minimizeWindow: () => invoke('window:minimize'),
  toggleMaximize: () => invoke('window:toggle-max'),
  windowState: () => invoke('window:state'),
  recreateWindow: () => invoke('window:recreate'),

  openExternal: (url) => invoke('external:open', url),

  platformOpen: (url) => invoke('platform:open', url),
  platformPull: () => invoke('platform:pull'),
  platformRefresh: () => invoke('platform:refresh'),
  platformClose: () => invoke('platform:close'),
  platformState: () => invoke('platform:state'),
  platformClearToken: () => invoke('platform:clear-token'),
  platformProbe: () => invoke('platform:probe'),

  langList: () => invoke('lang:list'),
  langDescribe: (text) => invoke('lang:describe', text),

  showCardWith: (payload) => invoke('card:show', payload),
  saveText: (payload) => invoke('file:save-text', payload),

  historyList: () => invoke('history:list'),
  historyClear: () => invoke('history:clear'),
  usageGet: () => invoke('usage:get'),

  on
});
