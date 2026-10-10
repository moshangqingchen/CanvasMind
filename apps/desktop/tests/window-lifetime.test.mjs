import test from "node:test";
import assert from "node:assert/strict";
import { liveWindowContents, windowRequestHeaders, TOKEN_HEADER } from "../src/policy.mjs";

const origin = "http://127.0.0.1:3210";
const request = { url: `${origin}/api/projects`, webContentsId: 12, requestHeaders: { Accept: "application/json", "X-SuperCanvas-Desktop-Token": "untrusted" } };
const window = { isDestroyed: () => false, webContents: { id: 12, isDestroyed: () => false } };

test("late session requests after window destruction finish without touching the destroyed native object", () => {
  const destroyed = { isDestroyed: () => true, get webContents() { throw new Error("Object has been destroyed"); } };
  assert.equal(liveWindowContents(destroyed), undefined);
  assert.deepEqual(windowRequestHeaders(request, destroyed, origin, false, "session"), { Accept: "application/json" });
  assert.equal(request.requestHeaders["X-SuperCanvas-Desktop-Token"], "untrusted");
});

test("a destroyed renderer, missing window, or retired renderer cannot receive a session token", () => {
  const destroyedContents = { isDestroyed: () => false, webContents: { isDestroyed: () => true, get id() { throw new Error("retired id"); } } };
  for (const target of [undefined, destroyedContents, { ...window, webContents: { id: 13, isDestroyed: () => false } }])
    assert.deepEqual(windowRequestHeaders(request, target, origin, false, "session"), { Accept: "application/json" });
});

test("only the live current renderer and exact app origin receive the token", () => {
  assert.equal(windowRequestHeaders(request, window, origin, false, "session")[TOKEN_HEADER], "session");
  for (const url of ["https://example.com/api/projects", "http://127.0.0.1:3211/api/projects", "ws://127.0.0.1:3210/_next/hmr"])
    assert.equal(windowRequestHeaders({ ...request, url }, window, origin, false, "session")[TOKEN_HEADER], undefined);
  assert.equal(windowRequestHeaders({ ...request, url: "ws://127.0.0.1:3210/_next/hmr" }, window, origin, true, "session")[TOKEN_HEADER], "session");
});
