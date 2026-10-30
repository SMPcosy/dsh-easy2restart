# 更新日志｜Changelog

本文件记录面向用户的变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.2.1 — 2026-10-31

界面重做 + 自动备份可配置化。

### 新增

- **自动备份设置（右侧栏内可编辑）**：「已归档会话」页新增「自动备份」卡片，可开关自动备份、可改备份根目录（输入或系统文件夹对话框），保存前会建目录并写探针文件验证可写，不可写则红字报错且不落盘。
- **备份配置的优先级**：环境变量 `DSH_EASY2RESTART_BACKUP`（关）/ `DSH_EASY2RESTART_BACKUP_DIR`（目录）> `~/.dsh/storages/dsh-easy2restart/config.json` > 内置默认 `F:\AI\会话归档备份\DSH`。环境变量生效时界面只读并给出说明。
- **三条新接口**：`GET /backup`、`POST /backup`、`POST /backup/pick`。
- 右侧栏头部新增状态徽章：自动备份 / 备份关闭 / 备份不可写。
- `scripts/make-icon.py`：图标生成脚本（Pillow），输出 `icon.png` 与多尺寸预览。

### 变更

- **界面整体重做**：统一淡暖纸本配色与令牌层（纸 `#FBF6EC`、卡 `#FFFDF8`、墨 `#2A2119`、线 `#E5D8C4`、圆角 16/10），语义色只表达危险/警告/成功/信息。
- **图标全部改为内联 SVG**：重启按钮从位图 `⟳` 换成手绘缺口环 + 箭头；新增归档托盘、文件夹、警示图标。
- **插件图标重绘**：缺口环 + 箭头 + 青色归档托盘，16px 起可辨识。
- 归档确认框按备份开关换文案：开启时写出备份目录，关闭时红字提示不生成副本。
- 禁用态由透明度改为灰底 + 去阴影；报错位置从提示条改为字段下方；动效统一 120–300ms 并响应 `prefers-reduced-motion`。
- 精选列表行、树行改为可键盘聚焦并有可见焦点环。

### 修复

- 无 `F:` 盘的新机器上，备份失败只写日志、界面看不出问题：现在右侧栏会直接显示「备份不可写 / 目录不存在」，并给出一处可改的地方。

### 兼容性

- 旧版写下的 `_auto-backup-state.json`、`manifest.json`、`归档清单.md` 继续可用；备份去重记录不变。
- 未配置过备份的用户行为与 0.2.0 完全一致（默认目录仍是 `F:\AI\会话归档备份\DSH`）。

---

## 0.2.0 — 2026-10-30

改名 + 合并。

### 变更

- 包名与仓库名从 `dsh-plugin-easy2restart` 改为 **`dsh-easy2restart`**。
- 合并 `dsh-plugin-safe-archive` 的全部能力：安全归档确认框（会话活动时 10 秒倒计时）、归档即备份、右侧栏「已归档会话」页。
- 宿主接口前缀统一为 `/api/dsh-easy2restart`，状态目录统一为 `~/.dsh/storages/dsh-easy2restart`。
- 客户端注入扩展为 `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-sidebar-right`。

### 迁移

- 卸载旧包、安装新包即可；状态文件与备份目录完全兼容，无需迁数据。详见 [RENAME.md](./RENAME.md)。
