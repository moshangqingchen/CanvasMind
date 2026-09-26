"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ImagePlus,
  Layers,
  LoaderCircle,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { AssetView } from "./types";
import { registerDesktopSave } from "../lib/desktop-client";
import {
  GRAPHIC_DESIGN_STYLES,
  GRAPHIC_DESIGN_TEMPLATES,
  createDefaultGraphicDesignBrief,
  graphicDesignFormats,
  graphicDesignLayout,
  graphicDesignLayoutNotice,
  graphicDesignReferenceLimit,
  type GraphicDesignBrief,
} from "../lib/graphic-design";
import {
  extractGraphicDesignContent,
  loadGraphicDesignExtractionModels,
} from "../lib/graphic-design-intake-client";
import styles from "./graphic-design-studio.module.css";

type ModelOption = {
  key: string;
  label: string;
  model: ModelDescriptor;
  provider: string;
  connectionId: string;
};

interface GraphicDesignStudioProps {
  assets: AssetView[];
  models: ModelOption[];
  initialModelKey?: string;
  initialBrief?: GraphicDesignBrief;
  draftKey: string;
  onClose: () => void;
  onManageModels: () => void;
  onCreate: (input: {
    brief: GraphicDesignBrief;
    modelKey: string;
    generate: boolean;
  }) => Promise<void>;
  onUpload: (file: File) => Promise<AssetView>;
}

type ReferenceRole = GraphicDesignBrief["references"][number]["role"];
type BrandPreset = {
  id: string;
  name: string;
  brandName: string;
  brandColors: string;
  style: string;
  constraints: string;
  logoAssetIds: string[];
};

const BRANDS_KEY = "supercanvas.graphic-design.brands.v1";
const CUSTOMER_TEXT_LIMIT = 60_000;
const CUSTOMER_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const emptyLayout = {
  enabled: false,
  width: "210",
  height: "289",
  safety: "7",
};
type ExtractionModel = Awaited<
  ReturnType<typeof loadGraphicDesignExtractionModels>
>[number];
const roleLabels: Record<ReferenceRole, string> = {
  subject: "主体素材",
  logo: "品牌标识",
  style: "风格参考",
  source: "改版原图",
};
const textFields = [
  "headline",
  "subheadline",
  "body",
  "eventDate",
  "location",
  "callToAction",
  "brandName",
  "brandColors",
  "style",
  "constraints",
  "revisionInstruction",
] as const;

function restoreBrief(value: unknown): GraphicDesignBrief | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!GRAPHIC_DESIGN_TEMPLATES.some((item) => item.id === raw.templateId))
    return null;
  if (!textFields.every((field) => typeof raw[field] === "string")) return null;
  if (raw.mode !== "create" && raw.mode !== "revise") return null;
  if (
    raw.variantCount !== 1 &&
    raw.variantCount !== 2 &&
    raw.variantCount !== 3
  )
    return null;
  if (
    !Array.isArray(raw.formatIds) ||
    !raw.formatIds.every((id) => typeof id === "string")
  )
    return null;
  if (
    !Array.isArray(raw.references) ||
    raw.references.length > 4 ||
    !raw.references.every(
      (ref) =>
        ref &&
        typeof ref === "object" &&
        typeof ref.assetId === "string" &&
        Object.hasOwn(roleLabels, ref.role),
    )
  )
    return null;
  if (raw.customerText !== undefined && typeof raw.customerText !== "string")
    return null;
  if (
    raw.customerConfirmed !== undefined &&
    typeof raw.customerConfirmed !== "boolean"
  )
    return null;
  if (
    raw.customerImageAssetIds !== undefined &&
    (!Array.isArray(raw.customerImageAssetIds) ||
      raw.customerImageAssetIds.length > 4 ||
      !raw.customerImageAssetIds.every((id) => typeof id === "string"))
  )
    return null;
  if (
    raw.customerImages !== undefined &&
    (!Array.isArray(raw.customerImages) ||
      raw.customerImages.length > 4 ||
      !raw.customerImages.every(
        (image) =>
          image &&
          typeof image === "object" &&
          typeof image.assetId === "string" &&
          typeof image.text === "string" &&
          Array.isArray(image.warnings) &&
          image.warnings.every(
            (warning: unknown) => typeof warning === "string",
          ),
      ))
  )
    return null;
  if (raw.layout !== undefined) {
    if (!raw.layout || typeof raw.layout !== "object") return null;
    const layout = raw.layout as Record<string, unknown>;
    if (
      typeof layout.enabled !== "boolean" ||
      !["width", "height", "safety"].every(
        (field) => typeof layout[field] === "string",
      )
    )
      return null;
  }
  return {
    ...createDefaultGraphicDesignBrief(),
    ...structuredClone(raw),
  } as unknown as GraphicDesignBrief;
}

function readBrands(): BrandPreset[] {
  const value: unknown = JSON.parse(localStorage.getItem(BRANDS_KEY) ?? "[]");
  if (!Array.isArray(value))
    throw new Error("品牌预设数据无法读取，原有数据已保留。");
  return value.filter(
    (item): item is BrandPreset =>
      item &&
      typeof item === "object" &&
      ["id", "name", "brandName", "brandColors", "style", "constraints"].every(
        (key) => typeof item[key] === "string",
      ) &&
      Array.isArray(item.logoAssetIds) &&
      item.logoAssetIds.every((id: unknown) => typeof id === "string"),
  );
}

function initialState(props: GraphicDesignStudioProps, storageKey: string) {
  const seed = restoreBrief(props.initialBrief);
  const fallback = {
    brief: seed ?? createDefaultGraphicDesignBrief(),
    modelKey: props.initialModelKey ?? props.models[0]?.key ?? "",
  };
  if (typeof window === "undefined")
    return {
      ...fallback,
      notice: "",
      brands: [] as BrandPreset[],
      storageError: "",
    };
  let brands: BrandPreset[] = [];
  let storageError = "";
  try {
    brands = readBrands();
  } catch {
    storageError = "无法读取本机品牌预设，请检查本机存储。";
  }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const raw = JSON.parse(saved) as { brief?: unknown; modelKey?: unknown };
      const brief = restoreBrief(raw.brief);
      if (!brief || typeof raw.modelKey !== "string")
        return {
          ...fallback,
          brands,
          notice: "保存的设计草稿无法读取，请重新填写。",
          storageError,
        };
      return {
        brief,
        modelKey: raw.modelKey,
        brands,
        notice: "已恢复此画布的设计草稿",
        storageError,
      };
    }
  } catch {
    storageError = "无法读取本机设计草稿，请检查本机存储。";
  }
  return { ...fallback, brands, notice: "", storageError };
}

