import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = resolve(packageRoot, "knowledge");
const argumentsList = process.argv.slice(2);
const allowDirty = argumentsList.includes("--allow-dirty");
const sourceIndex = argumentsList.indexOf("--source");
const sourceArgument =
  sourceIndex >= 0 ? argumentsList[sourceIndex + 1] : undefined;
const sourceRoot = resolve(
  sourceArgument ?? process.env.SUPER_DIRECTOR_SOURCE ?? "",
);

if (!sourceArgument && !process.env.SUPER_DIRECTOR_SOURCE) {
  throw new Error(
    "Pass --source <super-director-repo> or set SUPER_DIRECTOR_SOURCE",
  );
}
if (!(await stat(sourceRoot).catch(() => undefined))?.isDirectory()) {
  throw new Error(`Super Director source does not exist: ${sourceRoot}`);
}

function git(...args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

const head = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain").length > 0;
if (dirty && !allowDirty) {
  throw new Error(
    "Super Director source has uncommitted changes; rerun with --allow-dirty to record an explicit dirty snapshot",
  );
}

const references = [
  {
    id: "core-contract",
    title: "Core contract",
    file: "core-contract.md",
    priority: 1,
    always: true,
    triggers: [],
    tags: ["core"],
  },
  {
    id: "trend-gate",
    title: "Realtime trend and evidence gate",
    file: "trend-gate.md",
    priority: 5,
    triggers: [
      "创意",
      "剧情",
      "广告",
      "热点",
      "二创",
      "趋势",
      "story",
      "creative",
      "ad",
    ],
    tags: ["creative", "research", "trend"],
  },
  {
    id: "creative-routing",
    title: "Creative routing",
    file: "creative-routing.md",
    priority: 10,
    triggers: [
      "创意",
      "短剧",
      "广告",
      "故事",
      "喜剧",
      "改编",
      "creative",
      "story",
    ],
    tags: ["creative", "story"],
  },
  {
    id: "action-and-fight-direction",
    title: "Action and fight direction",
    file: "action-and-fight-direction.md",
    priority: 5,
    triggers: [
      "打斗",
      "战斗",
      "决斗",
      "招式",
      "必杀技",
      "对轰",
      "fight",
      "action",
    ],
    tags: ["fight", "action"],
  },
  {
    id: "dialogue-and-scene-writing",
    title: "Dialogue and scene writing",
    file: "dialogue-and-scene-writing.md",
    priority: 5,
    triggers: ["对白", "台词", "旁白", "场次", "剧本", "dialogue", "script"],
    tags: ["dialogue", "writing"],
  },
  {
    id: "production-and-generation",
    title: "Production and generation",
    file: "production-and-generation.md",
    priority: 5,
    triggers: [
      "生图",
      "图片",
      "故事板",
      "分镜",
      "视频",
      "运镜",
      "生成",
      "image",
      "video",
    ],
    tags: ["generation", "production", "image", "video"],
  },
  {
    id: "rights-and-provenance",
    title: "Rights and provenance",
    file: "rights-and-provenance.md",
    priority: 5,
    triggers: [
      "真人",
      "品牌",
      "Logo",
      "IP",
      "歌曲",
      "声音",
      "复刻",
      "商业",
      "发布",
    ],
    tags: ["rights", "provenance"],
  },
  {
    id: "video-reference-and-proxy-rerender",
    title: "Video reference and proxy rerender",
    file: "video-reference-and-proxy-rerender.md",
    priority: 5,
    triggers: [
      "视频参考",
      "白模",
      "白膜",
      "灰模",
      "深度视频",
      "代理渲染",
      "重渲染",
    ],
    tags: ["video-reference", "rerender"],
  },
  {
    id: "latest-platform-snapshot",
    title: "Latest platform snapshot",
    file: "latest-platform-snapshot.md",
    priority: 50,
    triggers: ["最新", "当前平台", "热点", "趋势", "latest"],
    tags: ["platform", "snapshot"],
  },
  {
    id: "capability-map",
    title: "Capability map",
    file: "capability-map.md",
    priority: 100,
    triggers: ["能力地图", "深度资料", "capability"],
    tags: ["capability"],
  },
];

const files = [
  {
    source: ".agents/skills/ai-super-director/SKILL.md",
    target: "SKILL.md",
    role: "skill",
  },
  {
    source: "docs/superpowers/capability-routing.json",
    target: "routing/capability-routing.json",
    role: "routing",
  },
  ...references.map((reference) => ({
    source: `.agents/skills/ai-super-director/references/${reference.file}`,
    target: `references/${reference.file}`,
    role: "reference",
    reference,
  })),
  {
    source:
      ".agents/skills/ai-super-director/scripts/validate-trend-evidence.ps1",
    target: "validators/validate-trend-evidence.ps1",
    role: "validator",
    id: "validate-trend-evidence",
  },
  {
    source: "scripts/validate-storyboard-timeline.ps1",
    target: "validators/validate-storyboard-timeline.ps1",
    role: "validator",
    id: "validate-storyboard-timeline",
  },
  {
    source: "scripts/validate-dialogue-scene.ps1",
    target: "validators/validate-dialogue-scene.ps1",
    role: "validator",
    id: "validate-dialogue-scene",
  },
  {
    source: "tests/validate-trend-evidence.tests.ps1",
    target: "source-tests/validate-trend-evidence.tests.ps1",
    role: "test",
    id: "validate-trend-evidence-tests",
  },
  {
    source: "tests/capability-routing-behavior.tests.ps1",
    target: "source-tests/capability-routing-behavior.tests.ps1",
    role: "test",
    id: "capability-routing-behavior-tests",
  },
  {
    source: ".agents/skills/ai-super-director/agents/openai.yaml",
    target: "agent-config/openai.yaml",
    role: "agent-config",
    id: "openai-agent-config",
  },
];

function assertInside(root, target) {
  const value = relative(root, target);
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`Path escapes expected root: ${target}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const prepared = [];
for (const file of files) {
  const source = resolve(sourceRoot, file.source);
  const target = resolve(targetRoot, file.target);
  assertInside(sourceRoot, source);
  assertInside(targetRoot, target);
  const content = await readFile(source);
  prepared.push({ ...file, source, target, content, sha256: sha256(content) });
}

if ((await stat(targetRoot).catch(() => undefined))?.isDirectory()) {
  assertInside(packageRoot, targetRoot);
  await rm(targetRoot, { recursive: true, force: true });
}
for (const file of prepared) {
  await mkdir(dirname(file.target), { recursive: true });
  await cp(file.source, file.target);
}

const fileHashes = prepared
  .map(
    (file) =>
      `${file.target.slice(targetRoot.length + 1).replaceAll("\\", "/")}\0${file.sha256}`,
  )
  .sort()
  .join("\n");
const byRole = (role) => prepared.find((file) => file.role === role);
const manifest = {
  schemaVersion: 1,
  packageName: "ai-super-director",
  contentHash: sha256(fileHashes),
  source: {
    path: sourceRoot.replaceAll("\\", "/"),
    head,
    dirty,
    syncedAt: new Date().toISOString(),
  },
  skill: {
    path: byRole("skill")
      .target.slice(targetRoot.length + 1)
      .replaceAll("\\", "/"),
    sha256: byRole("skill").sha256,
  },
  routing: {
    path: byRole("routing")
      .target.slice(targetRoot.length + 1)
      .replaceAll("\\", "/"),
    sha256: byRole("routing").sha256,
  },
  references: prepared
    .filter((file) => file.role === "reference")
    .map((file) => ({
      id: file.reference.id,
      title: file.reference.title,
      path: file.target.slice(targetRoot.length + 1).replaceAll("\\", "/"),
      sha256: file.sha256,
      priority: file.reference.priority,
      ...(file.reference.always ? { always: true } : {}),
      triggers: file.reference.triggers,
      tags: file.reference.tags,
    })),
  artifacts: prepared
    .filter((file) => ["validator", "test", "agent-config"].includes(file.role))
    .map((file) => ({
      id: file.id,
      kind: file.role,
      path: file.target.slice(targetRoot.length + 1).replaceAll("\\", "/"),
      sha256: file.sha256,
    })),
};
await writeFile(
  resolve(targetRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Synced ${prepared.length} files from ${head}${dirty ? " (dirty)" : ""}; content ${manifest.contentHash}`,
);
