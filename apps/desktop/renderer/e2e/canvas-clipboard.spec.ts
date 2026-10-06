import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
// These valid 1px PNGs have different pixels and bytes, but identical lengths.
const RED_PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const BLUE_PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYPj/HwADAgH/xCAAOgAAAABJRU5ErkJggg==",
  "base64",
);

interface ClipboardImage {
  base64: string;
  name: string;
  lastModified: number;
}

interface ClipboardCanvas {
  id: string;
  uploads: Array<{ id: string }>;
}

interface SavedCanvas {
  graph: {
    nodes: Array<{
      data: { nodeType?: string; assetKind?: string; assetId?: string };
    }>;
  };
}

const test = base.extend<{ clipboardCanvas: ClipboardCanvas }>({
  clipboardCanvas: async ({ page, request }, yieldCanvas) => {
    const id = `clipboard-regression-${randomUUID()}`;
    const created = await request.post("/api/canvas", {
      data: {
        id,
        title: id,
        graph: {
          schemaVersion: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [],
          edges: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const uploads: ClipboardCanvas["uploads"] = [];
    page.on("request", (event) => {
      const url = new URL(event.url());
      if (url.pathname !== "/api/assets/upload" || event.method() !== "POST")
        return;
      uploads.push({ id: url.searchParams.get("id")! });
    });
    try {
      await page.goto(`/canvas/${id}`);
      await expect(page.locator(".react-flow__pane")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "返回主界面", exact: true }),
      ).toBeEnabled();
      await yieldCanvas({ id, uploads });
    } finally {
      await page.close();
      await request.delete(`/api/projects/${id}`);
      await Promise.all(
        uploads.map((upload) => request.delete(`/api/assets/${upload.id}`)),
      );
    }
  },
});

async function pasteImages(
  page: Page,
  images: ClipboardImage[],
  source: "files" | "different-wrappers" | "items-only" = "files",
) {
  return page.evaluate(
    ({ images, source }) => {
      const transfer = new DataTransfer();
      const items: Array<{ kind: string; getAsFile: () => File | null }> = [];
      for (const image of images) {
        const bytes = Uint8Array.from(atob(image.base64), (value) =>
          value.charCodeAt(0),
        );
        const file = new File([bytes], image.name, {
          type: "image/png",
          lastModified: image.lastModified,
        });
        transfer.items.add(file);
        let itemFile = file;
        if (source === "different-wrappers") {
          // Chromium can expose the same bitmap with freshly created File
          // wrappers. Its two clipboard views need not share lastModified.
          itemFile = new File([bytes], image.name, {
            type: "image/png",
            lastModified: image.lastModified + 100,
          });
        }
        items.push({ kind: "file", getAsFile: () => itemFile });
      }
      if (source === "items-only") {
        items.push({ kind: "string", getAsFile: () => null });
      }
      // Native DataTransferItemList access can return a new item wrapper each
      // time. Use stable items to model the browser's two clipboard projections.
      const clipboardData = {
        files: source === "items-only" ? new DataTransfer().files : transfer.files,
        items,
        getData: (type: string) => transfer.getData(type),
      };
      const fileMetadata = Array.from(clipboardData.files, (file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      }));
      const itemMetadata = clipboardData.items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        }));
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      window.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        fileMetadata,
        itemMetadata,
      };
    },
    { images, source },
  );
}

async function expectOriginals(
  request: APIRequestContext,
  canvas: ClipboardCanvas,
  expected: Buffer[],
) {
  const originals = await Promise.all(
    canvas.uploads.map(async (upload) => {
      const content = await request.get(`/api/assets/${upload.id}/content`);
      expect(content.ok()).toBeTruthy();
      return (await content.body()).toString("base64");
    }),
  );
  expect(originals.sort()).toEqual(
    expected.map((bytes) => bytes.toString("base64")).sort(),
  );
}

async function expectImportedImages(
  page: Page,
  request: APIRequestContext,
  canvas: ClipboardCanvas,
  count: number,
) {
  const nodes = page.locator(
    '.react-flow__node:has(.node-card[data-node-type="asset-input"])',
  );
  await expect(nodes).toHaveCount(count);
  await expect(
    nodes.locator('.node-card[data-pending-import="true"]'),
  ).toHaveCount(0);
  expect(canvas.uploads).toHaveLength(count);
  expect(new Set(canvas.uploads.map((upload) => upload.id)).size).toBe(count);
  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvas.id}`);
      expect(response.ok()).toBeTruthy();
      const saved = (await response.json()) as SavedCanvas;
      return saved.graph.nodes
        .filter(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.assetKind === "image",
        )
        .map((node) => node.data.assetId)
        .sort();
    })
    .toEqual(canvas.uploads.map((upload) => upload.id).sort());
}

test("同一剪贴板图片的 files/items 时间戳不同，一次粘贴只导入一次且允许再次粘贴", async ({
  page,
  request,
  clipboardCanvas,
}) => {
  const image = {
    base64: PNG_1X1.toString("base64"),
    name: "image.png",
    lastModified: 1_700_000_000_000,
  };
  for (const count of [1, 2]) {
    const pasted = await pasteImages(page, [image], "different-wrappers");
    expect(pasted.defaultPrevented).toBe(true);
    expect(pasted.fileMetadata).toHaveLength(1);
    expect(pasted.itemMetadata).toEqual([
      { ...pasted.fileMetadata[0], lastModified: image.lastModified + 100 },
    ]);
    await expectImportedImages(page, request, clipboardCanvas, count);
    await expectOriginals(request, clipboardCanvas, Array(count).fill(PNG_1X1));
  }
});

test("同名同大小同时间戳的不同图片均保留", async ({
  page,
  request,
  clipboardCanvas,
}) => {
  expect(RED_PNG_1X1.length).toBe(BLUE_PNG_1X1.length);
  expect(RED_PNG_1X1.equals(BLUE_PNG_1X1)).toBe(false);
  const pasted = await pasteImages(
    page,
    [RED_PNG_1X1, BLUE_PNG_1X1].map((bytes) => ({
      base64: bytes.toString("base64"),
      name: "reference.png",
      lastModified: 1_700_000_000_000,
    })),
  );
  expect(pasted.defaultPrevented).toBe(true);
  expect(pasted.fileMetadata).toHaveLength(2);
  expect(pasted.fileMetadata[0]).toEqual(pasted.fileMetadata[1]);
  await expectImportedImages(page, request, clipboardCanvas, 2);
  await expectOriginals(request, clipboardCanvas, [RED_PNG_1X1, BLUE_PNG_1X1]);
});

test("files 为空时从 items 导入图片并忽略文本条目", async ({
  page,
  request,
  clipboardCanvas,
}) => {
  const pasted = await pasteImages(
    page,
    [{
      base64: PNG_1X1.toString("base64"),
      name: "fallback.png",
      lastModified: 1_700_000_000_000,
    }],
    "items-only",
  );
  expect(pasted.defaultPrevented).toBe(true);
  expect(pasted.fileMetadata).toEqual([]);
  expect(pasted.itemMetadata).toHaveLength(1);
  await expectImportedImages(page, request, clipboardCanvas, 1);
  await expectOriginals(request, clipboardCanvas, [PNG_1X1]);
});
