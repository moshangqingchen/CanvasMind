import { describe, expect, it } from "vitest";
import { requiresPublicReferenceUrls, type ReferenceDeliveryRequest } from "../src/reference-delivery.js";

const descriptor = { id: "fixture", metadata: { remoteMediaUrlsOnly: true } };
const urlConnector = { assetsRequirePublicUrls: true, submit: { path: "/fixture", bodyMode: "json", mappings: [
  { target: "/images", source: { kind: "assets", assetKind: "image" } },
] } };
const choose = (extra: Partial<ReferenceDeliveryRequest> = {}) => requiresPublicReferenceUrls({ provider: "rest", model: "fixture",
  operation: "video.image-to-video", config: { connector: urlConnector }, descriptor, ...extra });

describe("original reference delivery selection", () => {
  it("requires automatic public-link preparation for URL-only inputs", () => {
    expect(choose()).toBe(true);
    expect(choose({ provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "视频SD2.5" },
      model: "SD2.5特价30-10线路二" })).toBe(true);
  });
  it.each(["openai", "rest"])("lets the existing %s Jiasu video adapter upload bytes itself before URL submission", provider => {
    expect(choose({ provider, model: "sd-2.5-J2", config: { baseUrl: "https://ai.jiasuapi.com/v1", connector: urlConnector } })).toBe(false);
    expect(choose({ provider, model: "sd-2.5-J2", config: { baseUrl: "https://custom-gateway.invalid/v1", connector: urlConnector } })).toBe(true);
  });
  it.each(["openai", "rest"])("does not require a public host for exact %s Jijiu high-tier multipart edits", provider => {
    const config = { baseUrl: "https://newapi.jijiucanvas.com/v1", connector: urlConnector };
    expect(choose({ provider, config, operation: "image.edit", model: "gpt-image-2-2K/4K" })).toBe(false);
    expect(choose({ provider, config, operation: "image.edit", model: "gpt-image-2" })).toBe(true);
    expect(choose({ provider, config: { ...config, manualProtocol: true }, operation: "image.edit", model: "gpt-image-2-2K/4K" })).toBe(true);
  });
  it("keeps an explicit paid/manual Jijiu URL binding authoritative", () => {
    const model = "gpt-image-2-2K/4K";
    const config = { baseUrl: "https://newapi.jijiucanvas.com/v1", autoModelInterfaces: { [model]: {
      model: { id: model, operations: ["image.edit"], metadata: { source: "paid-test" } }, connector: urlConnector,
    } } };
    expect(choose({ provider: "openai", config, operation: "image.edit", model })).toBe(true);
  });
  it("keeps a paid connector model authoritative even when the older catalog row is automatic", () => {
    const model = "gpt-image-2-2K/4K";
    const config = { baseUrl: "https://newapi.jijiucanvas.com/v1", connector: { ...urlConnector,
      models: [{ id: model, metadata: { source: "paid-test" } }] } };
    expect(choose({ provider: "openai", config, operation: "image.edit", model })).toBe(true);
  });
  it.each(["multipart", "gemini-part", "gemini-inline-part"])("allows selected %s bytes despite legacy group and metadata URL flags", transport => {
    const connector = { ...urlConnector, submit: { ...urlConnector.submit,
      bodyMode: transport === "multipart" ? "multipart" : "json", mappings: [{ target: "/references", source: { kind: "assets",
        ...(transport === "multipart" ? {} : { encoding: transport }) } }] } };
    expect(choose({ config: { connector } })).toBe(false);
  });
  it("checks the selected model/operation override rather than the base group's JSON transport", () => {
    const connector = { ...urlConnector, modelOverrides: { fixture: { operationOverrides: { "image.edit": {
      submit: { ...urlConnector.submit, bodyMode: "multipart" },
    } } } } };
    expect(choose({ config: { connector }, operation: "image.edit" })).toBe(false);
    expect(choose({ config: { connector }, operation: "video.image-to-video" })).toBe(true);
  });
  it("does not treat an unencoded JSON image mapping as base64 support", () => {
    expect(choose()).toBe(true);
    expect(choose({ maskRequiresUrl: true, config: { connector: { ...urlConnector, submit: { ...urlConnector.submit, bodyMode: "multipart" } } } })).toBe(true);
  });
  it("uses current native WAN files but retains SD URL requirements despite stale multipart templates", () => {
    const config = { baseUrl: "https://newapi.jijiucanvas.com/v1", connector: { ...urlConnector, submit: { ...urlConnector.submit, bodyMode: "multipart" } } };
    expect(choose({ config, model: "wan3.0-video" })).toBe(false);
    expect(choose({ config, model: "SD2.5特价30-10线路二" })).toBe(true);
    expect(choose({ config, model: "wan3.0-video", maskRequiresUrl: true })).toBe(true);
  });
  it("keeps an explicit WAN URL binding instead of replacing it with native multipart", () => {
    const model = "wan3.0-video";
    const config = { baseUrl: "https://newapi.jijiucanvas.com/v1", autoModelInterfaces: { [model]: {
      model: { id: model, operations: ["video.image-to-video"], metadata: { source: "paid-test" } }, connector: urlConnector,
    } } };
    expect(choose({ provider: "openai", config, model })).toBe(true);
  });
  it("preserves a Miaowu custom multipart connector instead of imposing the native directory URL route", () => {
    const model = "dreamina-seedance-2.0-fast";
    const config = { baseUrl: "https://api.miaowuai.store/v1", connector: { ...urlConnector,
      submit: { ...urlConnector.submit, path: "/custom-documented-edits", bodyMode: "multipart" },
      output: { path: "$.url", kind: "video" } } };
    expect(choose({ config, model, descriptor: { id: model, metadata: { remoteMediaUrlsOnly: true } } })).toBe(false);
  });
  it("respects a saved native-byte binding ahead of an old OpenAI metadata label", () => {
    const model = "fixture";
    const config = { autoModelInterfaces: { [model]: { model: { id: model, operations: ["video.image-to-video"] },
      connector: { ...urlConnector, submit: { ...urlConnector.submit, bodyMode: "multipart" } } } } };
    expect(choose({ provider: "openai", config })).toBe(false);
  });
  it("lets Langframe's own uploader handle references without a separate public host", () => {
    expect(choose({ provider: "langframe", config: { baseUrl: "https://vipprompt.cn/v1" } })).toBe(false);
  });
});
