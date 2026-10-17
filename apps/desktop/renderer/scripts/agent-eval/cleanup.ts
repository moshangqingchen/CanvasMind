import { readdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Removes only isolated credential copies; historical public locks remain. */
export function removeIsolatedCredentials(directory: string): string[] {
  const root = resolve(directory);
  const removed: string[] = [];
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const target = resolve(join(folder, entry.name));
      const rel = relative(root, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel) || entry.isSymbolicLink())
        throw new Error("Credential cleanup refuses paths outside its isolated root");
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".secret.json") || entry.name.endsWith(".dpapi.bin") ||
        /^Local State(?:\..+)?$/u.test(entry.name)) {
        unlinkSync(target);
        removed.push(rel.replaceAll("\\", "/"));
      }
    }
  };
  visit(root);
  return removed.sort();
}
