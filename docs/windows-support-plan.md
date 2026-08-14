# DHDesk 双平台支持开发计划

> 目标平台：macOS arm64 + Windows x64
> 文档状态：实施中（双平台构建已完成，Windows 正式签名与真机验收待完成）
> 最后更新：2026-08-14
> 对应分支：`feature/windows-support`

## 1. 目标与结论

DHDesk 继续使用 Electron + TypeScript + electron-builder，不更换桌面框架。新分支的目标不是单独制作一个 Windows 版本，而是在同一套业务代码下维护两个可独立构建、测试和发布的平台版本：

| 平台 | 最低版本 | 架构 | 安装产物 |
|---|---|---|---|
| macOS | macOS 14 | arm64 | DMG |
| Windows | Windows 10 22H2 / Windows 11 | x64 | NSIS Setup EXE |

两个平台必须具备相同的核心能力：

- 双击桌面应用即可启动 DeepSeek Harness Web UI。
- 用户机器无需预装 Node.js、npm 或 DeepSeek Harness。
- 内置一个出厂 Harness Runtime，离线时仍能启动。
- 支持在 DHDesk 内检查、下载、验证、切换和回滚 Harness。
- 保留 Harness 官方用户目录，不因安装、升级或卸载 DHDesk 被覆盖。
- Harness 仅监听 `127.0.0.1`，Renderer 不获得 Node.js 或任意命令执行权限。

## 2. 范围

### 2.1 本期范围

- 保持 macOS arm64 的现有启动、升级和 DMG 构建能力。
- 新增 Windows x64 Runtime 准备、进程管理和 NSIS 打包能力。
- 在两个平台的原生构建环境中准备 Node 与出厂 Harness Runtime。
- 建立 macOS/Windows GitHub Actions 构建矩阵。
- 产出未签名 Windows 内测安装包。
- 为正式签名、公证和发布预留配置入口。

### 2.2 暂不包含

- Windows arm64。
- Intel Mac。
- Microsoft Store 或 Mac App Store。
- Windows portable 单文件版本。
- DHDesk 自身自动更新原不属于本计划范围，现已作为后续功能独立实现。
- 自动迁移或恢复 `~/.dsh` 用户数据。
- Harness 历史版本管理页面。

## 3. 当前代码基线

当前版本已经完成以下跨平台基础：

- Electron 主进程、Preload 和 Renderer 使用 TypeScript。
- 单实例锁、启动页、错误页、日志和 Harness 进程状态管理。
- 使用 `app.getPath()`、`process.resourcesPath`、`homedir()` 和 `node:path` 管理路径。
- 主窗口启用 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。
- Harness 使用独立 Node 子进程，通过动态端口监听 `127.0.0.1`。
- 已实现 Harness 应用内升级、SHA-512 校验、隔离冒烟测试、原子切换和启动失败回滚。
- `node-pty` npm 包包含 Windows x64 prebuild，但当前 macOS 打包配置明确排除了它。

当前 Runtime 固定版本读取自 `resources/runtime-manifest.json`：

| 组件 | 当前版本 |
|---|---|
| Node.js | `v24.19.0` |
| DeepSeek Harness | `0.1.0-rc.6` |

### 3.1 当前阻塞 Windows 的位置

| 模块 | 当前问题 |
|---|---|
| `scripts/prepare-node-runtime.mjs` | 仅允许 darwin，固定下载 `.tar.xz`，固定使用 Unix 目录和符号链接 |
| `scripts/prepare-harness-runtime.mjs` | 硬编码 `bin/node` 与 `lib/node_modules/npm` |
| `src/main/runtime-locator.ts` | 只查找 macOS Node/npm 目录 |
| `electron-builder.yml` | 只复制 macOS Node 布局，只配置 DMG，并排除 win32 node-pty |
| `package.json` | 没有 Windows 打包命令，产品描述仅提到 macOS |
| 进程结束逻辑 | Windows 上不能依赖 Unix 信号和进程组，需要处理完整子进程树 |
| UI 平台细节 | 更新窗口按钮和部分应用菜单 role 具有 macOS 语义 |
| 发布流程 | 缺少 Windows 图标、NSIS 设置、签名和安装验证 |

