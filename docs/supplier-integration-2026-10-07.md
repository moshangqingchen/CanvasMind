# 供应商文档接入与 v0.2.62 升级

本次将 2026-10-07 检测确认的模型、协议、价格和参数变化接入应用。供应商公开目录用于解释接口，实际可选型号仍以当前连接的 Key、账户分组及在线商品权限为准。

## 接入结果

| 供应商 | 应用行为 | 官方依据 |
| --- | --- | --- |
| 辰途、FriModel | 当前 Key 返回 `gemini-nano-banana-2.1` 时使用原生 Gemini `generateContent`，支持图片响应及参考图；保存为 REST 的旧连接也使用对应原生合同。 | [辰途媒体接口](https://tu.988236.xyz/docs/api-media.zh-CN.md)、[FriModel Gemini 指南](https://ai-doc.apifox.cn/9285585m0.md) |
| 沧元 | 新增 `lyria-3-pro`、`lyria-3.5` 音乐节点，提交 `/v1/music` 后查询原任务；支持歌词、纯音乐、时长提示、BPM、种子和 MP3/WAV/M4A，本地音频可播放、下载和复用。更新 Image2 与 Grok 图片价目，`gpt-image-2-x` 保留独立报价合同。 | [Lyria 3 Pro](https://ai.cangyuansuanli.cn/docs-static/models/lyria-3-pro.json)、[Lyria 3.5](https://ai.cangyuansuanli.cn/docs-static/models/lyria-3.5.json)、[价目](https://ai.cangyuansuanli.cn/api/pricing)、[Image2-x](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json) |
| 创想 | 使用 `/v1/videos/generations` 创建及查询视频，按型号验证时长和参考素材组合；等待超时保留原任务。人民币报价只应用一次官方有效倍率，并保留各分辨率按次/按秒单位。 | [视频文档](https://vapi.chuangxiangai.asia/docs/video)、[图片文档](https://vapi.chuangxiangai.asia/docs/image)、[模型市场](https://vapi.chuangxiangai.asia/api/v1/model-plaza) |
| 喵呜 | 保留分辨率报价与离散时长限制，更新 Seedance 的参考图片/音频数量、画幅和按次报价，Sora2 使用当前 8 秒选项。 | [价目](https://api.miaowuai.store/api/pricing)、[公开配置](https://api.miaowuai.store/api/status) |
| 词元 | 刷新已有 Key 的授权目录，商家别名必须同时满足 Key 型号、账户可见和在线商品条件；保留平台实际人民币零售价。 | 当前连接的鉴权模型目录、账户商品及在线商品接口 |

## 升级过程

桌面端启动后，后台对相关官方连接执行一次目录升级。身份变化（例如换 Key、模型分组或账户分组）会重新同步。并发同步最多三条，网络或鉴权失败保留记录并允许后续重试；成功标记只写回仍对应同一身份的连接。

后台同步只读取目录和公开元数据，不提交生成、不创建新 Key，不修改节点选择和用户参数。节点生成使用现有连接；已提交任务恢复使用保存的连接和原任务编号。响应缺少产物或任务编号时保留提交不确定状态，禁止自动重提收费任务。

价格是本次官方资料的快照，最终账单仍由供应商实际使用的分组、型号和参数决定。未经当前 Key 授权的型号不会因公开市场展示而获得权限。

## 验证与发布

验证覆盖原生协议请求、价格单位和倍率、授权交集、目录升级竞态、任务恢复、音频归档，以及音乐参数持久化、播放和下载。协议测试使用 mock，浏览器音频生成使用本地 fake，不包含真实付费生成。

本地全量 3,541 项测试、12 项维护边界测试、TypeScript、ESLint 和生产依赖安全审计通过。57 项浏览器用例覆盖首页、工作台搜索、音乐、供应商切换、图片参数、缩放、布局、账单及更新对话框；旧测试的空白点击改为点击真实可见画布，40% 供应商测试保持缩放并避开工具栏。

Windows 安装包已构建，打包配置、版本、发布说明、blockmap 和 `latest.yml` 校验通过。桌面启动、重启、GPU 窗口绘制和崩溃恢复验收使用隔离资料。打包后的 Electron 应用另外验证了本地 fake 音乐的实际播放及 WAV 下载完成，文件大小和 RIFF/WAVE 文件头一致。

正式发布使用仓库的 Windows Desktop Release 流程，再执行云端质量、浏览器及 Windows 验收，通过后公开安装包及更新文件。
