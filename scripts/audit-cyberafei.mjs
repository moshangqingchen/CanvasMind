import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = resolve(import.meta.dirname, "..");
const envPath = resolve(workspace, ".local-public.env");

for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) continue;
  process.env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
}

const only = process.argv
  .find((value) => value.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const listModels = process.argv.includes("--list-models");

if (
  !listModels &&
  (!process.argv.includes("--confirm-paid") || !only?.length)
) {
  console.error(
    "Refusing to run provider generation checks without both --confirm-paid and an explicit --only=id,... selection.",
  );
  process.exit(2);
}

const [{ getRepository }, { decryptSecret }] = await Promise.all([
  import(pathToFileURL(resolve(workspace, "packages/db/dist/index.js"))),
  import(pathToFileURL(resolve(workspace, "packages/providers/dist/index.js"))),
]);
const require = createRequire(resolve(workspace, "apps/web/package.json"));
const sharp = require("sharp");

const API_BASE = "https://api.3365api.cn";
const IMAGE_GROUP = "image-2稳定生图";
const COMPOSITE_GROUP = "图片视频模型综合分组";
const prompt = "尺寸验证测试：纯白背景中央一个蓝色圆形，无文字。";

const repository = getRepository();
const connections = await repository.listConnections();

function apiKeyFor(group) {
  const connection = connections.find(
    (item) =>
      item.config?.supplierKey === "cyberafei" &&
      item.config?.modelGroup === group &&
      item.encryptedSecret,
  );
  if (!connection) throw new Error(`Missing saved Cyber Afei key for ${group}`);
  return decryptSecret(connection.encryptedSecret, process.env.MASTER_KEY);
}

if (listModels) {
  for (const group of [IMAGE_GROUP, COMPOSITE_GROUP]) {
    const response = await fetch(`${API_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKeyFor(group)}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    const models = Array.isArray(payload?.data)
      ? payload.data
          .map((item) => item?.id)
          .filter((id) => typeof id === "string")
          .filter((id) => /(?:image|banana|grok)/iu.test(id))
          .sort((left, right) => left.localeCompare(right))
      : [];
    console.log(
      JSON.stringify({
        group,
        status: response.status,
        ok: response.ok,
        models,
        message: response.ok ? undefined : providerMessage(payload),
      }),
    );
  }
}

async function imageBytesFromResponse(payload) {
  const item = Array.isArray(payload?.data) ? payload.data[0] : undefined;
  const openAiBase64 = item?.b64_json;
  const openAiUrl = item?.url;
  if (typeof openAiBase64 === "string") {
    return Buffer.from(openAiBase64.replace(/^data:[^,]+,/u, ""), "base64");
  }
  if (typeof openAiUrl === "string") {
    const response = await fetch(new URL(openAiUrl, API_BASE));
    if (!response.ok)
      throw new Error(`Image download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const text = part?.text;
      if (typeof text === "string") {
        const dataUri = /data:image\/[^;]+;base64,([A-Za-z0-9+/=\r\n]+)/u.exec(
          text,
        );
        if (dataUri?.[1]) return Buffer.from(dataUri[1], "base64");
        const compact = text.replace(/\s+/gu, "");
        if (compact.length > 1_000 && /^[A-Za-z0-9+/]+={0,2}$/u.test(compact))
          return Buffer.from(compact, "base64");
        const embeddedBase64 =
          /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{10000,}={0,2})(?:$|[^A-Za-z0-9+/=])/u.exec(
            text,
          );
        if (embeddedBase64?.[1])
          return Buffer.from(embeddedBase64[1], "base64");
        if (/^https?:\/\//iu.test(text.trim())) {
          const response = await fetch(text.trim());
          if (!response.ok)
            throw new Error(
              `Gemini text URL download failed (${response.status})`,
            );
          return Buffer.from(await response.arrayBuffer());
        }
      }
      const inline = part?.inline_data ?? part?.inlineData;
      if (typeof inline?.data === "string")
        return Buffer.from(inline.data.replace(/^data:[^,]+,/u, ""), "base64");
      const file = part?.file_data ?? part?.fileData;
      const url = file?.file_uri ?? file?.fileUri;
      if (typeof url === "string") {
        const response = await fetch(new URL(url, API_BASE));
        if (!response.ok)
          throw new Error(`Gemini image download failed (${response.status})`);
        return Buffer.from(await response.arrayBuffer());
      }
    }
  }
  const chatContent = payload?.choices?.[0]?.message?.content;
  const chatText =
    typeof chatContent === "string"
      ? chatContent
      : Array.isArray(chatContent)
        ? chatContent
            .map((part) =>
              typeof part?.image_url?.url === "string"
                ? part.image_url.url
                : typeof part?.text === "string"
                  ? part.text
                  : "",
            )
            .join("\n")
        : "";
  const chatUrl = /(?:https?:\/\/|data:image\/)[^\s)\]"']+/iu.exec(
    chatText,
  )?.[0];
  if (chatUrl?.startsWith("data:image/")) {
    return Buffer.from(chatUrl.replace(/^data:[^,]+,/u, ""), "base64");
  }
  if (chatUrl) {
    const response = await fetch(chatUrl);
    if (!response.ok)
      throw new Error(`Chat image download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("Provider response did not contain an image");
}

function providerMessage(payload) {
  const value =
    payload?.error?.message ??
    payload?.message ??
    payload?.detail ??
    payload?.error;
  return typeof value === "string" ? value.slice(0, 300) : undefined;
}

function payloadShape(value, depth = 0) {
  if (typeof value === "string") {
    const redactedUrls = value.replace(/https?:\/\/[^\s)\]"']+/giu, (url) => {
      try {
        const parsed = new URL(url);
        return `<url:${parsed.hostname}${parsed.pathname}>`;
      } catch {
        return "<url>";
      }
    });
    return redactedUrls.length > 200
      ? `<string:${redactedUrls.length}>`
      : redactedUrls;
  }
  if (depth > 5) return "<max-depth>";
  if (Array.isArray(value))
    return value.slice(0, 5).map((item) => payloadShape(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [key, payloadShape(item, depth + 1)]),
  );
}

const checks = [
  {
    id: "gpt-image-2",
    name: "gpt-image-2 / 2048x1152",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "gpt-image-2",
      prompt,
      size: "2048x1152",
      quality: "high",
      n: 1,
    },
  },
  {
    id: "gpt-image-2-2k",
    name: "gpt-image-2-2K / 2048x1152",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "gpt-image-2-2K",
      prompt,
      size: "2048x1152",
      quality: "high",
      n: 1,
    },
  },
  {
    id: "gpt-image-2-4k",
    name: "gpt-image-2-4K / 3840x2160",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "gpt-image-2-4K",
      prompt,
      size: "3840x2160",
      quality: "low",
      n: 1,
    },
  },
  {
    id: "gemini-2k-canonical-native",
    name: "Gemini Flash 2K / 16:9",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
      },
    },
  },
  {
    id: "nano-pro-canonical-native",
    name: "Nano Banana Pro native / 4:3 / 4K",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3-pro-image-preview:generateContent",
    expected: "4800x3584",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "4:3", imageSize: "4K" },
      },
    },
  },
  {
    id: "grok-image-square",
    name: "grok-imagine-image / minimal Images API request",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: { model: "grok-imagine-image", prompt },
  },
  {
    id: "grok-unlimited-square",
    name: "grok-imagine-无限 / 1024x1024",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: { model: "grok-imagine-无限", prompt, size: "1024x1024" },
  },
  {
    id: "grok-quality-images",
    name: "grok-imagine-image-quality via Images API / 1024x1024",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "grok-imagine-image-quality",
      prompt,
    },
  },
  {
    id: "gpt-image-4k",
    name: "gpt-image-4K / 3840x2160",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "gpt-image-4K",
      prompt,
      size: "3840x2160",
      quality: "low",
      n: 1,
    },
  },
  {
    id: "gpt-image-4k-4by3",
    name: "gpt-image-4K / 4:3 / 2880x2160",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    expected: "2880x2160",
    body: {
      model: "gpt-image-4K",
      prompt,
      size: "2880x2160",
      quality: "high",
      n: 1,
    },
  },
  {
    id: "gpt-image-2-4k-3by2",
    name: "gpt-image-2-4K / 3:2 / 3240x2160",
    group: IMAGE_GROUP,
    path: "/v1/images/generations",
    expected: "3240x2160",
    body: {
      model: "gpt-image-2-4K",
      prompt,
      size: "3240x2160",
      quality: "high",
      n: 1,
    },
  },
  {
    id: "gemini-preview-native-4k",
    name: "Gemini Flash Preview native / 21:9 / 4K",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    expected: "6336x2688",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "21:9", imageSize: "4K" },
      },
    },
  },
  {
    id: "gemini-fixed-native-4k",
    name: "Gemini Flash 4K alias native / 9:16",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-4k:generateContent",
    expected: "3072x5504",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "9:16", imageSize: "4K" },
      },
    },
  },
  {
    id: "gemini-base-openai-4k",
    name: "Gemini Flash Preview OpenAI / 16:9 / 3840x2160",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    expected: "3840x2160",
    body: {
      model: "gemini-3.1-flash-image-preview",
      prompt,
      size: "3840x2160",
      n: 1,
    },
  },
  {
    id: "gemini-fixed-openai-4k",
    name: "Gemini Flash fixed 4K OpenAI / 1:1 / 2160x2160",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    expected: "2160x2160",
    body: {
      model: "gemini-3.1-flash-image-4k",
      prompt,
      size: "2160x2160",
      n: 1,
    },
  },
  {
    id: "gemini-preview-openai-4k",
    name: "Gemini Flash Preview 4K alias OpenAI / 3:4 / 2160x2880",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    expected: "2160x2880",
    body: {
      model: "gemini-3.1-flash-image-preview-4K",
      prompt,
      size: "2160x2880",
      n: 1,
    },
  },
  {
    id: "gemini-preview-2k-images-minimal",
    name: "Gemini Flash Preview 2K alias Images API minimal",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "gemini-3.1-flash-image-preview-2K",
      prompt,
    },
  },
  {
    id: "gemini-preview-2k-native-alias",
    name: "Gemini Flash Preview 2K alias native",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-preview-2K:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
  },
  {
    id: "nano-pro-openai-4k",
    name: "Nano Banana Pro alias OpenAI / 4:3 / 2880x2160",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    expected: "2880x2160",
    body: {
      model: "nano-banana-pro",
      prompt,
      size: "2880x2160",
      n: 1,
    },
  },
  {
    id: "nano2-openai-4k",
    name: "Nano Banana 2 alias OpenAI / 2:3 / 2160x3240",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    expected: "2160x3240",
    body: {
      model: "nano-banana2",
      prompt,
      size: "2160x3240",
      n: 1,
    },
  },
  {
    id: "gemini-2k-alias-native",
    name: "Gemini 2K alias native / 16:9",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-2k:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
      },
    },
  },
  {
    id: "gemini-1k-alias-native",
    name: "Gemini 1K alias native / 1:1",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-1k:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
      },
    },
  },
  {
    id: "gemini-1k-x-goog-key",
    name: "Gemini 1K alias native with x-goog-api-key / 1:1",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/gemini-3.1-flash-image-1k:generateContent",
    auth: "x-goog-api-key",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
      },
    },
  },
  {
    id: "nano-pro-openai",
    name: "Nano Banana Pro alias OpenAI / 1024x1024",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "nano-banana-pro",
      prompt,
      size: "1024x1024",
      n: 1,
    },
  },
  {
    id: "nano2-openai",
    name: "Nano Banana 2 alias OpenAI minimal",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: {
      model: "nano-banana2",
      prompt,
    },
  },
  {
    id: "nano2-native",
    name: "Nano Banana 2 alias native",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/nano-banana2:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
  },
  {
    id: "nano-pro-alias-native",
    name: "Nano Banana Pro alias native",
    group: COMPOSITE_GROUP,
    path: "/v1beta/models/nano-banana-pro:generateContent",
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
  },
  {
    id: "nano-pro-chat",
    name: "Nano Banana Pro alias OpenAI Chat / 16:9 / 4K target",
    group: COMPOSITE_GROUP,
    path: "/v1/chat/completions",
    body: {
      model: "nano-banana-pro",
      messages: [{ role: "user", content: `${prompt} 输出 16:9 的 4K 图片。` }],
      size: "3840x2160",
      stream: false,
    },
  },
  {
    id: "nano2-chat",
    name: "Nano Banana 2 alias OpenAI Chat / 16:9 / 4K target",
    group: COMPOSITE_GROUP,
    path: "/v1/chat/completions",
    body: {
      model: "nano-banana2",
      messages: [{ role: "user", content: `${prompt} 输出 16:9 的 4K 图片。` }],
      size: "3840x2160",
      stream: false,
    },
  },
  {
    id: "grok-quality-chat",
    name: "Grok Image Quality via marketplace Chat API",
    group: COMPOSITE_GROUP,
    path: "/v1/chat/completions",
    body: {
      model: "grok-imagine-image-quality",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    },
  },
  {
    id: "grok-unlimited-chat",
    name: "Grok Imagine Unlimited via marketplace Chat API",
    group: COMPOSITE_GROUP,
    path: "/v1/chat/completions",
    body: {
      model: "grok-imagine-无限",
      messages: [
        {
          role: "user",
          content: `${prompt} 生成一张 1:1 图片并返回图片。`,
        },
      ],
      temperature: 0.7,
      stream: false,
    },
  },
  {
    id: "veo-lite-chat",
    name: "Veo 3.1 Lite via marketplace Chat API",
    group: COMPOSITE_GROUP,
    kind: "video",
    path: "/v1/chat/completions",
    body: {
      model: "veo3.1-lite",
      messages: [
        {
          role: "user",
          content: "纯白背景中央一个蓝色圆形，镜头保持静止。",
        },
      ],
      duration: 4,
      aspect_ratio: "16:9",
      fps: 24,
      stream: false,
    },
  },
  {
    id: "grok-video15-docs",
    name: "Grok Imagine Video 1.5 via documented Videos API",
    group: COMPOSITE_GROUP,
    kind: "video",
    path: "/v1/videos/generations",
    body: {
      model: "grok-imagine-video-1.5",
      prompt: "让画面中的云层缓慢移动，镜头保持稳定。",
      image: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/320px-Fronalpstock_big.jpg",
      },
      duration: 1,
      aspect_ratio: "16:9",
    },
  },
  {
    id: "grok-unlimited-landscape",
    name: "grok-imagine-无限 / 2048x1152",
    group: COMPOSITE_GROUP,
    path: "/v1/images/generations",
    body: { model: "grok-imagine-无限", prompt, size: "2048x1152" },
  },
];

if (!listModels) {
  for (const check of checks.filter(
    (item) => !only || only.includes(item.id),
  )) {
    const startedAt = Date.now();
    try {
      const apiKey = apiKeyFor(check.group);
      const response = await fetch(`${API_BASE}${check.path}`, {
        method: "POST",
        headers: {
          ...(check.auth === "x-goog-api-key"
            ? { "x-goog-api-key": apiKey }
            : { Authorization: `Bearer ${apiKey}` }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(check.body),
        signal: AbortSignal.timeout(360_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.log(
          JSON.stringify({
            name: check.name,
            status: response.status,
            ok: false,
            message:
              providerMessage(payload) ?? "Provider rejected the request",
            responseShape: payloadShape(payload),
            requestId:
              response.headers.get("x-request-id") ??
              response.headers.get("x-oneapi-request-id") ??
              undefined,
            elapsedMs: Date.now() - startedAt,
          }),
        );
        continue;
      }
      if (check.kind === "video") {
        console.log(
          JSON.stringify({
            name: check.name,
            status: response.status,
            ok: true,
            responseShape: payloadShape(payload),
            elapsedMs: Date.now() - startedAt,
          }),
        );
        continue;
      }
      let image;
      try {
        image = await imageBytesFromResponse(payload);
      } catch (error) {
        console.log(
          JSON.stringify({
            name: check.name,
            status: response.status,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            responseShape: payloadShape(payload),
            elapsedMs: Date.now() - startedAt,
          }),
        );
        continue;
      }
      const metadata = await sharp(image).metadata();
      const actual = `${metadata.width}x${metadata.height}`;
      console.log(
        JSON.stringify({
          name: check.name,
          status: response.status,
          ok: true,
          requested:
            check.body.size ?? check.body.generationConfig?.imageConfig,
          actual,
          expected: check.expected,
          matchesExpected: check.expected
            ? actual === check.expected
            : undefined,
          format: metadata.format,
          bytes: image.byteLength,
          elapsedMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          name: check.name,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt,
        }),
      );
    }
  }
}