## 4. 双平台目录与 Runtime 约定

### 4.1 构建期 Runtime 布局

macOS：

```text
resources/node/
├── bin/node
├── bin/npm
├── bin/npx
└── lib/node_modules/npm/
```

Windows：

```text
resources/node/
├── node.exe
├── npm.cmd
├── npx.cmd
└── node_modules/npm/
```

DHDesk 的正常启动和 Harness 更新流程均使用 `node.exe <npm-cli.js>` 直接调用 npm，运行时不依赖 `npm.cmd` 或 `npx.cmd`。两个 `.cmd` 文件仅为保持 Node 官方 zip 资源完整性和便于调试而保留，不得将其作为需要 shell 执行的业务依赖。

两个平台的出厂 Harness 布局保持一致：

```text
resources/bundled-runtime/
├── package.json
├── package-lock.json
├── runtime-platform.json
└── node_modules/@deepseek-ai/dsh/
```

`runtime-platform.json` 至少记录：

```json
{
  "platform": "darwin",
  "arch": "arm64",
  "nodeVersion": "v24.19.0",
  "harnessVersion": "0.1.0-rc.6"
}
```

准备脚本不能只因 `dsh/lib/bin.js` 存在就提前退出，必须同时确认平台、架构和版本匹配，防止把 macOS 原生依赖打进 Windows 包。

### 4.2 用户机器目录

macOS：

```text
~/Library/Application Support/DHDesk/
~/.dsh/
```

Windows：

```text
%APPDATA%\DHDesk\
%USERPROFILE%\.dsh\
```

约束：

- DHDesk Runtime、下载缓存和激活记录保存在应用数据目录。
- Harness 配置、凭据、会话和工作区继续保存在 `.dsh`。
- 安装、升级和默认卸载均不得删除 `.dsh`。
- 不在应用日志中记录 API Key、Authorization Header 或凭据文件内容。

## 5. 实施方案

### 5.1 平台化 Node Runtime 准备脚本

修改 `scripts/prepare-node-runtime.mjs`：

- [ ] 只接受 `darwin-arm64` 和 `win32-x64` 两种目标。
- [ ] macOS 下载 `node-v24.19.0-darwin-arm64.tar.xz`。
- [ ] Windows 下载 `node-v24.19.0-win-x64.zip`。
- [ ] 两个平台均读取 Node 官方 `SHASUMS256.txt` 并执行 SHA-256 校验。
- [ ] macOS 解压后修复 `bin/npm`、`bin/npx` 符号链接。
- [ ] Windows 不创建符号链接，直接保留官方 zip 布局。
- [ ] 准备完成后执行目标 Node，检查 `process.platform`、`process.arch` 和版本。
- [ ] 错误信息明确显示构建主机、目标平台和不支持原因。

不在 macOS 上交叉准备 Windows Node，也不在 Windows 上准备 macOS Node。

### 5.2 平台化出厂 Harness Runtime

修改 `scripts/prepare-harness-runtime.mjs`：

- [ ] 根据平台解析 Node 与 npm CLI 路径。
- [ ] 只能使用项目内置 Node/npm，不能回退到系统 Node。
- [ ] 在目标平台原生执行 `npm install`。
- [ ] 安装版本继续读取 `resources/runtime-manifest.json`。
- [ ] 安装后检查 `@deepseek-ai/dsh/package.json` 版本。
- [ ] 执行 `dsh --version`。
- [ ] 检查目标平台原生模块：
  - macOS arm64：sharp/koffi 的 darwin-arm64 依赖。
  - Windows x64：sharp/koffi 的 win32-x64 依赖及 node-pty win32-x64 prebuild。
- [ ] 写入 `runtime-platform.json`。
- [ ] 使用临时 `DSH_HOME` 完成一次 Web 启动和 HTTP 健康检查。

