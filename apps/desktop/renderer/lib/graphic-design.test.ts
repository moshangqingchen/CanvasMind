import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { AssetView } from "../components/types";
import { normalizedParametersForModel } from "./model-parameters";
import {
  createDefaultGraphicDesignBrief,
  createGraphicDesignDraft,
  graphicDesignFormats,
  graphicDesignLayout,
  graphicDesignLayoutNotice,
  graphicDesignModelAllowed,
  graphicDesignReferenceLimit,
  type GraphicDesignBrief,
} from "./graphic-design";

const model: ModelDescriptor = {
  id: "gpt-image-2",
  name: "Image 2",
  operations: ["image.generate", "image.edit"],
  inputKinds: ["text", "image[]"],
  outputKinds: ["image"],
  limits: { maxInputImages: 3 },
  parameters: [
    {
      key: "size",
      label: "尺寸",
      control: "select",
      default: "1024x1024",
      options: [
        { label: "方形", value: "1024x1024" },
        { label: "竖版", value: "1024x1536" },
      ],
    },
    {
      key: "aspect_ratio",
      label: "比例",
      control: "select",
      options: [
        { label: "自动", value: "auto" },
        { label: "横向", value: "16:9" },
      ],
    },
    {
      key: "quality",
      label: "质量",
      control: "select",
      default: "high",
      options: [{ label: "高", value: "high" }],
    },
    { key: "n", label: "数量", control: "number", default: 4, min: 1, max: 4 },
  ],
};
const assets: AssetView[] = ["subject", "logo", "source", "style"].map(
  (name) => ({
    id: `asset-${name}`,
    name,
    kind: "image",
    mimeType: "image/png",
    size: 100,
    storageKey: `${name}.png`,
    metadata: {},
    createdAt: "2026-09-20T00:00:00Z",
  }),
);
const base = () => ({
  ...createDefaultGraphicDesignBrief(),
  headline: "秋日生活节",
});
function draft(
  brief: GraphicDesignBrief = base(),
  selectedModel = model,
  selectedAssets = assets,
) {
  return createGraphicDesignDraft({
    brief,
    model: selectedModel,
    assets: selectedAssets,
    connection: { id: "selected-connection", provider: "openai" },
    position: { x: 50, y: 100 },
  });
}

function generatedPrompts(result: ReturnType<typeof draft>) {
  return result.nodes
    .filter(({ id }) => result.generationNodeIds.includes(id))
    .map((node) => {
      const part = node.data.parts?.[0];
      if (part?.type !== "text") throw new Error("Missing prompt");
      return part.text;
    });
}

