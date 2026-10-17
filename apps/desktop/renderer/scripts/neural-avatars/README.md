# 角色轮廓烘焙

四张角色图由用户提供。这里不使用参考项目的代码、媒体或模型生成接口。

在渲染端运行：`node scripts/neural-avatars/bake.mjs`。首次从项目内的 `reference/avatars` 按 `config.mjs` 的归一化裁剪框取得正面头像；裁剪图保存到桌面资源目录。后续可用 `node scripts/neural-avatars/bake.mjs --from-crops` 只从已保存的裁剪图完整重建，运行时不需要原始大图。

处理顺序：224px 缩图 → 边缘连通白背景泛洪 → 高斯平滑（企鹅使用更大尺度）→ Sobel 非极大值抑制与粗亮度分区等值边 → Zhang–Suen 细化 → 相邻边图追踪为有序折线 → Douglas–Peucker 简化。只去掉与图像边界连通的白色，保留角色内部白色。伪深度来自前景到外边界的距离。填充点使用确定性的错列网格采样，约为轮廓顶点数的 24%，避免随机散点团块。

输出每份 JSON 小于 60KB。7 个整数一组：x、y、z（坐标尺度1000）、强度（0–255）、原图 RGB。`strokes` 是有序顶点索引，`fill` 为稀疏体积点；没有运行时图片采样或轮廓计算。预览只写入项目内 `redesign-v2/out/avatars`。