采用目标平台原生安装，而不是依赖 npm 的 `--os`/`--cpu` 交叉安装。原因是 Harness 包含生命周期脚本和原生依赖，只有原生安装及冒烟测试能覆盖真实运行链路。

### 5.3 Runtime 定位与平台标记校验

修改 `src/main/runtime-locator.ts`：

- [ ] macOS Node 候选：`node/bin/node`。
- [ ] Windows Node 候选：`node/node.exe`。
- [ ] macOS npm 候选：`node/lib/node_modules/npm/bin/npm-cli.js`。
- [ ] Windows npm 候选：`node/node_modules/npm/bin/npm-cli.js`。
- [ ] 开发环境和打包环境均覆盖上述候选路径。
- [ ] Runtime 不完整时继续回退到应用内置版本。
- [ ] 定位出厂 Runtime 和 Updater 管理的 Runtime 时，均读取并校验 `runtime-platform.json`。
- [ ] Updater 在临时目录安装新 Harness 后写入平台标记，并在原子切换到正式版本目录前再次校验平台、架构、Node 版本和 Harness 版本。
- [ ] 对旧版 DHDesk 创建的无标记 Runtime 先执行完整性与平台校验；校验通过后补写标记，不因单纯缺失标记破坏现有安装。
- [ ] 添加 darwin/win32 路径解析单元测试。

建议把平台布局解析收敛成一个纯函数，避免准备脚本、Locator 和打包配置分别维护不一致的字符串。

### 5.4 Windows 进程树管理

需要同时覆盖日常 Harness 进程和更新器安装/冒烟测试进程。

修改：

- `src/main/process-supervisor.ts`
- `src/main/harness-updater.ts`

策略：

| 平台 | 启动 | 正常停止 | 超时兜底 |
|---|---|---|---|
| macOS | detached 进程组 | 向进程组发送 `SIGTERM` | `SIGKILL` |
| Windows | 普通子进程 | 请求结束主进程并等待 | 结束完整进程树 |

任务：

- [ ] 抽取统一的 `terminateProcessTree()`。
- [ ] macOS 保持现有进程组逻辑。
- [ ] `process-supervisor` 和 `harness-updater` 中的所有 `spawn()` 均设置 `windowsHide: process.platform === "win32"`，避免 GUI 应用启动 Node/npm 时闪现或保留控制台窗口。
- [ ] Windows 不把 `SIGTERM` 当作优雅退出保证；当前 `signalChild()` 在 win32 上调用 `child.kill("SIGTERM")` 本质是终止目标进程，不能假设 Harness 会执行清理逻辑，也不保证子进程树已结束。
- [ ] Windows 超时后使用可靠的进程树终止方式，例如 `taskkill /PID <pid> /T /F`。
- [ ] npm 安装超时同样清理 npm/node-gyp/生命周期脚本子进程。
- [ ] 应用退出后验证没有遗留 `node.exe`、`conhost.exe` 或 Harness 子进程。
- [ ] 保留停止超时和错误日志，但不记录完整环境变量。

当前 Harness 启动后会立即关闭 stdin，因此在实现新的协议前，不能把“通过 stdin 优雅退出”写成既有能力。

### 5.5 Electron 平台细节

- [ ] 仅在 `process.platform === "darwin"` 时调用 macOS 窗口按钮相关 API。
- [ ] macOS 保留 About、Hide、Hide Others 等系统菜单。
- [ ] Windows 菜单只保留有效操作，并显示标准复制、粘贴和窗口快捷键。
- [ ] `CommandOrControl+Shift+U` 在两平台分别表现为 `⌘⇧U` 和 `Ctrl+Shift+U`。
- [ ] 外部 HTTP/HTTPS 链接继续交由系统浏览器打开。
- [ ] 检查 Windows 高 DPI 125%、150%、200% 下主 Web UI 和更新窗口点击位置。

### 5.6 分离打包配置

