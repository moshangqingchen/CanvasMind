import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createDesignDelivery, DELIVERY_CHECKS } from "./design-delivery";
import type { AssetView } from "../components/types";

it("delivers the exact original bytes and checked requirements without private config", async () => {
  const bytes = await readFile(
    new URL("../../assets/icon.png", import.meta.url),
  );
  const asset: AssetView = {
    id: "image",
    name: "../../客户图.png",
    kind: "image",
    mimeType: "image/png",
    size: bytes.length,
    storageKey: "private",
    createdAt: "2026-09-27T00:00:00Z",
    metadata: {
      secret: "secret",
      imageDesignReview: {
        status: "approved",
        note: "客户已确认",
        revision: 1,
        updatedAt: "2026-09-27T00:00:00Z",
      },
    },
  };
  const input = {
    asset,
    dimensions: { width: 512, height: 512 },
    checks: DELIVERY_CHECKS.map(([key]) => key),
    fetchOriginal: async () => new Response(bytes),
  };
  const blob = await createDesignDelivery(input);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(entries).sort()).toEqual(["delivery.json", "final.png"]);
  expect(Buffer.from(entries["final.png"]!)).toEqual(bytes);
  const manifest = strFromU8(entries["delivery.json"]!);
  expect(manifest).not.toContain("secret");
  expect(JSON.parse(manifest).checks).toHaveLength(4);
  await expect(createDesignDelivery({ ...input, checks: [] })).rejects.toThrow(
    "全部交付检查",
  );
  await expect(
    createDesignDelivery({
      ...input,
      asset: { ...asset, size: bytes.length + 1 },
    }),
  ).rejects.toThrow("原图不完整");
});
