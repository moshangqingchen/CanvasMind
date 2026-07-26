import { describe, expect, it } from "vitest";
import { JsonMappingError, readJsonPath, setJsonPointer } from "./json-mapping";

describe("JSON Pointer writes", () => {
  it("creates nested objects and arrays", () => {
    let body: unknown = {};
    body = setJsonPointer(body, "/request/prompt", "draw a fox");
    body = setJsonPointer(
      body,
      "/request/images/0/url",
      "https://assets.test/fox.png",
    );
    expect(body).toEqual({
      request: {
        prompt: "draw a fox",
        images: [{ url: "https://assets.test/fox.png" }],
      },
    });
  });

  it("implements RFC 6901 escaping", () => {
    expect(setJsonPointer({}, "/a~1b/~0key", 3)).toEqual({
      "a/b": { "~key": 3 },
    });
  });

  it("blocks prototype pollution", () => {
    expect(() => setJsonPointer({}, "/__proto__/polluted", true)).toThrow(
      JsonMappingError,
    );
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("safe JSONPath reads", () => {
  const response = {
    task: { id: "task-1" },
    outputs: [{ url: "one.png" }, { url: "two.png" }],
  };

  it("reads properties, indices and wildcards", () => {
    expect(readJsonPath(response, "$.task.id")).toBe("task-1");
    expect(readJsonPath(response, "$.outputs[1].url")).toBe("two.png");
    expect(readJsonPath(response, "$.outputs[*].url")).toEqual([
      "one.png",
      "two.png",
    ]);
  });

  it("rejects executable or recursive expressions", () => {
    expect(() => readJsonPath(response, "$..task")).toThrow(JsonMappingError);
    expect(() => readJsonPath(response, "$.outputs[?(@.url)]")).toThrow(
      JsonMappingError,
    );
    expect(() => readJsonPath(response, "$['__proto__']")).toThrow(
      JsonMappingError,
    );
  });
});