建议将当前配置拆分为：

```text
electron-builder.base.yml
electron-builder.mac.yml
electron-builder.win.yml
```

electron-builder 在显式传入 `--config` 后不会再自动加载默认的 `electron-builder.yml`。平台配置必须显式继承基础配置，不依赖多个 `-c` 参数合并；当前 electron-builder 版本在重复传入配置文件时可能只保留最后一个。

```yaml
# electron-builder.mac.yml
extends: electron-builder.base.yml
```

```yaml
# electron-builder.win.yml
extends: electron-builder.base.yml
```

共同配置包含：

- `appId`、`productName`、`asar`。
- `dist`、`package.json`。
- 出厂 Harness Runtime 的公共文件。

macOS 配置包含：

- Node 的 Unix 目录布局。
- `app-icon.icns`。
- Hardened Runtime 和 entitlements。
- arm64 DMG。
- 排除 Windows、Linux 和 darwin-x64 原生文件。

Windows 配置包含：

- `node.exe`、`npm.cmd`、`npx.cmd` 和 `node_modules/npm`。
- `app-icon.ico`。
- x64 NSIS。
- 保留 node-pty win32-x64，排除 macOS、Linux 和 Windows arm64 原生文件。

新增 npm scripts：

```json
{
  "package:dir:mac": "electron-builder --dir --mac -c electron-builder.mac.yml",
  "package:dir:win": "electron-builder --dir --win --x64 -c electron-builder.win.yml",
  "package:dmg": "electron-builder --mac dmg --arm64 -c electron-builder.mac.yml",
  "package:nsis": "electron-builder --win nsis --x64 -c electron-builder.win.yml"
}
```

产物命名：

```text
DHDesk-<version>-mac-arm64.dmg
DHDesk-<version>-win-x64-setup.exe
```

### 5.7 Windows NSIS 安装策略

第一期建议：

- [ ] 当前用户安装，默认不要求管理员权限。
- [ ] 支持开始菜单和桌面快捷方式。
- [ ] 同一 `appId` 和安装 GUID 下覆盖升级。
- [ ] 卸载应用时默认保留 `%APPDATA%\DHDesk` 和 `%USERPROFILE%\.dsh`。
- [ ] 安装目录含空格时可以正常启动。
- [ ] 不在安装器中捆绑额外下载器或系统级服务。
- [ ] portable 版本在 NSIS 稳定后再评估。

## 6. 签名与发布

### 6.1 macOS

macOS 正式签名与公证流水线已经建立。GitHub Actions 仅接受 `Developer ID Application: xiangguang zhang (2NW8BV74J4)`，并按证书 SHA-1、完整名称和 Team ID 校验临时钥匙串，避免误用本机或其他团队身份。

- [x] Developer ID Application 证书。
- [x] Hardened Runtime。
- [x] Node sidecar、Electron Framework 和所有嵌套原生模块签名。
- [x] Apple Notarization。
- [x] Stapling。
- [x] `codesign --verify --deep --strict` 和 Gatekeeper 验证。
- [ ] 无开发环境干净 Mac 真机验收。

### 6.2 Windows

分两步：

1. 未签名 NSIS 内测包，用于验证功能和杀毒软件误报。
2. 正式发布接入 OV/EV 代码签名证书或 Azure Trusted Signing。

正式发布要求：

- [ ] 主 EXE、Helper、Node sidecar、NSIS 安装器完成签名。
- [ ] 使用可信时间戳服务。
- [ ] 安装前后验证 Authenticode 状态。
- [ ] 签名凭据只通过 CI Secret 或受控签名服务提供，不进入仓库。
- [ ] 明确 SmartScreen 声誉建立期，不承诺签名后立即消除所有提示。

## 7. CI/CD

GitHub Actions 使用目标平台原生 Runner：

```text
macos-14:
  checkout
  setup-node
  npm ci
  runtime:prepare
  typecheck + test
  package:dmg
  verify mac artifact

windows-2022:
  checkout
  setup-node
  npm ci
  runtime:prepare
  typecheck + test
  package:nsis
  verify Windows artifact
```

