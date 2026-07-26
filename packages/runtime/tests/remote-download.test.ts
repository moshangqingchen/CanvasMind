import { describe, expect, it } from "vitest";
import {
  downloadRemoteArtifact,
  isPublicNetworkAddress,
} from "../src/remote-download.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("remote artifact download", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => {
      expect(isPublicNetworkAddress(address)).toBe(true);
    },
  );

  it("rejects unsafe protocols, credentials, and private DNS answers", async () => {
    await expect(downloadRemoteArtifact("file:///etc/passwd")).rejects.toThrow(
      /http or https/u,
    );
    await expect(
      downloadRemoteArtifact("https://user:secret@example.com/file"),
    ).rejects.toThrow(/credentials/u);
    await expect(
      downloadRemoteArtifact("http://metadata.example/file", {
        resolve: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toThrow(/private address/u);
  });

  it("automatically supports HTTPS hostnames behind Fake-IP DNS without allowing unsafe variants", async () => {
    let pinnedAddress = "";
    const result = await downloadRemoteArtifact(
      "https://cdn.provider.example/output.png",
      {
        resolve: async () => [{ address: "198.18.2.17", family: 4 }],
        transport: async (_url, resolved) => {
          pinnedAddress = resolved.address;
          return {
            status: 200,
            contentType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
          };
        },
      },
    );
    expect(pinnedAddress).toBe("198.18.2.17");
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));

    const fakeIpResolver = async () => [{ address: "198.18.2.17", family: 4 }];
    await expect(
      downloadRemoteArtifact("http://cdn.provider.example/output.png", {
        resolve: fakeIpResolver,
      }),
    ).rejects.toThrow(/private address/u);
    await expect(
      downloadRemoteArtifact("https://198.18.2.17/output.png"),
    ).rejects.toThrow(/private address/u);
    await expect(
      downloadRemoteArtifact("https://cdn.provider.example/output.png", {
        resolve: async () => [
          { address: "198.18.2.17", family: 4 },
          { address: "10.0.0.8", family: 4 },
        ],
      }),
    ).rejects.toThrow(/private address/u);
    await expect(
      downloadRemoteArtifact("https://cdn.provider.example/output.png", {
        resolve: async () => [
          { address: "198.18.2.17", family: 4 },
          { address: "93.184.216.34", family: 4 },
        ],
      }),
    ).rejects.toThrow(/private address/u);
  });

  it("allows HTTPS CDN redirects and revalidates DNS on every hop", async () => {
    const resolutions: string[] = [];
    const requests: string[] = [];
    const result = await downloadRemoteArtifact(
      "https://provider.example/output",
      {
        resolve: async (hostname) => {
          resolutions.push(hostname);
          return hostname === "cdn.provider.example"
            ? [{ address: "1.1.1.1", family: 4 }]
            : publicResolver();
        },
        transport: async (url) => {
          requests.push(url.href);
          return url.hostname === "provider.example"
            ? {
                status: 302,
                location: "https://cdn.provider.example/signed/output.png",
                bytes: new Uint8Array(),
              }
            : {
                status: 200,
                contentType: "image/png",
                bytes: new Uint8Array([4, 5, 6]),
              };
        },
      },
    );

    expect(resolutions).toEqual(["provider.example", "cdn.provider.example"]);
    expect(requests).toEqual([
      "https://provider.example/output",
      "https://cdn.provider.example/signed/output.png",
    ]);
    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects private redirect targets after resolving them", async () => {
    let requests = 0;
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        resolve: async (hostname) =>
          hostname === "private.example"
            ? [{ address: "10.0.0.8", family: 4 }]
            : publicResolver(),
        transport: async () => {
          requests += 1;
          return {
            status: 302,
            location: "https://private.example/output",
            bytes: new Uint8Array(),
          };
        },
      }),
    ).rejects.toThrow(/private address/u);
    expect(requests).toBe(1);
  });

  it("rejects HTTPS redirects that downgrade to HTTP", async () => {
    let resolutions = 0;
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        resolve: async () => {
          resolutions += 1;
          return publicResolver();
        },
        transport: async () => ({
          status: 302,
          location: "http://cdn.provider.example/output",
          bytes: new Uint8Array(),
        }),
      }),
    ).rejects.toThrow(/must not downgrade HTTPS/u);
    expect(resolutions).toBe(1);
  });

  it("enforces a total timeout and maximum response size", async () => {
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        timeoutMs: 5,
        resolve: () => new Promise(() => undefined),
      }),
    ).rejects.toThrow(/timed out/u);

    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        maxBytes: 3,
        resolve: publicResolver,
        transport: async () => ({
          status: 200,
          bytes: new Uint8Array([1, 2, 3, 4]),
        }),
      }),
    ).rejects.toThrow(/exceeds 3 bytes/u);
  });
});
