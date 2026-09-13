import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { downloadRemoteArtifact } from "../src/remote-download.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true})));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "canvas-recovered-"));
  directories.push(directory);
  const url = "https://cdn.example.com/original.png";
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const id = createHash("sha256").update(url).digest("hex");
  await writeFile(join(directory, `${id}.bin`), bytes);
  await writeFile(join(directory, `${id}.json`), JSON.stringify({url, contentType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex")}));
  const transport = vi.fn(async () => ({status:403, bytes:new Uint8Array()}));
  const options = {recoveryDirectory:directory, resolve:async()=>[{address:"1.1.1.1",family:4}], transport};
  return {url,bytes,id,directory,transport,options};
}
it("archives the exact staged original without requesting its blocked CDN again", async () => {
  const f = await fixture();
  expect(await downloadRemoteArtifact(f.url, f.options)).toEqual({bytes:new Uint8Array(f.bytes),contentType:"image/png"});
  expect(f.transport).not.toHaveBeenCalled();
  await expect(downloadRemoteArtifact(f.url+"?different-output",f.options)).rejects.toThrow("403");
  expect(f.transport).toHaveBeenCalledOnce();
});
it("rejects oversized or corrupted staged files", async () => {
  const f = await fixture();
  await expect(downloadRemoteArtifact(f.url,{...f.options,maxBytes:2})).rejects.toThrow("exceeds");
  await writeFile(join(f.directory,`${f.id}.bin`),Buffer.from([1,2,3]));
  await expect(downloadRemoteArtifact(f.url,f.options)).rejects.toThrow("checksum");
});
it("retains private network protection even when an original is staged", async () => {
  const f = await fixture();
  await expect(downloadRemoteArtifact(f.url,{...f.options,resolve:async()=>[{address:"127.0.0.1",family:4}]})).rejects.toThrow("private address");
});
