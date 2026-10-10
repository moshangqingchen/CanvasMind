/** Public ai.jiasuapi.com/api/pricing video declarations captured 2026-10-09. Prices and account credentials are deliberately absent. */
export const JIASU_VIDEO_CATALOG = [
  {
    "id": "sd-2.0-933-720-fast-原生真人",
    "description": "seedance-2.0-fast  文生视频 / 图片参考生视频 · 4-15秒 ·720p · 最多支持9张图3视频3音频，原生真人",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "default": "5",
        "range": "4-15",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "range": "720p",
        "description": "输出分辨率预设"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "sd-2.0-fast-803-J3",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-mini-J1",
    "description": "9图片 0视频 3音频  480P 最长 15 秒、720P 最长 12 秒，",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "required": true,
        "default": "15",
        "range": "4-15",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "required": true,
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "required": true,
        "default": "720p",
        "range": "480p, 720p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "AIGV-WAN3-1080P",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-J1",
    "description": "海外官渠，可返官链，9图片 0视频 3音频 720P ，原生过真人，可生成4-15秒，速度很快，平均生成时间4-10分钟",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "required": true,
        "default": "15",
        "range": "4-15秒",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "required": true,
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "required": true,
        "default": "720p",
        "range": "720p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "ov-seedance-2.5-720p-nv",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "wan3",
    "description": "WAN3 720P-1080；按秒计费 ；时长：15-30 秒；参考：最多 10 图 / 5 视频 / 5 音频。",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "required": true,
        "default": "30",
        "range": "15-30",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "default": "720p",
        "range": "720p, 1080p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "doubao-seedance-2-0-mini-260615",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "seedance2.5-全参真人",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "doubao-seedance-2-0-fast-260128",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "ov-seedance-2.5-480p-nv",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "MiniMax-H3-jx",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-mini-503-J3",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-J2",
    "description": "9图片 3视频 3音频 720P ，原生过真人，可生成5-15秒",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "required": true,
        "default": "5",
        "range": "5-15",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "required": true,
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "required": true,
        "default": "720p",
        "range": "720p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "grok-1.5",
    "description": "按次收费。最多7图 3-15秒,720p\n",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "default": "5",
        "range": "3-15",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "default": "720p",
        "range": "720p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "minimax-h3",
    "description": "9图3视频3音频，原生过真人；\n视频需要传视频duration_seconds",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "required": true,
        "default": "15",
        "range": "4-15",
        "description": "视频时长（秒），4–15 的整数。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "required": true,
        "default": "16:9",
        "range": "9:16, 1:1, 3:4, 4:3, 16:9",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "required": true,
        "default": "2k",
        "range": "2k",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 [{url, duration_seconds?, mime?}]。duration_seconds 为该参考视频时长（秒），不传按 5 秒；最多 3 个，多条合计不超过 15 秒；图片+视频+音频合计最多 10 个；超限或时长非法时网关在提交前拒绝（HTTP 400），不扣费。示例：[\"https://m.jiasuapi.com/media/by-hash/example-ref.mp4\"] 或 [{\"url\":\"https://m.jiasuapi.com/media/by-hash/example-ref.mp4\",\"duration_seconds\":10}]"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "AIGV-WAN3-720P",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "seedance2.0-mini-A",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "doubao-seedance-2-5-260628",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-fast-J4",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.5-J2",
    "description": "30图10视频 10音频  原生过真人 720P 支持5-30秒\n",
    "apiParameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "description": "视频模型 ID"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "想要生成视频的文字描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "default": "30",
        "range": "5-30",
        "description": "视频时长（秒）。客户端未传时长时使用此默认值。"
      },
      {
        "name": "ratio",
        "type": "enum",
        "default": "16:9",
        "range": "16:9, 9:16, 1:1",
        "description": "输出宽高比"
      },
      {
        "name": "resolution",
        "type": "enum",
        "default": "720p",
        "range": "480p, 720p, 1080p",
        "description": "输出分辨率预设。启用视频计费时，客户端未传分辨率则使用此默认值。"
      },
      {
        "name": "images",
        "type": "array",
        "description": "参考图：URL 或 {url,name?}。不传 name→图片N；传了 name→用于 @引用"
      },
      {
        "name": "videos",
        "type": "array",
        "description": "参考视频：URL 或 {url,name?}。不传 name→视频N；传了则用该 name"
      },
      {
        "name": "audios",
        "type": "array",
        "description": "参考音频：URL 或 {url,name?}。不传 name→音频N；传了则用该 name"
      },
      {
        "name": "materials",
        "type": "array",
        "description": "可选 materials[{type,url,name?}]，命名规则同上"
      }
    ]
  },
  {
    "id": "seedance2.0-720-满血真人",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-J4",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "sd-2.0-fast-813-J3",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "seedance2.0-满血",
    "description": "",
    "apiParameters": null
  },
  {
    "id": "doubao-seedance-2-0-260128",
    "description": "",
    "apiParameters": null
  }
];
