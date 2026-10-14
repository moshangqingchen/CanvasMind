// Extracted from official per-model documents, fresh GET 2026-10-12 (America/Los_Angeles);
// individually rechecked/new contracts carry their own checkedAt date.
// Source: https://ai.cangyuansuanli.cn/docs-static/models/{id}.json
// Public documentation does not grant a Key permission to use a model.
export interface CangyuanVideoContractData {
 checkedAt?: string; sourceSha256?: string; sourceLastReviewed?: string; forbiddenResolutionValues?: readonly string[]; requiresReferenceImage?: boolean; requiresReferenceMedia?: boolean; facePolicy?: "open" | "backend" | "blocked"; warnings?: readonly string[]; fixedResolution?: string;
 fields: readonly string[];
 parameters: readonly { key: string; description: string; valueType?: string; required?: boolean; suggestions?: readonly (string | number)[]; suggestedDefault?: string | number | boolean; values?: readonly (string | number)[]; min?: number; max?: number; default?: string | number | boolean }[];
 references: { images: number | null; videos: number | null; audios: number | null };
 frames: boolean; framePairRequired: boolean; allowFrameMediaMix: boolean;
 inputMimeTypes?: { image?: readonly string[]; video?: readonly string[]; audio?: readonly string[] }; maxInputBytes?: { image?: number; video?: number; audio?: number };
 maxInputDimensions?: { video?: { width: number; height: number } };
 videoObjects?: boolean; maxTotalInputVideoDurationSeconds?: number; maxInputAssets?: number;
 minInputVideoDurationSeconds?: number; maxInputVideoDurationSeconds?: number; minTotalInputVideoDurationSeconds?: number;
 minInputAudioDurationSeconds?: number; maxInputAudioDurationSeconds?: number;
 maxOutputAndInputVideoDurationSeconds?: number; durationMaxWithReferenceVideo?: number; requiresImageWithAudio?: boolean;
 maxTotalInputAudioDurationSeconds?: number; approximateDurationSeconds?: number; maxPromptCharacters?: number;
}
export const CANGYUAN_CURRENT_VIDEO_CONTRACTS: Readonly<Record<string, CangyuanVideoContractData>> = {
  "sd8-seedance-2.5-s": {
    "checkedAt": "2026-10-13T00:58:41.494Z",
    "facePolicy": "open",
    "fixedResolution": "720p",
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 30。最大 30。",
        "valueType": "integer",
        "min": 30,
        "max": 30,
        "values": [
          30
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "sourceSha256": "8eb902e88b76bac89e1b345c5cd69ec38a8fd850f1825db17a07a37c15062452",
    "sourceLastReviewed": "2026-10-08"
  },
  "minimax-h3-2k": {
    "checkedAt": "2026-10-13T00:50:28.504Z",
    "minInputVideoDurationSeconds": 2,
    "maxInputVideoDurationSeconds": 15,
    "minInputAudioDurationSeconds": 2,
    "maxInputAudioDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。",
        "valueType": "string"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "maxTotalInputVideoDurationSeconds": 15,
    "sourceSha256": "9393fcb34229103f8b2f20a87120f19c562f0623649b7d1561f3d0eebc8f6f99",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "seedance-2.0-720p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "时长秒数，可选 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15。",
        "values": [
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。",
        "values": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "清晰度，固定 720p。",
        "values": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频，true / false。"
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false
  },
  "seedance-2.0-1080p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "时长秒数，可选 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15。",
        "values": [
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。",
        "values": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "清晰度，固定 1080p。",
        "values": [
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频，true / false。"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "时长秒数，可选 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15。",
        "values": [
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。",
        "values": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "清晰度，固定 720p。",
        "values": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频，true / false。"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "wan3.0-15s": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 1:1 / 9:16 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "1:1",
          "9:16",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p"
        ]
      }
    ],
    "references": {
      "images": 10,
      "videos": 5,
      "audios": 5
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:37.692Z",
    "sourceSha256": "dbec17a79a66abab931435c5325c1e3e29335b759f73d14699bdc7cf28184c85",
    "sourceLastReviewed": "2026-09-15"
  },
  "wan3.0-video": {
    "checkedAt": "2026-10-13T00:50:34.617Z",
    "maxTotalInputVideoDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 30。",
        "valueType": "integer",
        "min": 5,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p"
        ]
      }
    ],
    "references": {
      "images": 10,
      "videos": 5,
      "audios": 5
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "sourceSha256": "b07c853e2aad490c23b09080e8d956891b94568e4914abb8a97b02e833d45f51",
    "sourceLastReviewed": "2026-09-15"
  },
  "grok-video": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:48.406Z",
    "sourceSha256": "1d4b8b4142063e6ca5143f0022d6ce37343f685e1031aa5c6515e5838382665e",
    "sourceLastReviewed": "2026-09-15"
  },
  "grok-video-1.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:36.145Z",
    "sourceSha256": "add2f6a433bf46b8e6986d14577d842a31ef118d75f35c1b73033587b88671d7",
    "sourceLastReviewed": "2026-09-15",
    "requiresReferenceMedia": true
  },
  "grok-imagine-video": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 1。最大 15。",
        "valueType": "integer",
        "min": 1,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      }
    ],
    "references": {
      "images": 1,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:43.808Z",
    "sourceSha256": "cb817804f2aecbad101fad70a500e471e53d8e448f576dc631605b5ac103e878",
    "sourceLastReviewed": "2026-09-15"
  },
  "grok-imagine-video-1.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 1。最大 15。",
        "valueType": "integer",
        "min": 1,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p"
        ]
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:39.227Z",
    "sourceSha256": "ed4472711ea90bc69f711c0c7a0dc01147c831f11ae9f356b97361668ab0cdee",
    "sourceLastReviewed": "2026-09-15"
  },
  "grok-imagine-video-6s": {
    "fields": [
      "aspect_ratio",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1。省略默认 9:16。",
        "values": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "9:16"
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "时长秒数，4–15。",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。",
        "values": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "清晰度，可选 480p / 720p。",
        "values": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频，true / false。"
      }
    ],
    "references": {
      "images": 4,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false
  },
  "seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "时长秒数，4–15。",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画幅比例，可选 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。",
        "values": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "清晰度，可选 480p / 720p。",
        "values": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频，true / false。"
      }
    ],
    "references": {
      "images": 4,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false
  },
  "veo-3.1": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 8。",
        "valueType": "integer",
        "min": 4,
        "max": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 3,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:45.348Z",
    "sourceSha256": "d61bd90562e28f2c4ae80d0c61b0039fc5f7bbc864a0819fcb5ba2d7fbfe9670",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "veo-3.1-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 8。",
        "valueType": "integer",
        "min": 4,
        "max": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:52.992Z",
    "sourceSha256": "cb3e18167e9dc5d5352a8e15df07fbead09e97931dffccbce690944ba28c5dc5",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "kling-3.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "generate_audio",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 1:1 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "1:1",
          "9:16"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 1,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:51.453Z",
    "sourceSha256": "c746c9a4e23e03952194fc0cad737c794a98580396da19daa124c2bad05754c3",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 10485760
    }
  },
  "kling-3.0-pro": {
    "fields": [
      "duration",
      "aspect_ratio",
      "generate_audio",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 1:1 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "1:1",
          "9:16"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 4,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:49.932Z",
    "sourceSha256": "9126f14026ad54dd09d2e48b65cffdd82f79a00e5fd1202513ce573655234880",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 10485760
    }
  },
  "kling-3.0-omni": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 1:1 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "1:1",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:54.517Z",
    "sourceSha256": "6926e281599cce41b0f942fe384e534cc8cf9796d44035440b2722cae1cbda3e",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "gemini-omni-flash": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 10。",
        "valueType": "integer",
        "min": 4,
        "max": 10
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      }
    ],
    "references": {
      "images": 1,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:56.042Z",
    "sourceSha256": "45c62f760a47ce70eba478a65a91b3b51ee89b8459bde29d660d95fe50f8d56b",
    "sourceLastReviewed": "2026-09-15"
  },
  "happyhouse-1.0": {
    "checkedAt": "2026-10-13T00:51:02.138Z",
    "minInputVideoDurationSeconds": 3,
    "maxInputVideoDurationSeconds": 10,
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 1,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "sourceSha256": "bafd58792b85fb1b9ef034ca6c0d9f3ab5396c1689906824aa48b27ddb4d24ac",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200
    }
  },
  "happyhouse-1.1": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:50:59.096Z",
    "sourceSha256": "044c78c2fd4929ff9284120a1dffc46731c32a366caa3ef8f3ad8b70dcc501c4",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400
    }
  },
  "happyhorse-1.1": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / 9:21 / 5:4 / 4:5；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "9:21",
          "5:4",
          "4:5"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：1080p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1080p",
          "720p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:03.664Z",
    "sourceSha256": "3e0b186845dc8b1a01df488f0b80de71e9e1659dd3aabbf2e10ce2e541bcc96e",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 10485760
    }
  },
  "minimax-h3-768p": {
    "checkedAt": "2026-10-13T00:51:06.720Z",
    "minInputVideoDurationSeconds": 2,
    "maxInputVideoDurationSeconds": 15,
    "minInputAudioDurationSeconds": 2,
    "maxInputAudioDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。",
        "valueType": "string"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "maxTotalInputVideoDurationSeconds": 15,
    "sourceSha256": "f94fff11a497e32d1809b7ed1b612b9f9fc082e034e79aa51200cfe73081a961",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "omni-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。",
        "valueType": "integer"
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 5,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:05.194Z",
    "sourceSha256": "da16ce7d2220ba8f1f43569b71de3bf00a153d45375226a317cdfb3d3696c7a2",
    "sourceLastReviewed": "2026-09-15"
  },
  "omni-fast-no-water": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。",
        "valueType": "integer"
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 5,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:08.252Z",
    "sourceSha256": "01a228def1c787df9e020c121507c38acfa4c8a3ae17640e29ab735e41c0eaa6",
    "sourceLastReviewed": "2026-09-15"
  },
  "omni-v2v": {
    "checkedAt": "2026-10-13T00:51:15.893Z",
    "maxInputBytes": {
      "image": 8000000,
      "video": 8000000
    },
    "maxInputDimensions": {
      "video": {
        "width": 1920,
        "height": 1080
      }
    },
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。",
        "valueType": "integer"
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 5,
      "videos": 2,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "sourceSha256": "cc172825388ea24d02d4578d7b23768df0c2667f356c88e6173f9d522809a38c",
    "sourceLastReviewed": "2026-09-15",
    "requiresReferenceMedia": true
  },
  "omni-v2v-no-water": {
    "checkedAt": "2026-10-13T00:51:09.778Z",
    "maxInputBytes": {
      "image": 8000000,
      "video": 8000000
    },
    "maxInputDimensions": {
      "video": {
        "width": 1920,
        "height": 1080
      }
    },
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。",
        "valueType": "integer"
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 5,
      "videos": 2,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "sourceSha256": "c7df456803e6de22aa9bf9d1e2027e736065e4e1bcf62b9147e701efedfdfb96",
    "sourceLastReviewed": "2026-09-15",
    "requiresReferenceMedia": true
  },
  "sd4-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 4,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:11.313Z",
    "sourceSha256": "c5155f25259de541c1dd82bb5ba9ff03076cea219c9f2304b22e746e1a1a6638",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "sd4-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 4,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:17.436Z",
    "sourceSha256": "908efdd14d936383e4b96eb1a2c9d586c65c0f7e2986f50e9e5f5c5afc41b43a",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "sd4-seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 4,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:12.834Z",
    "sourceSha256": "5d89ec44cf55a63986e675ac058e8676ded1df8497fe792ad074e769dd82000a",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "sd4-seedance-2.5-480p": {
    "checkedAt": "2026-10-13T00:51:14.371Z",
    "maxInputVideoDurationSeconds": 30.2,
    "maxTotalInputVideoDurationSeconds": 30.2,
    "maxInputAudioDurationSeconds": 30.2,
    "maxTotalInputAudioDurationSeconds": 30.2,
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 29。",
        "valueType": "integer",
        "min": 4,
        "max": 29
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。",
        "valueType": "string"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "sourceSha256": "5a1aff1ba21c9a048850afbe847d2d2f9b8a83439a28ad997df102b38dbe7936",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "sd4-seedance-2.5-720p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 29。",
        "valueType": "integer",
        "min": 4,
        "max": 29
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 3:4 / 4:3；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "3:4",
          "4:3"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。",
        "valueType": "string"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "durationMaxWithReferenceVideo": 18,
    "maxInputVideoDurationSeconds": 30.2,
    "maxTotalInputVideoDurationSeconds": 30.2,
    "maxInputAudioDurationSeconds": 30.2,
    "maxTotalInputAudioDurationSeconds": 30.2,
    "checkedAt": "2026-10-13T00:51:20.485Z",
    "sourceSha256": "936f5f6e51e1fc3ae806d3576d42d772eef8a97e8f12e404b2a42b5214cf5d37",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    }
  },
  "sd5-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:22.008Z",
    "sourceSha256": "84c2242c20abe7e4158b4d0663aaadfdd931b8ce5aff87080e49d8ac478eb995",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800,
      "audio": 15728640
    }
  },
  "sd5-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:18.964Z",
    "sourceSha256": "e906e6b689ffbc719d39cd7bd337517743abb261e1854badceaf49a5fb17e943",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800,
      "audio": 15728640
    }
  },
  "sd6-seedance-2.0-720p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:23.541Z",
    "sourceSha256": "cd6cfe7f875f4b77a71c2db03dad9ac13ad7b3e255767e64be893c846329f08e",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd6-seedance-2.0-1080p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 1
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:58:31.815Z",
    "sourceSha256": "c3a8e184e76232984e570a63bce4ccf1a504f9df71ead241e30a2abb8a65a5ad",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd7-seedance-2.0-720p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:51:25.063Z",
    "sourceSha256": "ad919947a869808bc14226bff4d31dd9b1718d5ff098f45742f06dae061de030",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd7-seedance-2.0-1080p": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 5,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:58:36.655Z",
    "sourceSha256": "a4890f70d6047921c805670914dedd95b1fb53951e9732b766348848d5f88154",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd8-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 1。最大 15。",
        "valueType": "integer",
        "min": 1,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:58:39.071Z",
    "sourceSha256": "42e62a282920b19e521590fad274742c6c839cd43c211d0cbb8d8e44ac73bbf0",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd8-seedance-2.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 30。最大 30。",
        "valueType": "integer",
        "min": 30,
        "max": 30,
        "values": [
          30
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:58:34.232Z",
    "sourceSha256": "c7833caf9ed75f317b6060bf1547d22a73e7ebc1b6db28a640ada22e23fa8af8",
    "sourceLastReviewed": "2026-09-15"
  },
  "doubao-seedance-2-0-260128": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url",
      "face_mode"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      },
      {
        "key": "face_mode",
        "valueType": "boolean",
        "description": "当前 Seedance 线路说明与统一视频文档：官转真人参考可使用 face_mode 或先素材入库；不得把 asset:// 与代审核混用。"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:52:27.047Z",
    "sourceSha256": "726d4acb4ba8b21617b84da700205e823c7c78b26ca0dc6d4b216ad9bf67d891",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "doubao-seedance-2-0-fast-260128": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url",
      "face_mode"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      },
      {
        "key": "face_mode",
        "valueType": "boolean",
        "description": "当前 Seedance 线路说明与统一视频文档：官转真人参考可使用 face_mode 或先素材入库；不得把 asset:// 与代审核混用。"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:52:25.512Z",
    "sourceSha256": "1be2452962e44fa0947d7dd9ac692d75d33efd658eae3576c034fefaaf0ac9e8",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "doubao-seedance-2-0-mini-260615": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url",
      "face_mode"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      },
      {
        "key": "face_mode",
        "valueType": "boolean",
        "description": "当前 Seedance 线路说明与统一视频文档：官转真人参考可使用 face_mode 或先素材入库；不得把 asset:// 与代审核混用。"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:52:40.170Z",
    "sourceSha256": "f73459adf12c6a1c7b6a800bfa5ce100977d1ba13397a3bf15b3e0d96165c0fd",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "doubao-seedance-2-5-260628": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url",
      "face_mode"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 30。",
        "valueType": "integer",
        "min": 4,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "21:9",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      },
      {
        "key": "face_mode",
        "valueType": "boolean",
        "description": "当前 Seedance 线路说明与统一视频文档：官转真人参考可使用 face_mode 或先素材入库；不得把 asset:// 与代审核混用。"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:52:37.114Z",
    "sourceSha256": "28173f89a57980f8e952250bdc44bcdb18df3ec4d341fcbe51496bac3bdeb0a4",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    }
  },
  "sd10-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。 当前 Seedance 线路说明明确限定 5 / 10 / 15 秒。",
        "valueType": "integer",
        "min": 5,
        "max": 15,
        "values": [
          5,
          10,
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "values": [
          "720p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxPromptCharacters": 6000,
    "checkedAt": "2026-10-13T00:52:38.642Z",
    "sourceSha256": "4eb63f3b346fcdc87f748ec40624e1cfc9992ff2e359b929883ea4aa1aa3c9e0",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd10-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxPromptCharacters": 6000,
    "checkedAt": "2026-10-13T00:52:41.698Z",
    "sourceSha256": "03023eb8b15a0c6598a512b1cfa1dd62d5f64b162c2808fed9944b25bf108066",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd10-seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 10。",
        "valueType": "integer",
        "min": 5,
        "max": 10
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxPromptCharacters": 6000,
    "checkedAt": "2026-10-13T00:52:43.227Z",
    "sourceSha256": "0eee7fcf6e1fdf08036a666de3d7e6822ccf88c59e385cdcb4adfa341869cf0c",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd10-seedance-2.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 30。最大 30。",
        "valueType": "integer",
        "min": 30,
        "max": 30,
        "values": [
          30
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ]
      }
    ],
    "references": {
      "images": 30,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxPromptCharacters": 6000,
    "checkedAt": "2026-10-13T00:52:44.756Z",
    "sourceSha256": "5c5e3b822696dee140f6c9e8f857bacc12de4ab11e3ffded86ff3690c4fbb99b",
    "sourceLastReviewed": "2026-09-15"
  },
  "niulai-pro": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "adaptive"
        ],
        "suggestedDefault": "16:9"
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：768p / 2k；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "768p",
          "2k"
        ],
        "suggestedDefault": "768p"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxTotalInputVideoDurationSeconds": 15,
    "inputMimeTypes": {
      "image": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ],
      "video": [
        "video/mp4",
        "video/quicktime"
      ],
      "audio": [
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav"
      ]
    },
    "maxTotalInputAudioDurationSeconds": 15,
    "requiresImageWithAudio": true,
    "maxPromptCharacters": 6000,
    "checkedAt": "2026-10-13T00:52:49.376Z",
    "sourceSha256": "b3c2218b4c19c4788a8f4b2da364f3f91723996dbbc3bcf63dc74034370ff668",
    "sourceLastReviewed": "2026-09-24"
  },
  "mm2-minimax-h3": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：768P / 2K；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "768P",
          "2K"
        ],
        "suggestedDefault": "768P"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:47.838Z",
    "sourceSha256": "3df5a936f623cdf4f29a5d84d82f9995914aa76791d7f9471bb8510549627567",
    "sourceLastReviewed": "2026-09-15"
  },
  "mm2-minimax-h3-max": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480P / 768P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480P",
          "768P"
        ],
        "suggestedDefault": "480P"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:46.294Z",
    "sourceSha256": "351366349a7f81602312bb02d39eb550cb55af13942b2d39e70ecac81df68701",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd11-seedance-2.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 30。",
        "valueType": "integer",
        "min": 4,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:55.514Z",
    "sourceSha256": "d2a7bf774e57b5ea0d3f951ae28e3b9f1b73475b8887d5201e7448f97aef7ca5",
    "sourceLastReviewed": "2026-09-16"
  },
  "sd11-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:50.920Z",
    "sourceSha256": "c278202c01a6f0d217e96e592d24b38d6cdc81b60507a4468e4843f64b7c01ad",
    "sourceLastReviewed": "2026-09-15",
    "forbiddenResolutionValues": [
      "4k",
      "4K"
    ]
  },
  "sd11-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:57.051Z",
    "sourceSha256": "97142bd998a17e780184d7aca5633524e7f2bf7f91e4e6030f999c71cf13f09d",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd11-seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "21:9",
          "adaptive"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:52.450Z",
    "sourceSha256": "0e57bf3a3ac95ddf24216c37594e361ce5179b1a3dca8979ac07cb5cb62c8f4d",
    "sourceLastReviewed": "2026-09-15"
  },
  "wan4-wan3.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 2。最大 30。",
        "valueType": "integer",
        "min": 2,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "adaptive",
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480P / 720P / 1080P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480P",
          "720P",
          "1080P"
        ],
        "suggestedDefault": "480P"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 10,
      "videos": 5,
      "audios": 5
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "checkedAt": "2026-10-13T00:52:53.987Z",
    "sourceSha256": "aa597b944addf87e5c2d0ce13ff12d7b3dfa488372ff51a8d28eea57bb769a99",
    "sourceLastReviewed": "2026-09-15"
  },
  "kl1-kling-3.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "seed",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p / 1080p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p",
          "1080p"
        ],
        "suggestedDefault": "720p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      },
      {
        "key": "seed",
        "description": "随机种子。",
        "valueType": "integer"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:53:03.190Z",
    "sourceSha256": "4e13697b7c952a90b01697122860b264537ad4c6a4362aee7bf219bc0838cb0c",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd12-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "maxOutputAndInputVideoDurationSeconds": 18,
    "maxInputBytes": {
      "image": 31457280,
      "video": 209715200,
      "audio": 15728640
    },
    "inputMimeTypes": {
      "video": [
        "video/mp4"
      ]
    },
    "minInputVideoDurationSeconds": 2,
    "maxInputVideoDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "maxPromptCharacters": 5000,
    "checkedAt": "2026-10-13T00:53:01.654Z",
    "sourceSha256": "8250e403ca8f55d6e4f5fea0a8c69b7b886fd34f93b317fe851a9cc0a193ccde",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd12-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "maxOutputAndInputVideoDurationSeconds": 25,
    "maxInputBytes": {
      "image": 31457280,
      "video": 209715200,
      "audio": 15728640
    },
    "inputMimeTypes": {
      "video": [
        "video/mp4"
      ]
    },
    "minInputVideoDurationSeconds": 2,
    "maxInputVideoDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "maxPromptCharacters": 2000,
    "checkedAt": "2026-10-13T00:53:00.116Z",
    "sourceSha256": "78c20ab4117b35210e6a4b64232b76c646017761e127e36ec1fee3d1129c0e98",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd12-seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": true,
    "maxTotalInputVideoDurationSeconds": 15,
    "maxInputBytes": {
      "image": 31457280,
      "video": 209715200,
      "audio": 15728640
    },
    "inputMimeTypes": {
      "video": [
        "video/mp4"
      ]
    },
    "minInputVideoDurationSeconds": 2,
    "maxInputVideoDurationSeconds": 15,
    "maxTotalInputAudioDurationSeconds": 15,
    "maxPromptCharacters": 3800,
    "checkedAt": "2026-10-13T00:52:58.586Z",
    "sourceSha256": "0b41f53dbbe19c1805f2e43e23b40f8c4e99b80385e56967321348d146e44147",
    "sourceLastReviewed": "2026-09-15"
  },
  "kl2-kling-3.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 1:1 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "1:1",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "suggestedDefault": "720p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxInputBytes": {
      "image": 31457280
    },
    "maxPromptCharacters": 2500,
    "checkedAt": "2026-10-13T00:53:09.324Z",
    "sourceSha256": "78158799ac3898647fa5ee3a054172e66f1589dfb17461d838aed0e398cee81d",
    "sourceLastReviewed": "2026-09-15"
  },
  "wan5-wan3.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 2。最大 30。",
        "valueType": "integer",
        "min": 2,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p"
        ],
        "suggestedDefault": "480p"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxPromptCharacters": 20000,
    "checkedAt": "2026-10-13T00:53:06.254Z",
    "sourceSha256": "7c53118e72636be147b25747f4ecb9be19280f912563875374fb599e34f080d1",
    "sourceLastReviewed": "2026-09-15"
  },
  "ve1-veo-3.1-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 8。",
        "valueType": "integer",
        "min": 4,
        "max": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "suggestedDefault": "720p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 0,
      "videos": 0,
      "audios": 0
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxInputBytes": {
      "image": 31457280
    },
    "maxPromptCharacters": 2000,
    "checkedAt": "2026-10-13T00:53:04.717Z",
    "sourceSha256": "4f347f544521575861c1386e7c7e9cf336103600b0d6b6a8d4a5613a024b992f",
    "sourceLastReviewed": "2026-09-15"
  },
  "sd13-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "auto",
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "suggestedDefault": "auto"
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p / 4k；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p",
          "4k"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "minTotalInputVideoDurationSeconds": 2,
    "maxTotalInputVideoDurationSeconds": 15,
    "inputMimeTypes": {
      "image": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ],
      "video": [
        "video/mp4",
        "video/quicktime"
      ]
    },
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800
    },
    "checkedAt": "2026-10-13T00:53:07.794Z",
    "sourceSha256": "011080c9b8bf7fca792ed3ce62700dc7e9496e1487aeb1e9efba77c245fb8bf3",
    "sourceLastReviewed": "2026-09-20"
  },
  "sd13-seedance-2.0-fast": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "auto",
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "suggestedDefault": "auto"
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "minTotalInputVideoDurationSeconds": 2,
    "maxTotalInputVideoDurationSeconds": 15,
    "inputMimeTypes": {
      "image": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ],
      "video": [
        "video/mp4",
        "video/quicktime"
      ]
    },
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800
    },
    "checkedAt": "2026-10-13T00:53:15.444Z",
    "sourceSha256": "1e97e9fe0a7588dda579b83b4af31a6703628f362a63af35ecc043a6dbdd541e",
    "sourceLastReviewed": "2026-09-20"
  },
  "sd13-seedance-2.0-mini": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 8
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "auto",
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "suggestedDefault": "auto"
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "minTotalInputVideoDurationSeconds": 2,
    "maxTotalInputVideoDurationSeconds": 15,
    "inputMimeTypes": {
      "image": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ],
      "video": [
        "video/mp4",
        "video/quicktime"
      ]
    },
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800
    },
    "checkedAt": "2026-10-13T00:53:12.381Z",
    "sourceSha256": "1d6f0c2e781b4b43ec2350b89da8ba6a82adedaefea9e08421ae4047c928534b",
    "sourceLastReviewed": "2026-09-20"
  },
  "sd13-seedance-2.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 30。",
        "valueType": "integer",
        "min": 4,
        "max": 30,
        "suggestedDefault": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "auto",
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "suggestedDefault": "auto"
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "minTotalInputVideoDurationSeconds": 2,
    "maxTotalInputVideoDurationSeconds": 30,
    "inputMimeTypes": {
      "image": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ],
      "video": [
        "video/mp4",
        "video/quicktime"
      ]
    },
    "maxInputBytes": {
      "image": 31457280,
      "video": 209715200
    },
    "maxInputVideoDurationSeconds": 30,
    "checkedAt": "2026-10-13T00:53:10.848Z",
    "sourceSha256": "1e79b24614dd321b72517bb5097ed4ff803fd63f32451c8ca8e4da5dcec98a09",
    "sourceLastReviewed": "2026-09-20"
  },
  "sd14-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。 当前 Seedance 线路说明：画幅只有 1:1 / 16:9 / 9:16。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ],
        "values": [
          "1:1",
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "suggestedDefault": "720p"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "maxOutputAndInputVideoDurationSeconds": 25,
    "checkedAt": "2026-10-13T00:53:13.909Z",
    "sourceSha256": "2793dff675a6755e82a09c5885b15f4af7c7d444c51728b65a7c877dbad62a46",
    "sourceLastReviewed": "2026-09-21"
  },
  "sd15-seedance-2.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 30。",
        "valueType": "integer",
        "min": 4,
        "max": 30,
        "suggestedDefault": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "720p"
      }
    ],
    "references": {
      "images": 30,
      "videos": 0,
      "audios": 10
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:53:16.977Z",
    "sourceSha256": "4a576dd821fd3f8de39c068cc4f16ae1d37a3cca303c9880b132568a23ec6906",
    "sourceLastReviewed": "2026-09-29"
  },
  "sd15-seedance-2.0": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "720p"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:53:18.516Z",
    "sourceSha256": "0db40f43b1165a1d33fd7e272d76b79df25059e14e0944615ca52ccee8e596cf",
    "sourceLastReviewed": "2026-09-29"
  },
  "gv3-grok-video-1.5": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 3。最大 15。",
        "valueType": "integer",
        "min": 3,
        "max": 15,
        "suggestedDefault": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "suggestedDefault": "720p"
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-13T00:53:20.047Z",
    "sourceSha256": "4336c96b4fe3f1c6677be66881196f138a27fbbac6be8d424b689f64aff57461",
    "sourceLastReviewed": "2026-09-29"
  },
  "mm3-minimax-h3-2k": {
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 15。最大 15。",
        "valueType": "integer",
        "min": 15,
        "max": 15,
        "suggestedDefault": 15,
        "values": [
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：2k；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "2k"
        ],
        "suggestedDefault": "2k"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "videoObjects": true,
    "maxTotalInputVideoDurationSeconds": 15,
    "maxInputAssets": 10,
    "checkedAt": "2026-10-13T00:53:21.574Z",
    "sourceSha256": "7aba6d5c2ba19002aec500e1fa4d2dcce34c59fae9531737ac9ca93549936a5d",
    "sourceLastReviewed": "2026-09-29"
  },
  "sd16-seedance-2.0": {
    "checkedAt": "2026-10-14T03:17:52.833Z",
    "sourceSha256": "0240523e6c7c2d0226a9e2b289b5210881e75502793d19924afb64ffc08600af",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "backend",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p / 1080p / 4k；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p",
          "1080p",
          "4k"
        ],
        "suggestedDefault": "480p",
        "default": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": true
  },
  "sd16-seedance-2.0-fast": {
    "checkedAt": "2026-10-14T03:17:54.869Z",
    "sourceSha256": "e3f82e36728f3b7b63ef1595c4ebca31593b811203a883193e4c3e977e0800ca",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "backend",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p",
        "default": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": true,
    "forbiddenResolutionValues": [
      "1080p",
      "1080P",
      "4k",
      "4K"
    ]
  },
  "sd16-seedance-2.0-mini": {
    "checkedAt": "2026-10-14T03:17:56.896Z",
    "sourceSha256": "c221d8af28a43ad54c4333f8ac5d88aee0f6c4b85b4ca1dadc32613aed90ac87",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "backend",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "reference_image_urls",
      "reference_videos",
      "reference_audios",
      "first_image_url",
      "last_image_url"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 4。最大 15。",
        "valueType": "integer",
        "min": 4,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p",
        "default": "480p"
      },
      {
        "key": "generate_audio",
        "description": "是否生成音频。",
        "valueType": "boolean"
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": true,
    "framePairRequired": true,
    "allowFrameMediaMix": true,
    "forbiddenResolutionValues": [
      "1080p",
      "1080P",
      "4k",
      "4K"
    ]
  },
  "sd17-seedance-2.0-3": {
    "checkedAt": "2026-10-14T03:17:58.930Z",
    "sourceSha256": "16b671b4febdfb6733dd5bd9a6e3e23bd1c6694fd7dc343f0c803c0783f09a60",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "blocked",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。 公告和广场限定5/10/15秒；schema为5–15范围，按已公布的较窄枚举选择，原有超范围值不改写。",
        "valueType": "integer",
        "min": 5,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5,
        "values": [
          5,
          10,
          15
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "warnings": [
      "供应商资料冲突：公告/广场为5、10、15秒，schema仅写5–15秒范围；按明确枚举校验。"
    ]
  },
  "sd17-seedance-2.5-3": {
    "checkedAt": "2026-10-14T03:18:00.971Z",
    "sourceSha256": "37301944c5ac06e6cf2e8ec97db65090df74e4ca6f020ab2c390282615a64405",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "blocked",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 30。最大 30。",
        "valueType": "integer",
        "min": 30,
        "max": 30,
        "suggestedDefault": 30,
        "default": 30,
        "values": [
          30
        ]
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "gv4-grok-imagine-video-1.5": {
    "checkedAt": "2026-10-14T03:18:03.002Z",
    "sourceSha256": "7b5c708cfc8bf4725bed13a90e13a21fe9c2e16e11751dd41d36de011daacb46",
    "sourceLastReviewed": "2026-10-13",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 6。最大 15。",
        "valueType": "integer",
        "min": 6,
        "max": 15,
        "suggestedDefault": 6,
        "default": 6
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：480p / 720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "480p",
          "720p"
        ],
        "suggestedDefault": "480p",
        "default": "480p"
      }
    ],
    "references": {
      "images": 7,
      "videos": 0,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "mm4-minimax-h3-2k": {
    "checkedAt": "2026-10-14T03:18:05.038Z",
    "sourceSha256": "d2284038bbf4141fdc9a4018907a40965946d301ce2c58719d5f389606d8f280",
    "sourceLastReviewed": "2026-10-13",
    "fixedResolution": "2K",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：2K；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "2K",
        "default": "2K",
        "values": [
          "2K"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd17-seedance-2.0": {
    "checkedAt": "2026-10-14T03:18:07.075Z",
    "sourceSha256": "7d066da40327544e448f2168a4ceb131e0b445c6c64ed96b608f113eb531db87",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "open",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd17-seedance-2.0-2": {
    "checkedAt": "2026-10-14T03:18:09.112Z",
    "sourceSha256": "3e34ddbe8ebbe6a2d9985094a74bd6e0ba70408067827149431196f4cb7faabc",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "open",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 15。",
        "valueType": "integer",
        "min": 5,
        "max": 15,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 9,
      "videos": 0,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd17-seedance-2.5": {
    "checkedAt": "2026-10-14T03:18:11.142Z",
    "sourceSha256": "ca8b9e195172ab14c21e5af1c3b904f153393bf02a6b2feba33ba83ab0f94fac",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "open",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 5。最大 30。",
        "valueType": "integer",
        "min": 5,
        "max": 30,
        "suggestedDefault": 5,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 0
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd17-seedance-2.5-2": {
    "checkedAt": "2026-10-14T03:18:13.166Z",
    "sourceSha256": "eee7d71af3dab2d04e92818dd435e1854efbaa8524172ad52990b4fbb6a3a833",
    "sourceLastReviewed": "2026-10-13",
    "facePolicy": "blocked",
    "fixedResolution": "720P",
    "fields": [
      "duration",
      "aspect_ratio",
      "resolution",
      "reference_image_urls",
      "reference_videos",
      "reference_audios"
    ],
    "parameters": [
      {
        "key": "duration",
        "description": "视频时长，单位秒。最小 10。最大 30。",
        "valueType": "integer",
        "min": 10,
        "max": 30,
        "suggestedDefault": 10,
        "default": 10
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ]
      },
      {
        "key": "resolution",
        "description": "输出分辨率。推荐值：720P；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestedDefault": "720P",
        "default": "720P",
        "values": [
          "720P"
        ]
      }
    ],
    "references": {
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  }
};
