# DHDesk Windows 支持方案（macOS + Windows x64）

> 状态：方案已确认。Windows 第一期仅支持 x64；macOS 侧构建路径保持不变。
> 本文档为规划归档，未涉及代码修改。

## 1. 结论

DHDesk 基于 Electron + electron-builder，框架本身跨平台，主进程代码中已存在 `process.platform === "win32"` 分支，**无需更换框架或重构**。差距集中在四处：

1. 内置 Node 与出厂 Harness Runtime 目前是 darwin 专用产物。
2. 打包配置只有 mac 段。
3. Windows 图标、签名与分发流程缺失。
4. 少量路径与进程管理代码需要平台分支适配（列于第 6 节，暂不修改）。

## 2. 目标交付形态

| 平台 | 架构 | 产物 |
|---|---|---|
| macOS 14+ | arm64（现有） | 签名公证 DMG |
| Windows 10/11 | x64（第一期） | NSIS 安装包（可选 portable 单文件版） |

两平台均内置 Node 与出厂 Harness Runtime，用户机器无需预装任何环境。

## 3. 现状盘点

### 3.1 已经兼容、无需改动的部分

- `src/main/process-supervisor.ts`、`src/main/harness-updater.ts` 已含 win32 分支（`detached`、`child.kill` 均有平台判断）。
- 主进程无硬编码 macOS 路径：全部使用 `app.getPath()`、`process.resourcesPath`、`homedir()`，Windows 上自动落到 `%APPDATA%\DHDesk` 与 `%USERPROFILE%\.dsh`。
- 单实例锁、菜单 roles、`CommandOrControl` 快捷键均为跨平台写法。
- `@deepseek-ai/dsh` 无 `os`/`cpu` 限制，自带 PowerShell 终端包（`dsh-pwsh-local`）；node-pty 的 npm 包内已含 win32-x64 prebuilds。
- Harness 更新器在用户机器上用内置 npm 安装，原生依赖按目标平台自动解析，链路天然跨平台。

### 3.2 拦路项

| # | 问题 | 位置 |
|---|---|---|
| 1 | 内置 Node 为 darwin 专用构建（tar.xz 布局），准备脚本硬拒绝非 mac 主机 | `resources/node/`、`scripts/prepare-node-runtime.mjs` |
| 2 | 出厂 Harness Runtime 为 mac-arm64 产物：仅含 `@img/sharp-darwin-arm64`，缺 `sharp-win32-x64` 及 koffi 的 win32 构建 | `resources/bundled-runtime/` |
| 3 | 打包配置只有 mac 段；extraResources 过滤器显式排除 win32 node-pty prebuilds；图标仅有 `.icns` | `electron-builder.yml` |
| 4 | 无 Windows `.ico` 图标、无 win 目标（NSIS/portable）、无 Windows 签名与验证流程 | `resources/icons/` |

## 4. 实施步骤

### 步骤 1：平台化内置 Node 运行时（构建脚本，非运行时代码）

`scripts/prepare-node-runtime.mjs` 按 `process.platform`/`process.arch` 分支：

- macOS：维持现状（`node-v24.19.0-darwin-arm64.tar.xz`）。
- Windows x64：下载 `node-v24.19.0-win-x64.zip`。注意布局差异：`node.exe` 位于压缩包根目录，npm 位于 `node_modules/npm`，无 `bin/`、`lib/` 层。
- 复用 SHA256 校验逻辑；Windows 解压使用系统自带 `tar.exe`（bsdtar 可解 zip）。
- `resources/node/` 变为按构建平台生成的产物，不进版本库，由 CI 产出。

### 步骤 2：平台化出厂 Harness Runtime

`scripts/prepare-harness-runtime.mjs` 逻辑本身跨平台，但**必须在目标平台的原生机器上执行**：Windows 上运行 `npm install` 才会拉取 `sharp-win32-x64`、koffi 的 win32 构建等。mac 上交叉安装会因源码构建模块失败，不推荐。

因此采用"各平台原生出包"：mac 机器出 DMG，Windows 机器出 EXE，由 CI 矩阵承载（见步骤 6）。

