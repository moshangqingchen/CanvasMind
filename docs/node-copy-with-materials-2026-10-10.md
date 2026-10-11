# 节点复制包含素材

节点右键菜单新增“复制（包含素材）”。点击后立即在附近复制右键目标节点，沿用原图片、视频、音频及提示词输入来源，并新建指向副本的输入连线。原节点、原连线和原素材保留。

输入端口、引用顺序及连线数据保持，副本保留提示词中的素材引用、供应商连接、完整型号与参数。不会递归复制上游素材或接出原下游，也不会复制旧任务生成来源关系；历史生成结果按既有规则转为固定素材。原普通复制和紧邻复制继续使用原行为，系统与画布剪贴板保持。

副本及新输入连线一起保存、撤销和重做。复制前同步最新编辑内容，撤销复制保留原节点刚编辑的提示词。

已本地覆盖安装 v0.2.90，BUILD_ID `t89WnEQ1v8jD7LoJPaGwu`，安装器 SHA-256 `37d1f7753b3e1000a0dff0408c813cc099f73849f4672306dadba74be588badc`。正常保存退出后完整备份并校验 3399 个持久文件；安装后首次启动前数据库与持久文件逐字节一致，重新打开原画布并核对素材、运行历史、Key 与连接绑定。

验证分开记录：相关隔离界面回归共 9 项通过（4 项新功能、4 项菜单键盘、1 项原复制粘贴），类型、静态检查、生产构建与安装包校验通过。最终假供应商及离线打包检查 28 项、隔离窗口检查 4 项通过；安装版实际窗口确认右键菜单入口可见。新功能的复制/保存/撤销操作在隔离测试资料中执行；真实用户画布只检查菜单和数据保留，未额外创建副本或发起生成。

