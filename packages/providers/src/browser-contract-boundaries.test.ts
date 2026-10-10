import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it.each(["cangyuan-current-models", "hang-image-contract"])("keeps %s UI inspection independent of server transports", entry => {
  const seen = new Set<string>();
  const serverDependencies: string[] = [];
  function inspect(url: URL, chain: string[]) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    // Resolve emitted imports so type-only references to REST interfaces remain legal.
    const emitted = ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const imported of ts.preProcessFile(emitted, true, true).importedFiles) {
      const dependency = imported.fileName;
      if (!dependency.startsWith(".")) {
        serverDependencies.push([...chain, dependency].join(" -> "));
        continue;
      }
      inspect(new URL(dependency.replace(/\.js$/u, ".ts"), url), [...chain, dependency]);
    }
  }
  inspect(new URL(`./${entry}.ts`, import.meta.url), [entry]);
  expect(serverDependencies).toEqual([]);
});

it("does not pull the server provider barrel into the image parameter menu", () => {
  const source = readFileSync(new URL("../../../apps/desktop/renderer/lib/supplier-image-menu-contract.ts", import.meta.url), "utf8");
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const providerImports = ts.preProcessFile(emitted, true, true).importedFiles
    .map(row => row.fileName).filter(name => name.startsWith("@super-canvas/providers"));
  expect(providerImports).not.toContain("@super-canvas/providers");
});