要求：

- [x] 每个 job 开始时输出并断言构建平台与架构。
- [x] Runtime 缓存 key 包含 OS、架构和 Runtime Manifest 内容摘要。
- [x] 禁止在 macOS 与 Windows job 之间共享 `resources/node` 或 `bundled-runtime` 缓存。
- [x] Pull Request 构建未签名安装包。
- [x] Tag 构建正式签名、公证的 macOS 产物和未签名 Windows 产物。
- [x] 两个平台测试全部通过后才创建 Release。
- [x] Release 同时附带 SHA-256 校验文件和自更新元数据。
- [x] CI 日志不输出证书密码、Token 或签名服务凭据。

当前 GitHub Hosted Runner 中，`macos-14` 为 arm64，`windows-2022` 为 x64；工作流仍需显式断言架构，避免未来 Runner 标签变化造成 Runtime 与应用架构不一致。

## 8. 测试计划

### 8.1 单元测试

- [ ] 平台到 Node/npm 路径的映射。
- [ ] Runtime 平台标记读取和错误平台拒绝。
- [ ] macOS/Windows 版本目录解析。
- [ ] Windows 进程树结束命令参数。
- [ ] 打包资源过滤规则。
- [ ] 更新切换和失败回滚。

### 8.2 集成测试

每个平台原生执行：

- [ ] 内置 Node 版本和架构检查。
- [ ] 出厂 Harness `dsh --version`。
- [ ] 临时 `DSH_HOME` 启动 Web 服务。
- [ ] HTTP 健康检查。
- [ ] Harness 更新下载安装。
- [ ] 新版本激活与旧版本回滚。
- [ ] 应用退出后的残留进程检查。

### 8.3 Windows 手工验收矩阵

- [ ] 干净 Windows 10 22H2 x64，无 Node/npm/pnpm。
- [ ] 干净 Windows 11 x64，无 Node/npm/pnpm。
- [ ] Windows 用户名、安装路径和工作区包含中文与空格。
- [ ] 显示缩放 100%、125%、150%、200%。
- [ ] PowerShell 5.1 环境。
- [ ] 安装 PowerShell 7 的环境。
- [ ] 工作区选择、文件读取、文件修改和 Shell 执行。
- [ ] Harness Web UI 的按钮点击位置正确。
- [ ] 应用重启和系统重启后会话数据仍存在。
- [ ] 断网时使用出厂 Runtime 正常启动。
- [ ] 更新时断网、损坏包和安装失败不会影响当前版本。
- [ ] 退出和卸载后没有遗留进程；用户数据仍保留。
- [ ] Windows Defender 和常见企业杀毒软件扫描。

### 8.4 macOS 回归矩阵

- [ ] macOS 14 arm64。
- [ ] 当前最新稳定 macOS arm64。
- [ ] 启动、重启、退出和 Harness 更新。
- [ ] Web UI、工作区选择器和 Shell 工具。
- [ ] 签名、DMG 挂载和 Gatekeeper。
- [ ] 现有 `~/.dsh` 数据保持。

## 9. 验收标准

### 9.1 共同标准

- [ ] 用户无需打开终端即可使用 Harness。
- [ ] 用户无需安装系统 Node.js。
- [ ] 出厂 Runtime 可离线启动。
- [ ] Harness 更新失败不破坏当前版本。
- [ ] 新 Runtime 启动失败自动回滚。
- [ ] 应用退出后无 Harness/Node 残留进程。
- [ ] `.dsh` 用户数据跨升级保持。
- [ ] 主窗口不能导航到未授权本地服务。
- [ ] 日志不包含明文 API Key。

### 9.2 macOS 完成标准

- [ ] 生成 arm64 DMG。
- [ ] 应用及嵌套组件签名验证通过。
- [ ] 正式发布包完成公证和 Stapling。

### 9.3 Windows 完成标准

