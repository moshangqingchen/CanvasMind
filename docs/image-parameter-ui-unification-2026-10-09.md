# 生图模型与参数面板统一

将各供应商的生图参数与香蕉模型接入公共布局：分辨率档位按钮、完整宽度的比例选择、模型支持的质量选项，以及可用时的像素宽高。模型名采用易读格式，保留原始 ID、渠道标记及 Preview / Lite 等后缀。

## 参数契约

- 原生档位支持 `image_size`、`imageSize`、`resolution`、`tier`、K 档 `size`，以及供应商明确用 `quality` 表示分辨率的契约。
- 苍源旧版香蕉的 `low / medium / high` 仍按原字段发送，仅展示已声明的 `1K / 2K / 4K` 标签。
- 原生档位仅显示渠道声明的选项；不补造自动、4K、质量或自定义像素输入。
- 供应商提供尺寸表时显示只读 W/H；只有精确尺寸可编辑的契约提供自定义宽高和 16 倍数对齐。
- 精确像素枚举使用公共尺寸布局，直接保留选项像素；不进行 16 像素取整、不增加 `size_tier` 请求值。
- 保留已保存但目录未确认的尺寸提示；精确尺寸和比例参数保持互斥，包括比例字段别名。

喵呜的 `pricing.image_api.sizes` 本身包含 `1080p` 图片档位。页面显示为“标准”，接口值保持 `1080p`，不会改成 `1K`。目录尺寸表中的标准方图为 1080 × 1080，标准 16:9 为 1920 × 1080；这些数据来自仓库内供应商目录快照。视频仍使用原始 `1080p` 名称。

## 验证

- `pnpm build:runtime`：通过（含 TypeScript）。
- 相关 Vitest：8 个文件、116 个用例通过。
- 相关 Playwright：29 个用例通过；旧模型名称断言更新后，失败的单项重跑通过。跨供应商香蕉与精确像素枚举共 10 个界面用例均通过。
- 修改文件 ESLint 与 `git diff --check` 通过。
- 发布前全量 renderer Vitest：206 个文件、2247 个用例通过（限制 4 个 worker 后重跑，避免本机并行构建产生导入超时）；修复模型同时声明多个比例别名时错误恢复默认尺寸的回归。
- 全仓库类型检查、ESLint、依赖安全检查及 12 个维护测试通过；存储测试在并行构建时的一次超时，独立重跑 27 个用例通过。
- 更新旧界面控件断言后，新增补验 6 个 Playwright 用例通过，包含立即运行、保存恢复、旧沧元分组和限定 1K 合同。
- Windows v0.2.78 安装包构建与更新文件完整性检查通过；更新自定义供应商冒烟测试中的模型显示名称断言后，打包应用启动、保存、退出和重启验收通过。
- 跨供应商合同覆盖 GenImage、Frimodel、PDog、Secure Skill、We-AI、辰途、苍源、Mikoto 和 CyberAfei；喵呜另有原生图片目录与请求测试。
- Playwright 使用临时隔离数据和模拟模型目录，阻止生成提交；检查档位、比例、原始字段值、像素与保存恢复，不产生付费生图。

截图：

- [香蕉公共面板](image-parameter-ui-unification-2026-10-09/banana-parameters.png)
- [GPT 图片公共面板](image-parameter-ui-unification-2026-10-09/gpt-image-parameters.png)
- [Mikoto 香蕉限定档位](image-parameter-ui-unification-2026-10-09/mikoto-banana-parameters.png)
- [只读精确像素枚举](image-parameter-ui-unification-2026-10-09/exact-size-parameters.png)
