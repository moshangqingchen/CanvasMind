import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  loadDirectorKnowledge,
  type DirectorKnowledgeReader,
  type DirectorKnowledgeTask,
  type LoadedDirectorKnowledge,
} from "./knowledge.js";

export * from "./knowledge.js";

export function sha256KnowledgeText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createFileSystemKnowledgeReader(
  packageRoot: string,
): DirectorKnowledgeReader {
  const root = resolve(packageRoot);
  const canonicalRoot = realpath(root);
  return {
    async readText(relativePath: string): Promise<string> {
      if (isAbsolute(relativePath)) {
        throw new Error("Knowledge reader accepts only relative paths");
      }
      const target = await realpath(resolve(root, relativePath));
      const fromRoot = relative(await canonicalRoot, target);
      if (
        fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        isAbsolute(fromRoot)
      ) {
        throw new Error("Knowledge path escapes the package root");
      }
      return readFile(target, "utf8");
    },
  };
}

export function loadDirectorKnowledgeFromFileSystem(
  packageRoot: string,
  manifestPath: string,
  task: DirectorKnowledgeTask,
): Promise<LoadedDirectorKnowledge> {
  return loadDirectorKnowledge(
    createFileSystemKnowledgeReader(packageRoot),
    manifestPath,
    task,
    sha256KnowledgeText,
  );
}
