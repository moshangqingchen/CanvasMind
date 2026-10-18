/** Exact supplier model documents, each retaining its own checkedAt and SHA.
 *17 size descriptions updated18Oct; other rows retain their original sample.
 * Values and pixel examples remain model-specific; no generic K-to-pixel mapping. */
export interface CangyuanImageDocument { sourceLastReviewed?: string; sizeSuggestionsOnly?: boolean; parameterRules?: Record<string,{type?: string; description?: string; required?: boolean; enum?: Array<string | number>; suggestions?: Array<string | number>; min?: number; max?: number; default?: string | number | boolean; suggestedDefault?: string | number | boolean}>; dimensionRules?: {step?:number;maxSide?:number;minLongestEdge?:number;maxAspectRatio?:number;minPixels?:number;maxPixels?:number}; sourceUrl: string; checkedAt: string; sha256: string; intro: string; fields: Record<string,string>; ratios: string[]; pixelOptions: string[]; customPixels: boolean; autoSize: boolean; omitSizeAutomatic: boolean; qualityOptions: string[]; maxReferences?: number; editing: boolean; referenceDimensions?: Array<{resolution:string;aspectRatio:string;width:number;height:number}>; }
export const CANGYUAN_IMAGE_DOCUMENTS: Readonly<Record<string,CangyuanImageDocument>> = {
  "gpt-image-2": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.json",
    "checkedAt": "2026-10-13T00:53:23.107Z",
    "sha256": "1960540e67d4cdeb27678b60f922960c79bdc653a6765101cd827d42c3bd7b83",
    "intro": "gpt-image-2",
    "fields": {
      "model": "固定传 gpt-image-2。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-1k.json",
    "checkedAt": "2026-10-18T00:34:31.871Z",
    "sha256": "fa8d9de65b41d98888582347794b0c994d5817b6b73e30efd4fc3ab03d7141ca",
    "intro": "gpt-image-2-1k",
    "fields": {
      "model": "固定传 gpt-image-2-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 1048576
    }
  },
  "gpt-image-2-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-2k.json",
    "checkedAt": "2026-10-18T00:34:31.915Z",
    "sha256": "3b43de71d2696eab78ebcb76e092faf68446ce59e86c8f856204d34bdf08c0ec",
    "intro": "gpt-image-2-2k",
    "fields": {
      "model": "固定传 gpt-image-2-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 4194304
    }
  },
  "gpt-image-2-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json",
    "checkedAt": "2026-10-18T00:34:31.965Z",
    "sha256": "b52f38f59b80e7b12a4eda5b84f5e17917c3733d806c51fb120dd4894d7a4e63",
    "intro": "gpt-image-2-4k",
    "fields": {
      "model": "固定传 gpt-image-2-4k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 8294400
    }
  },
  "gpt-image-2-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json",
    "checkedAt": "2026-10-13T00:53:24.642Z",
    "sha256": "55835fd13f82cb4aebbd4f8b3f536bbf05df2af9576ac9fd29c2a10f1061b2f0",
    "intro": "gpt-image-2-x",
    "fields": {
      "model": "固定传 gpt-image-2-x。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "tier": "选择生成档位。支持值：web / 1k / 2k / 4k。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "tier": {
        "type": "string",
        "description": "选择生成档位。支持值：web / 1k / 2k / 4k。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "web",
          "1k",
          "2k",
          "4k"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5.json",
    "checkedAt": "2026-10-13T00:53:30.787Z",
    "sha256": "287b06ff5b304612d72d01e74de54eddd74c89d2280f50b5343452fd0e232deb",
    "intro": "gpt-image-2.5",
    "fields": {
      "model": "固定传 gpt-image-2.5。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-flare": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare.json",
    "checkedAt": "2026-10-13T00:53:33.853Z",
    "sha256": "afe3bf2c61c37757d684fb2d17a82cd334fab7cb7be0e595bf62f0e7c1b2867d",
    "intro": "gpt-image-2.5-flare",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-flare-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-1k.json",
    "checkedAt": "2026-10-18T00:34:32.203Z",
    "sha256": "37c268a2e55daf66c204603e2a5dcacb9b77d1b8e53fa96157b2b475dbddcecd",
    "intro": "gpt-image-2.5-flare-1k",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 1048576
    }
  },
  "gpt-image-2.5-flare-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-2k.json",
    "checkedAt": "2026-10-18T00:34:32.309Z",
    "sha256": "f88459c5793f8cb501749eead8a0832b1aaf3a57d5ffce58995e621f91f13daa",
    "intro": "gpt-image-2.5-flare-2k",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 4194304
    }
  },
  "gpt-image-2.5-flare-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-4k.json",
    "checkedAt": "2026-10-18T00:34:32.348Z",
    "sha256": "d6ab9fb4cf3df064dfd05984aff71d10393d18908b0dbef0132350b15e616ad7",
    "intro": "gpt-image-2.5-flare-4k",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-4k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 8294400
    }
  },
  "gpt-image-2.5-sunburst": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst.json",
    "checkedAt": "2026-10-13T00:53:36.927Z",
    "sha256": "9e0740aa05b8ee7c8ce4c5d4686a18abdf892bb9db6d6bd4464dab7c2eedfefa",
    "intro": "gpt-image-2.5-sunburst",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-sunburst-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-1k.json",
    "checkedAt": "2026-10-18T00:34:32.433Z",
    "sha256": "20b0c438c8d9d658765fdf1a31f643f70f5e8b174eba44f9e2d0b517112682d8",
    "intro": "gpt-image-2.5-sunburst-1k",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 1048576。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 1048576
    }
  },
  "gpt-image-2.5-sunburst-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-2k.json",
    "checkedAt": "2026-10-18T00:34:32.535Z",
    "sha256": "55971f3195b10db5105f87e9bb994e93685bbbd7ce4e95455084ddf6033a4ca8",
    "intro": "gpt-image-2.5-sunburst-2k",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 4194304。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 4194304
    }
  },
  "gpt-image-2.5-sunburst-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-4k.json",
    "checkedAt": "2026-10-18T00:34:32.582Z",
    "sha256": "b1eae3b2df44861eb71ba45f9fcf6097ce3db4c541a256ea980083fed1cce25e",
    "intro": "gpt-image-2.5-sunburst-4k",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-4k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。"
    },
    "ratios": [
      "1:1",
      "5:4",
      "7:6",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "4:5",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。宽高步长 16。最长边 3840。像素尺寸最大宽高比 3。最少像素 655360。最多像素 8294400。推荐值：1:1 / 5:4 / 7:6 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 4:5 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "5:4",
          "7:6",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "4:5",
          "3:4",
          "2:3"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "step": 16,
      "maxSide": 3840,
      "maxAspectRatio": 3,
      "minPixels": 655360,
      "maxPixels": 8294400
    }
  },
  "gpt-image-2.5-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-x.json",
    "checkedAt": "2026-10-13T00:53:44.611Z",
    "sha256": "9f223c6fe76aca562ad5289374415758383367aca234addee305c42202b6b1b3",
    "intro": "gpt-image-2.5-x",
    "fields": {
      "model": "固定传 gpt-image-2.5-x。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "tier": "选择生成档位。支持值：web / 1k / 2k / 4k。无法识别的值按未传处理。",
      "series": "选择生成档位。支持值：flare / sunburst。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "medium",
      "low",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：medium / low / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "medium",
          "low",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "tier": {
        "type": "string",
        "description": "选择生成档位。支持值：web / 1k / 2k / 4k。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "web",
          "1k",
          "2k",
          "4k"
        ]
      },
      "series": {
        "type": "string",
        "description": "选择生成档位。支持值：flare / sunburst。无法识别的值按未传处理。",
        "required": true,
        "enum": [
          "flare",
          "sunburst"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-o.json",
    "checkedAt": "2026-10-13T00:53:53.803Z",
    "sha256": "b5e22e20ea899a6708157829c422ee7bd3c818b444fd260c39b0c1dae6296924",
    "intro": "gpt-image-2-o",
    "fields": {
      "model": "固定传 gpt-image-2-o。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-21",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-flare-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-o.json",
    "checkedAt": "2026-10-13T00:53:47.684Z",
    "sha256": "5072d33ab5605d4972f5d261ee0b700c8b5cac3da081798258e0dd39c8e9be3e",
    "intro": "gpt-image-2.5-flare-o",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-o。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-21",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-sunburst-o": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-o.json",
    "checkedAt": "2026-10-13T00:53:46.139Z",
    "sha256": "db2ae5ff8598a16e3c209f094e62ff888d54e14284a2f8648b713a946e9f7c9e",
    "intro": "gpt-image-2.5-sunburst-o",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-o。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "16:9",
      "4:3",
      "3:4",
      "5:4",
      "4:5",
      "21:9",
      "2:3",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1536x864",
      "1536x1152",
      "1152x1536",
      "1280x1024",
      "1024x1280",
      "1536x656",
      "1024x1536"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-21",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 16:9 / 1536x864 / 4:3 / 1536x1152 / 3:4 / 1152x1536 / 5:4 / 1280x1024 / 4:5 / 1024x1280 / 21:9 / 1536x656 / 2:3 / 1024x1536 / auto / 9:16；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "16:9",
          "1536x864",
          "4:3",
          "1536x1152",
          "3:4",
          "1152x1536",
          "5:4",
          "1280x1024",
          "4:5",
          "1024x1280",
          "21:9",
          "1536x656",
          "2:3",
          "1024x1536",
          "auto",
          "9:16"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：auto / low / medium / high / xhigh / max。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
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
    "checkedAt": "2026-10-18T00:34:32.988Z",
    "sha256": "c6cf61d30cf4e3d082ff35213660ae71781946b7bf3c21c3f15918b823470a63",
    "intro": "nano-banana-pro-1k",
    "fields": {
      "model": "固定传 nano-banana-pro-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 1024。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 1024。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "3:4",
          "2:3"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "maxSide": 1024
    }
  },
  "nano-banana-pro-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro-2k.json",
    "checkedAt": "2026-10-18T00:34:33.016Z",
    "sha256": "0ba285b859475ce8f51dbfa2dbcea33f0762c1ece95ad8fd49c8a4ce1bcfb044",
    "intro": "nano-banana-pro-2k",
    "fields": {
      "model": "固定传 nano-banana-pro-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 2048。最长边至少 1025。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 2048。最长边至少 1025。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "3:4",
          "2:3"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "maxSide": 2048,
      "minLongestEdge": 1025
    }
  },
  "nano-banana-pro-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana-pro-4k.json",
    "checkedAt": "2026-10-18T00:34:33.114Z",
    "sha256": "5607e23d19f367602187dde74de7bf9efa6a3ceb9cf4aa7bd204e5ce3bb41b94",
    "intro": "nano-banana-pro-4k",
    "fields": {
      "model": "固定传 nano-banana-pro-4k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边至少 2049。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "9:16",
      "21:9",
      "16:9",
      "3:2",
      "4:3",
      "3:4",
      "2:3"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边至少 2049。推荐值：1:1 / 9:16 / 21:9 / 16:9 / 3:2 / 4:3 / 3:4 / 2:3；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "9:16",
          "21:9",
          "16:9",
          "3:2",
          "4:3",
          "3:4",
          "2:3"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "minLongestEdge": 2049
    }
  },
  "gemini-3-pro-image-preview": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-3-pro-image-preview.json",
    "checkedAt": "2026-10-13T00:53:56.876Z",
    "sha256": "e185aaa695781e20ce573eb7817a4004c093e246fe556a5258f7f87be15a45cc",
    "intro": "gemini-3-pro-image-preview",
    "fields": {
      "model": "固定传 gemini-3-pro-image-preview。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / auto；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "1k",
      "2k",
      "4k"
    ],
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "maxReferences": 9,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / auto；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
          "auto"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "1k",
          "2k",
          "4k"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "nano-banana2-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-1k.json",
    "checkedAt": "2026-10-18T00:34:33.128Z",
    "sha256": "4713d4ddb277528c34758e064217251bc39a02b00eb9697f2fe949fc3184f1db",
    "intro": "nano-banana2-1k",
    "fields": {
      "model": "固定传 nano-banana2-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 1024。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 1024。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "maxSide": 1024
    }
  },
  "nano-banana2-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-2k.json",
    "checkedAt": "2026-10-18T00:34:33.214Z",
    "sha256": "5242f3c66aefe5fe73be647bb098f9f6ac62b0eafa87d43e0a38f99e4b067778",
    "intro": "nano-banana2-2k",
    "fields": {
      "model": "固定传 nano-banana2-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 2048。最长边至少 1025。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 9,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边 2048。最长边至少 1025。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "maxSide": 2048,
      "minLongestEdge": 1025
    }
  },
  "nano-banana2-4k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-4k.json",
    "checkedAt": "2026-10-18T00:34:33.234Z",
    "sha256": "1287cfe2d5521e171dff2be8421fcaa67aec8463296f14348988369b56911f6c",
    "intro": "nano-banana2-4k",
    "fields": {
      "model": "固定传 nano-banana2-4k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。最长边至少 2049。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。最长边至少 2049。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    },
    "dimensionRules": {
      "minLongestEdge": 2049
    }
  },
  "gemini-3.1-flash-image-preview": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-3.1-flash-image-preview.json",
    "checkedAt": "2026-10-13T00:54:01.488Z",
    "sha256": "8464c0e53ed0e45be2883b1063082873b1febc94cbfb80e1af032a604f3bbfa4",
    "intro": "gemini-3.1-flash-image-preview",
    "fields": {
      "model": "固定传 gemini-3.1-flash-image-preview。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / 8:1 / 8:1 / 4:1 / 4:1 / 1:4 / 1:4 / 1:8 / 1:8 / auto；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 9 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "1k",
      "2k",
      "4k"
    ],
    "editing": true,
    "sourceLastReviewed": "2026-09-26",
    "maxReferences": 9,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / 8:1 / 8:1 / 4:1 / 4:1 / 1:4 / 1:4 / 1:8 / 1:8 / auto；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
          "1:8",
          "auto"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "1k",
          "2k",
          "4k"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gemini-nano-banana-2.1": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json",
    "checkedAt": "2026-10-13T00:54:04.553Z",
    "sha256": "e193919067ce449fa526d793f7f765bc4baf67c3b23583192c9e94240468a2b9",
    "intro": "gemini-nano-banana-2.1",
    "fields": {
      "model": "固定传 gemini-nano-banana-2.1。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / auto；推荐值不代表完整允许集合。",
      "quality": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 14 个。"
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
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "1k",
      "2k",
      "4k"
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
    ],
    "sourceLastReviewed": "2026-10-07",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1:1 / 16:9 / 16:9 / 9:16 / 9:16 / 4:3 / 4:3 / 3:4 / 3:4 / 3:2 / 3:2 / 2:3 / 2:3 / 5:4 / 5:4 / 4:5 / 4:5 / 21:9 / 21:9 / auto；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
          "auto"
        ]
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：1k / 2k / 4k。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "1k",
          "2k",
          "4k"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "midjourney-v7": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-v7.json",
    "checkedAt": "2026-10-13T00:54:07.632Z",
    "sha256": "9b37437d8e0281b8a997323c0be659e0a813a5c2b55bbf87f93c36836da3e7da",
    "intro": "midjourney-v7",
    "fields": {
      "model": "固定传 midjourney-v7。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 5 个。"
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
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 5,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "midjourney-1k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-1k.json",
    "checkedAt": "2026-10-18T00:34:32.865Z",
    "sha256": "0bc506c6af9878c8ef57714e26aee9ee25dc5e0b893120175530b3f5f5909198",
    "intro": "midjourney-1k",
    "fields": {
      "model": "固定传 midjourney-1k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:2 / 1:2 / 6:11 / 6:11 / 9:16 / 9:16 / 2:3 / 2:3 / 3:4 / 3:4 / 4:5 / 4:5 / 5:6 / 5:6 / 1:1 / 1:1 / 2:1 / 2:1 / 11:6 / 11:6 / 16:9 / 16:9 / 3:2 / 3:2 / 4:3 / 4:3 / 5:4 / 5:4 / 6:5 / 6:5；推荐值不代表完整允许集合。",
      "speed": "生成速度。支持值：relax / fast。无法识别的值按未传处理。",
      "reference": "参考方式。支持值：image / style / edit / moodboard / editor。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 4 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 4,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:2 / 1:2 / 6:11 / 6:11 / 9:16 / 9:16 / 2:3 / 2:3 / 3:4 / 3:4 / 4:5 / 4:5 / 5:6 / 5:6 / 1:1 / 1:1 / 2:1 / 2:1 / 11:6 / 11:6 / 16:9 / 16:9 / 3:2 / 3:2 / 4:3 / 4:3 / 5:4 / 5:4 / 6:5 / 6:5；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
        ]
      },
      "speed": {
        "type": "string",
        "description": "生成速度。支持值：relax / fast。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "relax",
          "fast"
        ],
        "suggestedDefault": "relax"
      },
      "reference": {
        "type": "string",
        "description": "参考方式。支持值：image / style / edit / moodboard / editor。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "image",
          "style",
          "edit",
          "moodboard",
          "editor"
        ],
        "suggestedDefault": "image"
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "midjourney-2k": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/midjourney-2k.json",
    "checkedAt": "2026-10-18T00:34:32.897Z",
    "sha256": "8ae99ab62b1243b9951bcc2693ef6f5e61e86b85fd4c9c222f1c6002eb42a56c",
    "intro": "midjourney-2k",
    "fields": {
      "model": "固定传 midjourney-2k。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:2 / 1:2 / 6:11 / 6:11 / 9:16 / 9:16 / 2:3 / 2:3 / 3:4 / 3:4 / 4:5 / 4:5 / 5:6 / 5:6 / 1:1 / 1:1 / 2:1 / 2:1 / 11:6 / 11:6 / 16:9 / 16:9 / 3:2 / 3:2 / 4:3 / 4:3 / 5:4 / 5:4 / 6:5 / 6:5；推荐值不代表完整允许集合。",
      "speed": "生成速度。支持值：relax / fast。无法识别的值按未传处理。",
      "reference": "参考方式。支持值：image / style / edit / moodboard / editor。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 4 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 4,
    "editing": true,
    "sourceLastReviewed": "2026-09-29",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:2 / 1:2 / 6:11 / 6:11 / 9:16 / 9:16 / 2:3 / 2:3 / 3:4 / 3:4 / 4:5 / 4:5 / 5:6 / 5:6 / 1:1 / 1:1 / 2:1 / 2:1 / 11:6 / 11:6 / 16:9 / 16:9 / 3:2 / 3:2 / 4:3 / 4:3 / 5:4 / 5:4 / 6:5 / 6:5；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
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
        ]
      },
      "speed": {
        "type": "string",
        "description": "生成速度。支持值：relax / fast。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "relax",
          "fast"
        ],
        "suggestedDefault": "relax"
      },
      "reference": {
        "type": "string",
        "description": "参考方式。支持值：image / style / edit / moodboard / editor。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "image",
          "style",
          "edit",
          "moodboard",
          "editor"
        ],
        "suggestedDefault": "image"
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "grok-imagine-image": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image.json",
    "checkedAt": "2026-10-13T00:54:06.092Z",
    "sha256": "932f84b5b4bdae1465f36ad725f7355289402d1ad5918295c09040b7edd2789c",
    "intro": "grok-imagine-image",
    "fields": {
      "model": "固定传 grok-imagine-image。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1024x1024 / 1024x1024 / 1792x1024 / 1792x1024 / 1024x1792 / 1024x1792 / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 8 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "pixelOptions": [
      "1024x1024",
      "1792x1024",
      "1024x1792"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": true,
    "sourceLastReviewed": "2026-09-20",
    "maxReferences": 8,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1024x1024 / 1024x1024 / 1792x1024 / 1792x1024 / 1024x1792 / 1024x1792 / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1024x1024",
          "1792x1024",
          "1024x1792",
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "grok-imagine-image-2.0": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image-2.0.json",
    "checkedAt": "2026-10-13T00:54:13.748Z",
    "sha256": "ebd68d391f4bf95feb78e3b1505502d36c90ca08d637121f7ef87289fb6df77f",
    "intro": "grok-imagine-image-2.0",
    "fields": {
      "model": "固定传 grok-imagine-image-2.0。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1024x1024 / 1024x1024 / 1792x1024 / 1792x1024 / 1024x1792 / 1024x1792 / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 8 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
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
    "pixelOptions": [
      "1024x1024",
      "1792x1024",
      "1024x1792"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": true,
    "sourceLastReviewed": "2026-09-20",
    "maxReferences": 8,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1024x1024 / 1024x1024 / 1792x1024 / 1792x1024 / 1024x1792 / 1024x1792 / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1024x1024",
          "1792x1024",
          "1024x1792",
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "grok-imagine-image-lite": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/grok-imagine-image-lite.json",
    "checkedAt": "2026-10-13T00:54:18.347Z",
    "sha256": "67ed8ccf1bea5d20b80d34bf274511b9051d64f9445796d4bd23c3bfadf1abd1",
    "intro": "grok-imagine-image-lite",
    "fields": {
      "model": "固定传 grok-imagine-image-lite。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1280x720 / 1280x720 / 720x1280 / 720x1280 / 960x960 / 960x960；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。"
    },
    "ratios": [],
    "pixelOptions": [
      "1280x720",
      "720x1280",
      "960x960"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "editing": false,
    "sourceLastReviewed": "2026-09-20",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1280x720 / 1280x720 / 720x1280 / 720x1280 / 960x960 / 960x960；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1280x720",
          "720x1280",
          "960x960"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "seedream-5.0-pro-x": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/seedream-5.0-pro-x.json",
    "checkedAt": "2026-10-13T00:54:10.693Z",
    "sha256": "5b4b630f66b69940e6baf1be26943f1dd3aab3a2333b75ea44e6dde9eb61abec",
    "intro": "seedream-5.0-pro-x",
    "fields": {
      "model": "固定传 seedream-5.0-pro-x。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 10 个。"
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
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 10,
    "editing": true,
    "sourceLastReviewed": "2026-09-30",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "doubao-seedream-5-0-pro": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/doubao-seedream-5-0-pro.json",
    "checkedAt": "2026-10-13T00:54:12.223Z",
    "sha256": "ca78d55e38d61fd075d517ba0d16ca065034ac7095f30dc109a194ac7cd88ef8",
    "intro": "doubao-seedream-5-0-pro",
    "fields": {
      "model": "固定传 doubao-seedream-5-0-pro。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
      "output_format": "输出图片格式。支持值：jpeg / png。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 10 个。"
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
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 10,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "3:2",
          "2:3",
          "21:9"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：jpeg / png。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "jpeg",
          "png"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "flux-pro-2": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/flux-pro-2.json",
    "checkedAt": "2026-10-13T00:54:16.811Z",
    "sha256": "7aa1fed17bc0eeced96efd67c28f147001a25be16199cc20746dae562535dc7a",
    "intro": "flux-pro-2",
    "fields": {
      "model": "固定传 flux-pro-2。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 1。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 2:3 / 1024x1536 / 16:9 / 1920x1080 / 9:16 / 1080x1920 / 1:1-max / 1920x1920 / auto；推荐值不代表完整允许集合。",
      "output_format": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
      "output_compression": "输出压缩质量。最小 0。最大 100。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16"
    ],
    "pixelOptions": [
      "1024x1024",
      "1536x1024",
      "1024x1536",
      "1920x1080",
      "1080x1920",
      "1920x1920"
    ],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 16,
    "editing": true,
    "sourceLastReviewed": "2026-09-15",
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 1。",
        "required": false,
        "min": 1,
        "max": 1
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 1024x1024 / 3:2 / 1536x1024 / 2:3 / 1024x1536 / 16:9 / 1920x1080 / 9:16 / 1080x1920 / 1:1-max / 1920x1920 / auto；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "1024x1024",
          "3:2",
          "1536x1024",
          "2:3",
          "1024x1536",
          "16:9",
          "1920x1080",
          "9:16",
          "1080x1920",
          "1:1-max",
          "1920x1920",
          "auto"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg / webp。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg",
          "webp"
        ]
      },
      "output_compression": {
        "type": "integer",
        "description": "输出压缩质量。最小 0。最大 100。",
        "required": false,
        "min": 0,
        "max": 100,
        "suggestedDefault": 100
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2-az": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-az.json",
    "checkedAt": "2026-10-13T00:54:33.939Z",
    "sha256": "d7ca14039442299b269a765a84182607cba2938ea3cd732c6d0b23bf9e0906c8",
    "sourceLastReviewed": "2026-10-11",
    "intro": "gpt-image-2-az",
    "fields": {
      "model": "固定传 gpt-image-2-az。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。",
      "quality": "输出质量。支持值：low / medium / high。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
      "output_compression": "输出压缩质量。最小 0。最大 100。",
      "moderation": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [
      "low",
      "medium",
      "high"
    ],
    "maxReferences": 16,
    "editing": true,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。",
        "required": false
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：low / medium / high。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "low",
          "medium",
          "high"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg"
        ]
      },
      "output_compression": {
        "type": "integer",
        "description": "输出压缩质量。最小 0。最大 100。",
        "required": false,
        "min": 0,
        "max": 100,
        "suggestedDefault": 100
      },
      "moderation": {
        "type": "string",
        "description": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-flare-az": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-az.json",
    "checkedAt": "2026-10-13T00:54:35.466Z",
    "sha256": "84723c43fdade09d39971311a13c7ee95a70541d8a69753a2bd462892655f76d",
    "sourceLastReviewed": "2026-10-11",
    "intro": "gpt-image-2.5-flare-az",
    "fields": {
      "model": "固定传 gpt-image-2.5-flare-az。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。",
      "quality": "输出质量。支持值：low / medium / high / xhigh / max / auto。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
      "output_compression": "输出压缩质量。最小 0。最大 100。",
      "moderation": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [],
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
    "editing": true,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。",
        "required": false
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：low / medium / high / xhigh / max / auto。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "auto"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg"
        ]
      },
      "output_compression": {
        "type": "integer",
        "description": "输出压缩质量。最小 0。最大 100。",
        "required": false,
        "min": 0,
        "max": 100,
        "suggestedDefault": 100
      },
      "moderation": {
        "type": "string",
        "description": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "gpt-image-2.5-sunburst-az": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-az.json",
    "checkedAt": "2026-10-13T00:54:36.997Z",
    "sha256": "263d971e48eecaeebdd4ad4f4ba98df28b92f60b73657f7fbb2f99f2086d615f",
    "sourceLastReviewed": "2026-10-11",
    "intro": "gpt-image-2.5-sunburst-az",
    "fields": {
      "model": "固定传 gpt-image-2.5-sunburst-az。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。",
      "quality": "输出质量。支持值：low / medium / high / xhigh / max / auto。无法识别的值按未传处理。",
      "background": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
      "output_format": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
      "output_compression": "输出压缩质量。最小 0。最大 100。",
      "moderation": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 16 个。",
      "mask": "编辑请求的蒙版 HTTPS URL，最多 1 张。"
    },
    "ratios": [],
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
    "editing": true,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。",
        "required": false
      },
      "quality": {
        "type": "string",
        "description": "输出质量。支持值：low / medium / high / xhigh / max / auto。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "auto"
        ]
      },
      "background": {
        "type": "string",
        "description": "背景类型。支持值：auto / opaque / transparent。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "opaque",
          "transparent"
        ]
      },
      "output_format": {
        "type": "string",
        "description": "输出图片格式。支持值：png / jpeg。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "png",
          "jpeg"
        ]
      },
      "output_compression": {
        "type": "integer",
        "description": "输出压缩质量。最小 0。最大 100。",
        "required": false,
        "min": 0,
        "max": 100,
        "suggestedDefault": 100
      },
      "moderation": {
        "type": "string",
        "description": "内容审核级别。支持值：auto / low。无法识别的值按未传处理。",
        "required": false,
        "enum": [
          "auto",
          "low"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  },
  "doubao-seedream-5-0-flash": {
    "sourceUrl": "https://ai.cangyuansuanli.cn/docs-static/models/doubao-seedream-5-0-flash.json",
    "checkedAt": "2026-10-13T00:54:38.516Z",
    "sha256": "007bb5b96aaa0606400ce5974c51a34a1cc6e657ea17c057c78cff7e68b8ee78",
    "sourceLastReviewed": "2026-10-11",
    "intro": "Seedream 5.0 Flash 图像生成与编辑。",
    "fields": {
      "model": "固定传 doubao-seedream-5-0-flash。",
      "prompt": "生成内容的描述。",
      "n": "生成张数。最小 1。最大 10。",
      "size": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 3:2 / 2:3 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9；推荐值不代表完整允许集合。",
      "response_format": "url 返回结果地址，b64_json 返回 Base64。",
      "async": "true 创建异步任务；省略或 false 为同步等待。",
      "images": "参考图 HTTPS URL 数组，最多 10 个。"
    },
    "ratios": [
      "1:1",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "21:9"
    ],
    "pixelOptions": [],
    "customPixels": true,
    "autoSize": true,
    "omitSizeAutomatic": false,
    "qualityOptions": [],
    "maxReferences": 10,
    "editing": true,
    "sizeSuggestionsOnly": true,
    "parameterRules": {
      "n": {
        "type": "integer",
        "description": "生成张数。最小 1。最大 10。",
        "required": false,
        "min": 1,
        "max": 10
      },
      "size": {
        "type": "string",
        "description": "画面比例或 WIDTHxHEIGHT 尺寸。推荐值：1:1 / 3:2 / 2:3 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9；推荐值不代表完整允许集合。",
        "required": false,
        "suggestions": [
          "1:1",
          "3:2",
          "2:3",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "21:9"
        ]
      },
      "response_format": {
        "type": "string",
        "description": "url 返回结果地址，b64_json 返回 Base64。",
        "required": false,
        "enum": [
          "url",
          "b64_json"
        ]
      },
      "async": {
        "type": "boolean",
        "description": "true 创建异步任务；省略或 false 为同步等待。",
        "required": false
      }
    }
  }
};
