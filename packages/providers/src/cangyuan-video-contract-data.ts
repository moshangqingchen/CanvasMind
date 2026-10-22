// Extracted from official per-model documents, fresh GET 2026-10-12 (America/Los_Angeles);
// individually rechecked/new contracts carry their own checkedAt date.
// Source: https://ai.cangyuansuanli.cn/docs-static/models/{id}.json
// Public documentation does not grant a Key permission to use a model.
export interface CangyuanVideoContractData {
 checkedAt?: string; sourceSha256?: string; sourceStatus?: string; sourceLastReviewed?: string; forbiddenResolutionValues?: readonly string[]; requiresReferenceImage?: boolean; requiresReferenceMedia?: boolean; facePolicy?: "open" | "backend" | "blocked"; warnings?: readonly string[]; fixedResolution?: string;
 fields: readonly string[];
 parameters: readonly { key: string; description: string; valueType?: string; required?: boolean; suggestions?: readonly (string | number)[]; suggestedDefault?: string | number | boolean; values?: readonly (string | number)[]; min?: number; max?: number; default?: string | number | boolean }[];
 references: { images: number | null; videos: number | null; audios: number | null };
 frames: boolean; framePairRequired: boolean; allowFrameMediaMix: boolean; allowFrameAudioMix?: boolean; frameDescription?: string;
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
    "checkedAt": "2026-10-21T02:51:49.649Z",
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
    "sourceSha256": "6e12d253171896dd3589baa546b9acbf36034356fb04830f9b0f3d50eaac1af8",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "deprecated"
  },
  "minimax-h3-2k": {
    "checkedAt": "2026-10-22T04:13:14.386Z",
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
    "sourceSha256": "725fee7af69df96930ac4caed81f4fea717c61a789f41a07dbd4d95de1e96655",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一。上传文件最多 26214400 字节（25 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.455Z",
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
    "sourceSha256": "7f354377c713f7e9f450779dfd1873c437c0c5c180ae52df44fe6929d7aafa80",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "首尾帧须成对提供，且与参考图、参考视频、参考音频互斥。"
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
    "checkedAt": "2026-10-22T04:13:14.511Z",
    "sourceSha256": "e4143217f6af0036a6ad442e4342993422b32da8ef0feb628e8a49c89005844b",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧须成对提供，且与普通参考图互斥。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.524Z",
    "sourceSha256": "68a71044dcbc657dafa104eea7a3f46edc6a7a450da46a79c650c019000c8560",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "仅支持成对首尾帧。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.528Z",
    "sourceSha256": "665f9ab5ab0176473d070b2617272f116c89eb8e78c7bb495efd87cc151c64f9",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "仅支持成对首尾帧。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.534Z",
    "sourceSha256": "5e9ae0157dd808945da939131e2309b44cc656ef425a99ba5f7367f7f47daa4f",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "支持单首帧或成对首尾帧。"
  },
  "happyhouse-1.0": {
    "checkedAt": "2026-10-22T04:13:14.596Z",
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
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "sourceSha256": "90e9212d29654e43c322db364d0459ba8b7a44d0396ffe787d692bda29c37831",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200
    },
    "sourceStatus": "current",
    "frameDescription": "支持首帧；与多图/视频参考素材二选一。上传文件最多 26214400 字节（25 MiB）。"
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
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "checkedAt": "2026-10-22T04:13:14.600Z",
    "sourceSha256": "f7507abc7266602b10fa0c5778a10168012433999097fd3f120a76b3dc256d29",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400
    },
    "sourceStatus": "current",
    "frameDescription": "支持首帧；与多图/视频参考素材二选一。上传文件最多 26214400 字节（25 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.605Z",
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
    "sourceSha256": "0b39e43bb8a2480b109563bf5ffab3389cca2196e0e28039d74966149fd3105f",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一。上传文件最多 26214400 字节（25 MiB）。"
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
        "description": "固定输出约 10 秒。",
        "valueType": "integer",
        "values": [
          10
        ],
        "min": 10,
        "max": 10,
        "default": 10
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
    "checkedAt": "2026-10-22T04:13:13.481Z",
    "sourceSha256": "4f51dc17ec50a335cc0e19f0f63200e31a193f2107b92de3517db0f3e77c7ae5",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "支持首帧/尾帧参考图。",
    "approximateDurationSeconds": 10
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
        "description": "固定输出约 10 秒。",
        "valueType": "integer",
        "values": [
          10
        ],
        "min": 10,
        "max": 10,
        "default": 10
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
    "checkedAt": "2026-10-22T04:13:14.054Z",
    "sourceSha256": "55b8e239cd0afcf3effa0d46a75562a46c2fffe5e926182d0ae3a31bcc1a4e38",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "支持首帧/尾帧参考图。",
    "approximateDurationSeconds": 10
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
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
    "checkedAt": "2026-10-22T04:13:14.614Z",
    "sourceSha256": "0cef96024722ccb02128bbc60a4552de80fa61a7b24201e39a73334e936a4fb9",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一；首帧与尾帧须成对提供。上传文件最多 26214400 字节（25 MiB）。"
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
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
    "checkedAt": "2026-10-22T04:13:14.620Z",
    "sourceSha256": "0dfae50a03c55ea0e847092b3b8db262438119f56a7614dba17901eac647071b",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一；首帧与尾帧须成对提供。上传文件最多 26214400 字节（25 MiB）。"
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
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
    "checkedAt": "2026-10-22T04:13:14.695Z",
    "sourceSha256": "6461230e743e3c5307db82557e3336e3be3552ab384359d4c0bc6a7c481a38d2",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一；首帧与尾帧须成对提供。上传文件最多 26214400 字节（25 MiB）。"
  },
  "sd4-seedance-2.5-480p": {
    "checkedAt": "2026-10-22T04:13:14.624Z",
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
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
    "sourceSha256": "527d7143a101ef7d7b8c9ba7ebee06667979e1343e85a3d45c04eb35af7292f4",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一；首帧与尾帧须成对提供。上传文件最多 26214400 字节（25 MiB）。"
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
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
    "checkedAt": "2026-10-22T04:13:14.629Z",
    "sourceSha256": "d4ebc30119c6e6b1dc31bef3e4c0b823a4519799acbb6ec930fbe0ad0ff61f16",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 26214400,
      "video": 209715200,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与多模态（参考图/视频/音频）二选一；首帧与尾帧须成对提供。上传文件最多 26214400 字节（25 MiB）。"
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
      },
      {
        "key": "seed",
        "description": "可选整数种子；相同输入可用于复现，显式 0 也会透传。",
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
    "checkedAt": "2026-10-22T04:13:14.674Z",
    "sourceSha256": "27f6d9662d12073b18db295f267e0036f0b37a980551137ab34b506725d7e4c3",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与 9 图 + 3 个视频/音频素材的多模态参考互斥；首帧与尾帧须成对提供。上传文件最多 31457280 字节（30 MiB）。"
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
        "description": "是否生成原生音频，默认开启。",
        "valueType": "boolean",
        "default": true
      },
      {
        "key": "seed",
        "description": "可选整数种子；相同输入可用于复现，显式 0 也会透传。",
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
    "checkedAt": "2026-10-22T04:13:14.683Z",
    "sourceSha256": "ec661444239247349d5f8955757b2988d14f2373e1b71501669d5cfc80e44ce2",
    "sourceLastReviewed": "2026-09-15",
    "maxInputBytes": {
      "image": 31457280,
      "video": 52428800,
      "audio": 15728640
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧与 9 图 + 3 个视频/音频素材的多模态参考互斥；首帧与尾帧须成对提供。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.700Z",
    "sourceSha256": "66834ce1ca1b1310454d9cd4311d95a1e1d85bd1bfa49131bf395de9237316d4",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对提供，并与多模态参考二选一。"
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
    "checkedAt": "2026-10-22T04:13:14.732Z",
    "sourceSha256": "9468a2f1ca00107eb7780dbddfde875670a586269f2770d774b45438c75bdc7d",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对提供，并与多模态参考二选一。"
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
    "checkedAt": "2026-10-21T02:51:52.226Z",
    "sourceSha256": "844a84e59b9a1b0acbab21efd32b709e051addcd5eb5e944cac923a6f5f7d62c",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "deprecated"
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
    "checkedAt": "2026-10-21T02:51:52.242Z",
    "sourceSha256": "368b2025a71384fed4a4853143734b870e7bcbd7f64522babe5533b8224c9748",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "deprecated"
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
    "checkedAt": "2026-10-22T04:13:14.757Z",
    "sourceSha256": "f74e4b6dd7e21345ea94a7adee1d73b4fae6f366a6cc64a9e573e917ed86d2f3",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对，且不能和参考图、参考视频、参考音频同时使用。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.801Z",
    "sourceSha256": "9396bbb0dae0fca3619de516885c54d829b4a7ccbb13c59649e450b9bc29b9d1",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对，且不能和参考图、参考视频、参考音频同时使用。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.796Z",
    "sourceSha256": "1172c49a272200c701c70d46f82e4cd55b37d6b79286046addc42092167cc5cf",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对，且不能和参考图、参考视频、参考音频同时使用。上传文件最多 31457280 字节（30 MiB）。"
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
    "checkedAt": "2026-10-22T04:13:14.830Z",
    "sourceSha256": "d4518d0ede08a5a940a40d111c537cdc97131755f91e5708d29b1fccdb6e5114",
    "sourceLastReviewed": "2026-09-16",
    "maxInputBytes": {
      "image": 31457280
    },
    "sourceStatus": "current",
    "frameDescription": "首尾帧必须成对，且不能和参考图、参考视频、参考音频同时使用。上传文件最多 31457280 字节（30 MiB）。"
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
        "suggestedDefault": "768P",
        "default": "768P"
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
    "checkedAt": "2026-10-22T04:13:14.845Z",
    "sourceSha256": "5e70b06210517706b5826dd9cdbeb591ad85d8cdba73db9bcac87863d68d55b2",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480P",
        "default": "480P"
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
    "checkedAt": "2026-10-22T04:13:14.890Z",
    "sourceSha256": "2ae78b2fc469956d99758272a9ab66eae381450109115b46610accfaf4d9586b",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
    "checkedAt": "2026-10-22T04:13:14.956Z",
    "sourceSha256": "6fb891420e8b3382f871b2651ef26e84e78f7d06bb6794107935f0da1546c206",
    "sourceLastReviewed": "2026-09-16",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
    "checkedAt": "2026-10-22T04:13:14.855Z",
    "sourceSha256": "355337e5af7d1f3d6f67c314d5a6e02e60ddbf562d803669fa67ebec58dca64d",
    "sourceLastReviewed": "2026-09-15",
    "forbiddenResolutionValues": [
      "4k",
      "4K"
    ],
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
    "checkedAt": "2026-10-22T04:13:14.898Z",
    "sourceSha256": "59352e59a582337cc7ab26615eb2044f4844e26659283bd51f27b4297e0aa014",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
    "checkedAt": "2026-10-22T04:13:14.917Z",
    "sourceSha256": "b302d67195954cc1f82178b8260b832e801abd0e6a22f94c36ea13ff7464ff81",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "480P",
        "default": "480P"
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
    "checkedAt": "2026-10-22T04:13:14.908Z",
    "sourceSha256": "8622ceea159d8311c8549c8943e2c5975ed2fb6e9e38bffdcc62715e81587fe9",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。"
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
        "suggestedDefault": "720p",
        "default": "720p"
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
    "checkedAt": "2026-10-22T04:13:14.948Z",
    "sourceSha256": "eae68444e7080b77c4ca346ca1d58d4138cae44c5a5349513b951561d310dc34",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。可只传首帧做图生。不支持参考图。"
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
    "checkedAt": "2026-10-22T04:13:14.962Z",
    "sourceSha256": "9d89dfc5190dd0f92897dcc2509c59f018b30f1059b6a3f98e0e9c83963a72e9",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。有首帧时不支持参考音频。",
    "allowFrameAudioMix": false
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
    "checkedAt": "2026-10-22T04:13:14.970Z",
    "sourceSha256": "1927739756997ed39124e63f61a1dcde2336a01a02003c8362c34fc82d7e055b",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。有首帧时不支持参考音频。",
    "allowFrameAudioMix": false
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
    "checkedAt": "2026-10-22T04:13:15.020Z",
    "sourceSha256": "0e0939080ffbdbcd1770dc176b29218f9b71837e970634ce04f58454be054867",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "尾帧必须同时给首帧。首帧可以和参考图一起传。有首帧时不支持参考音频。",
    "allowFrameAudioMix": false
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
        "suggestedDefault": "720p",
        "default": "720p"
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
    "checkedAt": "2026-10-22T04:13:14.982Z",
    "sourceSha256": "f65dfbea160b503d4552aed1724bb2dea473fea776205b995ed1d8579ee03860",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "仅首尾帧。有尾帧必须有首帧。可只传首帧。不支持普通参考图、参考视频或参考音频。"
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
        "suggestedDefault": "720p",
        "default": "720p"
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
    "checkedAt": "2026-10-22T04:13:15.028Z",
    "sourceSha256": "b7b57ec3d9de342e97d16e81ffb439e21a770c1e99cc3cd734c63920e460dc30",
    "sourceLastReviewed": "2026-09-15",
    "sourceStatus": "current",
    "frameDescription": "仅首尾帧。有尾帧必须有首帧。可只传首帧。不支持普通参考图、参考视频或参考音频。"
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
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
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
        "suggestedDefault": "720p",
        "default": "720p"
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
    "checkedAt": "2026-10-22T04:13:14.309Z",
    "sourceSha256": "2899beb2b1f1e801c9e9b590eca4f4705dbb0edd705542aa9b253a04d5a80428",
    "sourceLastReviewed": "2026-09-21",
    "sourceStatus": "current",
    "frameDescription": "可只给首帧。首尾帧与参考图、参考视频、参考音频互斥。"
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
    "checkedAt": "2026-10-21T02:51:52.795Z",
    "sourceSha256": "60f45e77a959880d5019be352be1749d98491fa2cf4e6492cfec9f9477fda884",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "deprecated"
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
    "checkedAt": "2026-10-22T04:13:13.713Z",
    "sourceSha256": "27ccf723602158b5bb7ee9650b2a4c4d21c8fb49db005adbdddb4633307f234e",
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
    "allowFrameMediaMix": true,
    "sourceStatus": "current",
    "frameDescription": "首尾帧要成对，可以和参考图、参考视频、参考音频一起传。"
  },
  "sd16-seedance-2.0-fast": {
    "checkedAt": "2026-10-22T04:13:14.062Z",
    "sourceSha256": "9680bc73c49c8226131eb2297b1e075f14e24fe999d0025a98199eb524149f5e",
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
    ],
    "sourceStatus": "current",
    "frameDescription": "首尾帧要成对，可以和参考图、参考视频、参考音频一起传。"
  },
  "sd16-seedance-2.0-mini": {
    "checkedAt": "2026-10-22T04:13:14.066Z",
    "sourceSha256": "1d8996d3b9154b97eebaf7aba8cd52ef0cd4b396b4fc716ec4355efea43cde86",
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
    ],
    "sourceStatus": "current",
    "frameDescription": "首尾帧要成对，可以和参考图、参考视频、参考音频一起传。"
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
  },
  "sd15-seedance-2.5-2": {
    "checkedAt": "2026-10-21T02:54:38.666Z",
    "sourceSha256": "4560e0a5de313e920e2036a7cb14f906b6dda5c0a84bb4f9e3d66a9c5aacb850",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "current",
    "facePolicy": "open",
    "warnings": [
      "本页公共名就是请求里要传的名字。",
      "未列出的字段不要发送。",
      "视频只走 POST /v1/videos，再轮询 GET /v1/videos/{task_id}。"
    ],
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
        "description": "视频时长，单位秒。最小 4。最大 30。",
        "valueType": "integer",
        "suggestedDefault": 5,
        "min": 4,
        "max": 30
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：1:1 / 16:9 / 9:16；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "1:1",
          "16:9",
          "9:16"
        ],
        "suggestedDefault": "16:9"
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
      "images": 30,
      "videos": 10,
      "audios": 10
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd8-seedance-2.5-n": {
    "checkedAt": "2026-10-22T04:13:15.131Z",
    "sourceSha256": "5b6ada319eeb50940133a651da28754a9addb205a1c055a288753dc009119d8b",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "current",
    "facePolicy": "blocked",
    "warnings": [
      "本页公共名就是请求里要传的名字。",
      "未列出的字段不要发送。",
      "视频只走 POST /v1/videos，再轮询 GET /v1/videos/{task_id}。"
    ],
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
        "description": "视频时长，单位秒。最小 30。最大 30。",
        "valueType": "integer",
        "suggestedDefault": 30,
        "min": 30,
        "max": 30,
        "default": 30
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
        ],
        "suggestedDefault": "16:9",
        "default": "16:9"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
  },
  "sd17-seedance-2.5-4": {
    "checkedAt": "2026-10-21T02:54:38.668Z",
    "sourceSha256": "3527b447fadf2543f0f8932aac7e1afd258efede224066cf1b2fcd3c1c5c45c6",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "current",
    "facePolicy": "open",
    "warnings": [
      "本页公共名就是请求里要传的名字。",
      "未列出的字段不要发送。",
      "视频只走 POST /v1/videos，再轮询 GET /v1/videos/{task_id}。"
    ],
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
        "description": "视频时长，单位秒。最小 5。最大 30。",
        "valueType": "integer",
        "suggestedDefault": 5,
        "min": 5,
        "max": 30,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "21:9"
        ],
        "suggestedDefault": "16:9",
        "default": "16:9"
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
        "suggestedDefault": "480p",
        "default": "480p"
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
  },
  "sd17-seedance-2.0-4": {
    "checkedAt": "2026-10-21T02:54:38.668Z",
    "sourceSha256": "dc8fd1cc70b5158ccb315dd5938d915be8d04ec22e002e05dddfb8c6117805ea",
    "sourceLastReviewed": "2026-10-18",
    "sourceStatus": "current",
    "facePolicy": "open",
    "warnings": [
      "本页公共名就是请求里要传的名字。",
      "未列出的字段不要发送。",
      "视频只走 POST /v1/videos，再轮询 GET /v1/videos/{task_id}。"
    ],
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
        "suggestedDefault": 5,
        "min": 5,
        "max": 15,
        "default": 5
      },
      {
        "key": "aspect_ratio",
        "description": "画面比例。推荐值：16:9 / 9:16 / 1:1 / 4:3 / 21:9；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "21:9"
        ],
        "suggestedDefault": "16:9",
        "default": "16:9"
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
      "images": 9,
      "videos": 3,
      "audios": 3
    },
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false
  },
  "sd16-seedance-2.5-2": {
    "checkedAt": "2026-10-21T02:54:38.667Z",
    "sourceSha256": "439a7fba0a2ba5f9ee4e8b0e33567febe14cea43295894a69f465e9a2d18e009",
    "sourceLastReviewed": "2026-10-21",
    "sourceStatus": "current",
    "facePolicy": "open",
    "warnings": [
      "本页公共名就是请求里要传的名字。",
      "未列出的字段不要发送。",
      "视频只走 POST /v1/videos，再轮询 GET /v1/videos/{task_id}。"
    ],
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
        "description": "视频时长，单位秒。最小 5。最大 30。",
        "valueType": "integer",
        "suggestedDefault": 5,
        "min": 5,
        "max": 30,
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
        "description": "输出分辨率。推荐值：720p；推荐值不代表完整允许集合。",
        "valueType": "string",
        "suggestions": [
          "720p"
        ],
        "suggestedDefault": "720p",
        "default": "720p"
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
    "frames": false,
    "framePairRequired": false,
    "allowFrameMediaMix": false,
    "fixedResolution": "720p"
  }
};
