'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function on(channel, handler) {
  const allowed = ['card:update', 'card:delta', 'card:done', 'card:error'];
  if (!allowed.includes(channel)) return () => {};
  const listener = (_event, data) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cardBridge', {
  hide: () => invoke('card:hide'),
  pin: (pinned) => invoke('card:pin', pinned),
  copy: (text) => invoke('card:copy', text),
  openMain: () => invoke('card:open-main'),
  resize: (height) => invoke('card:resize', height),
  on
});
