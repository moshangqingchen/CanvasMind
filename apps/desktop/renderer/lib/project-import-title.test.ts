import { describe, expect, it } from "vitest";
import { projectImportTitle } from "./project-import-title";
import { projectTitleKey } from "./project-title";

describe("project import title", () => {
  it("keeps the unchanged current title even for legacy duplicate projects", () => {
    expect(projectImportTitle("A", "current", [{ id: "current", title: "A" }, { id: "other", title: "A" }])).toBe("A");
  });
  it("chooses ordered suffixes with the server's normalized directory identity", () => {
    const projects = [{ id: "a", title: "A_B" }, { id: "b", title: "a_b（导入）" }];
    expect(projectImportTitle("A/B", "current", projects)).toBe("A/B（导入 2）");
    expect(projectImportTitle("全新", "current", projects)).toBe("全新");
    expect(projectImportTitle("e\u0301", "current", [{ id: "a", title: "é" }])).toBe("e\u0301（导入）");
  });
  it("keeps suffixes within the folder-key limit for a long package title", () => {
    const title = "长".repeat(160);
    const selected = projectImportTitle(title, "current", [{ id: "other", title }]);
    expect(selected).toHaveLength(120);
    expect(selected.endsWith("（导入）")).toBe(true);
    expect(projectTitleKey(selected)).not.toBe(projectTitleKey(title));
  });
});
