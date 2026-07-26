import { describe, expect, it } from "vitest";
import {
  CredentialError,
  EncryptedSecretStore,
  EncryptedConnectionResolver,
  MemorySecretStore,
  EncryptedConnectionResolver,
  decryptSecret,
  encryptSecret,
  maskSecret,
  redactHeaders,
} from "./credentials";

describe("credential helpers", () => {
  it("round-trips an API key using authenticated encryption", () => {
    const encrypted = encryptSecret(
      "sk-private-value",
      "development-master-key",
    );
    expect(encrypted).not.toContain("sk-private-value");
    expect(decryptSecret(encrypted, "development-master-key")).toBe(
      "sk-private-value",
    );
  });

  it("rejects tampering and the wrong master key", () => {
    const encrypted = encryptSecret("sk-private-value", "correct-key");
    expect(() => decryptSecret(encrypted, "wrong-key")).toThrow(
      CredentialError,
    );
    const parts = encrypted.split(".");
    parts[3] = `${parts[3] ?? ""}x`;
    expect(() => decryptSecret(parts.join("."), "correct-key")).toThrow(
      CredentialError,
    );
  });

  it("masks common credential headers", () => {
    expect(maskSecret("sk-12345678").endsWith("5678")).toBe(true);
    expect(
      redactHeaders({ Authorization: "Bearer secret", Accept: "json" }),
    ).toEqual({
      Authorization: "********cret",
      Accept: "json",
    });
  });

  it("resolves encrypted connection records without storing plaintext", async () => {
    const encrypted = encryptSecret("sk-from-db", "master");
    const resolver = new EncryptedConnectionResolver(
      [{ id: "conn", provider: "openai", encryptedApiKey: encrypted }],
      "master",
    );
    await expect(resolver.resolve("conn")).resolves.toMatchObject({
      id: "conn",
      apiKey: "sk-from-db",
    });
  });

  it("keeps encrypted values in the backing store", async () => {
    const backing = new MemorySecretStore();
    const store = new EncryptedSecretStore(backing, "master-key");
    await store.set("connection", "sk-secret");
    expect(await store.get("connection")).toBe("sk-secret");
    expect(await backing.get("connection")).not.toContain("sk-secret");
  });

  it("does not expose the encrypted-at-rest field to adapters", async () => {
    const encryptedApiKey = encryptSecret("sk-secret", "master-key");
    const resolver = new EncryptedConnectionResolver(
      [{ id: "connection", provider: "fake", encryptedApiKey }],
      "master-key",
    );
    const connection = await resolver.resolve("connection");
    expect(connection.apiKey).toBe("sk-secret");
    expect("encryptedApiKey" in connection).toBe(false);
  });
});
