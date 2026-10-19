# 发布检查清单｜Release checklist

> 0.1.4 的教训：README 里写了相对路径 `![](error-dialog.png)`，tarball 里明明有这张图，
> 但 npm 页面和 DSH 查检中心都不会去包里找它 —— npm 页面上直接裂图。
> 往后每次发布都必须先跑 `pnpm check:readme`，它会在相对路径、非 https、空 src 上直接报错退出。

## 1. 改版本号

`package.json` 的 `version` 必须是**从未发布过**的新号（npm 不允许覆盖已发布版本，改 README 也要升号）。

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
tar -tzf dsh-plugin-easy2restart-<版本>.tgz
```

读一遍文件清单：`lib/`、`cordis.patch.yml`、`restart/`、`README.md`、`LICENSE`、`icon.png`、README 引用的每张图。

## 5. 发布（2FA）——必须在真实交互式终端里跑

```powershell
cd "C:\Users\Ren\Documents\deepseek-harness\插件工作区\dsh-plugin-easy2restart"
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
