import { afterEach, describe, expect, it, vi } from "vitest";
import { serverMasterKey, requireServerMasterKey } from "./master-key";
afterEach(() => vi.unstubAllEnvs());
describe("desktop master key", () => {
  it("uses the host-provided key", () => { vi.stubEnv("MASTER_KEY", "host-fixture"); expect(requireServerMasterKey()).toBe("host-fixture"); });
  it("does not load old web env files or invent a production key", () => { vi.stubEnv("MASTER_KEY", ""); vi.stubEnv("NODE_ENV", "production"); expect(serverMasterKey()).toBeUndefined(); expect(() => requireServerMasterKey()).toThrow("MASTER_KEY"); });
});