```json
{
  "recordedAt": "2026-10-11T01:34:58.890Z",
  "version": "0.2.90",
  "buildId": "t89WnEQ1v8jD7LoJPaGwu",
  "installerSha256": "37d1f7753b3e1000a0dff0408c813cc099f73849f4672306dadba74be588badc",
  "behavior": {
    "menu": "复制（包含素材）",
    "immediateCopy": true,
    "onlyContextTarget": true,
    "sharedOriginalMaterialSources": true,
    "ordinaryIncomingConnectionsRetained": true,
    "outgoingOrGeneratedRelationsCopied": false,
    "clipboardChanged": false
  },
  "sourceChecks": {
    "typecheckExitCode": 0,
    "eslintExitCode": 0,
    "productionRendererBuildExitCode": 0,
    "desktopStageExitCode": 0,
    "desktopDistExitCode": 0,
    "relatedUiTestsPassed": 9,
    "newFeatureUiTestsPassed": 4,
    "existingKeyboardAndCopyUiTestsPassed": 5,
    "existingKeyboardAndCopyEvidence": {
      "evidence": "Actual Playwright output from exec session 70172, final renderer production build; the unrelated initial feature multi-selection case was blocked by fixture toolbar overlap and was repaired/retested separately.",
      "passed": 5,
      "checks": [
        "右键菜单可用方向键操作，Escape 回收焦点，外部点击关闭",
        "撤销后立即编辑提示词会建立新分支并清除旧重做",
        "分组内的解组按钮能用 Enter 激活，撤销重做保留正确状态",
        "小窗口边缘弹出的新建菜单不会被顶栏遮住或裁切",
        "复制粘贴节点时贴近当前选中节点并向下避让"
      ]
    },
    "fixtureAdjustment": "Move the prompt fixture to keep its multi-selection toolbar from covering the target node header; all four feature cases then passed."
  },
  "packagedChecks": {
    "scope": "Isolated win-unpacked smoke profiles only; no real installed app or supplier generation",
    "packagedPassed": 28,
    "windowedPassed": 4,
    "rendererExceptions": 0
  },
  "installation": {
    "exitCode": 0,
    "installedVersion": "0.2.90.0",
    "verifiedBackupFiles": 3399,
    "databaseByteIdenticalBeforeFirstLaunch": true,
    "persistentFilesIdenticalBeforeFirstLaunch": true,
    "postcheckHarnessCorrection": "Installer exited 0; the running helper retained an obsolete 0.2.89 version assertion. Corrected the helper and independently verified installed 0.2.90.0 plus final build and all four core file hashes, without rerunning installation."
  },
  "installedFiles": {
    "checkedAt": "2026-10-11T01:33:38.467Z",
    "version": "0.2.90.0",
    "buildId": "t89WnEQ1v8jD7LoJPaGwu",
    "files": [
      {
        "path": "SuperCanvas.exe",
        "sha256": "fe7d41ec029b915dbfd145034afcdcd0878601b1c8a73232c86796cedf40aa39",
        "identical": true
      },
      {
        "path": "resources/app.asar",
        "sha256": "74556504fc50b6c792c301c59b618d571c841b2ee5d9446181688b64b2aa3429",
        "identical": true
      },
      {
        "path": "resources/runtime/node.exe",
        "sha256": "3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5",
        "identical": true
      },
      {
        "path": "resources/runtime/server/apps/desktop/renderer/.next-desktop/BUILD_ID",
        "sha256": "444e39edd281da906424faa74312c56b21abac0cbc5d18da356071ef814ab268",
        "identical": true
      }
    ],
    "passed": true
  },
  "installedReadback": {
    "checkedAt": "2026-10-11T01:34:55.348Z",
    "version": "0.2.90",
    "buildId": "t89WnEQ1v8jD7LoJPaGwu",
    "healthOk": true,
    "originalCanvasReopened": true,
    "save": "已保存",
    "lifecycle": {
      "draining": false,
      "activeRuns": 0,
      "resumableCloudRuns": 0,
      "activeVerifications": 0,
      "activeWrites": 0
    },
    "collections": [
      {
        "collection": "assets",
        "before": 442,
        "after": 442,
        "unchanged": true
      },
      {
        "collection": "runs",
        "before": 413,
        "after": 413,
        "unchanged": true
      },
      {
        "collection": "nodeRuns",
        "before": 413,
        "after": 413,
        "unchanged": true
      },
      {
        "collection": "directorMessages",
        "before": 24,
        "after": 24,
        "unchanged": true
      },
      {
        "collection": "directorProposals",
        "before": 3,
        "after": 3,
        "unchanged": true
      },
      {
        "collection": "directorSessions",
        "before": 2,
        "after": 2,
        "unchanged": true
      },
      {
        "collection": "supplierVerifications",
        "before": 17,
        "after": 17,
        "unchanged": true
      }
    ],
    "connectionBindingsPreserved": true,
    "originalConnections": 161,
    "canvases": [
      {
        "canvasIndex": 0,
        "beforeNodes": 25,
        "afterNodes": 25,
        "beforeEdges": 21,
        "afterEdges": 21,
        "unchanged": true
      },
      {
        "canvasIndex": 1,
        "beforeNodes": 3,
        "afterNodes": 3,
        "beforeEdges": 0,
        "afterEdges": 0,
        "unchanged": true
      },
      {
        "canvasIndex": 2,
        "beforeNodes": 5,
        "afterNodes": 5,
        "beforeEdges": 0,
        "afterEdges": 0,
        "unchanged": true
      },
      {
        "canvasIndex": 3,
        "beforeNodes": 5,
        "afterNodes": 5,
        "beforeEdges": 4,
        "afterEdges": 4,
        "unchanged": true
      }
    ],
    "newGenerationRequests": 0
  },
  "nativeUi": {
    "checkedAt": "2026-10-11T01:34:52.901Z",
    "version": "0.2.90",
    "buildId": "t89WnEQ1v8jD7LoJPaGwu",
    "passed": true,
    "scope": "Actual installed Windows node context menu visibility; copy/save/undo operations tested in isolated fixtures.",
    "menuLabel": "复制（包含素材）",
    "originalCopyVisible": true,
    "tightDuplicateVisible": true,
    "screenshot": "native-copy-materials-menu.png",
    "realUserCanvasCopiesCreated": 0,
    "newGenerationRequests": 0
  },
  "paidGenerationRequests": 0
}
```
