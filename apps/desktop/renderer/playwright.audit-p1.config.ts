import { defineConfig } from "@playwright/test";
import base from "./playwright.canvas-v3.config";

/** Integrated acceptance owns ephemeral data and the existing connect-before-loopback guard. */
export default defineConfig({
  ...base,
  projects: [
    { name: "audit-import", testMatch: "audit-import-recovery.spec.ts" },
    { name: "audit-rejection", testMatch: "audit-submission-errors.spec.ts" },
    { name: "audit-material", testMatch: "audit-material-preparation.spec.ts" },
    { name: "audit-bridge", testMatch: ["canvas-import-grid.spec.ts", "agent-material-drop-lock.spec.ts"] },
    { name: "audit-save", testMatch: "canvas.spec.ts", grep: /项目 JSON 可导出并重新导入|导入新画布后立即刷新/u },
    { name: "audit-recovery", testMatch: "canvas-polish.spec.ts", grep: /提交响应丢失并关闭页面/u },
    { name: "audit-project", testMatch: ["project-files.spec.ts", "project-dialog.spec.ts"] },
    { name: "audit-webm", testMatch: "audit-webm.spec.ts" },
    { name: "audit-fingerprint", testMatch: "canvas-run-fingerprint.spec.ts" },
  ],
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, args: [
    ...base.use?.launchOptions?.args ?? [], "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]",
  ] } },
});
