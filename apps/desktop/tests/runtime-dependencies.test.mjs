import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeLock } from "../scripts/runtime-dependencies.mjs";

test("runtime lock accepts reordered exact dependencies and rejects version or package drift", () => {
  const lock = {
    lockfileVersion: 3,
    packages: { "": { dependencies: { react: "19.2.7", next: "16.3.5" } } },
  };
  assert.doesNotThrow(() =>
    validateRuntimeLock(lock, { next: "16.3.5", react: "19.2.7" }),
  );
  assert.throws(
    () => validateRuntimeLock(lock, { next: "16.3.6", react: "19.2.7" }),
    /desktop:lock/,
  );
  assert.throws(
    () => validateRuntimeLock(lock, { next: "16.3.5" }),
    /desktop:lock/,
  );
  assert.throws(() => validateRuntimeLock({}, {}), /desktop:lock/);
});