### 步骤 3：打包配置

`electron-builder.yml` 增加 `win` 段：

- `target: nsis`（可选 `portable`），第一期仅 `x64`。
- 图标：由现有 `app-icon.png` 生成 256px 多尺寸 `.ico`。
- `artifactName` 与现有命名规则对齐。
- extraResources 中排除 win32 prebuilds 的过滤器调整：优先方案为双平台 prebuilds 全部携带（体积代价很小），或拆分平台配置文件。
- `asar`、单实例等其余配置不变。

### 步骤 4：签名与分发

- Windows：未签名包会触发 SmartScreen"未知发布者"警告。正式发布需代码签名证书（OV/EV，或 Azure Trusted Signing），electron-builder 支持环境变量注入或 azuresigntool。内测阶段可先使用未签名 NSIS 包验证功能。
- macOS：维持现有 Developer ID + Hardened Runtime + 公证路径不变。
- 分发：GitHub Releases 同时发布 DMG 与 EXE，或使用自有渠道。
- DHDesk 自身自动更新（electron-updater）涉及双平台更新源，留待后续统一处理。

### 步骤 5：CI/CD

GitHub Actions 矩阵，两个 job 各自原生构建：

```text
macos-14 (arm64):    setup-node → npm ci → runtime:prepare → test → package:dmg
windows-2022:        setup-node → npm ci → runtime:prepare → test → package:nsis
```

- tag 推送触发签名发布；日常构建产出未签名内测 artifact。
- 本地临时验证：在 Windows 机器上执行 `npm install → npm run runtime:prepare → 打包` 即可出内测 EXE。

### 步骤 6：Windows 验证清单

- [ ] 干净 Win10 22H2 / Win11 x64（无 Node）安装并双击启动，Harness Web UI 可用。
- [ ] 用户名/路径含中文与空格场景。
- [ ] PowerShell 5.1 与 7 下 Harness 终端与 Shell 工具可用。
- [ ] 工作区选择器、Agent 文件读写与 Shell 执行。
- [ ] 退出后任务管理器无残留 `node.exe`/`dsh` 进程。
- [ ] 离线启动（回退到出厂运行时）。
- [ ] Harness 更新流程（内置 npm 在 Windows 上安装原生依赖）。
- [ ] 杀毒软件误报检查（未签名包尤其注意）。

## 5. 待定的代码适配点（暂不修改，第二阶段实施）

以下位置需要少量平台分支适配，本期仅记录：

1. `src/main/runtime-locator.ts`：Node/npm 候选路径需增加 Windows zip 布局（`node/node.exe`、`node/node_modules/npm/bin/npm-cli.js`）。
2. `src/main/process-supervisor.ts`：Windows 上 `child.kill("SIGTERM")` 等价于强杀（TerminateProcess），Harness 优雅退出 handler 不会执行。需评估优雅停止方案（stdin 命令或 CTRL_BREAK），至少列入测试项。
3. `src/main/app.ts`：菜单中 mac 专属 roles（`hide`/`hideOthers`）在 Windows 为 no-op，可加平台分支（非阻塞）。
4. `scripts/prepare-node-runtime.mjs`：移除 darwin 硬校验（步骤 1 覆盖）。

## 6. 推进节奏

| 阶段 | 内容 | 产出 |
|---|---|---|
| 一 | Windows 机器手工跑通 prepare + 打包 | 未签名内测 EXE（约 1–2 天） |
| 二 | 第 5 节代码适配 + win 打包配置 + CI 矩阵 | 双平台自动化构建 |
| 三 | 签名、SmartScreen 声誉、双平台发布流水线 | 正式分发包 |

macOS 侧零回归风险：所有改动均按平台分支，现有 mac 构建路径保持不变。

## 7. 已确认决策

- Windows 第一期仅支持 x64，暂不支持 arm64。
- 其余待确认：内测期未签名 EXE 还是直接上 Azure Trusted Signing；是否顺带支持 Intel Mac（darwin-x64 分支现成）；分发渠道是否用 GitHub Releases。
