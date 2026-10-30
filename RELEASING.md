# 发布检查清单｜Release checklist

> 0.1.4 的教训：README 里写了相对路径 `![](error-dialog.png)`，tarball 里明明有这张图，
> 但 npm 页面和 DSH 查检中心都不会去包里找它 —— npm 页面上直接裂图。
> 往后每次发布都必须先跑 `pnpm check:readme`，它会在相对路径、非 https、空 src 上直接报错退出。

## 0. 第一性原则：发到 npm 就是给别人用的

只要动了 `publish`，对象就是**陌生用户**，不是我们自己。本地自用、私库分发不在此列；一旦发布，用户体验优先于我们的方便，代码质量的要求也随之提高——不把半成品和屎山丢上去。

每次发版前，用「第一次听说这个插件的人」的视角把下面 8 条过一遍，**任何一条不过就不发**：

1. **装得上**：`npm install` / 查检中心 / `pnpm add 包名@版本` 三条路都能拿到目标版本；README 里给出显式版本的安装命令（裸 `pnpm add 包名` 会因 pnpm 默认 `minimumReleaseAge=1440` 而在 24 小时内装到旧版）。
2. **看得懂**：README 前三屏能让陌生用户知道「这是什么、装完得到什么、有什么风险、怎么卸」。
3. **图能显示**：所有图片绝对 https 且可达；发布后必须肉眼确认 npm 页面与查检中心里每张图都真的显示。
4. **知道改了什么**：本次变更对用户的影响写在 README 或版本说明里，不是只写在 commit message。
5. **失败态体面**：按钮禁用有提示、宿主不可达不静默失败、中英双语可读。
6. **可退回**：写明怎么卸载、怎么退回上一版。
7. **兼容写清楚**：声明支持的 DSH 宿主版本范围，不靠用户试。
8. **说人话**：面向用户的文字不出现内部黑话、调试日志和 agent 之间的对话痕迹。

> 2026-10-20 的教训：0.1.4 发出去时 README 图裂、没有安装命令、没有变更摘要——用户看到的就是一个坏掉的包。
> 这 8 条就是从那一次开始补的，不是形式主义。

## 1. 改版本号

`package.json` 的 `version` 必须是**从未发布过**的新号（npm 不允许覆盖已发布版本，改 README 也要升号）。

> 0.2.0 起包名从 `dsh-plugin-easy2restart` 改为 **`dsh-easy2restart`**，同时把
> `dsh-plugin-safe-archive`（安全归档 + 归档即备份 + 右侧栏「已归档会话」）合并进来。
> 发布 0.2.0 时：新包名是**全新 npm 包**（首发即 0.2.0），旧包名 `dsh-plugin-easy2restart`
> 建议发一个 0.1.6 仅写迁移说明（deprecated + 指向新包），避免用户装到停更版本。

### 0.2.1 的额外动作（改名收尾）

新包 `dsh-easy2restart` 在 npm 上是**全新包名**（2026-10-31 查 registry：404，未被占用），
首次 `publish` 时 npm 会自动创建它 —— 不需要（也没有）"新建 package"这一步。

发完新包之后，把旧名字标成已弃用（**只 deprecate，不 unpublish**；下架会让已装用户的 lockfile 失效）：

```powershell
npm deprecate "dsh-plugin-easy2restart@*" "Renamed to dsh-easy2restart (merged with the safe-archive plugin). Install dsh-easy2restart instead: https://www.npmjs.com/package/dsh-easy2restart"
```

> `dsh-plugin-safe-archive` **从未发布到 npm**（registry 查询 404，只有一个本地源码目录），
> 所以没有可 deprecate 的对象，跑 `npm deprecate dsh-plugin-safe-archive@*` 只会报 404。

> 旧包的 npm 页面本身不会自动"链"到新包，能做的只有两件：上面那条 deprecate 提示（用户 `npm i` 时会看到），
> 以及在旧包 README 顶部写迁移说明。后者要生效必须在**旧包名下**再发一个版本（建议 0.1.6，只改 README，
> 内容直接指到 [RENAME.md](./RENAME.md)）。这一步可选，收益是"搜到旧包的人一眼看到新包名"。

GitHub 侧（需仓库管理员账号操作，agent 不做）：

1. 把仓库 `SMPcosy/dsh-plugin-easy2restart` **改名**为 `SMPcosy/dsh-easy2restart`（GitHub 会自动重定向旧地址，star / issue 一并跟随）；
2. 改名后旧地址 `https://github.com/SMPcosy/dsh-plugin-easy2restart` 仍能打开，指向新的 README 与 [RENAME.md](./RENAME.md)；
3. 把仓库 About 里的 npm 徽章、链接改成 `dsh-easy2restart`；
4. **不要新建同名空仓库** `dsh-plugin-easy2restart`：新建会顶掉 GitHub 的重定向，旧 git 地址、旧 raw 图片链接会立刻 404；
   想留落点页就把声明写在新仓库的 README / RENAME.md 里（已经写了）。
5. 打 tag `v0.2.1` 并发布 Release，正文直接贴 [CHANGELOG.md](./CHANGELOG.md) 的 0.2.1 段。

