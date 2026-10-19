# dsh-plugin-easy2restart

## ⚠️ 已知 DSH 启动问题（与本插件无关）

**现象｜Symptom**

![DSH 启动失败弹窗（截图）](https://cdn.jsdelivr.net/npm/dsh-plugin-easy2restart/error-dialog.png)

启动 DSH 时弹出上面这个窗口：「The application could not start or stopped unexpectedly.」，正文是 `desktop welcome: Web authentication failed`，并附诊断日志路径（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 下的 crash/host 日志）；按钮为 `Exit` / `Restart` / `Disable third-party plugins, back up profile patch, and restart`。主界面进不去，日志目录里每次多一条 `phase: startup` 的崩溃记录。

**原因｜Cause**

每次启动 DSH 都会向桌面 cookie 库新增一条 `dsh-auth-*` cookie（127.0.0.1、每次启动端口随机，所以 cookie 名不同、不会覆盖旧条目）。它的有效期是 **30 天**，30 天内不会自己消失；累积到 **71 条**时 Cookie 请求头超过 16 KB 上限，host 返回 **431**，桌面握手失败 —— 就是上面这个弹窗。所以**重启越频繁，越快撞线**：一天重启几次的话，大约一个月内必然出现。

**为什么点「Disable…」没用｜Why the "Disable" button doesn't help**

这个按钮只是**禁用**所有第三方插件（注意是禁用，不是删除、不是清空 —— 插件本体和配置都还在），然后重启一次。问题出在 cookie 累积，跟插件没有关系，所以点完照样起不来，反而暂时失去全部第三方插件能力，还得手动重新启用。`Restart` 按钮同理，只会再撞一次。

**处理办法｜Fix**

1. 完全退出 DSH（含托盘与后台进程）。
2. 清掉 `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` 里的 `dsh-auth-*`：用 SQLite 执行 `DELETE FROM cookies WHERE host_key='127.0.0.1' AND name LIKE 'dsh-auth-%';`，或直接删除 `Cookies` 文件（只影响免登录状态，不影响账号与会话）。
3. 或安装 `dsh-cookie-guard`：DSH 关闭时每分钟自动清理，推荐用于长期防复发。
4. 重新打开 DSH；cookie 会按需重新签发，不用重新登录，会话与工作区不受影响。

---

## ⚠️ Known DSH startup issue (unrelated to this plugin)

**Symptom**

![DSH startup failure dialog (screenshot)](https://cdn.jsdelivr.net/npm/dsh-plugin-easy2restart/error-dialog.png)

On launch DSH shows the dialog above: "The application could not start or stopped unexpectedly." with `desktop welcome: Web authentication failed` and a diagnostic log path under `%APPDATA%\@deepseek-ai\dsh-desktop\logs\`. The buttons are `Exit`, `Restart`, and `Disable third-party plugins, back up profile patch, and restart`. The main window never opens, and a new `phase: startup` crash log is written each time.

**Cause**

Every DSH launch adds one `dsh-auth-*` cookie to the desktop cookie store (host 127.0.0.1, random port each boot, so the cookie name differs and old entries are never overwritten). They live for **30 days**, so nothing expires on its own; at **71 cookies** the Cookie header exceeds the 16 KB limit, the host answers **431** and the desktop handshake fails — that is the dialog above. In other words, **the more often you restart, the sooner you hit the limit** (a few restarts a day gets you there within roughly a month).

**Why the "Disable …" button doesn't help**

It only **disables** all third-party plugins (disables — it does not delete or clear anything; the plugins and their config stay on disk) and then restarts. The problem is cookie accumulation, not plugins, so DSH still fails to start, and you just lose every third-party plugin until you re-enable them. The `Restart` button fails the same way.

**Fix**

1. Quit DSH completely (tray icon and background processes too).
2. Remove the `dsh-auth-*` rows from `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` (SQLite: `DELETE FROM cookies WHERE host_key='127.0.0.1' AND name LIKE 'dsh-auth-%';`), or simply delete the `Cookies` file (it only holds the "stay signed in" state, not account or sessions).
3. Alternatively install `dsh-cookie-guard`, which cleans them every minute while DSH is closed (recommended long-term).
4. Open DSH again; cookies are re-issued on demand — no re-login, no session or workspace loss.

<details>

<summary><b>🀄 中文（默认展开）</b></summary>

# 已发布到官方NPM

> **DSH 重启插件：双击侧边栏重启按钮即可整体重启 DeepSeek Harness，会话运行时按钮置灰禁用。**

DeepSeek Harness 重启插件：在左侧边栏**账号头像/设置上方**放一个「⟳ 重启 DSH」按钮，**双击**即可整进程重启 DeepSeek Harness；当有 Agent 会话正在运行时，按钮自动置灰禁用，避免打断进行中的工作。

## 功能

- 侧边栏 `sidebar.footer.action` 位置注入重启按钮（账号头像/设置上方）。
- 双击按钮 → 宿主用 Windows 计划任务拉起一个**脱离 DSH 进程树**的 PowerShell 脚本，`taskkill /T` 强杀整个 DSH 进程树，随后重新启动 `DeepSeek Harness.exe`。
- 有 Agent 会话**运行中**时按钮置灰禁用（依据 DSH 会话状态 `running`）。
- 无会话运行时按钮可点；宿主管理保存一个「重启待办」，便于后续扩展「重启后回到原会话」等流程。

![dsh-pluin-restart-02](https://github.com/user-attachments/assets/1cd364ed-3048-4104-928c-46566ba9bcc6)

![dsh-pluin-restart-01](https://github.com/user-attachments/assets/93e5d1e5-6647-4e03-9f8f-e491e3a4640d)

## 依赖

- DeepSeek Harness 桌面版（0.2.0-rc 以上）
- Node.js ≥ 22

## 安装

> 前提：`dsh` 命令在 PATH 中（DeepSeek Harness 自带）。

```bash
dsh-plugin-easy2restart
```

复制上述内容（插件名），进行如下操作：  
<img width="2558" height="1640" alt="dsh-plugin-easy2restart安装图示​" src="https://github.com/user-attachments/assets/6b719ee2-7ed9-4913-8c3b-99709d5b5e06" />

若发布到 registry：

```bash
dsh plugin --profile desktop add dsh-plugin-easy2restart
```

装完**重启 DeepSeek Harness**，侧边栏底部账号头像上方即出现「⟳」按钮。

## 使用

- **双击**「⟳」按钮即可重启 DSH。
- 当有会话正在运行时按钮为灰色（不可点），会话空闲时可正常重启。
- 重启由计划任务拉起，与 DSH 自身退出无关，即使 DSH 被强杀也能自动重新启动。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-plugin-easy2restart
```

然后重启 DSH 使改动生效。

## 工作原理（简述）

- `lib/index.js`（宿主/Cordis 插件）：注册 `/api/dsh-plugin-easy2restart/*` HTTP 路由；`/restart` 记录待办并调用 `scheduleRestart`，该函数用 `schtasks` 创建一个立即运行的重启任务，由计划任务服务启动（**脱离 DSH 进程树**），执行 `restart/restart.ps1`。
- `restart/restart.ps1`：`taskkill /PID <主进程> /T /F` 结束整个 DSH 进程树，等待退出后重新 `Start-Process DeepSeek Harness.exe`。
- `lib/client.js`（Web 客户端）：注入 `sidebar.footer.action` 渲染按钮；用 `useSessionStatus` 判断是否有会话在运行以决定是否禁用。

## 目录结构

```
dsh-plugin-easy2restart/
├─ package.json         # 插件清单（dsh.client / dsh.bundle 声明）
├─ cordis.patch.yml     # bundle 挂载声明
├─ lib/
│  ├─ index.js          # 宿主端：HTTP 路由 + 重启调度
│  └─ client.js         # 客户端端：侧边栏按钮
└─ restart/
   └─ restart.ps1       # 重启脚本（杀进程树 + 重启 exe）
```

## 备注

- 这是改安装版主程序之外的一种插件方式：直接以本地 bundle 加入 profile，不修改 `app.asar`。
- 若希望「重启完成后自动回到原会话并填入『重启完成』」，可在 `/restart` 的待办（`~/.dsh/storages/dsh-plugin-easy2restart/pending.json`）基础上扩展（当前版本不自动填写输入框）。

## License

MIT

</details>

<details>

<summary><b>🌐 English</b></summary>

# Published on official NPM

> **DSH restart plugin: double-click the sidebar restart button to fully relaunch DeepSeek Harness; the button is greyed out while an agent session is running.**

A DeepSeek Harness restart plugin: it places a "⟳ Restart DSH" button in the left sidebar **above the account avatar / settings**; **double-click** it to restart the whole DeepSeek Harness process. While an agent session is running, the button is automatically greyed out to avoid interrupting work in progress.

## Features

- Injects the restart button into the `sidebar.footer.action` slot (above the account avatar / settings).
- Double-click → the host launches a PowerShell script **detached from the DSH process tree** via Windows Task Scheduler; the script uses `taskkill /T` to force-kill the whole DSH process tree, then relaunches `DeepSeek Harness.exe`.
- The button is greyed out while an agent session is **running** (based on the DSH session status `running`).
- When no session is running, the button is clickable; the host keeps a "restart pending" record so that flows such as "return to the original session after restart" can be added later.

![dsh-pluin-restart-02](https://github.com/user-attachments/assets/1cd364ed-3048-4104-928c-46566ba9bcc6)

![dsh-pluin-restart-01](https://github.com/user-attachments/assets/93e5d1e5-6647-4e03-9f8f-e491e3a4640d)

## Requirements

- DeepSeek Harness desktop (0.2.0-rc or later)
- Node.js ≥ 22

## Installation

> Prerequisite: the `dsh` command must be on PATH (bundled with DeepSeek Harness).

```bash
dsh-plugin-easy2restart
```

Copy the plugin name above, then follow the steps below:  
<img width="2558" height="1640" alt="dsh-plugin-easy2restart install illustration" src="https://github.com/user-attachments/assets/6b719ee2-7ed9-4913-8c3b-99709d5b5e06" />

If publishing to a registry:

```bash
dsh plugin --profile desktop add dsh-plugin-easy2restart
```

After installing, **restart DeepSeek Harness**; the "⟳" button then appears at the bottom of the sidebar, above the account avatar.

## Usage

- **Double-click** the "⟳" button to restart DSH.
- The button is greyed out (not clickable) while a session is running; it works normally when the session is idle.
- The restart is launched by a scheduled task and is independent of DSH exiting itself, so DSH restarts automatically even if it is force-killed.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-plugin-easy2restart
```

Then restart DSH for the change to take effect.

## How it works (brief)

- `lib/index.js` (host / Cordis plugin): registers the `/api/dsh-plugin-easy2restart/*` HTTP routes; `/restart` records the pending entry and calls `scheduleRestart`, which uses `schtasks` to create an immediately-running restart task. The task is started by the Task Scheduler service (**detached from the DSH process tree**) and executes `restart/restart.ps1`.
- `restart/restart.ps1`: `taskkill /PID <main process> /T /F` terminates the whole DSH process tree, waits for it to exit, then runs `Start-Process DeepSeek Harness.exe`.
- `lib/client.js` (Web client): injects into `sidebar.footer.action` to render the button; uses `useSessionStatus` to decide whether to disable it.

## Directory structure

```
dsh-plugin-easy2restart/
├─ package.json         # plugin manifest (dsh.client / dsh.bundle declarations)
├─ cordis.patch.yml     # bundle mount declaration
├─ lib/
│  ├─ index.js          # host side: HTTP routes + restart scheduling
│  └─ client.js         # client side: sidebar button
└─ restart/
   └─ restart.ps1       # restart script (kill process tree + relaunch exe)
```

## Notes

- This is an alternative to modifying the installed main program: the plugin is added to the profile directly as a local bundle, without touching `app.asar`.
- If you want "after the restart, automatically return to the original session and fill in 'restart complete'", you can extend it based on the pending record of `/restart` (`~/.dsh/storages/dsh-plugin-easy2restart/pending.json`); the current version does not fill the input box automatically.

## License

MIT

</details>
