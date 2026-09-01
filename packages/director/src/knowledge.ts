import { z } from "zod";

const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !/^[a-z]:/iu.test(value) &&
      !value.split("/").includes(".."),
    "Knowledge paths must be safe POSIX-style relative paths",
  );

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const isoDateTime = z.string().datetime({ offset: true });

export const KnowledgeFileSchema = z
  .object({
    path: safeRelativePath,
    sha256,
  })
  .strict();

export const KnowledgeReferenceSchema = KnowledgeFileSchema.extend({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  priority: z.number().int().min(0).max(10_000).default(100),
  always: z.boolean().optional(),
  triggers: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
}).strict();

export const KnowledgeArtifactSchema = KnowledgeFileSchema.extend({
  id: z.string().trim().min(1).max(128),
  kind: z.enum(["validator", "test", "agent-config"]),
}).strict();

export const KnowledgeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageName: z.string().trim().min(1).max(128),
    contentHash: sha256,
    source: z
      .object({
        path: z.string().trim().min(1),
        head: z.string().trim().min(1).max(128),
        dirty: z.boolean(),
        syncedAt: isoDateTime,
      })
      .strict(),
    skill: KnowledgeFileSchema,
    routing: KnowledgeFileSchema.optional(),
    references: z.array(KnowledgeReferenceSchema).max(100),
    artifacts: z.array(KnowledgeArtifactSchema).max(100).default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>([
      manifest.skill.path,
      ...(manifest.routing ? [manifest.routing.path] : []),
    ]);
    const artifactIds = new Set<string>();
    for (const [index, artifact] of manifest.artifacts.entries()) {
      if (artifactIds.has(artifact.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "id"],
          message: `Duplicate artifact id: ${artifact.id}`,
        });
      }
      artifactIds.add(artifact.id);
      if (paths.has(artifact.path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "path"],
          message: `Duplicate knowledge path: ${artifact.path}`,
        });
      }
      paths.add(artifact.path);
    }
    for (const [index, reference] of manifest.references.entries()) {
      if (ids.has(reference.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["references", index, "id"],
          message: `Duplicate reference id: ${reference.id}`,
        });
      }
      ids.add(reference.id);
      if (paths.has(reference.path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["references", index, "path"],
          message: `Duplicate knowledge path: ${reference.path}`,
        });
      }
      paths.add(reference.path);
    }
    if (
      manifest.references.filter((reference) => reference.always).length > 3
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references"],
        message: "At most three references may be marked as always loaded",
      });
    }
  });

export type KnowledgeManifest = z.infer<typeof KnowledgeManifestSchema>;
export type KnowledgeReference = z.infer<typeof KnowledgeReferenceSchema>;

export interface DirectorKnowledgeTask {
  readonly query: string;
  readonly tags?: readonly string[];
  readonly maxReferences?: 1 | 2 | 3;
}

export interface LoadedKnowledgeDocument {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly sha256: string;
  readonly content: string;
}

export interface LoadedDirectorKnowledge {
  readonly manifest: KnowledgeManifest;
  readonly skill: LoadedKnowledgeDocument;
  readonly routing?: LoadedKnowledgeDocument;
  readonly references: readonly LoadedKnowledgeDocument[];
}

export interface DirectorKnowledgeReader {
  readText(relativePath: string): Promise<string>;
}

export type KnowledgeTextHasher = (content: string) => Promise<string> | string;

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function scoreReference(
  reference: KnowledgeReference,
  query: string,
  tags: ReadonlySet<string>,
): number {
  let score = reference.always ? 1_000_000 : 0;
  const normalizedTags = reference.tags.map(normalizeSearchText);
  const normalizedTriggers = reference.triggers.map(normalizeSearchText);
  if (normalizedTags.some((tag) => tags.has(tag))) score += 10_000;
  else if (normalizedTags.some((tag) => query.includes(tag))) score += 500;
  if (normalizedTriggers.some((trigger) => tags.has(trigger))) score += 5_000;
  else if (normalizedTriggers.some((trigger) => query.includes(trigger)))
    score += 250;
  return score;
}

/** Selects only task-relevant references; the skill document is loaded separately. */
export function selectKnowledgeReferences(
  manifest: KnowledgeManifest,
  task: DirectorKnowledgeTask,
): KnowledgeReference[] {
  const query = normalizeSearchText(task.query);
  const tags = new Set((task.tags ?? []).map(normalizeSearchText));
  const limit = task.maxReferences ?? 3;
  return manifest.references
    .map((reference) => ({
      reference,
      score: scoreReference(reference, query, tags),
    }))
    .filter(({ reference, score }) => reference.always === true || score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.reference.priority - right.reference.priority ||
        left.reference.id.localeCompare(right.reference.id),
    )
    .slice(0, limit)
    .map(({ reference }) => reference);
}

export function parseKnowledgeManifest(value: unknown): KnowledgeManifest {
  if (typeof value === "string") {
    return KnowledgeManifestSchema.parse(JSON.parse(value));
  }
  return KnowledgeManifestSchema.parse(value);
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function joinRelative(base: string, path: string): string {
  const combined = base ? `${base}/${path}` : path;
  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error("Knowledge path escapes the package root");
      }
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

async function readVerified(
  reader: DirectorKnowledgeReader,
  base: string,
  file: { readonly path: string; readonly sha256: string },
  hasher?: KnowledgeTextHasher,
): Promise<string> {
  const content = await reader.readText(joinRelative(base, file.path));
  if (hasher) {
    const actual = (await hasher(content)).toLowerCase();
    if (actual !== file.sha256.toLowerCase()) {
      throw new Error(`Knowledge integrity check failed for ${file.path}`);
    }
  }
  return content;
}

export async function loadDirectorKnowledge(
  reader: DirectorKnowledgeReader,
  manifestPath: string,
  task: DirectorKnowledgeTask,
  hasher?: KnowledgeTextHasher,
): Promise<LoadedDirectorKnowledge> {
  const manifestText = await reader.readText(manifestPath);
  const manifest = parseKnowledgeManifest(manifestText);
  const base = directoryOf(manifestPath);
  const selected = selectKnowledgeReferences(manifest, task);
  const [skillContent, routingContent, ...referenceContents] =
    await Promise.all([
      readVerified(reader, base, manifest.skill, hasher),
      manifest.routing
        ? readVerified(reader, base, manifest.routing, hasher)
        : Promise.resolve(undefined),
      ...selected.map((reference) =>
        readVerified(reader, base, reference, hasher),
      ),
    ]);

  return {
    manifest,
    skill: {
      id: "skill",
      title: manifest.packageName,
      path: manifest.skill.path,
      sha256: manifest.skill.sha256,
      content: skillContent,
    },
    ...(manifest.routing && routingContent !== undefined
      ? {
          routing: {
            id: "routing",
            title: "Capability routing",
            path: manifest.routing.path,
            sha256: manifest.routing.sha256,
            content: routingContent,
          },
        }
      : {}),
    references: selected.map((reference, index) => ({
      id: reference.id,
      title: reference.title,
      path: reference.path,
      sha256: reference.sha256,
      content: referenceContents[index]!,
    })),
  };
}