export function GraphicDesignStudio(props: GraphicDesignStudioProps) {
  const {
    assets,
    models,
    draftKey,
    onClose,
    onManageModels,
    onCreate,
    onUpload,
  } = props;
  const storageKey = `supercanvas.graphic-design.draft.v1.${draftKey}`;
  const [initial] = useState(() => initialState(props, storageKey));
  const [brief, setBrief] = useState(initial.brief);
  const [modelKey, setModelKey] = useState(initial.modelKey);
  const [brands, setBrands] = useState(initial.brands);
  const [brandId, setBrandId] = useState("");
  const [notice, setNotice] = useState(initial.notice);
  const [storageError, setStorageError] = useState(initial.storageError);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<
    "upload" | "extract" | "draft" | "generate" | null
  >(null);
  const [uploadAssets, setUploadAssets] = useState<AssetView[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [customerImageId, setCustomerImageId] = useState("");
  const [extractionModels, setExtractionModels] = useState<ExtractionModel[]>(
    [],
  );
  const [extractionModelKey, setExtractionModelKey] = useState("");
  const [extractionLoading, setExtractionLoading] = useState(true);
  const [extractionLoadError, setExtractionLoadError] = useState("");
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractionReload, setExtractionReload] = useState(0);
  const busyRef = useRef(false);
  const submittedRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef<() => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);
  const customerFileRef = useRef<HTMLInputElement>(null);
  const extractionAbortRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const selectedModel = models.find((item) => item.key === modelKey);
  const formats = selectedModel
    ? graphicDesignFormats(selectedModel.model, selectedModel.provider)
    : [];
  const referenceLimit = selectedModel
    ? graphicDesignReferenceLimit(selectedModel.model)
    : 4;
  const imageAssets = useMemo(() => {
    const unique = new Map<string, AssetView>();
    for (const asset of [...assets, ...uploadAssets])
      if (asset.kind === "image") unique.set(asset.id, asset);
    return [...unique.values()];
  }, [assets, uploadAssets]);
  const outputCount = brief.formatIds.length * brief.variantCount;
  const template = GRAPHIC_DESIGN_TEMPLATES.find(
    (item) => item.id === brief.templateId,
  );
  const invalidFormatIds = brief.formatIds.filter(
    (id) => !formats.some((format) => format.id === id),
  );
  const customerText = brief.customerText ?? "";
  const customerImageIds = brief.customerImageAssetIds ?? [];
  const customerImages = brief.customerImages ?? [];
  const hasCustomerSource = Boolean(
    customerText.trim() || customerImageIds.length,
  );
  const eligibleExtractionModels = extractionModels.filter(
    (model) =>
      model.available &&
      (!customerImageIds.length || model.capabilities.imageInput),
  );
  const selectedExtractionModel = eligibleExtractionModels.find(
    (model) => `${model.connectionId}::${model.modelId}` === extractionModelKey,
  );
  const layoutInput = brief.layout ?? emptyLayout;
  let resolvedLayout: ReturnType<typeof graphicDesignLayout> = null;
  let layoutError = "";
  try {
    resolvedLayout = graphicDesignLayout(brief);
  } catch (cause) {
    layoutError =
      cause instanceof Error ? cause.message : "请检查画面比例和安全距离。";
  }
  const layoutNotice =
    selectedModel && resolvedLayout
      ? graphicDesignLayoutNotice(
          selectedModel.model,
          selectedModel.provider,
          resolvedLayout,
          brief.references.length ? "image.edit" : "image.generate",
        )
      : "";

  // Model discovery can finish after this dialog opens. Initialize only an
  // empty choice; never replace a saved model that has become unavailable.
  if (!modelKey && models[0]) setModelKey(models[0].key);
  if (!extractionModelKey && eligibleExtractionModels[0]) {
    const first = eligibleExtractionModels[0];
    setExtractionModelKey(`${first.connectionId}::${first.modelId}`);
  }

  useEffect(() => {
    let active = true;
    void loadGraphicDesignExtractionModels()
      .then((items) => {
        if (!active) return;
        setExtractionModels(items);
        setExtractionLoading(false);
        setExtractionLoadError("");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setExtractionLoading(false);
        setExtractionLoadError(
          cause instanceof Error
            ? cause.message
            : "无法读取内容提取模型，请重试。",
        );
      });
    return () => {
      active = false;
    };
  }, [extractionReload]);

  useEffect(
    () => () => {
      extractionAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    onCloseRef.current = () => {
      if (busyRef.current) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ brief, modelKey }));
        onClose();
      } catch {
        setStorageError(
          "设计草稿保存失败，内容仍保留在此窗口。请先将设计放入画布。",
        );
      }
    };
  }, [brief, modelKey, onClose, storageKey]);
  useEffect(() => {
    if (submittedRef.current) return;
    let active = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ brief, modelKey }));
    } catch {
      queueMicrotask(() => {
        if (active)
          setStorageError(
            "设计草稿未能保存在本机。关闭前请将设计放入画布，或保持此窗口打开。",
          );
      });
    }
    return () => {
      active = false;
    };
  }, [brief, modelKey, storageKey]);

  useEffect(() => {
    const save = async () => {
      if (busyRef.current)
        throw new Error(
          "平面设计正在上传素材、提取内容或提交任务，请等待完成后再退出。",
        );
      if (submittedRef.current) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ brief, modelKey }));
      } catch {
        throw new Error("平面设计草稿未能保存，请先将设计放入画布后再退出。");
      }
    };
    const unregister = registerDesktopSave(save);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (busyRef.current || storageError) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [brief, modelKey, storageKey, storageError]);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() =>
      dialogRef.current?.focus({ preventScroll: true }),
    );
    const keydown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
      } else if (event.key === "Tab") {
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled):not([type='hidden']),select:not(:disabled),textarea:not(:disabled),summary,[tabindex='0']",
          ),
        ].filter(
          (element) => element.getClientRects().length > 0 && !element.hidden,
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === dialog ||
            document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === dialog ||
            document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function update<K extends keyof GraphicDesignBrief>(
    key: K,
    value: GraphicDesignBrief[K],
  ) {
    setBrief((current) => ({
      ...current,
      [key]: value,
      ...(["customerText", "customerImages", "customerImageAssetIds"].includes(
        key,
      )
        ? { customerConfirmed: false }
        : {}),
    }));
    setError("");
  }

  function manageModels() {
    if (busyRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ brief, modelKey }));
      onManageModels();
    } catch {
      setStorageError(
        "设计草稿保存失败，内容仍保留在此窗口。请先将设计放入画布。",
      );
    }
  }

  function addCustomerImage(asset: AssetView | undefined) {
    if (!asset || customerImageIds.includes(asset.id)) return;
    if (customerImageIds.length >= 4) {
      setError("每次最多录入 4 张客户图片。");
      return;
    }
    if (!CUSTOMER_IMAGE_TYPES.includes(asset.mimeType)) {
      setError("客户图片请使用 PNG、JPEG、WebP 或 GIF 格式。");
      return;
    }
    if (asset.size > 10 * 1024 * 1024) {
      setError("单张客户图片不能超过 10 MB。");
      return;
    }
    const totalBytes = customerImageIds.reduce(
      (total, id) =>
        total + (imageAssets.find((item) => item.id === id)?.size ?? 0),
      asset.size,
    );
    if (totalBytes > 24 * 1024 * 1024) {
      setError("客户图片总大小不能超过 24 MB。");
      return;
    }
    setBrief((current) => ({
      ...current,
      customerImageAssetIds: [
        ...(current.customerImageAssetIds ?? []),
        asset.id,
      ],
      customerImages: [
        ...(current.customerImages ?? []),
        { assetId: asset.id, text: "", warnings: [] },
      ],
      customerConfirmed: false,
    }));
    setCustomerImageId("");
    setExtractionWarnings([]);
    setError("");
  }

  function removeCustomerImage(assetId: string) {
    setBrief((current) => ({
      ...current,
      customerImageAssetIds: (current.customerImageAssetIds ?? []).filter(
        (id) => id !== assetId,
      ),
      customerImages: (current.customerImages ?? []).filter(
        (image) => image.assetId !== assetId,
      ),
      customerConfirmed: false,
    }));
    setExtractionWarnings([]);
    setError("");
  }

  async function uploadCustomerImage(file: File | undefined) {
    if (!file || busyRef.current) return;
    if (customerImageIds.length >= 4) {
      setError("每次最多录入 4 张客户图片。");
      return;
    }
    if (!CUSTOMER_IMAGE_TYPES.includes(file.type)) {
      setError("客户图片请使用 PNG、JPEG、WebP 或 GIF 格式。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("单张客户图片不能超过 10 MB。");
      return;
    }
    busyRef.current = true;
    setBusy("upload");
    setError("");
    try {
      const asset = await onUpload(file);
      if (asset.kind !== "image") throw new Error("上传结果不是图片，请重试。");
      setUploadAssets((current) => [
        ...current.filter((item) => item.id !== asset.id),
        asset,
      ]);
      addCustomerImage(asset);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "客户图片上传失败，请重试。",
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function extractCustomerContent() {
    if (busyRef.current) return;
    if (customerText.length > CUSTOMER_TEXT_LIMIT) {
      setError("客户原文超过 60000 字，内容已完整保留，请调整后再提取。");
      return;
    }
    if (!hasCustomerSource) {
      setError("请先粘贴客户原文或添加客户图片。");
      return;
    }
    if (!selectedExtractionModel) {
      setError(
        customerImageIds.length
          ? "请选择可用且支持图片输入的内容提取模型。"
          : "请先配置并选择可用的内容提取模型。",
      );
      return;
    }
    if (
      customerImageIds.some(
        (id) => !imageAssets.some((asset) => asset.id === id),
      )
    ) {
      setError("部分客户图片已不可用，请重新选择。");
      return;
    }
    const controller = new AbortController();
    extractionAbortRef.current = controller;
    busyRef.current = true;
    setBusy("extract");
    setError("");
    setExtractionWarnings([]);
    setBrief((current) => ({ ...current, customerConfirmed: false }));
    try {
      const result = await extractGraphicDesignContent(
        {
          text: customerText,
          imageAssetIds: [...customerImageIds],
          connectionId: selectedExtractionModel.connectionId,
          modelId: selectedExtractionModel.modelId,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        result.sourceText !== customerText ||
        result.images.length !== customerImageIds.length ||
        customerImageIds.some(
          (id) =>
            result.images.filter((image) => image.assetId === id).length !== 1,
        )
      )
        throw new Error(
          "提取结果与客户原始内容不一致，原文和已有填写均已保留，请重试。",
        );
      const retainedTranscripts = customerImages.some(
        (image) => image.text.length > 0,
      );
      setBrief((current) => {
        const next = { ...current, customerConfirmed: false };
        for (const field of [
          "headline",
          "subheadline",
          "body",
          "eventDate",
          "location",
          "callToAction",
          "brandName",
          "constraints",
        ] as const) {
          if (next[field].length === 0) next[field] = result.fields[field];
        }
        next.customerImages = result.images.map((image) => {
          const previous = current.customerImages?.find(
            (item) => item.assetId === image.assetId,
          );
          return previous?.text.length
            ? {
                ...previous,
                warnings: [
                  ...new Set([...previous.warnings, ...image.warnings]),
                ],
              }
            : { ...image, warnings: [...image.warnings] };
        });
        return next;
      });
      setExtractionWarnings([
        ...result.warnings,
        ...(retainedTranscripts
          ? [
              "已保留现有图片转录，未覆盖已填写内容；需要重新识别某张图片时，请先清空它的转录文字。",
            ]
          : []),
      ]);
      setNotice(
        customerImageIds.length
          ? "提取完成，原文已完整保留；请对照每张原图逐字核对转录。"
          : "提取完成，客户原文已完整保留；仅填入了空白的文案字段。",
      );
    } catch (cause) {
      if (controller.signal.aborted)
        setNotice("已取消内容提取，原文和已有填写均已保留。");
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "客户内容提取失败，原始内容已保留，请重试。",
        );
    } finally {
      if (extractionAbortRef.current === controller)
        extractionAbortRef.current = null;
      busyRef.current = false;
      setBusy(null);
    }
  }

  function changeLayout(
    patch: Partial<NonNullable<GraphicDesignBrief["layout"]>>,
  ) {
    setBrief((current) => {
      const layout = { ...emptyLayout, ...current.layout, ...patch };
      return {
        ...current,
        layout,
        ...(layout.enabled ? { formatIds: ["model-default"] } : {}),
      };
    });
    setError("");
  }

  function addReference(assetId: string) {
    if (!assetId || brief.references.some((ref) => ref.assetId === assetId))
      return;
    if (brief.references.length >= referenceLimit) {
      setError(`当前模型最多可使用 ${referenceLimit} 张参考图。`);
      return;
    }
    const role: ReferenceRole =
      brief.mode === "revise" &&
      !brief.references.some((ref) => ref.role === "source")
        ? "source"
        : "subject";
    update("references", [...brief.references, { assetId, role }]);
    setReferenceId("");
  }

  async function upload(file: File | undefined) {
    if (!file || busyRef.current) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件。");
      return;
    }
    if (brief.references.length >= referenceLimit) {
      setError(`当前模型最多可使用 ${referenceLimit} 张参考图。`);
      return;
    }
    busyRef.current = true;
    setBusy("upload");
    setError("");
    try {
      const asset = await onUpload(file);
      if (asset.kind !== "image") throw new Error("上传结果不是图片，请重试。");
      setUploadAssets((current) => [
        ...current.filter((item) => item.id !== asset.id),
        asset,
      ]);
      addReference(asset.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "图片上传失败，请重试。",
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function saveBrand() {
    if (!brief.brandName.trim()) {
      setError("请先填写品牌名称，再保存品牌预设。");
      return;
    }
    const name = brief.brandName.trim();
    const old = brands.find((item) => item.name === name);
    const preset: BrandPreset = {
      id: old?.id ?? crypto.randomUUID(),
      name,
      brandName: brief.brandName,
      brandColors: brief.brandColors,
      style: brief.style,
      constraints: brief.constraints,
      logoAssetIds: brief.references
        .filter((ref) => ref.role === "logo")
        .map((ref) => ref.assetId),
    };
    const next = [...brands.filter((item) => item.id !== preset.id), preset];
    try {
      localStorage.setItem(BRANDS_KEY, JSON.stringify(next));
      setBrands(next);
      setBrandId(preset.id);
      setNotice(`已保存品牌预设「${name}」`);
      setError("");
    } catch {
      setError("品牌预设保存失败，请检查本机存储后重试。");
    }
  }

  function applyBrand() {
    const preset = brands.find((item) => item.id === brandId);
    if (!preset) return;
    if (
      preset.logoAssetIds.some(
        (id) => !imageAssets.some((asset) => asset.id === id),
      )
    ) {
      setError("这个品牌预设的标识素材已不可用，请重新选择标识后保存预设。");
      return;
    }
    const references = brief.references.filter(
      (ref) =>
        ref.role !== "logo" && !preset.logoAssetIds.includes(ref.assetId),
    );
    references.push(
      ...preset.logoAssetIds.map((assetId) => ({
        assetId,
        role: "logo" as const,
      })),
    );
    if (references.length > referenceLimit) {
      setError(
        `应用这个品牌后会超出 ${referenceLimit} 张参考图的上限，请先移除部分素材。`,
      );
      return;
    }
    setBrief((current) => ({
      ...current,
      brandName: preset.brandName,
      brandColors: preset.brandColors,
      style: preset.style,
      constraints: preset.constraints,
      references,
    }));
    setNotice(`已应用品牌预设「${preset.name}」`);
    setError("");
  }

  async function submit(generate: boolean) {
    if (busyRef.current) return;
    let issue = "";
    if (!selectedModel) issue = "请选择可用的图片生成模型。";
    else if (customerText.length > CUSTOMER_TEXT_LIMIT)
      issue = "客户原文超过 60000 字，内容已完整保留，请调整后再创建设计。";
    else if (layoutError) issue = layoutError;
    else if (
      customerImageIds.some(
        (id) => !imageAssets.some((asset) => asset.id === id),
      )
    )
      issue = "部分客户图片已不可用，请重新选择并核对内容。";
    else if (
      customerImageIds.some(
        (id) =>
          !customerImages.find((image) => image.assetId === id)?.text.trim(),
      )
    )
      issue = "客户图片还有未转录的文字，请自动提取或手动填写，并逐字核对。";
    else if (customerImageIds.length && !brief.customerConfirmed)
      issue = "请先对照客户原图逐字核对，并确认全部文字完整无遗漏。";
    else if (
      brief.mode === "create" &&
      !brief.headline.trim() &&
      !hasCustomerSource
    )
      issue = "请填写主标题。";
    else if (brief.mode === "revise" && !brief.revisionInstruction.trim())
      issue = "请填写修改要求。";
    else if (
      brief.mode === "revise" &&
      brief.references.filter((ref) => ref.role === "source").length !== 1
    )
      issue = "修改已有图时，请将一张参考图设为改版原图。";
    else if (brief.references.length > referenceLimit)
      issue = `当前模型最多可使用 ${referenceLimit} 张参考图，请调整素材或模型。`;
    else if (
      brief.references.some(
        (ref) => !imageAssets.some((asset) => asset.id === ref.assetId),
      )
    )
      issue = "部分参考图已不可用，请移除后重新选择。";
    else if (brief.formatIds.length === 0) issue = "请至少选择一种输出尺寸。";
    else if (invalidFormatIds.length > 0)
      issue = "原先选择的尺寸不受当前模型支持，请重新选择尺寸。";
    else if (outputCount > 6)
      issue = "一次最多生成 6 张设计，请减少尺寸或方案数。";
    if (issue) {
      setError(issue);
      return;
    }
    busyRef.current = true;
    setBusy(generate ? "generate" : "draft");
    setError("");
    try {
      await onCreate({ brief: structuredClone(brief), modelKey, generate });
      submittedRef.current = true;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* The canvas now contains the submitted brief. */
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "创建设计失败，填写内容已保留，请重试。",
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const copyLines = [
    brief.headline,
    brief.subheadline,
    brief.body,
    brief.eventDate,
    brief.location,
    brief.callToAction,
  ].filter((line) => line.trim());

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="平面设计"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.symbol}>
              <Palette size={22} />
            </span>
            <div>
              <span className={styles.eyebrow}>图片设计工作室</span>
              <h2 id={titleId}>平面设计</h2>
              <p>把文案、品牌和素材整理成一组可继续修改的设计。</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="关闭平面设计"
            disabled={!!busy}
            onClick={() => onCloseRef.current()}
          >
            <X size={20} />
          </button>
        </header>
        <div className={styles.body}>
          <fieldset className={styles.form} disabled={!!busy}>
            <div
              className={styles.segment}
              role="radiogroup"
              aria-label="设计方式"
            >
              {(
                [
                  ["create", "新建设计"],
                  ["revise", "修改已有图"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={brief.mode === value ? styles.segmentActive : ""}
                >
                  <input
                    type="radio"
                    name={`${titleId}-mode`}
                    value={value}
                    checked={brief.mode === value}
                    onChange={() => update("mode", value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <section
              className={`${styles.section} ${styles.intake}`}
              aria-labelledby={`${titleId}-intake`}
            >
              <div className={styles.sectionTitle}>
                <span>01</span>
                <h3 id={`${titleId}-intake`}>录入客户内容</h3>
                <em>原文完整保留</em>
              </div>
              <p className={styles.hint}>
                粘贴客户整段需求，或上传带文字的客户图片。原始内容是设计的主要依据；下方分项文案仅用于辅助整理，不会替代或删减原文。
              </p>
              <label className={styles.field}>
                客户原文
                <textarea
                  aria-label="客户原文"
                  value={customerText}
                  rows={5}
                  placeholder="直接粘贴客户发来的整段文字，包括标题、价格、时间、地点、联系方式及全部细节。可以不拆分、不填写下面的主标题，直接放入画布。"
                  onChange={(event) =>
                    update("customerText", event.target.value)
                  }
                />
                <small
                  className={
                    customerText.length > CUSTOMER_TEXT_LIMIT
                      ? styles.error
                      : ""
                  }
                >
                  {customerText.length.toLocaleString()} / 60,000 字 ·
                  超过上限时会保留全文，并暂停提取和生成。
                </small>
              </label>
              {customerText.length > CUSTOMER_TEXT_LIMIT && (
                <p className={styles.inlineWarning}>
                  客户原文超过 60000
                  字，当前内容没有被截断，请调整后再提取或创建设计。
                </p>
              )}
              <div className={styles.customerImageHeading}>
                <span className={styles.label}>客户图片</span>
                <small>
                  {customerImageIds.length} / 4 张 ·
                  用于读取内容，独立于下方设计参考图
                </small>
              </div>
              <div className={styles.referenceControls}>
                <select
                  aria-label="客户图片"
                  value={customerImageId}
                  onChange={(event) => setCustomerImageId(event.target.value)}
                >
                  <option value="">从资料库选择客户原图</option>
                  {imageAssets
                    .filter((asset) => !customerImageIds.includes(asset.id))
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={!customerImageId || customerImageIds.length >= 4}
                  onClick={() =>
                    addCustomerImage(
                      imageAssets.find((asset) => asset.id === customerImageId),
                    )
                  }
                >
                  <Plus size={15} />
                  添加客户图片
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={customerImageIds.length >= 4}
                  onClick={() => customerFileRef.current?.click()}
                >
                  <ImagePlus size={15} />
                  上传客户图片
                </button>
                <input
                  ref={customerFileRef}
                  className={styles.fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label="上传客户图片文件"
                  onChange={(event) => {
                    void uploadCustomerImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
              <p className={styles.hint}>
                支持 PNG、JPEG、WebP、GIF；每张不超过 10 MB，总计不超过 24 MB。
              </p>
              {customerImageIds.length > 0 && (
                <div className={styles.customerImages}>
                  {customerImageIds.map((assetId, index) => {
                    const asset = imageAssets.find(
                      (item) => item.id === assetId,
                    );
                    const transcript = customerImages.find(
                      (image) => image.assetId === assetId,
                    );
                    const name =
                      asset?.name ?? `客户图片 ${index + 1}（已不可用）`;
                    return (
                      <article className={styles.customerImage} key={assetId}>
                        <div className={styles.customerImageTitle}>
                          <strong>
                            {index + 1}. {name}
                          </strong>
                          <button
                            className={styles.iconButton}
                            type="button"
                            aria-label={`移除客户图片 ${name}`}
                            onClick={() => removeCustomerImage(assetId)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className={styles.transcriptRow}>
                          <div className={styles.customerOriginal}>
                            {asset ? (
                              <img
                                src={`/api/assets/${encodeURIComponent(assetId)}/preview`}
                                alt={`客户原图 ${name}`}
                              />
                            ) : (
                              <p className={styles.error}>原图已不可用</p>
                            )}
                            <details>
                              <summary>查看原图</summary>
                              {asset && (
                                <img
                                  src={`/api/assets/${encodeURIComponent(assetId)}/content`}
                                  alt={`完整客户原图 ${name}`}
                                />
                              )}
                            </details>
                          </div>
                          <label className={styles.field}>
                            图片完整转录
                            <textarea
                              aria-label={`图片转录 ${name}`}
                              value={transcript?.text ?? ""}
                              rows={6}
                              placeholder="点击自动提取后核对全文，或直接手动输入图片上的全部文字。不要省略价格、标点、联系方式和小字。"
                              onChange={(event) => {
                                const next = customerImageIds.map((id) =>
                                  id === assetId
                                    ? {
                                        assetId,
                                        text: event.target.value,
                                        warnings: transcript?.warnings ?? [],
                                      }
                                    : (customerImages.find(
                                        (image) => image.assetId === id,
                                      ) ?? {
                                        assetId: id,
                                        text: "",
                                        warnings: [],
                                      }),
                                );
                                update("customerImages", next);
                              }}
                            />
                            <small>
                              可直接修正漏字、错字与换行。已有转录不会被再次提取覆盖；清空后可重新识别。
                            </small>
                          </label>
                        </div>
                        {!!transcript?.warnings.length && (
                          <ul className={styles.warningList}>
                            {transcript.warnings.map(
                              (warning, warningIndex) => (
                                <li key={warningIndex}>{warning}</li>
                              ),
                            )}
                          </ul>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              <div className={styles.extractionControls}>
                <label className={styles.field}>
                  内容提取模型
                  <select
                    aria-label="内容提取模型"
                    value={selectedExtractionModel ? extractionModelKey : ""}
                    disabled={extractionLoading}
                    onChange={(event) =>
                      setExtractionModelKey(event.target.value)
                    }
                  >
                    <option value="">
                      {extractionLoading
                        ? "正在读取已配置的 Agent 模型…"
                        : eligibleExtractionModels.length
                          ? "请选择内容提取模型"
                          : customerImageIds.length
                            ? "暂无可用的识图模型"
                            : "暂无可用的内容提取模型"}
                    </option>
                    {eligibleExtractionModels.map((model) => (
                      <option
                        key={`${model.connectionId}::${model.modelId}`}
                        value={`${model.connectionId}::${model.modelId}`}
                      >
                        {model.connectionName} · {model.modelName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={
                    !selectedExtractionModel ||
                    !hasCustomerSource ||
                    customerText.length > CUSTOMER_TEXT_LIMIT
                  }
                  onClick={() => {
                    void extractCustomerContent();
                  }}
                >
                  {busy === "extract" ? (
                    <LoaderCircle size={15} className={styles.spin} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  自动提取客户内容
                </button>
              </div>
              {extractionLoadError && (
                <p role="alert" className={styles.inlineWarning}>
                  {extractionLoadError}
                  <button
                    type="button"
                    onClick={() => {
                      setExtractionLoading(true);
                      setExtractionLoadError("");
                      setExtractionReload((value) => value + 1);
                    }}
                  >
                    重新读取模型
                  </button>
                </p>
              )}
              {!extractionLoading && !selectedExtractionModel && (
                <p className={styles.hint}>
                  {customerImageIds.length
                    ? "图片内容需要可用且支持图片输入的 Agent 模型。"
                    : "可配置 Agent 模型来自动整理文案，也可保留原文直接创建设计。"}
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={manageModels}
                  >
                    前往模型设置
                  </button>
                </p>
              )}
              {selectedExtractionModel && (
                <p className={styles.hint}>
                  使用 {selectedExtractionModel.supplierName} /{" "}
                  {selectedExtractionModel.connectionName} /{" "}
                  {selectedExtractionModel.modelName}
                  。点击提取后才会提交请求，费用以供应商计费为准；只补充空白文案字段。
                </p>
              )}
              {extractionWarnings.length > 0 && (
                <ul className={styles.warningList} aria-label="内容提取提示">
                  {extractionWarnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
              {customerImageIds.length > 0 && (
                <label className={styles.confirmation}>
                  <input
                    type="checkbox"
                    aria-label="我已对照原图逐字核对，确认全部文字完整无遗漏"
                    checked={brief.customerConfirmed === true}
                    disabled={customerImageIds.some(
                      (id) =>
                        !customerImages
                          .find((image) => image.assetId === id)
                          ?.text.trim() ||
                        !imageAssets.some((asset) => asset.id === id),
                    )}
                    onChange={(event) =>
                      update("customerConfirmed", event.target.checked)
                    }
                  />
                  <span>
                    我已对照原图逐字核对，确认全部文字完整无遗漏
                    <small>
                      图片识别可能漏掉小字。修改原文、图片或转录后，需要重新核对。
                    </small>
                  </span>
                </label>
              )}
            </section>
            <section
              className={styles.section}
              aria-labelledby={`${titleId}-type`}
            >
              <div className={styles.sectionTitle}>
                <span>02</span>
                <h3 id={`${titleId}-type`}>选择设计类型</h3>
              </div>
              <div
                className={styles.templates}
                role="radiogroup"
                aria-label="设计类型"
              >
                {GRAPHIC_DESIGN_TEMPLATES.map((item) => (
                  <label
                    key={item.id}
                    className={`${styles.template} ${brief.templateId === item.id ? styles.templateActive : ""}`}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-template`}
                      value={item.id}
                      checked={brief.templateId === item.id}
                      onChange={() => update("templateId", item.id)}
                    />
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </label>
                ))}
              </div>
            </section>
            <section
              className={styles.section}
              aria-labelledby={`${titleId}-copy`}
            >
              <div className={styles.sectionTitle}>
                <span>03</span>
                <h3 id={`${titleId}-copy`}>
                  {brief.mode === "revise" ? "说明修改内容" : "填写画面文案"}
                </h3>
              </div>
              {brief.mode === "revise" && (
                <label className={styles.field}>
                  修改要求 <span className={styles.required}>必填</span>
                  <textarea
                    aria-label="修改要求"
                    value={brief.revisionInstruction}
                    rows={3}
                    maxLength={6000}
                    placeholder="例如：保留主体和品牌标识，把背景改成暖色，替换活动日期。"
                    onChange={(event) =>
                      update("revisionInstruction", event.target.value)
                    }
                  />
                  <small>
                    在下方添加原图，并将素材用途设为「改版原图」。文案留空时，以修改要求和原图为准。
                  </small>
                </label>
              )}
              <label className={styles.field}>
                主标题{" "}
                {brief.mode === "create" && !hasCustomerSource && (
                  <span className={styles.required}>必填</span>
                )}
                <input
                  aria-label="主标题"
                  value={brief.headline}
                  maxLength={300}
                  placeholder="例如：城市生活灵感节"
                  onChange={(event) => update("headline", event.target.value)}
                />
              </label>
              <label className={styles.field}>
                副标题
                <input
                  aria-label="副标题"
                  value={brief.subheadline}
                  maxLength={600}
                  placeholder="一句话说明卖点或活动主题"
                  onChange={(event) =>
                    update("subheadline", event.target.value)
                  }
                />
              </label>
              <label className={styles.field}>
                正文
                <textarea
                  aria-label="正文"
                  value={brief.body}
                  rows={3}
                  maxLength={6000}
                  placeholder="填写需要出现在画面里的具体文案，可换行。"
                  onChange={(event) => update("body", event.target.value)}
                />
              </label>
              <div className={styles.twoColumns}>
                <label className={styles.field}>
                  活动时间
                  <input
                    aria-label="活动时间"
                    value={brief.eventDate}
                    maxLength={300}
                    placeholder="例如：10 月 1 日—10 月 7 日"
                    onChange={(event) =>
                      update("eventDate", event.target.value)
                    }
                  />
                </label>
                <label className={styles.field}>
                  活动地点
                  <input
                    aria-label="活动地点"
                    value={brief.location}
                    maxLength={500}
                    placeholder="例如：城市广场 · 中庭"
                    onChange={(event) => update("location", event.target.value)}
                  />
                </label>
              </div>
              <label className={styles.field}>
                行动文案
                <input
                  aria-label="行动文案"
                  value={brief.callToAction}
                  maxLength={300}
                  placeholder="例如：立即预约 / 到店参与 / 限时抢购"
                  onChange={(event) =>
                    update("callToAction", event.target.value)
                  }
                />
              </label>
            </section>
            <section
              className={styles.section}
              aria-labelledby={`${titleId}-references`}
            >
              <div className={styles.sectionTitle}>
                <span>04</span>
                <h3 id={`${titleId}-references`}>素材与视觉方向</h3>
                <em>
                  {brief.references.length} / {referenceLimit} 张参考图
                </em>
              </div>
              <div className={styles.referenceControls}>
                <select
                  aria-label="参考素材"
                  value={referenceId}
                  onChange={(event) => setReferenceId(event.target.value)}
                >
                  <option value="">选择资料库中的图片</option>
                  {imageAssets
                    .filter(
                      (asset) =>
                        !brief.references.some(
                          (ref) => ref.assetId === asset.id,
                        ),
                    )
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={
                    !referenceId || brief.references.length >= referenceLimit
                  }
                  onClick={() => addReference(referenceId)}
                >
                  <Plus size={15} />
                  添加参考图
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={brief.references.length >= referenceLimit}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={15} />
                  上传图片
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  aria-label="上传参考图"
                  className={styles.fileInput}
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
              {referenceLimit === 0 && (
                <p className={styles.hint}>
                  当前模型不支持参考图。需要使用素材或修改原图时，请切换模型。
                </p>
              )}
              {brief.references.length > 0 && (
                <div className={styles.references}>
                  {brief.references.map((reference) => {
                    const asset = imageAssets.find(
                      (item) => item.id === reference.assetId,
                    );
                    return (
                      <article
                        key={reference.assetId}
                        className={styles.reference}
                      >
                        <div className={styles.thumbnail}>
                          {asset ? (
                            <img
                              src={`/api/assets/${encodeURIComponent(asset.id)}/preview`}
                              alt=""
                            />
                          ) : (
                            <ImagePlus size={20} />
                          )}
                        </div>
                        <div className={styles.referenceInfo}>
                          <strong title={asset?.name}>
                            {asset?.name ?? "素材已不可用"}
                          </strong>
                          <select
                            aria-label={`素材用途 ${asset?.name ?? reference.assetId}`}
                            value={reference.role}
                            onChange={(event) =>
                              update(
                                "references",
                                brief.references.map((item) =>
                                  item.assetId === reference.assetId
                                    ? {
                                        ...item,
                                        role: event.target
                                          .value as ReferenceRole,
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {Object.entries(roleLabels).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`移除素材 ${asset?.name ?? reference.assetId}`}
                          onClick={() =>
                            update(
                              "references",
                              brief.references.filter(
                                (item) => item.assetId !== reference.assetId,
                              ),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
              <label className={styles.field}>
                风格
                <select
                  aria-label="风格"
                  value={brief.style}
                  onChange={(event) => update("style", event.target.value)}
                >
                  {!GRAPHIC_DESIGN_STYLES.includes(brief.style) && (
                    <option value={brief.style}>
                      {brief.style || "请选择风格"}
                    </option>
                  )}
                  {GRAPHIC_DESIGN_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </label>
              <details className={styles.advanced}>
                <summary>
                  品牌与更多要求<span>品牌预设 · 配色 · 排版约束</span>
                </summary>
                <div className={styles.advancedContent}>
                  {brands.length > 0 && (
                    <div className={styles.brandLoad}>
                      <label className={styles.field}>
                        品牌预设
                        <select
                          aria-label="品牌预设"
                          value={brandId}
                          onChange={(event) => setBrandId(event.target.value)}
                        >
                          <option value="">选择已保存的品牌</option>
                          {brands.map((brand) => (
                            <option key={brand.id} value={brand.id}>
                              {brand.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={!brandId}
                        onClick={applyBrand}
                      >
                        应用品牌预设
                      </button>
                    </div>
                  )}
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>
                      品牌名称
                      <input
                        aria-label="品牌名称"
                        value={brief.brandName}
                        maxLength={300}
                        placeholder="你的品牌或活动主办方"
                        onChange={(event) =>
                          update("brandName", event.target.value)
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      品牌颜色
                      <input
                        aria-label="品牌颜色"
                        value={brief.brandColors}
                        maxLength={600}
                        placeholder="例如：深蓝、米白、少量珊瑚橙"
                        onChange={(event) =>
                          update("brandColors", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    补充要求
                    <textarea
                      aria-label="补充要求"
                      rows={3}
                      maxLength={6000}
                      value={brief.constraints}
                      placeholder="例如：留白充足、主标题醒目、保留标识比例、避免多余装饰。"
                      onChange={(event) =>
                        update("constraints", event.target.value)
                      }
                    />
                  </label>
                  <div className={styles.brandSave}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={saveBrand}
                    >
                      保存品牌预设
                    </button>
                    <small>
                      保存品牌、配色、风格、补充要求与标识素材。同名预设会更新。
                    </small>
                  </div>
                </div>
              </details>
            </section>
          </fieldset>
          <aside className={styles.summary} aria-label="设计需求预览">
            <fieldset disabled={!!busy} className={styles.outputSettings}>
              <div className={styles.summaryHeading}>
                <Layers size={18} />
                <h3>输出设置</h3>
              </div>
              <label className={styles.field}>
                生成模型
                <select
                  aria-label="生成模型"
                  value={modelKey}
                  onChange={(event) => {
                    setModelKey(event.target.value);
                    setError("");
                  }}
                >
                  {!selectedModel && (
                    <option value={modelKey}>
                      {modelKey
                        ? "原模型暂不可用，请重新选择"
                        : "请选择图片模型"}
                    </option>
                  )}
                  {models.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {models.length === 0 && (
                <p className={styles.hint}>
                  先在设置中添加可用的图片生成模型。
                </p>
              )}
              <button
                type="button"
                className={styles.textButton}
                onClick={manageModels}
              >
                管理供应商与模型
              </button>
              <div className={styles.layoutPanel}>
                <label className={styles.layoutToggle}>
                  <input
                    type="checkbox"
                    aria-label="自定义画面比例"
                    checked={layoutInput.enabled}
                    onChange={(event) =>
                      changeLayout({ enabled: event.target.checked })
                    }
                  />
                  <span>自定义画面比例</span>
                </label>
                {layoutInput.enabled && (
                  <>
                    <div className={styles.layoutFields}>
                      <label className={styles.field}>
                        画面宽度
                        <input
                          aria-label="画面宽度"
                          inputMode="decimal"
                          value={layoutInput.width}
                          onChange={(event) =>
                            changeLayout({ width: event.target.value })
                          }
                        />
                      </label>
                      <span>:</span>
                      <label className={styles.field}>
                        画面高度
                        <input
                          aria-label="画面高度"
                          inputMode="decimal"
                          value={layoutInput.height}
                          onChange={(event) =>
                            changeLayout({ height: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label className={styles.field}>
                      安全距离
                      <input
                        aria-label="安全距离"
                        inputMode="decimal"
                        value={layoutInput.safety}
                        onChange={(event) =>
                          changeLayout({ safety: event.target.value })
                        }
                      />
                      <small>
                        宽和高各减去此数值，剩余区域居中。宽高与安全距离使用同一比例单位。
                      </small>
                    </label>
                    {layoutError ? (
                      <p className={styles.inlineWarning}>{layoutError}</p>
                    ) : (
                      resolvedLayout && (
                        <div
                          className={styles.layoutResult}
                          aria-label="安全范围计算"
                        >
                          <p>
                            完整画面 <strong>{resolvedLayout.label}</strong>
                          </p>
                          <p>
                            主体和文字安全范围{" "}
                            <strong>
                              {resolvedLayout.innerWidth}:
                              {resolvedLayout.innerHeight}
                            </strong>
                          </p>
                          <small>
                            左右、上下各留 {resolvedLayout.safety / 2}
                            ；背景可以延伸至画面边缘。
                          </small>
                        </div>
                      )
                    )}
                    {layoutNotice && (
                      <p className={styles.hint}>{layoutNotice}</p>
                    )}
                    <p className={styles.hint}>
                      比例和安全范围会写入生成要求。实际像素受模型支持范围限制；自定义比例启用后，每次使用这一种画幅。
                    </p>
                  </>
                )}
              </div>
              <div
                className={styles.formats}
                role="group"
                aria-label="输出尺寸"
              >
                <span className={styles.label}>输出尺寸</span>
                {formats.map((format) => (
                  <label key={format.id}>
                    <input
                      type="checkbox"
                      disabled={layoutInput.enabled}
                      checked={brief.formatIds.includes(format.id)}
                      onChange={(event) =>
                        update(
                          "formatIds",
                          event.target.checked
                            ? [...brief.formatIds, format.id]
                            : brief.formatIds.filter((id) => id !== format.id),
                        )
                      }
                    />
                    <span>{format.label}</span>
                  </label>
                ))}
              </div>
              {layoutInput.enabled && (
                <p className={styles.hint}>
                  已按自定义比例生成，其他尺寸选项暂时停用。
                </p>
              )}
              {invalidFormatIds.length > 0 && (
                <div className={styles.inlineWarning}>
                  有 {invalidFormatIds.length} 种已选尺寸不受当前模型支持。
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "formatIds",
                        brief.formatIds.filter((id) =>
                          formats.some((format) => format.id === id),
                        ),
                      )
                    }
                  >
                    移除不支持的尺寸
                  </button>
                </div>
              )}
              <label className={styles.field}>
                每种尺寸方案数
                <select
                  aria-label="每种尺寸方案数"
                  value={brief.variantCount}
                  onChange={(event) =>
                    update(
                      "variantCount",
                      Number(event.target.value) as 1 | 2 | 3,
                    )
                  }
                >
                  <option value={1}>1 个方案</option>
                  <option value={2}>2 个方案</option>
                  <option value={3}>3 个方案</option>
                </select>
              </label>
              <p
                className={`${styles.outputCount} ${outputCount > 6 ? styles.tooMany : ""}`}
              >
                <strong>{outputCount}</strong> 张设计
                <span>
                  {brief.formatIds.length} 种尺寸 × {brief.variantCount} 个方案
                  · 单次最多 6 张
                </span>
              </p>
            </fieldset>
            <div className={styles.requirementPreview}>
              <span className={styles.eyebrow}>设计需求预览</span>
              <h3>
                {template?.label ?? "平面设计"}
                <span>
                  {brief.mode === "revise" ? "原图改版" : brief.style}
                </span>
              </h3>
              <p>
                {brief.brandName ? `${brief.brandName} · ` : ""}
                {brief.brandColors || "配色由模型结合风格设计"}
              </p>
              {hasCustomerSource && (
                <details className={styles.sourcePreview}>
                  <summary>客户原始内容 · 全量保留</summary>
                  {customerText.length > 0 && (
                    <div>
                      <strong>客户文字原文</strong>
                      <pre>{customerText}</pre>
                    </div>
                  )}
                  {customerImageIds.map((assetId, index) => (
                    <div key={assetId}>
                      <strong>
                        图片 {index + 1} 转录
                        {brief.customerConfirmed ? " · 已核对" : " · 待核对"}
                      </strong>
                      <pre>
                        {customerImages.find(
                          (image) => image.assetId === assetId,
                        )?.text || "尚未转录"}
                      </pre>
                    </div>
                  ))}
                  <small>
                    下方分项文案是辅助信息，完整原文始终作为设计依据。
                  </small>
                </details>
              )}
              <div className={styles.copyPreview} aria-label="画面文案预览">
                {copyLines.length > 0 ? (
                  copyLines.map((line, index) => <p key={index}>{line}</p>)
                ) : (
                  <p className={styles.emptyCopy}>
                    {brief.mode === "revise"
                      ? "未填写替换文案，按修改要求处理原图。"
                      : hasCustomerSource
                        ? "已保留客户原始内容，可以不填分项文案。"
                        : "填写左侧文案后，在这里核对。"}
                  </p>
                )}
              </div>
              {brief.mode === "revise" && brief.revisionInstruction && (
                <p className={styles.revisionPreview}>
                  修改要求：{brief.revisionInstruction}
                </p>
              )}
              <small>这里展示文案与需求；完成画面由所选图片模型生成。</small>
            </div>
          </aside>
        </div>
        <footer className={styles.footer}>
          <div className={styles.feedback} aria-live="polite">
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : storageError ? (
              <p role="alert" className={styles.error}>
                {storageError}
              </p>
            ) : (
              <p className={styles.notice}>
                {busy === "upload"
                  ? "正在上传素材…"
                  : busy === "extract"
                    ? "正在提取客户内容，原文和已有填写保持保留…"
                    : notice || "设计草稿自动保存在本机，关闭后可继续填写。"}
              </p>
            )}
            <small>
              {selectedModel
                ? `使用 ${selectedModel.label}，将提交 ${outputCount} 个图片任务。`
                : "选择模型后可放入画布或生成。"}{" "}
              点击生成会向供应商提交任务，费用以供应商实际计费为准。
            </small>
          </div>
          <div className={styles.actions}>
            {busy === "extract" && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  extractionAbortRef.current?.abort();
                  setNotice("已取消内容提取，原文和已有填写均已保留。");
                }}
              >
                取消提取
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              disabled={!!busy || !selectedModel}
              onClick={() => {
                void submit(false);
              }}
            >
              {busy === "draft" ? (
                <LoaderCircle size={16} className={styles.spin} />
              ) : (
                <Plus size={16} />
              )}
              放入画布
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={!!busy || !selectedModel}
              onClick={() => {
                void submit(true);
              }}
            >
              {busy === "generate" ? (
                <LoaderCircle size={16} className={styles.spin} />
              ) : (
                <Sparkles size={16} />
              )}
              生成设计
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
