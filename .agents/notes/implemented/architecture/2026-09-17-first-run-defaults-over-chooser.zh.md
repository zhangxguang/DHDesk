# Agent Note：首次运行直接提交出厂默认，不再打开 Desktop Setup

Status: implemented

[English](2026-09-17-first-run-defaults-over-chooser.md) | 中文

## 问题

没有 Setup 标记的 profile，过去会在 Host 启动前先遇到原生 Desktop Setup 选择窗口。它要求用户先决定窗口模式、窗口材质、浏览器与网络暴露、通知和插件市场 —— 而这些全都是应用跑起来之后的 **桌面设置** 控件。

用选择窗口开场，只会推迟用户安装这个应用想要的那个界面；而一个始终没走完选择窗口的首次运行，根本到不了应用。

## 决定

首次运行直接提交出厂默认并启动。`desktopFirstRunAction` 以纯函数持有这个判断：Safe Mode、已经有标记、以及已经留有使用证据的 profile 都不采取动作；剩下的问题只是"这个构建是问还是直接提交"，由 `desktop-features.ts` 里的 `DESKTOP_SETUP_CHOOSER_ENABLED` 回答，出厂为关闭。

提交动作（`setup-wizard-defaults.ts`）执行的正是选择窗口自己那个"跳过"按钮执行过的写入 —— 偏好、重新组合、最后写 Setup 标记 —— 所以"从没被问过"和"用户主动跳过"落到同一持久状态。**设置文档不写**：选择窗口会写的每个值本来就等于默认值，而已经带有选择的文档会被沿用而不是被覆盖。

标记记的是 `completed` 而不是 `skipped`：启动器确实用出厂默认完成了 Setup 阶段，而 channel admission 会把该标记当作 profile 使用证据读取，在那里起作用的事实是"这个 profile 已经离开首次运行"。

## 选择窗口予以保留

删除选择窗口被考虑过并否决。`DESKTOP_SETUP_CHOOSER_ENABLED` 关掉的是一条完整且有测试覆盖的路径：窗口、它的 native-UI 产物、`dsh-setup-wizard:` scheme、文案，以及 quit/skip/complete 三条分支。把这个字面量打开（或对单个进程设置 `DSH_FEATURE_SETUP_CHOOSER=1`）即可恢复，而且该窗口继续具备本地窗口安全策略对它的全部要求。

后续维护者若发现选择窗口运行期不可达，请先读这份 note，不要把它当死代码处理。

## 不变的行为

- Safe Mode 仍然两个分支都不进入，并继续以出厂默认启动。
- 已经留有使用证据的 profile 永远不会被询问。
- 显式恢复启动仍然优先进入恢复助手。

## 验证

`tests/setup-wizard-defaults.spec.ts` 覆盖判断的真值表、出厂开关字面量（清空覆盖后重新 import 模块）、提交的写入顺序、已存在文档的继承场景，以及标记本身。`tests/package.spec.ts` 钉住"Safe Mode 会走到这个判断"—— 这是只有启动器能证明的那一部分。
