// Loaded by bundled Node before Next. Tracks the actual HTTP response lifetime,
// including streaming agent requests, independently of Next's module bundles.
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { isPromise } = require('node:util').types;
if (process.env.SUPERCANVAS_DESKTOP === 'true') {
  const state = globalThis.__superCanvasDesktopLifecycle = { draining: false, writes: 0 };
  const requestState = Symbol('desktop write request');
  const trackedListeners = new WeakSet();
  const createServer = http.createServer;
  // Next registers its async request listener through createServer. Observe the
  // returned Promise without reimplementing EventEmitter dispatch (once,
  // listener mutations, exceptions, and captureRejections remain native).
  http.createServer = function (...args) {
    const index = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[index];
    if (typeof listener === 'function') {
      function trackedListener(...listenerArgs) {
        const work = listenerArgs[0][requestState];
        let result;
        try { result = Reflect.apply(listener, this, listenerArgs); }
        catch (error) { if (work) work.observable = false; throw error; }
        if (!work) return result;
        if (!isPromise(result)) { work.observable = false; return result; }
        work.pending++;
        // Return the observed Promise so native rejection handling still sees
        // the original success/rejection, rather than swallowing a rejection.
        return result.then(
          value => { work.pending--; work.check(); return value; },
          error => { work.pending--; work.check(); throw error; },
        );
      }
      trackedListener.listener = listener;
      trackedListeners.add(trackedListener);
      args[index] = trackedListener;
    }
    return Reflect.apply(createServer, this, args);
  };
  const original = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event !== 'request' && event !== 'upgrade') return original.call(this, event, ...args);
    const [req, res] = args;
    const expected = Buffer.from(process.env.SUPERCANVAS_DESKTOP_TOKEN || '');
    const supplied = Buffer.from(String(req.headers['x-supercanvas-desktop-token'] || ''));
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      if (event === 'upgrade') {
        res.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return true;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '桌面会话无效' }));
      return true;
    }
    if (event === 'upgrade') return original.call(this, event, ...args);
    const lifecycle = req.url?.split('?')[0] === '/api/desktop/lifecycle';
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !lifecycle;
    if (write && state.draining) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '正在等待任务完成并退出，请返回软件后继续编辑' }));
      return true;
    }
    if (write) {
      state.writes++;
      let done = false;
      const finish = () => { if (!done) { done = true; state.writes--; } };
      res.once('finish', finish);
      const listeners = this.rawListeners('request');
      const work = req[requestState] = {
        observable: listeners.length > 0 && listeners.every(listener => trackedListeners.has(listener)),
        pending: 0,
        dispatched: false,
        check() {
          // Close alone says nothing about outstanding writes. Next may finish
          // its async handler without end/finish after the response is destroyed.
          // Unknown/callback listeners remain fail-closed.
          if (this.observable && this.dispatched && this.pending === 0 && res.destroyed) finish();
        },
      };
      res.once('close', () => work.check());
      const end = res.end;
      res.end = function (...endArgs) { try { return end.apply(this, endArgs); } finally { finish(); } };
      try {
        return original.call(this, event, ...args);
      } finally {
        work.dispatched = true;
        work.check();
      }
    }
    return original.call(this, event, ...args);
  };
  // The parent owns this child; don't leave a writer behind after a crash.
  if (process.send) process.on('disconnect', () => process.exit(0));
  process.on('message', (message) => {
    // Next dev has a CLI parent and a forked HTTP worker. The Electron parent
    // checks/drains the HTTP worker before stopping the CLI; disconnect then
    // cascades through the worker's inherited hook.
    if (message?.type === 'shutdown' && state.writes === 0 &&
        (state.draining || process.env.SUPERCANVAS_DESKTOP_DEV === 'true')) process.exit(0);
  });
}
