# 改名声明｜Rename notice

> **本插件已改名：`dsh-plugin-easy2restart` → `dsh-easy2restart`。**
> 同时并入原 `dsh-plugin-safe-archive`（安全归档 + 归档即备份 + 右侧栏「已归档会话」）。
> 本声明对应旧仓库 `https://github.com/SMPcosy/dsh-plugin-easy2restart` 与其 npm 包。

<details open>

<summary><b>🀄 中文</b></summary>

## 一句话

旧名 `dsh-plugin-easy2restart`（以及 `dsh-plugin-safe-archive`）**已停止更新**，请改用新包 **`dsh-easy2restart`**。功能只增不减，配置与备份数据完全兼容。

## 对照表

| | 旧 | 新 |
|---|---|---|
| npm 包 | `dsh-plugin-easy2restart`（≤ 0.1.5） | **`dsh-easy2restart`**（≥ 0.2.0） |
| npm 包 | `dsh-plugin-safe-archive`（≤ 0.2.0） | 并入 **`dsh-easy2restart`** |
| GitHub 仓库 | `SMPcosy/dsh-plugin-easy2restart` | **`SMPcosy/dsh-easy2restart`** |
| 宿主接口前缀 | `/api/dsh-plugin-easy2restart`、`/api/dsh-plugin-safe-archive` | `/api/dsh-easy2restart` |
| 状态目录 | `~/.dsh/storages/dsh-plugin-easy2restart` | `~/.dsh/storages/dsh-easy2restart` |

## 为什么改

1. 两个插件做的是同一件事的两半：一个管重启、一个管归档，合起来才是一套「收工流程」；分开发只会让用户装两遍。
2. 目录名里的 `-plugin-` 是冗余前缀，DSH 查检中心里所有条目都带，反而挤占了可读的包名。
3. 合成一个包之后，归档确认框才知道「这次归档会不会备份、备份到哪」，界面才说得清楚。

## 怎么迁移

```bash
# 1. 卸掉旧的两个（装过哪个卸哪个）
dsh plugin --profile desktop remove dsh-plugin-easy2restart
dsh plugin --profile desktop remove dsh-plugin-safe-archive

# 2. 装新的
dsh plugin --profile desktop add dsh-easy2restart@0.2.1
```

然后**重启 DeepSeek Harness**（插件不支持热加载）。

迁移不需要搬数据：

- 备份目录（默认 `F:\AI\会话归档备份\DSH`）沿用，`_auto-backup-state.json` 里的去重记录继续有效，不会重复备份；
- `manifest.json`、`_auto-backup-manifest.json`、`归档清单.md`、`_auto-backup.log` 都留在原处；
- 重启待办 `pending.json` 会留在旧状态目录里，没用了可以直接删。

## 旧包会怎样

- 旧包**不会下架**（下架会让已装用户的 lockfile 失效），只是**不再发新版本**；
- npm 上旧包会标记 `deprecated`，提示文案指向新包；
- 旧仓库保留为只读存档，GitHub 的仓库改名会自动把旧地址重定向到新仓库。

</details>

<details>

<summary><b>🌐 English</b></summary>

## In one line

The old packages `dsh-plugin-easy2restart` and `dsh-plugin-safe-archive` are **no longer updated**; use **`dsh-easy2restart`** instead. Nothing was removed — configuration and backup data carry over unchanged.

## Mapping

| | Old | New |
|---|---|---|
| npm package | `dsh-plugin-easy2restart` (≤ 0.1.5) | **`dsh-easy2restart`** (≥ 0.2.0) |
| npm package | `dsh-plugin-safe-archive` (≤ 0.2.0) | merged into **`dsh-easy2restart`** |
| GitHub repo | `SMPcosy/dsh-plugin-easy2restart` | **`SMPcosy/dsh-easy2restart`** |
| Host route prefix | `/api/dsh-plugin-easy2restart`, `/api/dsh-plugin-safe-archive` | `/api/dsh-easy2restart` |
| State folder | `~/.dsh/storages/dsh-plugin-easy2restart` | `~/.dsh/storages/dsh-easy2restart` |

## Why

1. The two plugins were two halves of one workflow (restart + archive); shipping them apart only forced users to install both.
2. The `-plugin-` prefix is redundant in the DSH plugin market and squeezed out the readable part of the package name.
3. Only a merged package can tell — inside the confirm dialog — whether this archive will be backed up and where.

## Migration

```bash
# 1. remove whichever old package you have
dsh plugin --profile desktop remove dsh-plugin-easy2restart
dsh plugin --profile desktop remove dsh-plugin-safe-archive

# 2. install the new one
dsh plugin --profile desktop add dsh-easy2restart@0.2.1
```

Then **restart DeepSeek Harness** (plugins are not hot-reloaded).

No data migration is needed:

- the backup folder (default `F:\AI\会话归档备份\DSH`) is reused and the dedupe state in `_auto-backup-state.json` stays valid;
- `manifest.json`, `_auto-backup-manifest.json`, `归档清单.md` and `_auto-backup.log` stay where they are;
- the old `pending.json` in the previous state folder is simply unused and can be deleted.

## What happens to the old packages

- They are **not unpublished** (that would break existing lockfiles) — they just stop receiving releases;
- npm marks them `deprecated` with a message pointing here;
- the old repository stays as a read-only archive; GitHub redirects the old URL to the renamed repo.

</details>
