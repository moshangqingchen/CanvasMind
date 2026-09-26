# 个人 AI 网站 CLI

超级画布通过本机 CLI 桥接程序调用个人 AI 网站。网站登录由对应 CLI 管理，画布沿用其登录状态。即梦模板是待接入配置，不包含真实即梦命令或模型；模拟连接只返回固定测试媒体，不访问网站或消耗额度。

## 使用

1. 打开「设置 → 个人 AI 网站」，选择「即梦（待接入）」「自定义网站」或「模拟连接」。
2. 为真实网站填写桥接程序的绝对路径、固定参数数组、工作目录和账号备注。Node/Python 脚本使用对应解释器作为程序，脚本路径放在参数数组第一项；不要填写整条 Shell 命令或将登录凭据放入参数。
3. 先按该 CLI 的说明登录，在画布中启用连接，点击「检测连接」，然后「同步模型与参数」。这两个操作不能触发生成。
4. 在图片或视频生成节点选择网站、账号和模型。分辨率、秒数、比例、声音和素材支持均由该模型的目录声明决定。目录尚未同步时没有可运行模型。
5. 连接和命令只保存在本机。导入另一台电脑的项目后，需重新绑定当地已配置的连接。

打开画布或读取模型目录不会执行 CLI。修改程序、参数、工作目录、账号或其他 CLI 配置会使检测和目录失效，需重新检测及同步。编辑连接显示名称不影响检测结果。

## 桥接协议 v1

类型定义位于 `packages/providers/src/cli-contracts.ts`。一个进程处理一次请求，从 stdin 读取一个 UTF-8 JSON 文档，在 stdout 写入一个完整 JSON 响应并退出。运行诊断写入 stderr；stdout 不得夹杂 banner、终端颜色或日志。画布通过程序路径和参数数组直接启动进程，`shell:false`。

请求外层包含 `version:1`、`action`、`requestId` 和 `context`。`context.connectionId` 指明本机连接；生成、查询和取消还会收到作业目录、输出目录。查询和取消带 `taskId`。

成功响应统一为 `{"version":1,"ok":true,"data":{...}}`；失败响应为 `{"version":1,"ok":false,"error":{"code":"...","message":"..."}}`。错误信息不得包含令牌、Cookie 或登录文件内容。

| action | 职责 |
| --- | --- |
| `test` | 免费检查程序、协议与登录状态，返回 `ready`、可选 `loginRequired/message` 和 `supportsCancel`。 |
| `describe` | 返回 `models` 与 `supportsCancel`，不得调用生成命令。 |
| `submit` | 接收标准生成请求，快速返回站点任务标识与初始状态。 |
| `poll` | 查询同一个任务，返回当前状态以及完成后的输出。 |
| `cancel` | 当声明支持取消时，向网站请求取消；不得产生新的生成任务。 |

`submit.request` 包含 `operation`、准确的 `model`、原样传递的 `prompt`、`parameters`、`idempotencyKey` 和 `assets`。素材有本地 `path`、`id`、`kind`、`mimeType`，以及可选 `reference/firstFrame/lastFrame` 角色。只有图片/视频生成与图片编辑操作；音频可以作为参考输入。

桥接层必须将同一幂等键关联到同一个已创建任务，保存跨进程恢复所需的状态。只有阻塞生成命令的 CLI 应由桥接层封装为“提交后可查询”的作业。不能在每次 `poll` 时重新调用生成。

`LOGIN_REQUIRED` 和 `INVALID_PARAMETERS` 表示明确拒绝，桥接层必须保证此时没有创建生成任务或产生生成费用。用户修复问题后可以显式重试同一任务；程序尚未启动的失败也可显式重试。已经启动但提交结果不确定的错误不能使用这些代码，画布会保留现场并阻止重复提交。

`submit` 的 `data` 至少返回 `taskId` 和 `status`。`poll` 的 `data` 返回 `status`，可带相同的 `taskId`、0–100 的 `progress`；成功时必须提供非空 `outputs`。每个输出为 `{kind:"video"|"image", path?:string, url?:string, mimeType?:string, filename?:string}`，`path` 与 `url` 必须且只能提供一个。

模型的 `inputKinds` 明确声明接受的素材类型；省略时仅支持文本。`metadata.inputRoles` 可声明 `reference/firstFrame/lastFrame`，省略时仅支持参考素材。不要将网站未支持的首尾帧或素材类型放入目录。

模型描述复用 `ModelDescriptor`。参数可使用 `select/number/text/toggle/dimensions`，声明 `valueType`、`default`、`required`、选项、范围、步长及适用操作。`visibleWhen` 中的条件全部满足时显示；`constraints` 按顺序应用匹配条件下的选项、上下界或必填规则。条件使用严格匹配的 `{parameter, values}`，不可携带执行脚本。

例如，下面是模拟规则，不代表即梦的真实参数：

```json
{
  "key": "duration",
  "label": "时长（秒）",
  "control": "select",
  "valueType": "integer",
  "required": true,
  "default": 5,
  "options": [{"label":"5 秒","value":5},{"label":"10 秒","value":10}],
  "constraints": [{
    "when": [{"parameter":"resolution","values":["1080p"]}],
    "options": [{"label":"5 秒","value":5}]
  }]
}
```

前后端使用同一校验逻辑。未声明参数、非法选项和不满足联动的组合都会被拒绝。主动切换模型时重新整理参数；打开旧节点时保留失效值并提示修正，不静默改变用户原来的生成请求。

## 任务与结果

默认每连接同时执行一个生成任务。普通命令超时 30 秒、提交超时 60 秒，每 10 秒查询，最多等待 2 小时；可在高级设置调整。CLI 必须尽快返回任务 ID，远端排队时间不应占用一次提交命令。

状态使用 `queued/running/succeeded/failed/cancelled`。已创建的任务重启后继续查询，不重新提交。提交结果不确定、查询超时或结果归档失败时进入“需要处理”；保留原任务及恢复信息。未声明远端取消能力时，界面仅提供停止跟踪，不承诺取消网站上的任务或费用。

任务达到总等待时限后，恢复会查询原任务一次；若已完成则归档，否则继续标为“需要处理”，不会因重启或恢复无限延长自动查询。尚未确认结束的任务仍占用该账号；核查网站后可停止跟踪释放本地占用。

结果可以是可下载 URL，也可以是作业输出目录中的本地文件。桥接程序应先完整写入文件再报告成功。本地输出必须真实位于本次输出目录，不得通过 `..`、符号链接或目录联接引用其他文件。画布验证路径并流式归档，成功归档后才清理临时输出；失败时保留恢复所需文件。

模型价格缺失时保持未知，不标为免费。未知价格不参与导演自动最低价选择；模拟目录不会作为真实生成候选。

## 示例与验证

`packages/providers/examples/mock-cli.mjs` 是可运行的协议示例，演示目录、参数联动、幂等任务、查询、取消及本地测试视频。设置页的模拟模板自动使用桌面自带 Node 路径；开发版本使用当前 Node。实际网站接入时复制示例结构，将动作处理替换为对应 CLI 的调用，不修改画布界面或运行系统。

相关测试位于 providers 的 CLI 测试、runtime 的 CLI 集成测试，以及 renderer 的连接/参数测试和个人网站端到端测试。测试只使用固定素材，不调用真实网站的付费生成。
