# DHDesk

DHDesk 是 DeepSeek Harness 的 macOS 桌面启动器。它负责启动本地 Harness Runtime、在安全的 Electron 窗口中展示官方 Web UI，并支持在应用内升级 Harness。

当前代码对应开发计划的“阶段 0：技术验证”。目标平台为 macOS 14+、Apple Silicon。

## 本地开发

要求：

- macOS Apple Silicon
- Node.js 24+

安装依赖并准备固定版本的 Node.js 与 DeepSeek Harness Runtime：

```bash
npm install
npm run runtime:prepare
```

启动应用：

```bash
npm run dev
```

## 在应用内升级 Harness

从 macOS 菜单栏选择 `Harness > 检查 Harness 更新…`，也可以使用快捷键 `⌘⇧U`。

DHDesk 会从 npm `latest` 查询 `@deepseek-ai/dsh`，将新版本安装到独立目录，校验 SHA-512 integrity，并在临时 `DSH_HOME` 中完成 Web 启动测试。验证成功后点击“重启并使用”才会切换版本；新版本启动失败时会自动恢复上一版本。更新过程不会覆盖 `~/.dsh` 用户数据。

也可以通过环境变量使用已有 Runtime 进行调试：

```bash
DHDESK_DSH_ENTRY=/absolute/path/to/@deepseek-ai/dsh/lib/bin.js npm run dev
```

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 打包

生成未签名的本地 `.app`：

```bash
npm run package:dir
```

正式 DMG 还需要 Apple Developer ID、Hardened Runtime 和 Notarization 配置。

完整计划见 [docs/development-plan.md](docs/development-plan.md)。