- [ ] 生成 x64 NSIS Setup EXE。
- [ ] 在干净 Win10/Win11 上安装、启动、更新和卸载通过。
- [ ] 正式发布包 Authenticode 验证通过。
- [ ] 中文路径、高 DPI 和进程清理测试通过。

## 10. 里程碑

| 里程碑 | 内容 | 交付物 |
|---|---|---|
| M1：Runtime 平台化 | Node/Harness 准备脚本、平台标记、Locator | 两个平台可生成正确 Runtime |
| M2：运行时适配 | Windows 进程树、菜单和窗口平台分支 | Windows 开发版可稳定启动/退出 |
| M3：Windows 打包 | 分离 builder 配置、ICO、NSIS | 未签名 Windows x64 内测安装包 |
| M4：双平台验证 | 单元、集成和手工测试 | macOS 无回归，Windows 核心功能通过 |
| M5：CI | GitHub Actions 双平台矩阵 | 每个提交可生成测试产物 |
| M6：正式发布 | macOS 公证、Windows 签名、Release | 可对外分发的 DMG + EXE |

Windows 第一个可运行安装包必须在 M1–M3 完成后生成，不能直接用当前脚本在 Windows 上执行 `runtime:prepare`。

## 11. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Runtime 与应用目标架构不一致 | 应用能安装但 Harness 无法启动 | 平台标记、构建前断言、原生 Runner |
| npm 原生依赖缺少 Windows 构建 | Harness 安装或启动失败 | Windows 原生安装、模块检查、完整冒烟测试 |
| Windows 子进程未全部结束 | 残留进程、文件锁、更新失败 | 统一进程树管理和退出测试 |
| 杀毒软件拦截未签名安装器 | 用户无法安装或运行 | 内测收集误报，正式版签名并建立声誉 |
| 双平台配置互相污染 | macOS 回归或 Windows 缺文件 | 分离 builder 配置、平台缓存隔离 |
| Harness 预览版改变 CLI/数据格式 | 更新失败或数据不兼容 | 固定出厂版本、冒烟测试、Runtime 回滚 |
| 新版本迁移 `.dsh` | 只回滚 Runtime 仍可能不兼容 | 不自动恢复数据，后续设计用户确认的数据备份 |

不能宣称 macOS“零回归风险”。共享代码和构建脚本发生变化后，必须执行完整 macOS 回归。

## 12. 已确认与待确认决策

### 已确认

- [x] 同一仓库、同一业务代码支持 macOS 和 Windows。
- [x] macOS 第一期仅 arm64。
- [x] Windows 第一期仅 x64。
- [x] Windows 使用目标平台原生构建，不从 macOS 交叉制作 Runtime。
- [x] Windows 第一交付形态为 NSIS Setup EXE。
- [x] 两个平台复用官方 `.dsh` 用户目录。
- [x] Harness 更新与 DHDesk 自身更新保持分离。

### 待确认

- [ ] Windows 内测是否长期允许未签名，还是第一版即接入签名。
- [ ] Windows 正式签名采用 OV/EV 证书还是 Azure Trusted Signing。
- [ ] NSIS 使用 one-click 还是带安装目录选择的 assisted 模式。
- [ ] GitHub Releases 是否作为正式分发渠道。
- [ ] DHDesk 自身自动更新何时进入计划。
- [ ] portable、Windows arm64 和 Intel Mac 的后续优先级。

## 13. 参考资料

- [Node.js 官方下载](https://nodejs.org/en/download)
- [electron-builder 多平台构建](https://www.electron.build/multi-platform-build.html)
- [electron-builder Configuration 与 extends](https://www.electron.build/docs/api/app-builder-lib.interface.configuration/)
- [electron-builder NSIS 配置](https://www.electron.build/nsis.html)
- [electron-builder Windows 签名](https://www.electron.build/code-signing-win.html)
- [Node.js child_process 文档](https://nodejs.org/api/child_process.html)
- [GitHub Hosted Runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
