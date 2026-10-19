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

## 5. 发布（2FA）

```bash
pnpm publish --access public --no-git-checks   # 交互终端，会提示输入验证器 6 位码
```

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
