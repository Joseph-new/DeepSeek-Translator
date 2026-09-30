'use strict';

/**
 * 网络请求超时控制。
 *
 * 为什么单独抽一个模块：早期所有 fetch 都没有超时，遇到「服务端接受连接
 * 但不返回数据」或者网络半死的情况，请求会一直挂着 —— 余额刷新、模型列表、
 * 充值记录重放这三处连个取消按钮都没有，界面看起来就是卡死了。
 *
 * 两类超时语义不同，不要混：
 *   - 普通请求（余额、模型列表、接口重放）：总时长超时
 *   - 流式翻译：空闲超时 —— 长文翻译本身可能要几分钟，但只要还在持续吐字
 *     就说明连接是活的；卡住不吐字才算异常
 */

/** 普通短请求：余额、模型列表、接口重放 */
const TIMEOUT_SHORT = 30000;

/** 非流式翻译：整段生成完才返回，给足时间 */
const TIMEOUT_NON_STREAM = 180000;

/** 流式翻译的空闲上限：超过这么久没有新内容就判定卡住 */
const TIMEOUT_STREAM_IDLE = 60000;

/**
 * 把多个 AbortSignal 合并成一个，任一触发即触发。
 * Electron 33 的 Node 版本支持 AbortSignal.any，但保留手写兜底。
 */
function combineSignals(signals) {
  const list = (signals || []).filter(Boolean);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(list);
  }

  const controller = new AbortController();
  const forward = (reason) => {
    try {
      controller.abort(reason);
    } catch (_) {
      controller.abort();
    }
  };
  for (const s of list) {
    if (s.aborted) {
      forward(s.reason);
      break;
    }
    s.addEventListener('abort', () => forward(s.reason), { once: true });
  }
  return controller.signal;
}

/** 把一个超时信号包成「能看出是超时」的错误 */
function timeoutError(ms) {
  const err = new Error(`请求超时：超过 ${Math.round(ms / 1000)} 秒没有响应`);
  err.name = 'TimeoutError';
  return err;
}

function isTimeoutError(err) {
  return Boolean(err) && (err.name === 'TimeoutError' || err.name === 'AbortError' && err.__timeout);
}

/**
 * 带总时长超时的 fetch。
 * 超时会抛出 name === 'TimeoutError' 的错误，方便上层给出明确提示，
 * 而不是让用户对着一个不动的界面猜。
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_SHORT) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    try {
      timeoutController.abort(timeoutError(timeoutMs));
    } catch (_) {
      timeoutController.abort();
    }
  }, timeoutMs);

  const signal = combineSignals([options.signal, timeoutController.signal]);

  try {
    return await fetch(url, Object.assign({}, options, { signal }));
  } catch (err) {
    // 是超时导致的、且不是用户主动取消 → 换成明确的超时错误
    const userAborted = options.signal && options.signal.aborted;
    if (!userAborted && timeoutController.signal.aborted) {
      throw timeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式响应的空闲守卫。
 * 只要还在持续收到数据就重置计时；连续 idleMs 没有任何数据才判定卡住。
 *
 * 用法：
 *   const guard = createIdleGuard(TIMEOUT_STREAM_IDLE);
 *   ... fetch(url, { signal: combineSignals([userSignal, guard.signal]) })
 *   for await (const chunk of res.body) { guard.bump(); ... }
 *   guard.dispose();
 */
function createIdleGuard(idleMs = TIMEOUT_STREAM_IDLE) {
  const controller = new AbortController();
  let timer = null;
  let fired = false;

  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      try {
        controller.abort();
      } catch (_) {}
    }, idleMs);
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  bump();

  return {
    signal: controller.signal,
    bump,
    dispose,
    get timedOut() {
      return fired;
    },
    error() {
      return timeoutError(idleMs);
    }
  };
}

module.exports = {
  TIMEOUT_SHORT,
  TIMEOUT_NON_STREAM,
  TIMEOUT_STREAM_IDLE,
  combineSignals,
  fetchWithTimeout,
  createIdleGuard,
  timeoutError,
  isTimeoutError
};
