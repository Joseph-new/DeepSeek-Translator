'use strict';

/* 注入到 DeepSeek 平台页面主世界的钩子脚本。
 * 抽成独立模块是为了让主进程（兜底注入）与登录窗口的 preload（首选注入）共用同一份，
 * 避免两处副本不同步。
 *
 * HOOK_PREFIX 是脚本通过 console.log 回传数据时使用的前缀，
 * 主进程侧的解析逻辑必须用同一个值，所以一并导出。
 *
 * 回传格式：PREFIX | kind | url | 分片序号/总分片 | 内容
 * 必须分片：Chromium 对单条 console 消息有长度上限，几十 KB 的接口响应
 * 会被截断，导致 JSON.parse 失败、数据被静默丢弃（这是踩过的坑）。
 */

const HOOK_PREFIX = '__DSHOOK__';
const CHUNK_SIZE = 7000;
const MAX_CHUNKS = 400;

const HOOK_SCRIPT = `
(function () {
  if (window.__dsHook) return 'already';

  var P = ${JSON.stringify(HOOK_PREFIX)};
  var CHUNK = ${CHUNK_SIZE};
  var MAXC = ${MAX_CHUNKS};
  var stats = { seen: 0, sent: 0, truncated: 0, errors: [] };
  window.__dsHook = true;
  window.__dsHookStats = stats;

  function emit(kind, url, payload) {
    try {
      var body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (body == null) return;
      var head = P + '|' + kind + '|' + (url || '') + '|';
      if (body.length <= CHUNK) {
        console.log(head + '0/1|' + body);
        return;
      }
      var parts = Math.ceil(body.length / CHUNK);
      if (parts > MAXC) { parts = MAXC; stats.truncated++; }
      for (var i = 0; i < parts; i++) {
        console.log(head + i + '/' + parts + '|' + body.substr(i * CHUNK, CHUNK));
      }
    } catch (e) {
      if (stats.errors.length < 8) stats.errors.push('emit:' + e.message);
    }
  }

  function readAuth(headers, url) {
    try {
      if (!headers) return;
      if (typeof headers.get === 'function') {
        var v = headers.get('authorization') || headers.get('Authorization');
        if (v) emit('AUTH', url, v);
        return;
      }
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === 'authorization') emit('AUTH', url, String(headers[i][1]));
        }
        return;
      }
      for (var k in headers) {
        if (String(k).toLowerCase() === 'authorization') emit('AUTH', url, String(headers[k]));
      }
    } catch (e) {}
  }

  /* 判定哪些请求值得抓。
     不能写死 /api/vN/ —— 平台改版可能换路径前缀，那样就一个都抓不到。
     改为：任意 /api/ 路径、GraphQL、以及同源下形似数据接口的路径全部放行，
     宁可多抓几个（主进程用字段打分筛选），不要漏。 */
  function interesting(url) {
    var u = String(url || '');
    if (!u) return false;
    if (u.indexOf('/api/') >= 0) return true;
    if (u.indexOf('graphql') >= 0) return true;
    if (/[?&](operationName|query)=/.test(u)) return true;
    try {
      var abs = new URL(u, location.href);
      if (abs.origin === location.origin && /\\/(api|rpc|bff|service|gateway|v\\d+)\\//i.test(abs.pathname)) return true;
    } catch (e) {}
    return false;
  }

  /* 页面用的是相对路径（例如 /auth-api/v0/...），
     必须转成绝对地址，否则主进程保存下来的接口地址没法直接重放。 */
  function abs(u) {
    try {
      return new URL(String(u || ''), location.href).href;
    } catch (e) {
      return String(u || '');
    }
  }

  function note(url, method) {
    stats.seen++;
    emit('URL', abs(url), method || 'GET');
  }

  function deliver(url, status, data) {
    stats.sent++;
    emit('RES', abs(url), { status: status, data: data, at: Date.now() });
  }

  // ---- fetch ----
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var mine = false;
      try {
        readAuth((init && init.headers) || (input && input.headers), url);
        if (interesting(url)) { mine = true; note(url, method); }
      } catch (e) {}

      var p = origFetch.apply(this, arguments);
      if (!mine) return p;

      try {
        return p.then(function (res) {
          try {
            res.clone().text().then(function (t) {
              if (!t) return;
              var json = null;
              try { json = JSON.parse(t); } catch (e) { return; }
              deliver(url, res.status, json);
            }).catch(function (e) {
              if (stats.errors.length < 8) stats.errors.push('fetch-read:' + e.message);
            });
          } catch (e) {}
          return res;
        });
      } catch (e) {
        return p;
      }
    };
  }

  // ---- XMLHttpRequest ----
  var XHR = window.XMLHttpRequest;
  if (XHR) {
    var oOpen = XHR.prototype.open;
    var oSend = XHR.prototype.send;
    var oSet = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (m, u) {
      try {
        this.__dsUrl = u;
        this.__dsMethod = m || 'GET';
        this.__dsMine = interesting(u);
      } catch (e) {}
      return oOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (n, v) {
      try {
        if (String(n).toLowerCase() === 'authorization') emit('AUTH', this.__dsUrl || '', String(v));
      } catch (e) {}
      return oSet.apply(this, arguments);
    };

    /* responseType 为 'json' 时读 responseText 会抛 InvalidStateError，
       静默被 catch 掉就什么都抓不到 —— 必须按类型分别取。 */
    function readBody(xhr) {
      try {
        if (xhr.responseType === 'json') return xhr.response;
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          return JSON.parse(xhr.responseText);
        }
        if (xhr.response && typeof xhr.response === 'object') return xhr.response;
      } catch (e) {
        if (stats.errors.length < 8) stats.errors.push('xhr-read(' + xhr.responseType + '):' + e.message);
      }
      return null;
    }

    XHR.prototype.send = function () {
      var self = this;
      try {
        if (self.__dsMine) note(self.__dsUrl, self.__dsMethod);
        self.addEventListener('load', function () {
          try {
            if (!self.__dsMine) return;
            var json = readBody(self);
            if (json == null) return;
            deliver(self.__dsUrl, self.status, json);
          } catch (e) {}
        });
      } catch (e) {}
      return oSend.apply(this, arguments);
    };
  }

  console.log(P + '|READY|' + location.href + '|0/1|{}');
  return 'installed';
})();
`;

module.exports = { HOOK_SCRIPT, HOOK_PREFIX, CHUNK_SIZE, MAX_CHUNKS };
