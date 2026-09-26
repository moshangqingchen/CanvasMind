import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "package.json"));
const { load } = createRequire(require.resolve("electron-updater"))("js-yaml");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const config = load(await readFile(join(root, "release/win-unpacked/resources/app-update.yml"), "utf8"));
assert.equal(config.provider, "github");
assert.equal(config.owner, "moshangqingchen");
assert.equal(config.repo, "CanvasMind");
assert.ok(config.updaterCacheDirName);
if (!process.argv.includes("--unpacked")) {
  const latest = load(await readFile(join(root, "release/latest.yml"), "utf8"));
  const name = "SuperCanvas-Setup-" + version + "-x64.exe";
  assert.equal(latest.version, version);
  assert.equal(latest.path, name);
  assert.ok(latest.releaseNotes?.includes(version), "Update metadata must contain this version's release notes");
  const file = await readFile(join(root, "release", name));
  const hash = createHash("sha512").update(file).digest("base64");
  assert.equal(latest.sha512, hash);
  assert.equal(latest.files[0].sha512, hash);
  assert.equal(latest.files[0].size, file.length);
  assert.ok((await stat(join(root, "release", name + ".blockmap"))).size > 0);
}
console.log("Verified packaged GitHub configuration, release notes and update artifacts for " + version);
