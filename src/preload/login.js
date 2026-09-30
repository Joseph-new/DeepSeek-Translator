'use strict';

/**
 * 登录 / 同步窗口专用 preload
 *
 * 作用：在页面任何脚本执行之前，把钩子脚本注入到页面主世界。
 * preload 的执行时机天然早于页面脚本，这样就不必再依赖 CDP 的
 * Page.addScriptToEvaluateOnNewDocument —— CDP 会拖慢页面加载，
 * 而且窗口被销毁时调试器未分离容易连带影响主进程稳定性。
 *
 * contextIsolation 保持 true：webFrame.executeJavaScript 是把代码
 * 送进页面主世界执行，而不是把 Node 能力暴露给页面。
 */

const { webFrame } = require('electron');
const { HOOK_SCRIPT } = require('../main/hook-source');

try {
  webFrame.executeJavaScript(HOOK_SCRIPT).then(
    (result) => {
      if (result !== 'installed' && result !== 'already') {
        console.warn('[platform] preload 注入返回异常：', result);
      }
    },
    (err) => {
      console.warn('[platform] preload 注入失败，主进程会走 CDP 兜底：', err && err.message);
    }
  );
} catch (err) {
  console.warn('[platform] preload 注入抛错，主进程会走 CDP 兜底：', err && err.message);
}