> README 里的图片与图标用的是 `https://raw.githubusercontent.com/SMPcosy/dsh-easy2restart/main/...`，
> **仓库改名之后**才会变成可访问（实测：GitHub 对改名前的 raw 地址保留别名，但新地址在改名之前一定是 404）。
> 发布前跑**严格门禁**（把远端 404 从 warn 升级成 error，不过就不许发）：
>
> ```powershell
> pnpm check:readme:remote:strict    # = node scripts/check-readme-assets.mjs --remote --strict
> ```
>
> 2026-10-31 实测：仓库还没改名时，这两条 URL 都是 `404 text/plain`，严格门禁会红 —— 这是**预期**，
> 改完仓库名再跑一次就会绿。只跑不加 `--remote` 的静态检查永远是绿的，别拿它当"图能显示"的证据。
>
> 若你打算**先发 npm 再改名**，先把 README 两处 URL 换成旧名（改名后 GitHub 仍会把旧名重定向到新仓库，实测可用），
> 发布后再换回来。用 Python 改，**不要**用 PowerShell 的 `Get-Content/Set-Content`（本机 pwsh 是 5.1，默认按 cp936
> 读 UTF-8，会把整份中文 README 读成乱码）：
>
> ```powershell
> $py = 'C:\Users\Ren\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
> # 新 → 旧
> & $py -c "import io;p='README.md';s=io.open(p,encoding='utf-8').read();s=s.replace('/dsh-easy2restart/main/','/dsh-plugin-easy2restart/main/');io.open(p,'w',encoding='utf-8',newline='').write(s)"
> # 旧 → 新（改名完成后跑这条换回来）
> & $py -c "import io;p='README.md';s=io.open(p,encoding='utf-8').read();s=s.replace('/dsh-plugin-easy2restart/main/','/dsh-easy2restart/main/');io.open(p,'w',encoding='utf-8',newline='').write(s)"
> ```

## 2. 图片静态检查（必过）

```bash
node scripts/check-readme-assets.mjs        # 或 pnpm check:readme
```

- `error` = 相对路径 / 非 https / 空 src → **必须修**，否则 npm 页面必然裂图。
- `warn` = 域名不在查检中心白名单（只认 `raw.githubusercontent.com`、`user-images.githubusercontent.com`、`camo.githubusercontent.com`、`github.com`）→ npm 能显示，查检中心预览图不会加载。

可用图床（任选，都是绝对 https）：

- `https://cdn.jsdelivr.net/npm/<包名>/<文件>` —— 直接读 npm 包内的文件，**不需要 GitHub**；
- `https://github.com/user-attachments/assets/<id>` —— GitHub 上传的图，查检中心也能用；
- `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<文件>` —— 仅当仓库公开可访问时可用（私有/被封时 404）。

## 3. 图片远程探活（推荐）

```bash
node scripts/check-readme-assets.mjs --remote
```

对每张图发一次 GET，确认 `2xx` + `content-type: image/*`（`--strict` 可让失败变成错误）。

## 4. 打包并核对内容

```bash
pnpm pack
tar -tzf dsh-easy2restart-<版本>.tgz
```

读一遍文件清单：`lib/`、`cordis.patch.yml`、`restart/`、`test/`、`README.md`、`CHANGELOG.md`、`RENAME.md`、`LICENSE`、`icon.png`、`error-dialog.png`、README 引用的每张图。

## 5. 发布（2FA）——必须在真实交互式终端里跑

```powershell
cd "C:\Users\Ren\Documents\deepseek-harness\插件工作区\dsh-easy2restart"
& "C:\Users\Ren\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\Ren\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" publish --access public --no-git-checks --registry https://registry.npmjs.org
```

**硬规则（2026-10-19/20 两次发布踩出来的）：**

- registry 对写操作要求实时 2FA，**非交互进程一定失败**：`ERR_PNPM_OTP_NON_INTERACTIVE`。
  agent 不要用后台 job 里的 pnpm 去 publish，也不要用 `npm stage approve`（同样要 `--otp`）。
- 正确做法：开一个**可见的真终端窗口**跑上面的命令，由用户完成验证（浏览器批准或动态码）。
- **不要反复重试**：连续多次认证失败没有任何好处，还可能触发风控。一次失败就停下来问用户。
- **不要中途 kill 发布窗口**：命令可能已经发行成功（0.1.5 就是这样发的）。先查 registry 再决定。
- 发布前最后确认三件事：`package.json` 版本号是新的、`pnpm pack` 的 tarball 内容对、`check:readme` 通过。

## 6. 发布后核对

```bash
curl -s https://registry.npmjs.org/<包名>/<版本> | head -c 200     # 200 + version
curl -s https://registry.npmjs.org/-/package/<包名>/dist-tags      # latest 指向新版本
```

再看一眼 `https://www.npmjs.com/package/<包名>` 的 README：**每张图都要真的显示出来**（不是裂图）。
registry 的 `latest` 更新可能有几十秒到几分钟延迟，属正常。

## 7. 归档与本地同步

把 tgz 与解包内容放进 `F:\AI\DSH\产出物\DSH插件\<包名>\v<版本>\`，更新 `SHA256SUMS.txt` 与
`0-版本归档说明.md`；把已安装副本（`~/.dsh/profiles/desktop/node_modules/<包名>`）同步成本次内容。
客户端代码改动需要用户**手动重启** DSH 才生效。
