# DHDesk

DHDesk 是 DeepSeek Harness 的非官方 macOS / Windows 桌面启动器。它负责启动本地 Harness Runtime、在安全的 Electron 窗口中展示官方 Web UI，并分别支持升级 Harness 和 DHDesk 桌面应用。

支持平台：

- macOS 14+，Apple Silicon（arm64）
- Windows 10 22H2 / Windows 11，x64

## 本地开发

要求：Node.js 24+，并在目标平台原生准备 Runtime。

```bash
npm install
npm run runtime:prepare
npm run dev
```

## 在应用内升级 Harness

从菜单选择 `Harness > 检查 Harness 更新…`，也可以使用 `CommandOrControl+Shift+U`。

DHDesk 会从 npm `latest` 查询 `@deepseek-ai/dsh`，将新版本安装到独立目录，校验 SHA-512 integrity，并在临时 `DSH_HOME` 中完成 Web 启动测试。验证成功后点击“重启并使用”才会切换版本；新版本启动失败时会自动恢复上一版本。更新过程不会覆盖 `.dsh` 用户数据。

也可以通过环境变量使用已有 Runtime 进行调试：

```bash
DHDESK_DSH_ENTRY=/absolute/path/to/@deepseek-ai/dsh/lib/bin.js npm run dev
```

## 升级 DHDesk

macOS 从应用菜单、Windows 从“帮助”菜单选择“检查 DHDesk 更新…”。正式安装版会读取公开 [GitHub Releases](https://github.com/zhangxguang/DHDesk/releases) 的更新元数据，下载并校验对应平台的安装包，然后由用户确认重启安装。

DHDesk 自更新与 Harness Runtime 更新相互独立，不会删除 `.dsh` 或已安装的 Harness Runtime。开发模式会禁用桌面应用自更新。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 打包

```bash
# macOS 未签名本地 App
npm run package:dir:mac

# macOS DMG
npm run package:dmg

# macOS Release 所需 DMG、ZIP 和 latest-mac.yml
npm run package:mac:release

# Windows NSIS Setup EXE 和 latest.yml
npm run package:nsis
```

推送 `v*` 标签后，GitHub Actions 会在双平台构建通过后创建 GitHub Release。macOS 流程使用指定 Developer ID Application 证书完成 Hardened Runtime 签名、公证、Stapling 和 Gatekeeper 验证；Windows 当前仍是未签名安装包。

完整计划见 [docs/development-plan.md](docs/development-plan.md)。
