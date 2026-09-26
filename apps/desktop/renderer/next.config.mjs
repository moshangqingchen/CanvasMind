import rootPackage from "../../../package.json" with { type: "json" };
import { fileURLToPath } from "node:url";

/** Internal desktop renderer. Only Electron launches the authenticated local API. */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../../", import.meta.url)),
  outputFileTracingExcludes: { "/*": [
    "**/.env", "**/.env.*", "**/.local-public.env", "../../../.local-public.env",
    "./data/**/*", "./storage/**/*", "./项目/**/*", "../../../data/**/*", "../../../storage/**/*",
    "../../../backups/**/*", "../../../项目/**/*", "../../../.git/**/*", "../../../.runtime-local/**/*",
    "../../../.codex-temp/**/*", "../../../.codex-logs/**/*",
    "../../../packages/*/tests/**/*", "../../../packages/*/src/**/*.test.*",
    "../../../packages/*/vitest.config.*",
    "./lib/**/*.test.*", "./app/**/*.test.*", "./e2e/**/*",
    "./vitest.config.*", "./playwright.config.*", "./.ui-regression-results/**/*",
    "./test-results*/**/*", "./playwright-report/**/*", "./blob-report/**/*",
    "../stage/**/*", "../release/**/*",
  ] },
  distDir: ".next-desktop",
  experimental: { proxyClientMaxBodySize: "500mb" },
  transpilePackages: ["@super-canvas/core", "@super-canvas/db", "@super-canvas/providers", "@super-canvas/runtime", "@super-canvas/storage"],
  typedRoutes: false,
  env: { NEXT_PUBLIC_APP_VERSION: rootPackage.version },
};
export default nextConfig;