describe("graphic design drafts", () => {
  it("offers only model-declared dimensions and ratios, without inventing options for unknown controls", () => {
    expect(graphicDesignFormats(model, "openai")).toEqual([
      { id: "model-default", label: "模型默认尺寸", parameters: {} },
      {
        id: "size:1024x1024",
        label: "方形",
        parameters: { size: "1024x1024" },
      },
      {
        id: "size:1024x1536",
        label: "竖版",
        parameters: { size: "1024x1536" },
      },
      {
        id: "aspect_ratio:16:9",
        label: "横向",
        parameters: { aspect_ratio: "16:9" },
      },
    ]);
    for (const unknown of [
      { ...model, parameters: undefined },
      { ...model, parameters: [] },
      { ...model, metadata: { parameterControlsUnavailable: true } },
      {
        ...model,
        parameters: model.parameters!.map((descriptor) => ({
          ...descriptor,
          operations: ["video.generate"] as const,
        })),
      },
    ])
      expect(graphicDesignFormats(unknown, "openai")).toEqual([
        { id: "model-default", label: "模型默认尺寸", parameters: {} },
      ]);
    expect(
      graphicDesignFormats(
        {
          ...model,
          parameters: [
            {
              key: "size",
              label: "分辨率档位",
              control: "select",
              options: [
                { label: "2K", value: "2K" },
                { label: "坏数据", value: "0x-100" },
              ],
            },
          ],
        },
        "rest",
      ),
    ).toHaveLength(1);
  });

  it("requires declared image operations and an available Image 2 model, permitting fake only on the fake provider", () => {
    for (const id of [
      "gpt-image-2",
      "gpt-image-2-4k",
      "gpt-image-2.5-flare-adobe",
      "AZ-gpt-image-2.5-sunburst",
      "gpt-image-2自由传参",
      "gpt-image-2::4k",
    ])
      expect(graphicDesignModelAllowed({ ...model, id })).toBe(true);
    for (const invalid of [
      { ...model, id: "gpt-image-1" },
      { ...model, id: "gpt-image-20" },
      { ...model, id: "nano-banana-pro" },
      { ...model, id: "fake-image-v1" },
      { ...model, operations: [] },
      { ...model, operations: ["video.generate"] as const },
      { ...model, metadata: { canvasRunnable: false } },
      { ...model, metadata: { modality: "video" } },
      { ...model, outputKinds: ["video"] as const },
    ])
      expect(graphicDesignModelAllowed(invalid, "openai")).toBe(false);
    expect(
      graphicDesignModelAllowed({ ...model, id: "fake-image-v1" }, "fake"),
    ).toBe(true);
  });

  it("builds six independently editable designs from an immutable brief with exact copy and fixed references", () => {
    const brief: GraphicDesignBrief = {
      ...base(),
      headline: "秋日生活节 · 第 2 回",
      subheadline: "欢迎你\n也欢迎小狗！",
      body: "入场 ¥ 20，儿童免费。",
      eventDate: "10 月 3 日 14:00–18:00",
      location: "青禾广场",
      callToAction: "现场见",
      brandName: "青禾",
      brandColors: "#123456 / 米白",
      constraints: "品牌标志放在右上角",
      references: [
        { assetId: assets[0]!.id, role: "subject" },
        { assetId: assets[1]!.id, role: "logo" },
      ],
      variantCount: 3,
      formatIds: ["size:1024x1536", "aspect_ratio:16:9"],
    };
    const before = structuredClone({ brief, model, assets });
    const result = draft(brief);
    const generated = result.nodes.filter(({ id }) =>
      result.generationNodeIds.includes(id),
    );
    expect(generated).toHaveLength(6);
    expect(result.nodes).toHaveLength(8);
    expect(result.edges).toHaveLength(12);
    expect(new Set(result.nodes.map(({ id }) => id)).size).toBe(8);
    for (const node of generated) {
      expect(node.data).toMatchObject({
        provider: "openai",
        connectionId: "selected-connection",
        model: "gpt-image-2",
        graphicDesignBrief: brief,
      });
      expect(node.data.parameters?.n).toBe(1);
      expect(node.data.parameters?.quality).toBe("high");
      const text = node.data.parts?.[0];
      expect(text?.type).toBe("text");
      if (text?.type !== "text") throw new Error("Missing prompt");
      for (const value of [
        brief.headline,
        brief.subheadline,
        brief.body,
        brief.eventDate,
        brief.location,
        brief.callToAction,
        brief.brandName,
        brief.brandColors,
        brief.constraints,
      ])
        expect(text.text).toContain(value);
      expect(text.text).toContain("参考图 1（主体素材）");
      expect(text.text).toContain("参考图 2（品牌标志）");
      expect(
        result.edges
          .filter(({ target }) => target === node.id)
          .map(
            ({ source }) =>
              result.nodes.find(({ id }) => id === source)?.data.assetId,
          ),
      ).toEqual([assets[0]!.id, assets[1]!.id]);
    }
    expect(generated[0]!.data.parameters).toEqual({
      size: "1024x1536",
      quality: "high",
      n: 1,
    });
    expect(generated[3]!.data.parameters).toEqual({
      aspect_ratio: "16:9",
      quality: "high",
      n: 1,
    });
    expect(generated[0]!.data.parts).not.toEqual(generated[1]!.data.parts);
    expect({ brief, model, assets }).toEqual(before);
    (generated[0]!.data.graphicDesignBrief as GraphicDesignBrief).headline =
      "仅改此节点";
    expect(
      (generated[1]!.data.graphicDesignBrief as GraphicDesignBrief).headline,
    ).toBe(brief.headline);
    expect(draft(brief).generationNodeIds[0]).not.toBe(
      result.generationNodeIds[0],
    );
    for (let left = 0; left < result.nodes.length; left += 1) {
      for (let right = left + 1; right < result.nodes.length; right += 1) {
        const a = result.nodes[left]!;
        const b = result.nodes[right]!;
        expect(
          a.position.x + Number(a.style!.width) <= b.position.x ||
            b.position.x + Number(b.style!.width) <= a.position.x ||
            a.position.y + Number(a.style!.height) <= b.position.y ||
            b.position.y + Number(b.style!.height) <= a.position.y,
        ).toBe(true);
      }
    }
  });

  it("preserves a source image for revision without forcing unrelated variant layout changes", () => {
    const brief: GraphicDesignBrief = {
      ...base(),
      headline: "",
      mode: "revise",
      revisionInstruction: "只把标题改为「冬日生活节」，其他不动",
      references: [{ assetId: assets[2]!.id, role: "source" }],
    };
    const result = draft(brief);
    expect(result.nodes[0]!.data.assetId).toBe(assets[2]!.id);
    const prompt = result.nodes[1]!.data.parts?.[0];
    expect(prompt).toMatchObject({
      type: "text",
      text: expect.stringContaining(brief.revisionInstruction),
    });
    if (prompt?.type !== "text") throw new Error("Missing prompt");
    expect(prompt.text).toContain("待修改原图");
    expect(prompt.text).not.toContain("非对称构图");
    expect(() => draft({ ...brief, references: [] })).toThrow("待修改原图");
    expect(() => draft({ ...brief, revisionInstruction: " " })).toThrow(
      "修改要求",
    );
  });

  it("rejects missing or incompatible assets and respects model reference and mime limits", () => {
    const referenceBrief = {
      ...base(),
      references: [{ assetId: assets[0]!.id, role: "subject" as const }],
    };
    expect(graphicDesignReferenceLimit(model)).toBe(3);
    expect(
      graphicDesignReferenceLimit({
        ...model,
        limits: { maxInputImages: 9, maxInputAssets: 1 },
      }),
    ).toBe(1);
    expect(() => draft(referenceBrief, model, [])).toThrow("参考图已不可用");
    expect(() =>
      draft(referenceBrief, model, [{ ...assets[0]!, kind: "video" }]),
    ).toThrow("参考图已不可用");
    expect(() =>
      draft(referenceBrief, { ...model, operations: ["image.generate"] }),
    ).toThrow("不支持参考图");
    expect(() =>
      draft(referenceBrief, { ...model, inputKinds: ["text"] }),
    ).toThrow("不支持参考图");
    expect(() =>
      draft(referenceBrief, {
        ...model,
        limits: { supportedMimeTypes: ["image/jpeg"] },
      }),
    ).toThrow("格式");
    expect(() =>
      draft({
        ...referenceBrief,
        references: [
          ...referenceBrief.references,
          ...referenceBrief.references,
        ],
      }),
    ).toThrow("只能选择一次");
    expect(() =>
      draft({
        ...base(),
        references: assets.map(({ id }) => ({ assetId: id, role: "style" })),
      }),
    ).toThrow("3 张");
    expect(() =>
      draft(base(), { ...model, limits: { requiresInputImage: true } }),
    ).toThrow("至少一张");
    expect(() =>
      draft(base(), { ...model, operations: ["image.edit"] }),
    ).toThrow("设计方式");
  });

  it("validates selected formats, operation-specific controls, output bounds and prompt limits before any graph mutation", () => {
    expect(() => draft({ ...base(), headline: " " })).toThrow("主标题");
    expect(() =>
      draft({
        ...base(),
        variantCount: 3,
        formatIds: ["model-default", "size:1024x1024", "size:1024x1536"],
      }),
    ).toThrow("1–6");
    expect(() => draft({ ...base(), formatIds: ["size:9999x9999"] })).toThrow(
      "不受当前模型支持",
    );
    expect(() =>
      draft({ ...base(), formatIds: ["model-default", "model-default"] }),
    ).toThrow("重复选择");
    expect(() =>
      draft(base(), { ...model, limits: { maxPromptCharacters: 100 } }),
    ).toThrow("100 字符");
    expect(() =>
      draft(base(), { ...model, metadata: { fixedOutputCount: 4 } }),
    ).toThrow("单张方案");
    expect(() =>
      draft(
        {
          ...base(),
          formatIds: ["size:1024x1536"],
          references: [{ assetId: assets[0]!.id, role: "subject" }],
        },
        {
          ...model,
          parameters: model.parameters!.map((descriptor) =>
            descriptor.key === "size"
              ? { ...descriptor, operations: ["image.generate"] }
              : descriptor,
          ),
        },
      ),
    ).toThrow("不支持当前");
  });

  it("omits output count for fixed-output models and all fabricated parameters for unspecified controls", () => {
    const fixed = draft(base(), {
      ...model,
      metadata: { fixedOutputCount: 1 },
    });
    expect(fixed.nodes[0]!.data.parameters).toEqual({
      size: "1024x1024",
      quality: "high",
    });
    expect(
      draft(base(), { ...model, parameters: undefined }).nodes[0]!.data
        .parameters,
    ).toEqual({});
    expect(createDefaultGraphicDesignBrief().references).not.toBe(
      createDefaultGraphicDesignBrief().references,
    );
  });

  it("keeps selected aspect ratio through run normalization, hides conflicting aliases and retains known dimension tiers", () => {
    for (const key of ["aspect_ratio", "aspectRatio", "ratio"]) {
      const aliased: ModelDescriptor = {
        ...model,
        parameters: [
          model.parameters![0]!,
          {
            key,
            label: "比例",
            control: "select",
            default: "1:1",
            options: [
              { label: "方形", value: "1:1" },
              { label: "竖版", value: "3:4" },
            ],
          },
        ],
      };
      expect(
        graphicDesignFormats(aliased, "rest").some(
          ({ id }) => id === `${key}:3:4`,
        ),
      ).toBe(key === "aspect_ratio");
      const ratioOnly = { ...aliased, parameters: [aliased.parameters![1]!] };
      expect(
        graphicDesignFormats(ratioOnly, "rest").some(
          ({ id }) => id === `${key}:3:4`,
        ),
      ).toBe(true);
      const ratioModel = key === "aspect_ratio" ? aliased : ratioOnly;
      const ratioDraft = draft(
        { ...base(), formatIds: [`${key}:3:4`] },
        ratioModel,
      ).nodes[0]!.data.parameters;
      expect(ratioDraft).toEqual({ [key]: "3:4" });
      expect(
        normalizedParametersForModel(
          "image-generation",
          "openai",
          ratioModel,
          ratioDraft,
        ),
      ).toEqual(ratioDraft);
      expect(
        draft({ ...base(), formatIds: ["size:1024x1536"] }, aliased).nodes[0]!
          .data.parameters,
      ).toEqual({ size: "1024x1536" });
    }
    const tiered: ModelDescriptor = {
      ...model,
      parameters: [
        {
          key: "size",
          label: "尺寸",
          control: "dimensions",
          default: "auto",
          options: [
            { label: "自动", value: "auto" },
            { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" },
            { label: "4K · 1:1 · 3072 × 3072", value: "3072x3072" },
          ],
        },
      ],
    };
    expect(
      draft({ ...base(), formatIds: ["size:2048x2048"] }, tiered).nodes[0]!.data
        .parameters,
    ).toEqual({ size: "2048x2048", size_tier: "2K" });
  });

  it("preserves every original character in each variant, with extracted fields as suggestions only", () => {
    const customerText =
      "  客户原话：\n活动：春日集市\r\n时间：10:00—18:00，免费入场！\n电话：001-020-003\n要求：底色绿色，不能省略上面任何文字。\n  ";
    const brief: GraphicDesignBrief = {
      ...base(),
      headline: "自动提取的分类建议",
      customerText,
      variantCount: 3,
      formatIds: ["size:1024x1024", "size:1024x1536"],
    };
    const before = structuredClone(brief);
    const prompts = generatedPrompts(draft(brief));
    expect(prompts).toHaveLength(6);
    for (const prompt of prompts) {
      expect(prompt).toContain(
        `客户文字原文开始（以下内容原样保留）：\n${customerText}\n客户文字原文结束。`,
      );
      expect(prompt).toContain("不得替代、删减、概括、缩写或擅自改写");
      expect(prompt).toContain("不作为画面文案印出来");
      expect(prompt).toContain("结构化字段仅为排版分类建议");
    }
    expect(brief).toEqual(before);
    expect(() => draft({ ...brief, headline: "" })).not.toThrow();
    expect(() =>
      draft(brief, { ...model, limits: { maxPromptCharacters: 500 } }),
    ).toThrow("原文未删减，请拆分");
    expect(brief.customerText).toBe(customerText);
    expect(
      generatedPrompts(draft({ ...base(), customerText: " \r\n " }))[0],
    ).toContain("原样保留）：\n \r\n \n客户文字原文结束。");
  });

  it("retains confirmed image transcripts verbatim and archives OCR sources without sending them as art references", () => {
    const text = "  设计内容\n第一行\r\n第二行　　¥99.00\n ";
    const brief: GraphicDesignBrief = {
      ...base(),
      headline: "",
      customerImageAssetIds: [assets[0]!.id, assets[1]!.id],
      customerImages: [
        { assetId: assets[1]!.id, text: "图片二原文", warnings: [] },
        { assetId: assets[0]!.id, text, warnings: ["用户已核对该行"] },
      ],
      customerConfirmed: true,
    };
    const result = draft(brief, {
      ...model,
      operations: ["image.generate"],
      inputKinds: ["text"],
    });
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toEqual([]);
    expect(result.nodes.slice(0, 2).map((node) => node.data.assetId)).toEqual(
      brief.customerImageAssetIds,
    );
    expect(result.nodes[0]!.data.graphicDesignCustomerSource).toBe(true);
    expect(result.nodes[2]!.position.x).toBeGreaterThan(
      result.nodes[0]!.position.x + 300,
    );
    const prompt = generatedPrompts(result)[0]!;
    expect(prompt).toContain(
      `客户图片 1（素材 ID：${assets[0]!.id}）的完整核对文字开始：\n${text}\n客户图片 1 的完整核对文字结束。`,
    );
    expect(prompt).toContain(`客户图片 2（素材 ID：${assets[1]!.id}）`);
    expect(prompt).not.toContain("参考图 1");
    const referenced = draft({
      ...brief,
      references: [{ assetId: assets[1]!.id, role: "logo" }],
    });
    expect(referenced.nodes).toHaveLength(3);
    expect(referenced.edges).toHaveLength(1);
    expect(
      referenced.nodes.find((node) => node.id === referenced.edges[0]!.source)
        ?.data.assetId,
    ).toBe(assets[1]!.id);
  });

  it("rejects unconfirmed, missing, extra, duplicate or empty OCR transcripts before creating a draft", () => {
    const brief: GraphicDesignBrief = {
      ...base(),
      customerImageAssetIds: [assets[0]!.id],
      customerImages: [
        { assetId: assets[0]!.id, text: "内容完整", warnings: [] },
      ],
      customerConfirmed: true,
    };
    expect(() => draft({ ...brief, customerConfirmed: false })).toThrow("核对");
    for (const bad of [
      { ...brief, customerImages: [] },
      {
        ...brief,
        customerImages: [brief.customerImages![0]!, brief.customerImages![0]!],
      },
      { ...brief, customerImageAssetIds: [] },
      { ...brief, customerImageAssetIds: [assets[1]!.id] },
      { ...brief, customerImageAssetIds: [assets[0]!.id, assets[0]!.id] },
    ])
      expect(() => draft(bad)).toThrow("不一致");
    expect(() =>
      draft({
        ...brief,
        customerImages: [
          { assetId: assets[0]!.id, text: "  \n", warnings: [] },
        ],
      }),
    ).toThrow("缺少可用");
    expect(() => draft(brief, model, [])).toThrow("客户原始图片已不可用");
    expect(() =>
      draft(brief, model, [{ ...assets[0]!, kind: "video" }]),
    ).toThrow("客户原始图片已不可用");
  });

  it("rejects oversized restored customer materials without truncating the originals", () => {
    const customerText = "长".repeat(60_001);
    expect(() => draft({ ...base(), customerText })).toThrow(
      "60000 字符，内容未删减",
    );
    expect(customerText).toHaveLength(60_001);
    expect(
      generatedPrompts(
        draft({ ...base(), customerText: customerText.slice(1) }),
      )[0],
    ).toContain(customerText.slice(1));
    const brief = {
      ...base(),
      customerImageAssetIds: [assets[0]!.id],
      customerImages: [
        { assetId: assets[0]!.id, text: customerText, warnings: [] },
      ],
      customerConfirmed: true,
    };
    expect(() => draft(brief)).toThrow("每张客户图片最多支持 60000");
    expect(brief.customerImages[0]!.text).toBe(customerText);
    expect(() =>
      draft({ ...base(), customerImageAssetIds: ["1", "2", "3", "4", "5"] }),
    ).toThrow("最多支持 4 张");
  });

  it("computes 210:289 with total safety 7 as centered 203:282, including exact decimals and zero safety", () => {
    const brief: GraphicDesignBrief = {
      ...base(),
      layout: { enabled: true, width: "210", height: "289", safety: "7" },
    };
    const layout = graphicDesignLayout(brief)!;
    expect(layout).toMatchObject({
      width: 210,
      height: 289,
      safety: 7,
      innerWidth: 203,
      innerHeight: 282,
      label: "210:289",
    });
    expect(layout.instruction).toContain(
      "画面比例为 210:289。主要元素以及文字必须在居中的 203:282 范围之内",
    );
    expect(layout.instruction).toContain("分别留出 3.5");
    const result = draft(brief);
    expect(generatedPrompts(result)[0]).toContain(layout.instruction);
    expect(result.nodes[0]!.data.parameters).toEqual({
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    expect(generatedPrompts(result)[0]).toContain(
      "比例作为构图要求，实际像素受模型限制",
    );
    expect(graphicDesignLayoutNotice(model, "openai", layout)).toContain(
      "size=1024x1024",
    );
    expect(
      graphicDesignLayout({
        layout: { enabled: true, width: "0.3", height: "0.4", safety: "0.1" },
      }),
    ).toMatchObject({ innerWidth: 0.2, innerHeight: 0.3 });
    expect(
      graphicDesignLayout({
        layout: { enabled: true, width: "1", height: "1", safety: "0.000001" },
      })?.instruction,
    ).toContain("0.0000005");
    expect(
      graphicDesignLayout({
        layout: { enabled: true, width: "210", height: "289", safety: "0" },
      })?.instruction,
    ).toContain("210:289 范围之内");
    expect(graphicDesignLayout({})).toBeNull();
  });

  it("rejects invalid layout arithmetic instead of silently substituting a different ratio", () => {
    const layout = { enabled: true, width: "210", height: "289", safety: "7" };
    for (const width of [
      "",
      "0",
      "-1",
      "Infinity",
      "1e3",
      "210px",
      "1000001",
      "1.0000001",
    ])
      expect(() =>
        graphicDesignLayout({ layout: { ...layout, width } }),
      ).toThrow();
    for (const safety of ["-1", "210", "211", "NaN", "1e1"])
      expect(() =>
        graphicDesignLayout({ layout: { ...layout, safety } }),
      ).toThrow();
    expect(() =>
      draft({ ...base(), layout, formatIds: ["size:1024x1024"] }),
    ).toThrow("自定义比例");
  });

  it("uses only an exactly matching declared ratio or pixel size, and preserves that choice after normalization", () => {
    const brief = {
      ...base(),
      layout: { enabled: true, width: "210", height: "315", safety: "7" },
    };
    const exact = draft(brief).nodes[0]!.data.parameters;
    expect(exact).toEqual({ size: "1024x1536", quality: "high", n: 1 });
    const ratioModel: ModelDescriptor = {
      ...model,
      parameters: [
        ...model.parameters!.filter(
          (descriptor) => descriptor.key !== "aspect_ratio",
        ),
        {
          key: "ratio",
          label: "比例别名",
          control: "select",
          options: [{ label: "匹配", value: "210:315" }],
        },
        {
          key: "aspect_ratio",
          label: "比例",
          control: "select",
          options: [{ label: "匹配", value: "2:3" }],
        },
      ],
    };
    const ratioParameters = draft(brief, ratioModel).nodes[0]!.data.parameters;
    expect(ratioParameters).toEqual({
      aspect_ratio: "2:3",
      quality: "high",
      n: 1,
    });
    expect(
      normalizedParametersForModel(
        "image-generation",
        "openai",
        ratioModel,
        ratioParameters,
      ),
    ).toEqual(ratioParameters);
    const unsupported = {
      ...base(),
      layout: { enabled: true, width: "210", height: "289", safety: "7" },
    };
    expect(draft(unsupported).nodes[0]!.data.parameters?.size).toBe(
      "1024x1024",
    );
    expect(draft(unsupported).nodes[0]!.data.parameters?.size).not.toBe(
      "210x289",
    );
  });

  it("permits custom ratio text only for a declared string control compatible with normalization and operation", () => {
    const brief = {
      ...base(),
      layout: { enabled: true, width: "210.5", height: "289", safety: "7" },
    };
    const freeform: ModelDescriptor = {
      ...model,
      parameters: [
        ...model.parameters!.filter(
          (descriptor) => descriptor.key !== "aspect_ratio",
        ),
        {
          key: "aspect_ratio",
          label: "比例",
          control: "text",
          valueType: "string",
          operations: ["image.generate"],
        },
      ],
    };
    const parameters = draft(brief, freeform).nodes[0]!.data.parameters;
    expect(parameters).toEqual({
      aspect_ratio: "421:578",
      quality: "high",
      n: 1,
    });
    expect(
      normalizedParametersForModel(
        "image-generation",
        "openai",
        freeform,
        parameters,
      ),
    ).toEqual(parameters);
    expect(
      draft(
        { ...brief, references: [{ assetId: assets[0]!.id, role: "subject" }] },
        freeform,
      ).nodes[1]!.data.parameters,
    ).toEqual({ size: "1024x1024", quality: "high", n: 1 });
    expect(
      graphicDesignLayoutNotice(
        freeform,
        "openai",
        graphicDesignLayout(brief),
        "image.edit",
      ),
    ).toContain("实际像素受模型限制");
    const unsafeAlias: ModelDescriptor = {
      ...freeform,
      parameters: freeform.parameters!.map((descriptor) =>
        descriptor.key === "aspect_ratio"
          ? { ...descriptor, key: "ratio" }
          : descriptor,
      ),
    };
    expect(draft(brief, unsafeAlias).nodes[0]!.data.parameters?.size).toBe(
      "1024x1024",
    );
    expect(
      draft(brief, unsafeAlias).nodes[0]!.data.parameters?.ratio,
    ).toBeUndefined();
    const constrainedText: ModelDescriptor = {
      ...freeform,
      parameters: freeform.parameters!.map((descriptor) =>
        descriptor.key === "aspect_ratio"
          ? { ...descriptor, options: [{ label: "方形", value: "1:1" }] }
          : descriptor,
      ),
    };
    expect(draft(brief, constrainedText).nodes[0]!.data.parameters?.size).toBe(
      "1024x1024",
    );
    expect(
      draft(brief, constrainedText).nodes[0]!.data.parameters?.aspect_ratio,
    ).toBeUndefined();
  });

  it("continues accepting briefs saved before client materials and layout settings existed", () => {
    const legacy = base();
    delete legacy.customerText;
    delete legacy.customerImages;
    delete legacy.customerImageAssetIds;
    delete legacy.customerConfirmed;
    delete legacy.layout;
    expect(draft(legacy).generationNodeIds).toHaveLength(1);
    const defaults = createDefaultGraphicDesignBrief();
    expect(defaults.customerImages).toEqual([]);
    expect(defaults.layout).toEqual({
      enabled: false,
      width: "210",
      height: "289",
      safety: "7",
    });
  });
});
