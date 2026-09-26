import { readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export async function runtimeDependencies(workspace) {
  const require = createRequire(
    join(workspace, "apps/desktop/renderer/package.json"),
  );
  const dependencies = Object.fromEntries(
    ["next", "react", "react-dom"].map((name) => [
      name,
      require(`${name}/package.json`).version,
    ]),
  );
  const aliases = [];
  const aliasRoot = join(
    workspace,
    "apps/desktop/renderer/.next-desktop/standalone/apps/desktop/renderer/.next-desktop/node_modules",
  );
  const collect = async (directory, prefix = "") => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if (name.startsWith("@")) {
        await collect(path, `${name}/`);
        continue;
      }
      const target = await realpath(path);
      const pkg = JSON.parse(
        await readFile(join(target, "package.json"), "utf8"),
      );
      if (dependencies[pkg.name] && dependencies[pkg.name] !== pkg.version)
        throw new Error(`Conflicting runtime external: ${pkg.name}`);
      dependencies[pkg.name] = pkg.version;
      aliases.push({ path: `${prefix}${name}`, name: pkg.name });
    }
  };
  await collect(aliasRoot);
  return { dependencies, aliases };
}

export function validateRuntimeLock(lock, dependencies) {
  const actual = lock?.packages?.[""]?.dependencies;
  const sorted = (value) =>
    JSON.stringify(
      Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    );
  if (
    lock?.lockfileVersion !== 3 ||
    !actual ||
    sorted(actual) !== sorted(dependencies)
  ) {
    throw new Error(
      "Runtime dependency lock is out of date. Build the renderer, then run pnpm desktop:lock and review runtime-package-lock.json.",
    );
  }
}
