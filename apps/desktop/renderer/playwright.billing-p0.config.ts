import { defineConfig } from "@playwright/test";
import base from "./playwright.canvas-v3.config";

/** Billing regressions own an ephemeral runtime and retain its loopback guard. */
export default defineConfig({
  ...base,
  projects: [
    {
      name: "billing-canvas",
      testMatch: [
        "canvas-failed-generation-parameters.spec.ts",
        "canvas-polish.spec.ts",
        "canvas-music.spec.ts",
        "project-files.spec.ts",
      ],
    },
    {
      name: "billing-submission",
      testMatch: "canvas.spec.ts",
      grep: /生成中再次运行创建独立结果|提交生成后立即创建多个占位框|生成失败会在同一个结果框|再次运行多结果批次|新建图片节点可在自动保存触发前直接运行最新设置|上传素材、保存结构化 @引用/u,
    },
    {
      name: "billing-history",
      testMatch: ["personal-ai-runtime.spec.ts", "result-information.spec.ts"],
    },
    {
      name: "billing-design",
      testMatch: ["image-design.spec.ts", "graphic-design.spec.ts"],
      grep: /从选定版本继续修改保留原图和节点|生成设计只运行本次新增方案/u,
    },
  ],
});
