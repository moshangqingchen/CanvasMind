import { projectTitleKey } from "./project-title";

/** Select before uploading; the server remains the authority for concurrent changes. */
export function projectImportTitle(title: string, canvasId: string, projects: readonly { id: string; title: string }[]): string {
  if (projects.some(project => project.id === canvasId && project.title === title)) return title;
  const occupied = new Set(projects.filter(project => project.id !== canvasId).map(project => projectTitleKey(project.title)));
  occupied.add(projectTitleKey(".supercanvas-meta"));
  if (!occupied.has(projectTitleKey(title))) return title;
  for (let index = 1; index <= occupied.size + 1; index++) {
    const suffix = index === 1 ? "（导入）" : `（导入 ${index}）`;
    // Folder keys are limited to 120 UTF-16 units. Keep the suffix inside that
    // boundary, including for long package titles; never split a surrogate pair.
    const base = title.slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/u, "");
    const candidate = `${base}${suffix}`;
    if (!occupied.has(projectTitleKey(candidate))) return candidate;
  }
  throw new Error("无法选择不冲突的导入项目名称，请调整项目名称后重试");
}
