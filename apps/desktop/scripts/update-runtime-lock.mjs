import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  runtimeDependencies,
  validateRuntimeLock,
} from "./runtime-dependencies.mjs";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const { dependencies } = await runtimeDependencies(workspace);
const directory = await mkdtemp(join(tmpdir(), "supercanvas-runtime-lock-"));
try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "super-canvas-desktop-runtime",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    ),
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--install-strategy=hoisted",
      ],
      {
        cwd: directory,
        shell: process.platform === "win32",
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Lock update failed: ${code}`)),
    );
  });
  const text = await readFile(join(directory, "package-lock.json"), "utf8");
  validateRuntimeLock(JSON.parse(text), dependencies);
  await writeFile(
    join(workspace, "apps/desktop/runtime-package-lock.json"),
    text,
  );
  console.log(
    "Runtime lock updated. Review its dependency changes before release.",
  );
} finally {
  if (dirname(resolvePath(directory)) !== resolvePath(tmpdir()))
    throw new Error("Unexpected temporary lock directory");
  await rm(directory, { recursive: true, force: true });
}
