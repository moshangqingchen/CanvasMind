# 喵呜目录已返回但界面仍待确认的修复

检查日期：2026-10-09。对应用户反馈：官网已有型号及价格，画布仍显示“官网已列出 · Key 目录待确认”。

## 原因与改动

1. 前端模型内容相同时复用了原 React 状态，没有把扫描成功和完整性变化同步进去。定时刷新先清掉缓存后，这个问题会让目录标题一直停留在待确认。现在模型内容和扫描状态共同决定更新。
2. 连接取得新扫描后，旧模型缓存仍可能处于有效期。现在根据来源、实际分组和扫描版本清理旧缓存，并拒绝晚到的旧响应覆盖新扫描。
3. 喵呜普通读取以 `persist:false` 扫描时，返回的连接仍可能包含旧合同。现在返回本轮扫描形成的内存模型、参数和价格；是否保存由调用方决定。
4. 之前读取了视频 schema，却没有消费图片 schema。现在同时读取图片和视频的认证参数；图片按完整 ID、来源和实际 Key 分组解析，合法尺寸、比例、素材数量与请求构造一致。
5. 报价选择优先使用 Key 实际绑定的分组。官方 `pricing_display` 已换算的展示价直接使用，不再次乘汇率或分组倍率。

## 当前官方范围与免费核验

[官网广场](https://api.miaowuai.store/pricing)与[价格接口](https://api.miaowuai.store/api/pricing)当前提供 21 个完整型号：14 个视频、7 个图片。同一 default Key 的 `/v1/dream/model_list` 返回这 21 项；21 个 `/v1/dream/model_schema?model=...` 请求均成功。无效 Key 对目录和 schema 均返回 401。

原生调用合同来自[官方媒体指南](https://api.miaowuai.store/docs/openai-videos)：视频使用 `/v1/videos`，图片使用 `/v1/images`，各自按任务 ID 查询结果。

| 完整型号 | default 当前 CNY 报价与条件 |
| --- | --- |
| `dola-seedance-2.0-fast` / `dola-seedance-2.5` | 各 0.875/次，720p |
| `doubao-seedance-2.0-fast` | 2.5/次，720p |
| `doubao-seedance-2.0-mini` | 1/次，720p |
| `doubao-seedance-2.5` | 6.25/次，720p，最多 30 秒 |
| `jimeng-seedance-2.5` | 480p 0.625/秒；720p 0.75/秒 |
| `seedance-2.0-pro` | 480p 0.15/秒；720p 0.28/秒 |
| `seedance-2.5-pro` | 10/次，720p；当前 schema 最长 29 秒 |
| `seedance-2.0-deal` | 3.125/次，720p |
| `seedance-2.0-mini-deal` | 0.4/次，480p，最长 10 秒 |
| `minimax-h3` | 0.0625/秒，720p |
| `minimax-h3-max` | 2/次 |
| `sora-2` | 1/次，720p，8 秒 |
| `wan3.0-video` | 480p 0.195/秒；720p 0.39/秒；1080p 0.65/秒 |
| `GPT-image-2` | 0.05/次，1080p |
| `Image-nano-banana` / `Image-nano-banana-2` | 各 0.05/次，1080p |
| `Image-nano-banana-pro` | 0.15/次，1080p / 2K |
| `gpt-image-2.5-flare` / `gpt-image-2.5-sunburs` | 各 1080p 0.04/次、2K 0.08/次、4K 0.2/次 |
| `seedream-5-0-pro` | 0.2/次，2K |

`gpt-image-2.5-sunburs` 是本站本次返回的完整 ID，保留官方拼写。`/v1/models` 另有 5 个旧 Chat 型号：`dreamina-seedance-2.0-fast`、`dreamina-seedance-2.0-mini`、`seedance-2.0-fast-deal`、`seedance-2.5-deal`、`video-editing`。它们不在当前 21 项价格表中，不能自动当作 doubao/dola 等型号的别名借价。认证读取价格配置入口仍返回 403；没有编造这些旧名称的报价。

## 验证边界

本轮真实网络检查是免费目录、参数与报价读取，没有额外提交收费生成。旧版本正式应用已读回 21 项原生型号的价格和可运行状态，但标题确认状态仍可复现异常；这与修复源码、升级后正式应用读回分别记录。

独立修复副本完成供应商模块 1624 项、界面模块 2410 项完整回归，以及类型和静态检查。浏览器目录对照回归 7 项通过，包括保持同一菜单打开、相同型号连续三次扫描后确认状态与报价正确刷新；该测试没有提交生成请求。Windows v0.2.81 生产安装包已构建成功，桌面回归 105 项通过、1 项按环境跳过，打包程序的独立临时资料冒烟检查通过。不以模拟测试代替真实收费成功。
