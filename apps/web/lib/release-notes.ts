const RELEASE_NOTES: Readonly<Record<string, string>> = {
  "0.2.16": [
    "独立安装包自动更新发现修复",
    "",
    "- 修复无 Git 元数据的 Windows 独立安装包始终显示“最新版本：暂无”的问题。",
    "- 公共仓库现在可匿名查询 GitHub Release，REST API 失败时自动回退到 releases.atom。",
    "- Git 网络/TLS 临时失败会记录为更新状态，不再导致常驻管理器退出。",
  ].join("\n"),
  "0.2.15": [
    "画布模型与参数面板锚定修复",
    "",
    "- 修复滚轮缩放或平移画布后，模型与参数面板停留在旧位置的问题。",
    "- 面板现在会跟随 React Flow 画布视口变化，持续锚定原节点。",
    "- 增加滚轮缩放回归测试，验证面板与节点触发按钮保持相对位置。",
  ].join("\n"),
  "0.2.14": [
    "沧元算力模型可用性监控",
    "",
    "- 接入沧元 /v1/availability 可用性查询接口。",
    "- 模型列表显示正常、降级、不可用、可用率和平均延迟。",
    "- API Key 仅在服务端解密使用，不会发送到浏览器。",
    "- 按沧元限制加入 30 秒缓存，筛选状态时不会重复请求上游。",
    "- 可用性查询失败不会影响模型目录和正常生成任务。",
    "- 画布模型下拉框新增发光可用性标签，每 30 秒自动刷新状态、可用率与平均延迟。",
  ].join("\n"),
};

export function releaseNotesForVersion(version: string): string | undefined {
  return RELEASE_NOTES[version];
}
