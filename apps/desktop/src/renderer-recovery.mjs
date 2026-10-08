/** Keep navigation diagnostics useful without exposing URL credentials or queries. */
export function rendererDiagnosticUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}`
      : url.protocol === "file:" ? "file://[desktop-page]" : `[${url.protocol}]`;
  } catch { return "[invalid-url]"; }
}

function diagnosticMessage(error) {
  return String(error?.message ?? error).replace(/(?:https?|file):\/\/[^\s<>"']+/gu, rendererDiagnosticUrl);
}

export function rendererLoadFailure(errorCode, errorDescription, url, isMainFrame) {
  return isMainFrame ? `renderer main-frame load failed: ${errorCode} ${diagnosticMessage(errorDescription)} ${rendererDiagnosticUrl(url)}` : null;
}

/** Owns only the window. A renderer failure must never restart a paid backend task. */
export class DesktopRendererRecovery {
  constructor({ context, startupPath, state, show, log, nativeError, now = Date.now,
    prepareErrorWindow = () => {},
    maxAttempts = 2, retryWindowMs = 60_000, navigationTimeoutMs = 30_000 }) {
    Object.assign(this, { context, startupPath, state, show, log, nativeError, now, prepareErrorWindow, maxAttempts, retryWindowMs, navigationTimeoutMs });
    this.attempts = [];
    this.pending = false;
    this.stopped = false;
    this.crashes = 0;
    this.fallback = false;
    this.nativeShown = false;
    this.operation = undefined;
  }

  active() {
    const { window, quitting } = this.context();
    return !this.stopped && !quitting && window && !window.isDestroyed();
  }

  record(message) { void Promise.resolve().then(() => this.log(message)).catch(() => {}); }

  run(work) {
    const operation = (this.operation ?? Promise.resolve()).catch(() => {}).then(() => this.active() ? work() : false);
    this.operation = operation;
    void operation.finally(() => {
      if (this.operation !== operation) return;
      this.operation = undefined;
      void this.resume();
    }).catch(() => {});
    return operation;
  }

  stop() { this.stopped = true; this.pending = false; }

  get isRecovering() { return Boolean(this.operation || this.pending || this.fallback); }

  rememberPage(value) {
    try {
      const url = new URL(value);
      if (url.origin === this.context().origin) this.lastPage = `${url.origin}${url.pathname}`;
    } catch { /* Only a successfully navigated application path is recoverable. */ }
  }

  rendererGone(details) {
    this.record(`renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    this.crashes++;
    if (!this.active()) return Promise.resolve(false);
    if (this.context().waitingExit) { this.pending = true; return Promise.resolve(false); }
    if (this.fallback) {
      this.pending = false;
      this.showNative("界面进程再次停止", "请打开日志检查故障后重试。后台任务不会因此重新提交。");
      return Promise.resolve(false);
    }
    this.pending = true;
    return this.resume();
  }

  resume() {
    const { starting, waitingExit } = this.context();
    if (!this.pending || !this.active() || starting || waitingExit || this.operation) return this.operation ?? Promise.resolve(false);
    this.pending = false;
    return this.run(() => this.reload(true));
  }

  load({ manual = false } = {}) {
    if (this.operation) return this.operation;
    if (manual) { this.attempts = []; this.nativeShown = false; }
    this.fallback = false;
    this.pending = false;
    return this.run(() => this.reload(false));
  }

  loadStartup() {
    // Retrying setup is a new user action even before a backend exists.
    this.attempts = [];
    this.nativeShown = false;
    this.fallback = false;
    this.pending = false;
    this.prepareErrorWindow();
    return this.navigation(this.context().window.loadFile(this.startupPath));
  }

  async navigation(work) {
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("界面加载超时"));
          if (this.active()) try { this.context().window.webContents.stop(); } catch { /* The renderer may already be gone. */ }
        }, this.navigationTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  async reload(automatic) {
    const { window, origin, backend } = this.context();
    if (!origin || !backend) return this.displayError("界面进程已停止", "请点击重试重新打开界面，或打开日志查看原因。");
    const target = this.lastPage && new URL(this.lastPage).origin === origin ? this.lastPage : origin;
    let recoveryAttempts = 0;
    while (this.active()) {
      const current = this.context();
      if (current.origin !== origin || current.backend !== backend) return false;
      if (current.waitingExit || (automatic && current.starting)) { this.pending = true; return false; }
      if (automatic) {
        this.attempts = this.attempts.filter(time => this.now() - time < this.retryWindowMs);
        if (recoveryAttempts >= this.maxAttempts || this.attempts.length >= this.maxAttempts) break;
        recoveryAttempts++;
        this.attempts.push(this.now());
        this.record(`renderer recovery attempt ${this.attempts.length}/${this.maxAttempts}`);
      }
      const crashes = this.crashes;
      try {
        this.fallback = false;
        await this.navigation(window.loadURL(target));
        if (!this.active() || this.context().backend !== backend || this.context().origin !== origin) return false;
        if (crashes !== this.crashes) throw new Error("界面在加载过程中再次停止");
        this.pending = false;
        this.fallback = false;
        if (!this.context().waitingExit) this.show();
        return true;
      } catch (error) {
        this.record(`renderer load failed: ${diagnosticMessage(error)}`);
        if (!this.active()) return false;
        if (!automatic) return this.displayError("无法显示画布界面", `本地服务和已有任务保持运行，请点击重试重新载入界面。\n${diagnosticMessage(error)}`);
      }
    }
    return this.displayError("画布界面连续停止", "已暂停自动重载，本地服务和已有任务保持运行。请打开日志检查原因，或点击重试重新载入界面。");
  }

  error(message, detail) {
    this.pending = false;
    return this.run(() => this.displayError(message, detail));
  }

  showNative(message, detail) {
    if (!this.active() || this.nativeShown) return;
    this.nativeShown = true;
    this.nativeError(message, diagnosticMessage(detail));
  }

  async displayError(message, detail) {
    if (!this.active() || this.context().waitingExit) return false;
    this.pending = false;
    this.fallback = true;
    const crashes = this.crashes;
    try {
      this.prepareErrorWindow();
      await this.navigation(this.context().window.loadFile(this.startupPath));
      if (!this.active() || this.context().waitingExit) return false;
      if (crashes !== this.crashes) throw new Error("错误提示页面的渲染进程已停止");
      this.state("error", message, diagnosticMessage(detail));
      this.show();
    } catch (error) {
      this.record(`renderer error page failed: ${diagnosticMessage(error)}`);
      this.showNative(message, `${diagnosticMessage(detail)}\n错误提示页面也未能打开，请通过托盘打开日志。`);
    }
    return false;
  }
}
