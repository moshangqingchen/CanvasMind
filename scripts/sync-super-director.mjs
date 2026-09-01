import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SOURCE = "D:\\创业\\超级导演";
const repositoryRoot = resolve(import.meta.dirname, "..");
const targetRoot = resolve(
  argumentValue("--target") ??
    join(repositoryRoot, "packages", "director", "knowledge"),
);
const skillRoot = join(".agents", "skills", "ai-super-director");

const referenceDefinitions = [
  {
    file: "core-contract.md",
    title: "核心导演契约",
    priority: 1,
    always: true,
    triggers: ["创意", "图片", "视频", "分镜", "故事板"],
    tags: ["core", "safety", "quality"],
  },
  {
    file: "trend-gate.md",
    title: "实时趋势与证据门禁",
    priority: 5,
    triggers: ["创意", "剧情", "广告", "热点", "二创", "趋势"],
    tags: ["research", "trend", "evidence"],
  },
  {
    file: "creative-routing.md",
    title: "创意路由",
    priority: 10,
    triggers: ["创意", "短剧", "广告", "喜剧", "高概念", "改编"],
    tags: ["creative", "story"],
  },
  {
    file: "production-and-generation.md",
    title: "制作与生成",
    priority: 10,
    triggers: ["生图", "图片", "视频", "故事板", "Seedance", "运镜", "速度"],
    tags: ["image", "video", "production", "generation"],
  },
  {
    file: "action-and-fight-direction.md",
    title: "动作与打斗导演",
    priority: 20,
    triggers: ["动作", "打斗", "战斗", "决斗", "追逐", "必杀技", "对轰"],
    tags: ["action", "fight", "camera"],
  },
  {
    file: "dialogue-and-scene-writing.md",
    title: "自然台词与场次",
    priority: 20,
    triggers: ["剧情", "剧本", "对白", "台词", "旁白", "场次"],
    tags: ["dialogue", "scene", "story"],
  },
  {
    file: "rights-and-provenance.md",
    title: "权利与来源",
    priority: 20,
    triggers: ["IP", "真人", "声音", "歌曲", "品牌", "Logo", "商用", "发布"],
    tags: ["rights", "provenance", "safety"],
  },
  {
    file: "video-reference-and-proxy-rerender.md",
    title: "视频参考与代理重渲染",
    priority: 25,
    triggers: ["视频参考", "复刻", "白模", "灰模", "深度视频", "重渲染"],
    tags: ["video", "reference", "rerender"],
  },
  {
    file: "latest-platform-snapshot.md",
    title: "平台资料快照",
    priority: 40,
    triggers: ["平台", "热点", "短视频", "趋势"],
    tags: ["platform", "snapshot"],
  },
  {
    file: "capability-map.md",
    title: "深度能力索引",
    priority: 100,
    triggers: ["深度", "类型", "能力"],
    tags: ["capability", "index"],
  },
];

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(source, ...args) {
  const result = spawnSync("git", ["-C", source, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function copyVerified(sourcePath, targetPath) {
  const content = await readFile(sourcePath, "utf8");
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return sha256(content);
}

const source = resolve(argumentValue("--source") ?? DEFAULT_SOURCE);
const allowDirty = process.argv.includes("--allow-dirty");
const dirty = git(source, "status", "--porcelain").length > 0;
if (dirty && !allowDirty) {
  throw new Error(
    "超级导演源工作树包含未提交改动；确认要同步时显式添加 --allow-dirty",
  );
}

const head = git(source, "rev-parse", "HEAD");
const skillSource = join(source, skillRoot, "SKILL.md");
const skillTarget = join(targetRoot, "skill", "SKILL.md");
const skillHash = await copyVerified(skillSource, skillTarget);

const routingSource = join(
  source,
  "docs",
  "superpowers",
  "capability-routing.json",
);
const routingTarget = join(targetRoot, "routing", "capability-routing.json");
const routingHash = await copyVerified(routingSource, routingTarget);

const references = [];
for (const definition of referenceDefinitions) {
  const sourcePath = join(source, skillRoot, "references", definition.file);
  const targetPath = join(targetRoot, "references", definition.file);
  const hash = await copyVerified(sourcePath, targetPath);
  references.push({
    id: basename(definition.file, ".md"),
    title: definition.title,
    path: `references/${definition.file}`,
    sha256: hash,
    priority: definition.priority,
    ...(definition.always ? { always: true } : {}),
    triggers: definition.triggers,
    tags: definition.tags,
  });
}

const contentHash = sha256(
  JSON.stringify({
    skill: skillHash,
    routing: routingHash,
    references: references.map(({ path, sha256: hash }) => ({
      path,
      sha256: hash,
    })),
  }),
);
const manifest = {
  schemaVersion: 1,
  packageName: "ai-super-director",
  contentHash,
  source: {
    path: source,
    head,
    dirty,
    syncedAt: new Date().toISOString(),
  },
  skill: { path: "skill/SKILL.md", sha256: skillHash },
  routing: {
    path: "routing/capability-routing.json",
    sha256: routingHash,
  },
  references,
};

await mkdir(targetRoot, { recursive: true });
await writeFile(
  join(targetRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      target: relative(repositoryRoot, targetRoot).replaceAll("\\", "/"),
      head,
      dirty,
      contentHash,
      files: references.length + 2,
    },
    null,
    2,
  ),
);
