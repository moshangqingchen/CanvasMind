import { describe, expect, it } from "vitest";
import { assertTextModelRequest, makeSecretRedactor } from "./guard";
import { testSelection } from "./test-fixture";
const connection = testSelection().connection;
const init = (body: unknown): RequestInit => ({ method: "POST", redirect: "manual", body: JSON.stringify(body) });
describe("text-only precise selected model boundary", () => {
  it("allows only the selected model and its existing compatibility endpoints", () => {
    for (const suffix of ["chat/completions", "responses"]) {
      expect(assertTextModelRequest(connection, `https://eval-text.invalid/v1/${suffix}`,
        init({ model: connection.model, messages: [{ role: "user", content: "纯文字描述图片，不上传" }] })).body.model).toBe(connection.model);
    }
    for (const url of ["https://other.invalid/v1/chat/completions", "https://eval-text.invalid/v1/images/generations", "https://eval-text.invalid/v1/models", "https://eval-text.invalid/v1/chat/completions?key=x"]) {
      expect(() => assertTextModelRequest(connection, url, init({ model: connection.model }))).toThrow();
    }
    expect(() => assertTextModelRequest(connection, "https://eval-text.invalid/v1/chat/completions", init({ model: "different" }))).toThrow();
  });
  it.each([
    { messages: [{ content: [{ type: "image_url", image_url: { url: "https://example.invalid/image.png" } }] }] },
    { contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: "eA==" } }] }] },
    { input: [{ content: [{ type: "input_file", file_id: "f" }] }] },
    { tools: [{ type: "web_search" }] },
  ])("rejects media/upload/tool payload %#", body => {
    expect(() => assertTextModelRequest(connection, "https://eval-text.invalid/v1/chat/completions", init({ model: connection.model, ...body }))).toThrow();
  });
  it("pins Google model in endpoint and blocks redirects/form bodies", () => {
    const google = { ...connection, model: "models/gemini-exact", protocol: "google-generate-content" as const, baseUrl: "https://eval-text.invalid/v1beta" };
    const url = "https://eval-text.invalid/v1beta/models/gemini-exact:generateContent";
    expect(assertTextModelRequest(google, url, init({ contents: [{ parts: [{ text: "文字" }] }] }))).toBeTruthy();
    expect(assertTextModelRequest(google, url.replace(":generateContent", ":streamGenerateContent?alt=sse"), init({ contents: [{ parts: [{ text: "文字" }] }] }))).toBeTruthy();
    expect(() => assertTextModelRequest(google, url.replace(":generateContent", ":streamGenerateContent?alt=json"), init({}))).toThrow();
    expect(() => assertTextModelRequest(google, url.replace("exact", "other"), init({}))).toThrow();
    expect(() => assertTextModelRequest(google, url, { ...init({}), redirect: "follow" })).toThrow();
    expect(() => assertTextModelRequest(google, url, { method: "POST", redirect: "manual", body: new FormData() })).toThrow();
  });
  it("redacts literal overlapping credentials without regex interpretation", () => {
    expect(makeSecretRedactor(["s[e]cret", "s[e]cret-long"])("s[e]cret-long / s[e]cret")).toBe("[REDACTED] / [REDACTED]");
  });
});
