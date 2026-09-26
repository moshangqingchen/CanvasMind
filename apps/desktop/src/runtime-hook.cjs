// Loaded by bundled Node before Next. Tracks the actual HTTP response lifetime,
// including streaming agent requests, independently of Next's module bundles.
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
if (process.env.SUPERCANVAS_DESKTOP === 'true') {
  const state = globalThis.__superCanvasDesktopLifecycle = { draining: false, writes: 0 };
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
      // A client disconnect can leave a handler working. Fail closed until
      // the handler ends its response, rather than declaring it idle early.
      const end = res.end;
      res.end = function (...endArgs) { try { return end.apply(this, endArgs); } finally { finish(); } };
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
