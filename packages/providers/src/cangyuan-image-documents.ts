/** Exact supplier model documents fetched on 2026-10-09 (America/Los_Angeles).
 * Values and pixel examples remain model-specific; no generic K-to-pixel mapping. */
export interface CangyuanImageDocument { sourceUrl: string; checkedAt: string; sha256: string; intro: string; fields: Record<string,string>; ratios: string[]; pixelOptions: string[]; customPixels: boolean; autoSize: boolean; omitSizeAutomatic: boolean; qualityOptions: string[]; maxReferences?: number; editing: boolean; referenceDimensions?: Array<{resolution:string;aspectRatio:string;width:number;height:number}>; }
export const CANGYUAN_IMAGE_DOCUMENTS: Readonly<Record<string,CangyuanImageDocument>> = {
  "gpt-image-2": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.json",
    "checkedAt": "2026-10-10T00:16:03.781Z",
    "sha256": "86fdf53551b965cb8f0a131d1ca5feb77ef1f3413efd967b45d15bf5fe57ab7a",
    "intro": "gpt-image-2；张数 1；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-1k.json",
    "checkedAt": "2026-10-10T00:16:04.033Z",
    "sha256": "fcef8bc5f6f1c7c9c37986af2fbe56ec71159deb2ab1239fa9a05cff393edcc3",
    "intro": "gpt-image-2-1k；张数 1；quality 为 low / medium / high / xhigh / max；参考图最多 9 张，可带 1 张蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2-1k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 1K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质，可选 low / medium / high / xhigh / max。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-2k.json",
    "checkedAt": "2026-10-10T00:16:04.287Z",
    "sha256": "4199d4a59d4be81de405f7020b368977648e7185b37caa42131fea73bebac1f1",
    "intro": "gpt-image-2-2k；张数 1；quality 为 low / medium / high / xhigh / max；参考图最多 9 张，可带 1 张蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2-2k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 2K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质，可选 low / medium / high / xhigh / max。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json",
    "checkedAt": "2026-10-10T00:16:04.543Z",
    "sha256": "417e4a99fcf5ff29a4974228560319614551cfcf78420ce7f18c21da67412510",
    "intro": "gpt-image-2-4k；张数 1；quality 为 low / medium / high / xhigh / max；参考图最多 9 张，可带 1 张蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2-4k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 4K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质，可选 low / medium / high / xhigh / max。",
      "response_format": "推荐 url，结果为 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json",
    "checkedAt": "2026-10-10T00:16:04.804Z",
    "sha256": "dc48ccd84eecf9d9b0c0d676f465e23689abae280fa193b49a9c10fa4344590f",
    "intro": "gpt-image-2-x 用 tier 选择清晰度，价格与对应公共名相同：省略或 web 等于 gpt-image-2，1k / 2k / 4k 等于 gpt-image-2-1k / gpt-image-2-2k / gpt-image-2-4k。直接调用那些公共名时不要传 tier。",
    "fields": {
      "model": "固定传 gpt-image-2-x。",
      "tier": "清晰度。web、1k、2k、4k。省略或 web 为默认档，价格与 gpt-image-2 相同。1k / 2k / 4k 与 gpt-image-2-1k / gpt-image-2-2k / gpt-image-2-4k 相同。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。1k / 2k / 4k 的宽高须落在该档像素预算内。",
      "quality": "仅 1k / 2k / 4k 可传，可选 low / medium / high / xhigh / max。不改变本页价格。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "仅 1k / 2k / 4k 可传，可选蒙版 HTTPS URL，最多 1 张。web 不要传。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5.json",
    "checkedAt": "2026-10-10T00:16:05.058Z",
    "sha256": "2cdca9799c88c42207fd876db3a10e53b1b17b5b71c97cb57fafc83e59dfcbf3",
    "intro": "gpt-image-2.5；张数 1；参考图最多 9 张，可带 1 张蒙版。这不是 gpt-image-2.5-x 的 web 档。那个入口的 web 档是 gpt-image-2.5-flare 或 gpt-image-2.5-sunburst。",
    "fields": {
      "model": "固定传 gpt-image-2.5。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5-flare": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare.json",
    "checkedAt": "2026-10-10T00:16:05.310Z",
    "sha256": "42855733fc5aa785cd2cf2a3c1637635b576e209c14b7dcd48e96dc760cec7aa",
    "intro": "gpt-image-2.5-flare；张数 1；参考图最多 9 张，可带 1 张蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5-flare-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-1k.json",
    "checkedAt": "2026-10-10T00:16:05.562Z",
    "sha256": "644cc1d2ca9ebd32966f10a2a72e35b034c386037c45b66e61357c88f963a5ba",
    "intro": "gpt-image-2.5-flare-1k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-1k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 1K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-flare-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-2k.json",
    "checkedAt": "2026-10-10T00:16:05.818Z",
    "sha256": "8ab3cb1f5a613d614c5c4ed4e0779021ca5359f8f9531ce41a32d3119ff78b4a",
    "intro": "gpt-image-2.5-flare-2k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-2k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 2K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-flare-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-4k.json",
    "checkedAt": "2026-10-10T00:16:06.062Z",
    "sha256": "9721d9a2fe2afbbb2f2ea04fa985bcf7e5bc60cc43bef2bef7327fd66887da68",
    "intro": "gpt-image-2.5-flare-4k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-4k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 4K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-sunburst": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst.json",
    "checkedAt": "2026-10-10T00:16:06.318Z",
    "sha256": "642eb5399a338835f96b8288b0c9c64a664e276f1449167477c800229059f1fd",
    "intro": "gpt-image-2.5-sunburst；张数 1；参考图最多 9 张，可带 1 张蒙版。",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5-sunburst-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-1k.json",
    "checkedAt": "2026-10-10T00:16:06.582Z",
    "sha256": "30ae8d9861620aa84047d8ba95f53f5dc00bd08128743375d0b44c44c4524999",
    "intro": "gpt-image-2.5-sunburst-1k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-1k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 1K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-sunburst-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-2k.json",
    "checkedAt": "2026-10-10T00:16:06.828Z",
    "sha256": "cc5c2e7c2cb361f610abca0599338e16d2a987cffb547df7d3a58bfa1241e337",
    "intro": "gpt-image-2.5-sunburst-2k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-2k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 2K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-sunburst-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-4k.json",
    "checkedAt": "2026-10-10T00:16:07.089Z",
    "sha256": "37264ba329e90801cdcaa4a94094278c5df465b20705432295d9b607fe1b91fb",
    "intro": "gpt-image-2.5-sunburst-4k；张数 1；参考图最多 16 张。",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-4k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，须落在 4K 像素预算内。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 21:9。",
      "quality": "画质。low / medium / high / 省略 / auto 按标准档计费；xhigh / max 按标准档双倍。",
      "response_format": "推荐 url，结果为 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2.5-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-x.json",
    "checkedAt": "2026-10-10T00:16:07.332Z",
    "sha256": "09e88049a65b3f761e906ccb324fc8f8a3806ab67f907c006260fbd8620ec439",
    "intro": "gpt-image-2.5-x 用 series 选择 Flare 或 Sunburst，再用 tier 选择清晰度，价格与对应公共名相同。series 必须传。省略 tier 或 web：flare 等于 gpt-image-2.5-flare，sunburst 等于 gpt-image-2.5-sunburst。1k / 2k / 4k 等于同名的 k 公共名。k 档在 quality 为 xhigh 或 max 时按标准价加倍。gpt-image-2.5 不是本页的 web 档。直接调用那些公共名时不要传 series 或 tier。",
    "fields": {
      "model": "固定传 gpt-image-2.5-x。",
      "series": "产品线。只能是 flare 或 sunburst，必须传。",
      "tier": "清晰度。web、1k、2k、4k。省略或 web 为默认档。1k / 2k / 4k 与对应 k 公共名相同。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。1k / 2k / 4k 的宽高须落在该档像素预算内。",
      "quality": "1k / 2k / 4k 可传 low / medium / high / xhigh / max。省略、auto、low、medium、high 按标准档；xhigh / max 按标准档双倍。web 不按 quality 加价。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组。1k / 2k / 4k 最多 16 张，web 档最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 16,
    "editing": true
  },
  "gpt-image-2-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-o.json",
    "checkedAt": "2026-10-10T00:16:07.585Z",
    "sha256": "cbdfb12ddfc711fafbe64336553cab8b37996fe3fa444c3d49156d62b370fcc7",
    "intro": "gpt-image-2-o。官转。按 token 计费，文本输入、图片输入、图片输出分列。张数 1；参考图最多 9 张，可带 1 张蒙版。quality 与像素会影响用量。",
    "fields": {
      "model": "固定传 gpt-image-2-o。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "quality": "画质。low / medium / high / xhigh / max / auto。省略或 auto 由服务端决定；更高画质和更大像素会增加图片输出 token。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5-flare-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-o.json",
    "checkedAt": "2026-10-10T00:16:07.836Z",
    "sha256": "c11272dc4677b4d71e6724d9e2b24223dee998ab233c8c0f8c6ffd0d7dc370c2",
    "intro": "gpt-image-2.5-flare-o。官转，偏速度。按 token 计费，文本输入、图片输入、图片输出分列。张数 1；参考图最多 9 张，可带 1 张蒙版。quality 与像素会影响用量。",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-o。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "quality": "画质。low / medium / high / xhigh / max / auto。省略或 auto 由服务端决定；更高画质和更大像素会增加图片输出 token。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "gpt-image-2.5-sunburst-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-o.json",
    "checkedAt": "2026-10-10T00:16:08.087Z",
    "sha256": "8c1831df3fe9e262da119ec89e82e7dd06bcf2ea049d4b69980629c01906ceb6",
    "intro": "gpt-image-2.5-sunburst-o。官转，偏画质与编辑精度。按 token 计费，文本输入、图片输入、图片输出分列。张数 1；参考图最多 9 张，可带 1 张蒙版。quality 与像素会影响用量。",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-o。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 16:9 / 9:16 / 3:2 / 2:3 / 4:3 / 3:4 / 5:4 / 4:5 / 21:9，或 auto。",
      "quality": "画质。low / medium / high / xhigh / max / auto。省略或 auto 由服务端决定；更高画质和更大像素会增加图片输出 token。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。",
      "mask": "可选蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto"
    ],
    "maxReferences": 9,
    "editing": true
  },
  "nano-banana-pro": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro.json",
    "checkedAt": "2026-10-10T00:16:08.337Z",
    "sha256": "e40a05a69e21bd5f0a81c600414c8e876e0f84fd34699158a0cc4645b09ca8e0",
    "intro": "nano-banana-pro；张数 1；quality 可选 1k / 2k / 4k；参考图一张或多张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana-pro。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9。",
      "quality": "清晰度档，可选 1k / 2k / 4k。不要另传 image_size。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，一张或多张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "1k",
      "2k",
      "4k"
    ],
    "editing": true
  },
  "nano-banana-pro-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro-1k.json",
    "checkedAt": "2026-10-10T00:16:08.591Z",
    "sha256": "14507700ee05bb777f11f50e77b9c2d1219540b522a5d4e40c237fae0912c684",
    "intro": "nano-banana-pro-1k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana-pro-1k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "nano-banana-pro-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro-2k.json",
    "checkedAt": "2026-10-10T00:16:08.870Z",
    "sha256": "b38a4c9dd428e66e937463cbfb769ca72fec5511fb8b995c9fc5d4d31c3a9206",
    "intro": "nano-banana-pro-2k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana-pro-2k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "nano-banana-pro-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro-4k.json",
    "checkedAt": "2026-10-10T00:16:09.100Z",
    "sha256": "e49118fed8f2a8a0d9348b52ea03b5e28eb466e6df7bfefc302d42ff2086c80d",
    "intro": "nano-banana-pro-4k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana-pro-4k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gemini-3-pro-image-preview": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-3-pro-image-preview.json",
    "checkedAt": "2026-10-10T00:16:09.394Z",
    "sha256": "e8ab609f8c38a416b05fa4bd4a7fe990bb5c40f640c5f212164c87248c9f9e7a",
    "intro": "文生图走 /v1/images/generations，图生图走 /v1/images/edits，一次只出 1 张。quality 选择清晰度，只能是 1k / 2k / 4k，价格分别与 nano-banana-pro-1k / 2k / 4k 相同。省略或 auto 按 1k。没有 web。编辑时 images 按数组顺序对应提示词里的「第一张 / 第二张」。不支持蒙版。需要自动比例时省略 size，不要传 auto。",
    "fields": {
      "model": "固定传本页公共名。",
      "prompt": "文生图写画面。图生图写编辑要求，可用「第一张 / 第二张」按 images 数组顺序指代参考图。",
      "n": "张数，只能为 1。",
      "size": "画幅比例，只传 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9。不要传像素，不要传 1k / 2k / 4k。省略则按参考图比例，无参考图时由模型决定。",
      "quality": "清晰度，1k / 2k / 4k。省略或 auto 按 1k。不要传 web，也不要另传 tier。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，一张或多张。第一项是「第一张」，第二项是「第二张」。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": true,
    "qualityOptions": [
      "1k",
      "2k",
      "4k",
      "auto"
    ],
    "editing": true
  },
  "nano-banana2-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-1k.json",
    "checkedAt": "2026-10-10T00:16:09.621Z",
    "sha256": "ddeca68a3bafebc18ed16d92f2a8144e26ddff635cc9de733ff2c8ecdb8766fd",
    "intro": "nano-banana2-1k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana2-1k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "nano-banana2-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-2k.json",
    "checkedAt": "2026-10-10T00:16:09.896Z",
    "sha256": "a1260764a26e585473882771a827bcfb177e1e70a2251a6de4a939758a217626",
    "intro": "nano-banana2-2k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana2-2k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "nano-banana2-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-4k.json",
    "checkedAt": "2026-10-10T00:16:10.145Z",
    "sha256": "5c3b32d0adf57d9529d33af35c84c37f6584df5fcc090d513f059c6b6a9da21d",
    "intro": "nano-banana2-4k；张数 1；清晰度写在公共名里，不要再传 quality；参考图最多 9 张；不支持蒙版。",
    "fields": {
      "model": "固定传 nano-banana2-4k。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 9 张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true
  },
  "gemini-3.1-flash-image-preview": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-3.1-flash-image-preview.json",
    "checkedAt": "2026-10-10T00:16:10.404Z",
    "sha256": "369ae54edce675dfe1a23dd9d667164bf1cf9f65eca9e953cdf5aeb67a542557",
    "intro": "文生图走 /v1/images/generations，图生图走 /v1/images/edits，一次只出 1 张。size 只传比例，另有超宽 8:1 / 4:1 / 1:4 / 1:8。quality 选择清晰度，只能是 1k / 2k / 4k，价格分别与 nano-banana2-1k / 2k / 4k 相同。省略或 auto 按 1k。没有 web。编辑时 images 按数组顺序对应提示词里的「第一张 / 第二张」。不支持蒙版。需要自动比例时省略 size，不要传 auto。",
    "fields": {
      "model": "固定传本页公共名。",
      "prompt": "文生图写画面。图生图写编辑要求，可用「第一张 / 第二张」按 images 数组顺序指代参考图。",
      "n": "张数，只能为 1。",
      "size": "画幅比例，只传 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9 / 8:1 / 4:1 / 1:4 / 1:8。不要传像素，不要传 1k / 2k / 4k。省略则按参考图比例，无参考图时由模型决定。",
      "quality": "清晰度，1k / 2k / 4k。省略或 auto 按 1k。不要传 web，也不要另传 tier。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，一张或多张。第一项是「第一张」，第二项是「第二张」。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "21:9",
      "8:1",
      "4:1",
      "1:4",
      "1:8"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": true,
    "qualityOptions": [
      "1k",
      "2k",
      "4k",
      "auto"
    ],
    "editing": true
  },
  "gemini-nano-banana-2.1": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json",
    "checkedAt": "2026-10-10T00:16:10.668Z",
    "sha256": "c043c35553914ba4ea7866056a9eaa4e72bb5ac0e78072ce246649b330d63d52",
    "intro": "文生图走 /v1/images/generations，图生图走 /v1/images/edits，一次只出 1 张。先选下表 10 种比例，再用 quality 选 1k / 2k / 4k。省略 size 按 1:1，省略 quality 或 auto 按 1k。价格分别与 nano-banana2-1k / 2k / 4k 相同。不支持 1:4、4:1、1:8、8:1，也不接受任意宽x高。参考图 png / jpeg / webp，每张不超过 35MB，最多 14 张。不支持蒙版。",
    "fields": {
      "model": "固定传 gemini-nano-banana-2.1。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "只能传 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 4:5 / 5:4 / 9:16 / 16:9 / 21:9。省略按 1:1。不要传宽x高，不要把 1k / 2k / 4k 写进 size，不要传 1:4、4:1、1:8、8:1。",
      "quality": "清晰度，1k / 2k / 4k。价格分别与 nano-banana2-1k / 2k / 4k 相同。省略或 auto 按 1k。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组。png / jpeg / webp，每张不超过 35MB，最多 14 张。超过 14 张会被拒绝，不出图。"
    },
    "ratios": [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "1k",
      "2k",
      "4k",
      "auto"
    ],
    "maxReferences": 14,
    "editing": true,
    "referenceDimensions": [
      {
        "resolution": "1k",
        "aspectRatio": "1:1",
        "width": 1024,
        "height": 1024
      },
      {
        "resolution": "2k",
        "aspectRatio": "1:1",
        "width": 2048,
        "height": 2048
      },
      {
        "resolution": "4k",
        "aspectRatio": "1:1",
        "width": 4096,
        "height": 4096
      },
      {
        "resolution": "1k",
        "aspectRatio": "2:3",
        "width": 848,
        "height": 1264
      },
      {
        "resolution": "2k",
        "aspectRatio": "2:3",
        "width": 1696,
        "height": 2528
      },
      {
        "resolution": "4k",
        "aspectRatio": "2:3",
        "width": 3392,
        "height": 5056
      },
      {
        "resolution": "1k",
        "aspectRatio": "3:2",
        "width": 1264,
        "height": 848
      },
      {
        "resolution": "2k",
        "aspectRatio": "3:2",
        "width": 2528,
        "height": 1696
      },
      {
        "resolution": "4k",
        "aspectRatio": "3:2",
        "width": 5056,
        "height": 3392
      },
      {
        "resolution": "1k",
        "aspectRatio": "3:4",
        "width": 896,
        "height": 1200
      },
      {
        "resolution": "2k",
        "aspectRatio": "3:4",
        "width": 1792,
        "height": 2400
      },
      {
        "resolution": "4k",
        "aspectRatio": "3:4",
        "width": 3584,
        "height": 4800
      },
      {
        "resolution": "1k",
        "aspectRatio": "4:3",
        "width": 1200,
        "height": 896
      },
      {
        "resolution": "2k",
        "aspectRatio": "4:3",
        "width": 2400,
        "height": 1792
      },
      {
        "resolution": "4k",
        "aspectRatio": "4:3",
        "width": 4800,
        "height": 3584
      },
      {
        "resolution": "1k",
        "aspectRatio": "4:5",
        "width": 928,
        "height": 1152
      },
      {
        "resolution": "2k",
        "aspectRatio": "4:5",
        "width": 1856,
        "height": 2304
      },
      {
        "resolution": "4k",
        "aspectRatio": "4:5",
        "width": 3712,
        "height": 4608
      },
      {
        "resolution": "1k",
        "aspectRatio": "5:4",
        "width": 1152,
        "height": 928
      },
      {
        "resolution": "2k",
        "aspectRatio": "5:4",
        "width": 2304,
        "height": 1856
      },
      {
        "resolution": "4k",
        "aspectRatio": "5:4",
        "width": 4608,
        "height": 3712
      },
      {
        "resolution": "1k",
        "aspectRatio": "9:16",
        "width": 768,
        "height": 1376
      },
      {
        "resolution": "2k",
        "aspectRatio": "9:16",
        "width": 1536,
        "height": 2752
      },
      {
        "resolution": "4k",
        "aspectRatio": "9:16",
        "width": 3072,
        "height": 5504
      },
      {
        "resolution": "1k",
        "aspectRatio": "16:9",
        "width": 1376,
        "height": 768
      },
      {
        "resolution": "2k",
        "aspectRatio": "16:9",
        "width": 2752,
        "height": 1536
      },
      {
        "resolution": "4k",
        "aspectRatio": "16:9",
        "width": 5504,
        "height": 3072
      },
      {
        "resolution": "1k",
        "aspectRatio": "21:9",
        "width": 1584,
        "height": 672
      },
      {
        "resolution": "2k",
        "aspectRatio": "21:9",
        "width": 3168,
        "height": 1344
      },
      {
        "resolution": "4k",
        "aspectRatio": "21:9",
        "width": 6336,
        "height": 2688
      }
    ]
  },
  "midjourney-v7": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-v7.json",
    "checkedAt": "2026-10-10T00:16:10.925Z",
    "sha256": "32e7a1249cb689ca6b6e91cffc6c0e5d6a71a8d376726343afec198ec42a800b",
    "intro": "Midjourney V7 文生图和图生图，按次计费。没有 1K / 2K 档，也没有速度档。结果地址可以直接拉取，适合高并发。n 只能为 1，结果仍可能有多张，请遍历 data，不按返回张数加价。不要和 midjourney-1k、midjourney-2k 混用。",
    "fields": {
      "model": "固定传 midjourney-v7。",
      "prompt": "图像描述，最多 4000 字符。不要写 --v、--niji、--fast、--hd。",
      "n": "只能为 1。返回的 data 仍可能有多项。我们按次计费，不按返回张数加价。",
      "size": "比例：1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9。也可传对应的宽x高。省略按 16:9。没有 1K / 2K 档。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 5 张。",
      "response_format": "推荐 url。结果地址可以直接拉取，适合高并发。结果在 data 数组里，可能多于一项。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 5,
    "editing": true
  },
  "midjourney-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-1k.json",
    "checkedAt": "2026-10-10T00:16:11.186Z",
    "sha256": "ddab67dbfe4de887e9272019b364eeec9c34c7c649ced64acc4aafca10cafa20",
    "intro": "Midjourney 文生图，固定 1K 档，按次计费。默认 Relax，speed=fast 或 prompt 写 --fast 为 Fast。版本 8.2。n=1，一次出 4 张，不按张加价。结果是官网原链，下载容易被 Cloudflare 拦截，不适合高并发拉取。可用 --v / --niji 换版本。不要和 midjourney-v7 混用。",
    "fields": {
      "model": "固定传 midjourney-1k。",
      "prompt": "图像描述。可写官网参数 --ar / --fast / --relax / --v / --niji / --stylize / --chaos / --seed / --weird / --raw / --no。省略 --v / --niji 时按 8.2。可用 --v 6 / 6.1 / 7 / 8.1 / 8.2 或 --niji 换版本。已是 --ar 16:9 --fast 这种写法时会原样保留。",
      "n": "只能为 1。一次请求仍返回 4 张，按次计费，不按返回张数加价。",
      "size": "官网比例：1:2 / 6:11 / 9:16 / 2:3 / 3:4 / 4:5 / 5:6 / 1:1，以及反向 2:1 / 11:6 / 16:9 / 3:2 / 4:3 / 5:4 / 6:5。也可写在 prompt 的 --ar。省略则不指定。",
      "speed": "生成速度，可选 relax / fast。也可写在 prompt 的 --fast / --relax。省略为 relax。这不是画质，不要用 quality。",
      "images": "可选。参考图 HTTPS URL 数组。不要发本地文件或 data URI。怎么用看 reference：image / style / edit / moodboard 走 /v1/images/generations；editor 走 /v1/images/edits 且只能 1 张。edit 最多 4 张。不要另发明 sref_images、edit_images 等字段。",
      "reference": "和 images 一起用，决定这些图扮演什么角色。省略或 image：把图当画面素材，构图和物体会被拆散重组进新图，单图要配文字。style：只借配色、笔触、光影，不把原图里的人/物体搬过来，必须另写要画的内容（对应 --sref）。edit：把图当要改的对象，尽量保住物体，按文字改颜色、季节、背景等，最多 4 张；仍走 /v1/images/generations，不要发 mask。moodboard：用这批图现场建一块风格板再出图（对应 --profile）；prompt 里已有 --p 或 --profile 则不再建板。editor：已有成图要在这张画布上擦除、换材质或扩边，必须走 /v1/images/edits，源图只能 1 张。",
      "mask": "仅 /v1/images/edits。可选。HTTPS URL，标出要重绘的区域。有 mask 只改那一块；不传则整图换材质（结构大致保留）。扩边用 size 或 prompt 的 --ar，不是 mask。不要在 /v1/images/generations 里发送。",
      "response_format": "推荐 url。地址是 Midjourney 官网 CDN 原链，下载容易被 Cloudflare 拦截，不要在服务器上高并发拉取。不要用 b64_json。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。"
    },
    "ratios": [
      "1:2",
      "6:11",
      "9:16",
      "2:3",
      "3:4",
      "4:5",
      "5:6",
      "1:1",
      "2:1",
      "11:6",
      "16:9",
      "3:2",
      "4:3",
      "5:4",
      "6:5"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 4,
    "editing": true
  },
  "midjourney-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-2k.json",
    "checkedAt": "2026-10-10T00:16:11.434Z",
    "sha256": "1884a6bed596583bc3c8cc4130a537a496fb044e77622c0e62cefdaba9e2c56e",
    "intro": "Midjourney 文生图，固定 2K 档，按次计费。默认 Relax，speed=fast 或 prompt 写 --fast 为 Fast。版本 8.2。n=1，一次出 4 张，不按张加价。结果是官网原链，下载容易被 Cloudflare 拦截，不适合高并发拉取。可用 --v / --niji 换版本。不要和 midjourney-v7 混用。",
    "fields": {
      "model": "固定传 midjourney-2k。",
      "prompt": "图像描述。可写官网参数 --ar / --fast / --relax / --hd / --v / --niji / --stylize / --chaos / --seed / --weird / --raw / --no。省略 --v / --niji 时按 8.2。可用 --v 6 / 6.1 / 7 / 8.1 / 8.2 或 --niji 换版本。已是 --ar 16:9 --fast --hd 这种写法时会原样保留。",
      "n": "只能为 1。一次请求仍返回 4 张，按次计费，不按返回张数加价。",
      "size": "官网比例：1:2 / 6:11 / 9:16 / 2:3 / 3:4 / 4:5 / 5:6 / 1:1，以及反向 2:1 / 11:6 / 16:9 / 3:2 / 4:3 / 5:4 / 6:5。也可写在 prompt 的 --ar。省略则不指定。",
      "speed": "生成速度，可选 relax / fast。也可写在 prompt 的 --fast / --relax。省略为 relax。这不是画质，不要用 quality。",
      "images": "可选。参考图 HTTPS URL 数组。不要发本地文件或 data URI。怎么用看 reference：image / style / edit / moodboard 走 /v1/images/generations；editor 走 /v1/images/edits 且只能 1 张。edit 最多 4 张。不要另发明 sref_images、edit_images 等字段。",
      "reference": "和 images 一起用，决定这些图扮演什么角色。省略或 image：把图当画面素材，构图和物体会被拆散重组进新图，单图要配文字。style：只借配色、笔触、光影，不把原图里的人/物体搬过来，必须另写要画的内容（对应 --sref）。edit：把图当要改的对象，尽量保住物体，按文字改颜色、季节、背景等，最多 4 张；仍走 /v1/images/generations，不要发 mask。moodboard：用这批图现场建一块风格板再出图（对应 --profile）；prompt 里已有 --p 或 --profile 则不再建板。editor：已有成图要在这张画布上擦除、换材质或扩边，必须走 /v1/images/edits，源图只能 1 张。",
      "mask": "仅 /v1/images/edits。可选。HTTPS URL，标出要重绘的区域。有 mask 只改那一块；不传则整图换材质（结构大致保留）。扩边用 size 或 prompt 的 --ar，不是 mask。不要在 /v1/images/generations 里发送。",
      "response_format": "推荐 url。地址是 Midjourney 官网 CDN 原链，下载容易被 Cloudflare 拦截，不要在服务器上高并发拉取。不要用 b64_json。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。"
    },
    "ratios": [
      "1:2",
      "6:11",
      "9:16",
      "2:3",
      "3:4",
      "4:5",
      "5:6",
      "1:1",
      "2:1",
      "11:6",
      "16:9",
      "3:2",
      "4:3",
      "5:4",
      "6:5"
    ],
    "pixelOptions": [],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 4,
    "editing": true
  },
  "grok-imagine-image": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image.json",
    "checkedAt": "2026-10-10T00:16:14.282Z",
    "sha256": "508f9c26ac3578ab0b3ee76d9fb838a8c3b5a19572a812c33f2209e18c453830",
    "intro": "文生图与参考图编辑。张数 1。画幅用 size：1:1 / 16:9 / 9:16 / 2:3 / 3:2 / 4:3 / 3:4，或 1024x1024 / 1792x1024 / 1024x1792。编辑参考图 1–8 张，无蒙版。各 size 同价。",
    "fields": {
      "model": "固定传 grok-imagine-image。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 2:3 / 3:2 / 4:3 / 3:4，或像素 1024x1024 / 1792x1024 / 1024x1792。省略默认 1024x1024（1:1）。1792x1024 是 3:2，不是 16:9。",
      "response_format": "url 或 b64_json。推荐 url。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "image": "单张参考图：HTTPS URL 或 data:image/...;base64, Data URI。",
      "images": "多张参考图数组，1–8 张。每项 HTTPS URL 或 Data URI。与 image 不要混着重复传同一张。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "2:3",
      "3:2",
      "4:3",
      "3:4"
    ],
    "pixelOptions": [
      "1024x1024",
      "1792x1024",
      "1024x1792"
    ],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": true
  },
  "grok-imagine-image-2.0": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image-2.0.json",
    "checkedAt": "2026-10-10T00:16:14.557Z",
    "sha256": "62f4796570bfd8dd4faba0592560212103df216f6bc879d232eb4d9645f300ef",
    "intro": "文生图与参考图编辑，质感高于 grok-imagine-image。张数 1。画幅用 size：1:1 / 16:9 / 9:16 / 2:3 / 3:2 / 4:3 / 3:4，或 1024x1024 / 1792x1024 / 1024x1792。编辑参考图 1–8 张，无蒙版。各 size 同价。",
    "fields": {
      "model": "固定传 grok-imagine-image-2.0。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 16:9 / 9:16 / 2:3 / 3:2 / 4:3 / 3:4，或像素 1024x1024 / 1792x1024 / 1024x1792。省略默认 1024x1024（1:1）。1792x1024 是 3:2，不是 16:9。",
      "response_format": "url 或 b64_json。推荐 url。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "image": "单张参考图：HTTPS URL 或 data:image/...;base64, Data URI。",
      "images": "多张参考图数组，1–8 张。每项 HTTPS URL 或 Data URI。"
    },
    "ratios": [
      "1:1",
      "16:9",
      "9:16",
      "2:3",
      "3:2",
      "4:3",
      "3:4"
    ],
    "pixelOptions": [
      "1024x1024",
      "1792x1024",
      "1024x1792"
    ],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": true
  },
  "grok-imagine-image-lite": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image-lite.json",
    "checkedAt": "2026-10-10T00:16:14.801Z",
    "sha256": "d92dad866745a5cb4b0d6388ae8a037593a5be8a9f118e3e14563229cab49dea",
    "intro": "仅文生图。张数 1。画幅用 size：1280x720（16:9）/ 720x1280（9:16）/ 960x960（1:1）。不要传参考图。各 size 同价。",
    "fields": {
      "model": "固定传 grok-imagine-image-lite。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "1280x720（16:9）/ 720x1280（9:16）/ 960x960（1:1）。不要传 4:3 等未列出比例。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。"
    },
    "ratios": [
      "16:9",
      "9:16",
      "1:1",
      "4:3"
    ],
    "pixelOptions": [
      "1280x720",
      "720x1280",
      "960x960"
    ],
    "customPixels": false,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": false
  },
  "seedream-5.0-pro-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/seedream-5.0-pro-x.json",
    "checkedAt": "2026-10-10T00:16:15.078Z",
    "sha256": "c359a8226e9ba9a3d0befb7edb413d1ffddf1b97b215e18054514cab43f98f8b",
    "intro": "seedream-5.0-pro-x 文生图和参考图编辑。清晰度 1K 或 2K。size 传比例或宽x高，其它比例就近收到 8 种画面。省略按 16:9、2K。参考图最多 10 张。不支持蒙版。不要和 doubao-seedream-5-0-pro 混用。",
    "fields": {
      "model": "固定传 seedream-5.0-pro-x。",
      "prompt": "图像描述，最多 8000 字符。",
      "n": "张数，只能为 1。",
      "size": "比例 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9，或宽x高，例如 1024x1024、2048x1152。其它比例就近收到这 8 种。省略按 16:9、2K。成品像素以返回图片为准。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 10 张。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。"
    },
    "ratios": [
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [
      "1024x1024",
      "2048x1152"
    ],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 10,
    "editing": true
  },
  "doubao-seedream-5-0-pro": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/doubao-seedream-5-0-pro.json",
    "checkedAt": "2026-10-10T00:16:15.324Z",
    "sha256": "9ca30a61cd797acbfaf654c5b835ea58f5f19c78f6159aea352d9d8f157c09e1",
    "intro": "doubao-seedream-5-0-pro。张数 1；size 为比例或 WIDTHxHEIGHT；参考图最多 10 张；不支持蒙版。各 size 同价。",
    "fields": {
      "model": "固定传 doubao-seedream-5-0-pro。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT，例如 1024x1024 / 2048x1152。也可传比例 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9。省略默认 1:1。",
      "output_format": "png 或 jpeg。省略默认 jpeg。",
      "response_format": "推荐 url，结果 HTTPS 地址。",
      "async": "true 时按创建端点轮询；省略或 false 为同步等待。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 10 张。"
    },
    "ratios": [
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "21:9"
    ],
    "pixelOptions": [
      "1024x1024",
      "2048x1152"
    ],
    "customPixels": true,
    "autoSize": false,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 10,
    "editing": true
  },
  "flux-pro-2": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/flux-pro-2.json",
    "checkedAt": "2026-10-10T00:16:18.247Z",
    "sha256": "f538fbfdbbe3743d7046be254683e5606d56e630287185bede6a876f72035934",
    "intro": "FLUX.2 Pro 异步图像。张数 1；size 为比例或 WIDTHxHEIGHT；参考图最多 16 张。",
    "fields": {
      "model": "固定传 flux-pro-2。",
      "prompt": "图像描述。",
      "n": "张数，只能为 1。",
      "size": "需要固定宽高时传 WIDTHxHEIGHT。也可传比例 1:1 / 3:2 / 2:3 / 16:9 / 9:16，或 auto。",
      "response_format": "推荐 url，结果为第一方 HTTPS 地址。",
      "async": "本 SKU 按异步使用，传 true 后轮询任务。",
      "images": "编辑请求的参考图 HTTPS URL 数组，最多 16 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 16,
    "editing": true
  }
};
