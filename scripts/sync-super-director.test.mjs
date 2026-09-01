import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve(import.meta.dirname, "sync-super-director.mjs");
const skillRoot = join(".agents", "skills", "ai-super-director");
const references = [
  "core-contract.md",
  "trend-gate.md",
  "creative-routing.md",
  "production-and-generation.md",
  "action-and-fight-direction.md",
  "dialogue-and-scene-writing.md",
  "rights-and-provenance.md",
  "video-reference-and-proxy-rerender.md",
  "latest-platform-snapshot.md",
  "capability-map.md",
];

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

test("knowledge sync refuses dirty sources unless explicitly audited", async () => {
  const root = await mkdtemp(join(tmpdir(), "super-director-sync-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source, { recursive: true });
  assert.equal(run("git", ["init"], source).status, 0);
  assert.equal(
    run("git", ["config", "user.email", "director-test@example.test"], source)
      .status,
    0,
  );
  assert.equal(
    run("git", ["config", "user.name", "Director Test"], source).status,
    0,
  );
  await write(join(source, skillRoot, "SKILL.md"), "# AI 超级导演\n");
  for (const reference of references) {
    await write(
      join(source, skillRoot, "references", reference),
      `# ${reference}\n`,
    );
  }
  await write(
    join(source, "docs", "superpowers", "capability-routing.json"),
    '{"schemaVersion":1}\n',
  );
  assert.equal(run("git", ["add", "."], source).status, 0);
  assert.equal(run("git", ["commit", "-m", "fixture"], source).status, 0);
  await write(join(source, skillRoot, "SKILL.md"), "# AI 超级导演\n\nDirty\n");

  const refused = run(
    process.execPath,
    [script, "--source", source, "--target", target],
    source,
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /--allow-dirty/u);

  const allowed = run(
    process.execPath,
    [script, "--source", source, "--target", target, "--allow-dirty"],
    source,
  );
  assert.equal(allowed.status, 0, allowed.stderr);
  const manifest = JSON.parse(
    await readFile(join(target, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.source.dirty, true);
  assert.match(manifest.source.head, /^[a-f0-9]{40}$/u);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.references.length, references.length);
});
