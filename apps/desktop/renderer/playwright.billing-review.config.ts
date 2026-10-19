import { defineConfig } from "@playwright/test";
import base from "./playwright.canvas-v3.config";

/** Review follow-ups retain the owned runtime and its loopback-only guard. */
export default defineConfig({
  ...base,
  projects: [
    { name: "review-fingerprint", testMatch: "canvas-run-fingerprint.spec.ts" },
    { name: "review-failed-parameters", testMatch: "canvas-failed-generation-parameters.spec.ts" },
    {
      name: "review-submission", testMatch: "canvas.spec.ts",
      grep: /生成中再次运行创建独立结果|提交生成后立即创建多个占位框|生成失败会在同一个结果框|再次运行多结果批次|新建图片节点可在自动保存触发前直接运行最新设置|上传素材、保存结构化 @引用/u,
    },
    {
      name: "review-save-recovery", testMatch: "canvas-polish.spec.ts",
      grep: /提交响应丢失并关闭页面|输入框保存最新内容、组合输入不生成|运行时逐字保留提示词与换行|任务运行期间保存失败/u,
    },
    {
      name: "review-selection", testMatch: "graphic-design.spec.ts",
      grep: /生成设计只运行本次新增方案/u,
    },
  ],
});
