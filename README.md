# dsh-plugin-restart

> **DSH 重启插件：双击侧边栏重启按钮即可整体重启 DeepSeek Harness，会话运行时按钮置灰禁用。**
> **DSH plugin: double-click the sidebar restart button to fully relaunch DeepSeek Harness; it is greyed out while an agent session is running.**

DeepSeek Harness 重启插件：在左侧边栏**账号头像/设置上方**放一个「⟳ 重启 DSH」按钮，**双击**即可整进程重启 DeepSeek Harness；当有 Agent 会话正在运行时，按钮自动置灰禁用，避免打断进行中的工作。

## 功能

- 侧边栏 `sidebar.footer.action` 位置注入重启按钮（账号头像/设置上方）。
- 双击按钮 → 宿主用 Windows 计划任务拉起一个**脱离 DSH 进程树**的 PowerShell 脚本，`taskkill /T` 强杀整个 DSH 进程树，随后重新启动 `DeepSeek Harness.exe`。
- 有 Agent 会话**运行中**时按钮置灰禁用（依据 DSH 会话状态 `running`）。
- 无会话运行时按钮可点；宿主管理保存一个「重启待办」，便于后续扩展「重启后回到原会话」等流程。

<img width="2558" height="1638" alt="dsh-pluin-restart-02" src="https://github.com/user-attachments/assets/1cd364ed-3048-4104-928c-46566ba9bcc6" />

<img width="2561" height="1638" alt="dsh-pluin-restart-01" src="https://github.com/user-attachments/assets/93e5d1e5-6647-4e03-9f8f-e491e3a4640d" />

## 依赖

- DeepSeek Harness 桌面版（0.2.0-rc 以上）
- Node.js ≥ 22

## 安装

> 前提：`dsh` 命令在 PATH 中（DeepSeek Harness 自带）。

```bash
# 用 link 方式装本地副本（推荐，便于维护/调试）
git clone https://github.com/SMPcosy/dsh-plugin-restart
dsh plugin --profile desktop add link:<克隆或本目录的绝对路径>
```

若发布到 registry：

```bash
dsh plugin --profile desktop add dsh-plugin-restart
```

装完**重启 DeepSeek Harness**，侧边栏底部账号头像上方即出现「⟳」按钮。

## 使用

- **双击**「⟳」按钮即可重启 DSH。
- 当有会话正在运行时按钮为灰色（不可点），会话空闲时可正常重启。
- 重启由计划任务拉起，与 DSH 自身退出无关，即使 DSH 被强杀也能自动重新启动。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-plugin-restart
```

然后重启 DSH 使改动生效。

## 工作原理（简述）

- `lib/index.js`（宿主/Cordis 插件）：注册 `/api/dsh-plugin-restart/*` HTTP 路由；`/restart` 记录待办并调用 `scheduleRestart`，该函数用 `schtasks` 创建一个立即运行的重启任务，由计划任务服务启动（**脱离 DSH 进程树**），执行 `restart/restart.ps1`。
- `restart/restart.ps1`：`taskkill /PID <主进程> /T /F` 结束整个 DSH 进程树，等待退出后重新 `Start-Process DeepSeek Harness.exe`。
- `lib/client.js`（Web 客户端）：注入 `sidebar.footer.action` 渲染按钮；用 `useSessionStatus` 判断是否有会话在运行以决定是否禁用。

## 目录结构

```
dsh-plugin-restart/
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
- 若希望「重启完成后自动回到原会话并填入『重启完成』」，可在 `/restart` 的待办（`~/.dsh/storages/dsh-plugin-restart/pending.json`）基础上扩展（当前版本不自动填写输入框）。

## License

MIT
