import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import standardSetup from "../global-setup";

/** Guard the actual application server before any adapter can connect. */
export default async function setup(config: FullConfig) {
  if (process.env.PLAYWRIGHT_BASE_URL) throw new Error("Readability regression refuses reused application servers");
  const root = fileURLToPath(new URL("../../../../..", import.meta.url));
  const logs = resolve(root, ".codex-logs/2026-10-18-ui-readability/verification");
  await mkdir(logs, { recursive: true });
  await mkdir(resolve(logs, "../tmp"), { recursive: true });
  const guard = resolve(logs, "app-loopback-only.cjs"), attempts = resolve(logs, "app-external-attempts.jsonl");
  await writeFile(attempts, "");
  await writeFile(guard, `const net=require('node:net'),fs=require('node:fs');const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0][0]:args[0];const host=typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:undefined;if(host&&!['127.0.0.1','localhost','::1','[::1]'].includes(host)){fs.appendFileSync(${JSON.stringify(attempts)},JSON.stringify({host,blockedBeforeConnect:true})+'\\n');throw new Error('Readability isolated runtime blocks non-loopback network');}return Reflect.apply(connect,this,args)};`);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--require="${guard.replaceAll("\\", "/")}"`;
  try { return await standardSetup(config); }
  finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
}
