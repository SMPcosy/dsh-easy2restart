/**
 * dsh-easy2restart（Web 客户端：重启按钮 + 归档确认框 + 右侧栏）
 * ==================================================================
 * 由两个插件合并而来（0.2.0），0.2.1 起按「淡暖纸本 v1.0」设计规范重做界面。
 *
 * 四块能力：
 *  1. 侧边栏底部「重启 DSH」按钮（slot: sidebar.footer.action，双击触发重启）
 *  2. 安全归档确认框（拦截 uiWorkspace.archiveSession；会话有活动时切到倒计时确认）
 *     「会话正在活动」活动清单 + 10 秒倒计时，倒计时结束才能「停止并归档」）
 *     ——slot: shell.overlay
 *  3. 右侧栏「已归档会话」页（归档会话文件夹浏览，slot: sidebar.right.pane.tab）
 *  4. 同页的「自动备份」设置卡（备份根目录可改、可关闭；env 覆盖时只读）
 *
 * 数据/动作走本地 HTTP 接口（统一前缀 /api/dsh-easy2restart）：
 *   GET  /health /state /active /status /archive/roots /archive/ls?path= /backup
 *   POST /restart /clear /diag /scan /archive/open /backup /backup/pick
 *
 * 设计约定（照 ui-design-spec 淡暖纸本 v1.0）：
 *  - 层级靠 1px 线与暖褐阴影，不靠底色差；卡片只画一层边界
 *  - 圆角只有 16 / 10 两档；正文 15px 起，一屏字号不超过 3 档
 *  - 禁用态用灰底 + 去阴影，不用透明度；报错紧贴字段，不用 toast
 *  - 动效 120–300ms（ease-out 进 / ease-in 出），并响应 prefers-reduced-motion
 *  - 热区不低于 28，常规控件 32–40；正文对比度 ≥ 4.5:1
 */
window.__ModuleLoader__.load({
  id: "dsh-easy2restart",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const React = require("react");
    const h = React.createElement;

    const NS = "dsh-easy2restart";
    const API = "/api/dsh-easy2restart";
    const POLL_MS = 1200;

    function diag(msg) {
      try {
        fetch(API + "/diag", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ msg: String(msg) }),
        }).catch(() => {});
      } catch (e) {
        /* 诊断失败忽略 */
      }
    }
    diag("factory-evaluated");

    /* ================================================================
     *  零、样式层（一次注入；HMR 重载后复用同一个 style 标签）
     * ================================================================ */

    const CSS = [
      /* ---------- 令牌：优先吃宿主 token，缺省退到淡暖纸本 ---------- */
      ".e2r-btn,.e2r-dlg,.e2r-pane{",
      "  --e2r-ink:var(--dsw-alias-label-primary,#2A2119);",
      "  --e2r-ink-2:var(--dsw-alias-label-secondary,rgba(42,33,25,.72));",
      "  --e2r-ink-3:var(--dsw-alias-label-tertiary,rgba(42,33,25,.5));",
      "  --e2r-line:var(--dsw-alias-border-l2,#E5D8C4);",
      "  --e2r-line-strong:var(--dsw-alias-border-default,#CFC0A8);",
      "  --e2r-card:var(--dsw-alias-bg-layer-1,#FFFDF8);",
      "  --e2r-paper:var(--dsw-alias-bg-primary,#FBF6EC);",
      "  --e2r-wash:rgba(138,106,63,.10);",
      "  --e2r-wash-2:rgba(138,106,63,.16);",
      "  --e2r-sunk:rgba(120,110,96,.10);",
      "  --e2r-ok:#3E6B4A;",
      "  --e2r-ok-wash:rgba(62,107,74,.13);",
      "  --e2r-warn:#966813;",
      "  --e2r-warn-wash:rgba(150,104,19,.13);",
      "  --e2r-danger:#B03A2E;",
      "  --e2r-danger-wash:rgba(176,58,46,.12);",
      "  --e2r-r:16px;",
      "  --e2r-r-sm:10px;",
      "  --e2r-shadow:0 10px 30px rgba(42,33,25,.16),0 1px 2px rgba(42,33,25,.10);",
      "  --e2r-in:180ms;",
      "  --e2r-out:140ms;",
      "}",

      /* ---------- 重启按钮 ---------- */
      ".e2r-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;order:1;width:36px;height:36px;padding:0;margin:0 0 0 auto;border:1px solid var(--e2r-line);border-radius:var(--e2r-r-sm);background:var(--e2r-card);color:var(--e2r-ink-2);cursor:pointer;box-shadow:0 1px 2px rgba(42,33,25,.06);transition:background var(--e2r-in) ease-out,color var(--e2r-in) ease-out,border-color var(--e2r-in) ease-out;}",
      ".e2r-btn:hover:not(:disabled){background:var(--e2r-wash);border-color:var(--e2r-line-strong);color:var(--e2r-ink);}",
      ".e2r-btn:active:not(:disabled){background:var(--e2r-wash-2);}",
      // 禁用：灰底 + 去阴影 + 弱化文字与描边，不用 opacity，也保留形状（不能读成"坏方块"）
      ".e2r-btn:disabled{cursor:default;background:var(--e2r-sunk);border-color:var(--e2r-line);color:var(--e2r-ink-3);box-shadow:none;}",
      ".e2r-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:2px;}",
      ".e2r-btn[data-live='off']{color:var(--e2r-ink-3);}",
      ".e2r-glyph{width:18px;height:18px;display:block}",
      "[class*='collapsed'] .e2r-btn{margin:0;}",
      // 与「功能坞」同一行（sidebar.footer.action 一个 flex 行）：让图标钮贴右
      "div:has(>.docke2-btn){align-items:center;justify-content:flex-start;gap:8px;}",
      "div:has(>.docke2-btn) .docke2-btn:not(.docke2-rail){box-sizing:border-box;flex:1 1 auto;min-width:0;width:auto;height:36px;margin:0;border-radius:var(--e2r-r-sm);justify-content:flex-start;text-align:left;}",
      "[class*='collapsed'] div:has(>.docke2-btn){flex-direction:column;justify-content:center;}",

      /* ---------- 弹窗 ---------- */
      ".e2r-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(30,24,16,.52);backdrop-filter:blur(2px);}",
      ".e2r-card{box-sizing:border-box;width:min(460px,92vw);max-height:calc(100vh - 48px);overflow:auto;background:var(--e2r-card);color:var(--e2r-ink);border:1px solid var(--e2r-line);border-radius:var(--e2r-r);box-shadow:var(--e2r-shadow);padding:20px 22px 18px;font:inherit;animation:e2r-pop var(--e2r-in) ease-out both;}",
      "@keyframes e2r-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}",
      ".e2r-card-head{display:flex;align-items:center;gap:10px;margin:0 0 10px;}",
      ".e2r-badge{flex:none;width:30px;height:30px;border-radius:var(--e2r-r-sm);display:inline-flex;align-items:center;justify-content:center;background:var(--e2r-wash);color:var(--e2r-ink);}",
      ".e2r-badge--warn{background:var(--e2r-warn-wash);color:var(--e2r-warn);}",
      ".e2r-badge--danger{background:var(--e2r-danger-wash);color:var(--e2r-danger);}",
      ".e2r-h3{font-size:16.5px;line-height:1.5;font-weight:600;margin:0;letter-spacing:.01em;}",
      ".e2r-p{font-size:15px;line-height:1.75;color:var(--e2r-ink-2);margin:0 0 10px;}",
      ".e2r-p--tight{margin-bottom:6px}",
      ".e2r-ul{list-style:none;margin:0 0 12px;padding:8px 12px;border:1px solid var(--e2r-line);border-radius:var(--e2r-r-sm);background:var(--e2r-wash);font-size:15px;line-height:1.75;color:var(--e2r-ink);}",
      ".e2r-ul li{margin:2px 0}",
      ".e2r-warn{color:var(--e2r-warn);font-weight:600}",
      ".e2r-danger-text{color:var(--e2r-danger)}",
      ".e2r-code{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:13.5px;background:var(--e2r-sunk);border-radius:3px;padding:1px 5px;word-break:break-all;}",
      ".e2r-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:16px;}",
      ".e2r-b{box-sizing:border-box;min-height:34px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--e2r-r-sm);border:1px solid var(--e2r-line-strong);background:transparent;color:var(--e2r-ink);font:inherit;font-size:15px;cursor:pointer;transition:background var(--e2r-in) ease-out,border-color var(--e2r-in) ease-out,color var(--e2r-in) ease-out;}",
      ".e2r-b:hover:not(:disabled){background:var(--e2r-wash);}",
      ".e2r-b:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:2px;}",
      ".e2r-b--primary{background:var(--e2r-ink);border-color:var(--e2r-ink);color:var(--e2r-card);}",
      ".e2r-b--primary:hover:not(:disabled){background:#3B3128;border-color:#3B3128;color:#FFFDF8;}",
      ".e2r-b--danger{background:var(--e2r-danger);border-color:var(--e2r-danger);color:#FFFDF8;}",
      ".e2r-b--danger:hover:not(:disabled){background:#93301F;border-color:#93301F;}",
      ".e2r-b:disabled{cursor:default;background:var(--e2r-sunk);border-color:transparent;color:var(--e2r-ink-3);}",

      /* ---------- 右侧栏页头 ---------- */
      ".e2r-pane{height:100%;width:100%;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;color:var(--e2r-ink);font:inherit;}",
      ".e2r-head{flex:none;padding:12px 14px 10px;border-bottom:1px solid var(--e2r-line);display:flex;flex-direction:column;gap:6px;background:var(--e2r-card);}",
      ".e2r-head-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
      ".e2r-title{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em;}",
      ".e2r-sub{font-size:12.5px;line-height:1.6;color:var(--e2r-ink-3);word-break:break-all;}",
      ".e2r-chip{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;line-height:1;padding:4px 9px;border-radius:999px;border:1px solid transparent;}",
      ".e2r-chip--ok{background:var(--e2r-ok-wash);color:var(--e2r-ok);}",
      ".e2r-chip--off{background:var(--e2r-sunk);color:var(--e2r-ink-3);}",
      ".e2r-chip--warn{background:var(--e2r-warn-wash);color:var(--e2r-warn);}",
      ".e2r-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}",
      ".e2r-body{flex:1;min-height:0;overflow-y:auto;padding:10px 10px 20px;}",
      ".e2r-sec{display:flex;align-items:baseline;gap:8px;padding:8px 4px 4px;}",
      ".e2r-sec-title{font-size:13.5px;font-weight:600;margin:0;}",
      ".e2r-count{font-size:12.5px;color:var(--e2r-ink-3);font-variant-numeric:tabular-nums;}",
      ".e2r-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:4px 8px;border-radius:var(--e2r-r-sm);cursor:pointer;user-select:none;transition:background var(--e2r-out) ease-out;}",
      ".e2r-row:hover{background:var(--e2r-wash);}",
      ".e2r-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:-2px;}",
      ".e2r-row--static{cursor:default;color:var(--e2r-ink-3);}",
      ".e2r-row--static:hover{background:transparent;}",
      ".e2r-chev{width:12px;flex:none;font-size:10px;color:var(--e2r-ink-3);text-align:center;}",
      ".e2r-name{flex:1;min-width:0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".e2r-meta{flex:none;font-size:12.5px;color:var(--e2r-ink-3);font-variant-numeric:tabular-nums;}",
      ".e2r-indent-1{padding-left:22px}",
      ".e2r-indent-2{padding-left:36px}",
      ".e2r-indent-3{padding-left:50px}",
      ".e2r-hr{border:none;border-top:1px solid var(--e2r-line);margin:12px 4px;}",
      ".e2r-err{margin:8px 4px;padding:8px 10px;border:1px solid var(--e2r-danger-wash);background:var(--e2r-danger-wash);border-radius:var(--e2r-r-sm);font-size:13.5px;line-height:1.65;color:var(--e2r-danger);word-break:break-all;}",
      ".e2r-empty{margin:6px 4px;padding:14px 12px;border:1px dashed var(--e2r-line);border-radius:var(--e2r-r-sm);font-size:13.5px;line-height:1.7;color:var(--e2r-ink-3);}",
      ".e2r-path{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:12.5px;color:var(--e2r-ink-2);word-break:break-all;}",

      /* ---------- 数据源 / 自动备份卡片 ---------- */
      ".e2r-card-box{margin:12px 2px 0;border:1px solid var(--e2r-line);border-radius:var(--e2r-r);background:var(--e2r-card);overflow:hidden;}",
      ".e2r-card-box>.e2r-card-row{display:flex;align-items:center;gap:8px;padding:11px 15px;min-height:40px;box-sizing:border-box;}",
      ".e2r-card-box>.e2r-card-row+.e2r-card-row{border-top:1px solid var(--e2r-line);}",
      ".e2r-card-box>.e2r-card-row--foot{justify-content:flex-end;padding:9px 15px;}",
      ".e2r-card-lead{font-size:13.5px;font-weight:600;flex:none;}",
      ".e2r-card-note{font-size:13.5px;line-height:1.7;color:var(--e2r-ink-2);}",
      ".e2r-card-body{padding:2px 15px 13px;}",
      ".e2r-summary{display:flex;align-items:center;gap:8px;padding:11px 15px;min-height:40px;box-sizing:border-box;cursor:pointer;user-select:none;}",
      ".e2r-summary:hover{background:var(--e2r-wash);}",
      ".e2r-summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:-2px;}",
      ".e2r-summary-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
      ".e2r-summary-line{font-size:13.5px;font-weight:600;}",
      ".e2r-summary-path{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:12.5px;color:var(--e2r-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".e2r-seg{display:inline-flex;border:1px solid var(--e2r-line-strong);border-radius:var(--e2r-r-sm);overflow:hidden;}",
      ".e2r-seg-b{box-sizing:border-box;min-height:32px;padding:0 14px;border:none;background:transparent;color:var(--e2r-ink-2);font:inherit;font-size:13.5px;cursor:pointer;transition:background var(--e2r-in) ease-out,color var(--e2r-in) ease-out;}",
      ".e2r-seg-b+.e2r-seg-b{border-left:1px solid var(--e2r-line-strong);}",
      ".e2r-seg-b:hover:not(:disabled){background:var(--e2r-wash);}",
      ".e2r-seg-b[aria-pressed='true']{background:var(--e2r-ink);color:var(--e2r-card);}",
      ".e2r-seg-b:disabled{cursor:default;background:var(--e2r-sunk);color:var(--e2r-ink-3);}",
      ".e2r-seg-b:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:-2px;}",
      ".e2r-field{display:flex;flex-direction:column;gap:6px;margin:12px 0 0;}",
      ".e2r-label{font-size:13.5px;font-weight:600;color:var(--e2r-ink);}",
      ".e2r-input-row{display:flex;align-items:center;gap:8px;}",
      ".e2r-input{box-sizing:border-box;flex:1;min-width:0;min-height:32px;padding:4px 10px;border:1px solid var(--e2r-line-strong);border-radius:var(--e2r-r-sm);background:var(--e2r-paper);color:var(--e2r-ink);font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:13.5px;}",
      ".e2r-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#7A5B34);outline-offset:1px;}",
      ".e2r-input:disabled{background:var(--e2r-sunk);color:var(--e2r-ink-3);border-color:transparent;}",
      ".e2r-input--bad{border-color:var(--e2r-danger);}",
      ".e2r-b--sm{min-height:32px;padding:0 12px;font-size:13.5px;}",
      ".e2r-status{display:flex;align-items:flex-start;gap:6px;font-size:13.5px;line-height:1.65;}",
      ".e2r-status--ok{color:var(--e2r-ok)}",
      ".e2r-status--warn{color:var(--e2r-warn)}",
      ".e2r-status--danger{color:var(--e2r-danger)}",
      ".e2r-status--muted{color:var(--e2r-ink-3)}",
      ".e2r-help{font-size:12.5px;line-height:1.65;color:var(--e2r-ink-3);}",
      ".e2r-saved{font-size:12.5px;color:var(--e2r-ok);animation:e2r-fade 1.6s ease-out both;}",
      "@keyframes e2r-fade{0%{opacity:0}18%{opacity:1}72%{opacity:1}100%{opacity:0}}",
      ".e2r-banner{margin:0 0 10px;padding:8px 10px;border-radius:var(--e2r-r-sm);font-size:12.5px;line-height:1.65;background:var(--e2r-warn-wash);color:var(--e2r-warn);}",

      /* ---------- 动效降级 ---------- */
      "@media (prefers-reduced-motion: reduce){.e2r-card{animation:none}.e2r-saved{animation:none}.e2r-btn,.e2r-b,.e2r-row,.e2r-seg-b{transition:none}}",
    ].join("\n");

    function ensureCss() {
      try {
        if (typeof document === "undefined" || !document.head) return;
        let tag = document.querySelector('style[data-plugin-css="' + NS + '"]');
        if (!tag) {
          tag = document.createElement("style");
          tag.dataset.pluginCss = NS;
          document.head.appendChild(tag);
        }
        if (tag.textContent !== CSS) tag.textContent = CSS;
      } catch (e) {
        /* 样式注入失败时退回浏览器默认控件，不阻塞功能 */
      }
    }

    /* ================================================================
     *  一、图标（内联 SVG，跟 currentColor，任意缩放下都清晰）
     * ================================================================ */

    /** 重启：顺时针缺口圆环 + 箭头，笔画用圆头，24px 下仍可读 */
    function RestartGlyph(props) {
      return h(
        "svg",
        Object.assign(
          {
            className: "e2r-glyph",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.9,
            strokeLinecap: "round",
            "aria-hidden": "true",
            focusable: "false",
          },
          props,
        ),
        h("path", { d: "M20.2 12a8.2 8.2 0 1 1-2.6-5.95" }),
        h("path", { d: "M20.6 4.2v4.6h-4.6", strokeLinejoin: "round" }),
        h("path", { d: "M12 8.4v4.1h3.1", strokeWidth: 1.5, opacity: 0.9 }),
      );
    }

    /** 归档：盒体 + 盖板 + 两枚内衬 */
    function ArchiveGlyph(props) {
      return h(
        "svg",
        Object.assign(
          {
            className: "e2r-glyph",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
          },
          props,
        ),
        h("path", { d: "M3.6 8.2h16.8" }),
        h("path", { d: "M5.2 8.2v9.6a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6V8.2" }),
        h("path", { d: "M4.6 4.6h14.8a1 1 0 0 1 1 1v2.6H3.6V5.6a1 1 0 0 1 1-1Z" }),
        h("path", { d: "M10 12.4h4" }),
      );
    }

    /** 文件夹：右侧栏引导页图标 */
    function FolderGlyph(props) {
      return h(
        "svg",
        Object.assign(
          {
            viewBox: "0 0 24 24",
            width: 26,
            height: 26,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.6,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
          },
          props,
        ),
        h("path", { d: "M3 7.4a1.8 1.8 0 0 1 1.8-1.8h4l2.1 2.6h8.3a1.8 1.8 0 0 1 1.8 1.8v7.6a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.6Z" }),
        h("path", { d: "M3.2 10.6h17.6" }),
      );
    }

    /** 警告三角：弹窗里提示「会话正在活动」 */
    function WarnGlyph(props) {
      return h(
        "svg",
        Object.assign(
          {
            width: 18,
            height: 18,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.8,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
          },
          props,
        ),
        h("path", { d: "M12 4.4 20 18H4Z" }),
        h("path", { d: "M12 10v4" }),
        h("path", { d: "M12 16.6v.2" }),
      );
    }

    const zh = {
      tooltip: "重启 DSH",
      tooltipDisabled: "有会话运行中，无法重启",
      done: "重启完成",
      restartHint: "双击重启",
      unavailable: "宿主不可用",
      // 弹窗
      dialogTitle: "归档会话确认",
      dialogActive: "会话正在活动",
      dialogError: "归档失败",
      dialogBusy: "正在归档…",
      confirmBody: "确认归档该会话吗？归档后会话窗口会关闭。",
      backupOn: "归档完成后会自动备份到：",
      backupOff: "自动备份已关闭，本次归档不生成备份副本。",
      activeLead: "该会话仍有工作在运行，归档前需要先停止这些工作：",
      waitSeconds: (n) => "为防止误操作，确认按钮将在 " + n + " 秒后解锁",
      ready: "倒计时结束，现在可以停止这些工作并归档。",
      submitting: "正在提交归档…",
      cancel: "取消",
      confirm: "确认归档",
      stopArchive: "停止并归档",
      waiting: (n) => "请等待 " + n + " 秒",
      close: "关闭",
      unknownError: "未知错误",
      // 右侧栏
      paneTitle: "已归档会话",
      refresh: "刷新",
      refreshing: "刷新中…",
      openFolder: "打开文件夹",
      listTitle: "归档清单",
      sessionsRootTitle: "会话存储目录",
      allWorkspaces: "全部工作区",
      reading: "读取中…",
      waiting: "等待读取…",
      emptyList: "还没有归档会话。归档后，会话会出现在这里。",
      truncated: "（条目过多，已截断）",
      openFailed: "打开失败：",
      opened: "已在资源管理器中打开",
      loadFailed: "读取归档会话清单失败：",
      sourceTitle: "数据源",
      sourceNote: "DSH 会话目录，归档会话文件的真实位置；本页只读这里，不读备份副本。",
      // 备份设置
      backupTitle: "自动备份",
      backupEnabled: "开启",
      backupDisabled: "关闭",
      backupPathLabel: "备份根目录",
      pick: "选择…",
      picking: "选择中…",
      save: "保存",
      saving: "保存中…",
      saveFailed: "保存失败：",
      dirPlaceholder: (d) => "留空使用默认：" + d,
      statusOk: (n) => "✓ 可写，已备份 " + n + " 个会话",
      statusMissing: "目录还不存在，保存时会自动创建",
      statusUnwritable: "目录不可写，请换一个位置",
      statusOff: "自动备份已关闭：归档只保留在 DSH 会话目录",
      statusPicked: "已选择目录，保存后生效",
      pickedCancelled: "已取消选择",
      sourceDefault: "默认路径",
      sourceUser: "用户设置",
      sourceEnv: "环境变量",
      envBanner: (k) => "由环境变量 " + k + " 接管：界面里的开关与路径不会生效，去掉该变量后恢复。",
      savedOnce: "已保存",
      collapse: "收起",
      noDirYet: "（未设置）",
      backupHelp: "归档后约 3 秒自动备份。改动只影响之后的归档，已有备份不会搬迁。",
    };
    const en = {
      tooltip: "Restart DSH",
      tooltipDisabled: "Session running; cannot restart",
      done: "Restart done",
      restartHint: "Double-click to restart",
      unavailable: "Host unavailable",
      dialogTitle: "Confirm session archive",
      dialogActive: "Session is active",
      dialogError: "Archive failed",
      dialogBusy: "Archiving…",
      confirmBody: "Archive this session? Its window will close after archiving.",
      backupOn: "A copy will be backed up to: ",
      backupOff: "Auto-backup is off; no backup copy will be made.",
      activeLead: "Work is still running in this session. Stop it before archiving.",
      waitSeconds: (n) => "To avoid mistakes, the confirm button unlocks in " + n + "s.",
      ready: "Countdown finished. You can stop the work and archive now.",
      submitting: "Submitting…",
      cancel: "Cancel",
      confirm: "Archive",
      stopArchive: "Stop and archive",
      waiting: (n) => "Wait " + n + "s",
      close: "Close",
      unknownError: "Unknown error",
      paneTitle: "Archived sessions",
      refresh: "Refresh",
      refreshing: "Refreshing…",
      openFolder: "Open folder",
      listTitle: "Archive list",
      sessionsRootTitle: "Session store",
      allWorkspaces: "All workspaces",
      reading: "Reading…",
      waiting: "Waiting…",
      emptyList: "No archived sessions yet. Archived sessions show up here.",
      truncated: "(too many entries; truncated)",
      openFailed: "Open failed: ",
      opened: "Opened in Explorer: ",
      loadFailed: "Failed to load archived sessions: ",
      sourceTitle: "Data source",
      sourceNote: "The DSH session folder holds the real archived files; this page reads only that, not the backup copies.",
      backupTitle: "Auto-backup",
      backupEnabled: "On",
      backupDisabled: "Off",
      backupPathLabel: "Backup root",
      pick: "Browse…",
      picking: "Browsing…",
      save: "Save",
      saving: "Saving…",
      saveFailed: "Save failed: ",
      dirPlaceholder: (d) => "Empty = default: " + d,
      statusOk: (n) => "Writable, " + n + " session(s) backed up",
      statusMissing: "Folder does not exist yet; it will be created on save",
      statusUnwritable: "Folder not writable; pick another location",
      statusOff: "Auto-backup is off: archives stay in the DSH session folder",
      statusPicked: "Folder selected; save to apply",
      pickedCancelled: "Selection cancelled",
      sourceDefault: "default path",
      sourceUser: "user setting",
      sourceEnv: "environment variable",
      envBanner: (k) => "Controlled by " + k + ": the toggle and path below have no effect until it is removed.",
      savedOnce: "Saved",
      collapse: "Collapse",
      noDirYet: "(not set)",
      backupHelp: "Backup runs 3s after archiving. Changes apply to future archives only; existing backups stay put.",
    };

    /* ================================================================
     *  二、重启按钮
     * ================================================================ */

    function RestartButton(props) {
      const { useSessionStatus } = props || {};
      const [restarting, setRestarting] = React.useState(false);
      const [alive, setAlive] = React.useState(true);
      const busyRef = React.useRef(false);

      // snapshot 是 Map：sessionId -> status（含 running 字段）；未注入视为无运行
      const running = (typeof useSessionStatus === "function" ? useSessionStatus : () => false)((snapshot) => {
        if (!snapshot || typeof snapshot.values !== "function") return false;
        for (const st of snapshot.values()) {
          if (st && st.running) return true;
        }
        return false;
      });

      React.useEffect(() => {
        let stop = false;
        const tick = async () => {
          if (stop) return;
          try {
            const r = await fetch(`${API}/health`);
            if (!stop) setAlive(r.status >= 200 && r.status < 500);
          } catch {
            if (!stop) setAlive(false);
          }
        };
        tick();
        const timer = window.setInterval(tick, POLL_MS);
        return () => {
          stop = true;
          window.clearInterval(timer);
        };
      }, []);

      const onDoubleClick = async () => {
        if (busyRef.current || restarting || running) return;
        busyRef.current = true;
        try {
          const res = await fetch(`${API}/restart`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: null, text: zh.done }),
          });
          const j = await res.json().catch(() => ({}));
          diag("double-click /restart status=" + res.status + " ok=" + !!j.ok);
          if (j && j.ok) setRestarting(true);
        } catch (e) {
          diag("double-click /restart fetch error: " + (e && e.message ? e.message : String(e)));
          setAlive(false);
        } finally {
          busyRef.current = false;
        }
      };

      const disabled = running || restarting || !alive;
      const label = running
        ? zh.tooltipDisabled
        : restarting
          ? zh.done
          : alive
            ? zh.tooltip
            : zh.unavailable;

      return h(
        "button",
        {
          type: "button",
          className: "e2r-btn",
          "aria-label": label,
          title: `${label} · ${zh.restartHint}`,
          "data-live": alive ? "on" : "off",
          disabled,
          onDoubleClick,
        },
        h(RestartGlyph, null),
      );
    }

    /* ================================================================
     *  三、安全归档确认框
     * ================================================================ */

    let dlg = null;
    let currentFlow = null;
    let countdownTimer = null;
    const subs = new Set();
    function emit() {
      for (const fn of Array.from(subs)) {
        try {
          fn();
        } catch (e) {
          /* 忽略订阅者异常 */
        }
      }
    }
    function setDlg(next) {
      dlg = next;
      emit();
    }
    function useDlg() {
      const [value, setValue] = React.useState(dlg);
      React.useEffect(() => {
        const update = () => setValue(dlg);
        subs.add(update);
        return () => {
          subs.delete(update);
        };
      }, []);
      return value;
    }
    function clearCountdown() {
      if (countdownTimer !== null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }

    function activityLines(activity) {
      const lines = [];
      for (const entry of activity || []) {
        const items = Array.isArray(entry.items) ? entry.items : [];
        const names = items
          .map((it) => it && (it.label || it.id))
          .filter(Boolean)
          .join("\n");
        if (entry.kind === "turn") lines.push("· 进行中的回合");
        else if (entry.kind === "subagent") lines.push("· 子代理" + (names ? "：" + names : ""));
        else if (entry.kind === "job") lines.push("· 后台任务" + (names ? "：" + names : ""));
        else if (entry.kind === "schedule") lines.push("· 定时任务" + (names ? "：" + names : ""));
        else lines.push("· 其他活动（" + entry.kind + "）" + (names ? "：" + names : ""));
      }
      if (lines.length === 0) lines.push("· 该会话仍有工作在运行");
      return lines;
    }

    function startCountdown(flow) {
      clearCountdown();
      countdownTimer = setInterval(() => {
        if (flow.finished) {
          clearCountdown();
          return;
        }
        flow.countdown = Math.max(0, flow.countdown - 1);
        if (flow.countdown === 0) clearCountdown();
        flow.sync();
      }, 1000);
    }

    function runFlow(sessionId, orig) {
      if (currentFlow && !currentFlow.finished && currentFlow.sessionId === sessionId) return currentFlow.promise;
      let resolveFn;
      let rejectFn;
      const promise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });
      promise.catch(() => {});
      const flow = {
        sessionId,
        orig,
        promise,
        finished: false,
        phase: "confirm",
        busy: false,
        countdown: 0,
        activity: [],
        error: null,
        sync() {
          setDlg({
            sessionId,
            phase: this.phase,
            busy: this.busy,
            countdown: this.countdown,
            activity: this.activity,
            error: this.error,
            activityLines: activityLines(this.activity),
          });
        },
        finish(ok, value) {
          if (this.finished) return;
          this.finished = true;
          clearCountdown();
          if (currentFlow === this) currentFlow = null;
          setDlg(null);
          if (ok) resolveFn(value);
          else rejectFn(value);
        },
        cancel() {
          this.finish(false, new Error(NS + "/cancelled"));
        },
        async confirm() {
          if (this.busy || this.finished) return;
          this.busy = true;
          this.phase = "busy";
          this.error = null;
          this.sync();
          try {
            const result = await this.orig(this.sessionId);
            this.finish(true, result);
          } catch (e) {
            const code = e && e.rpcError && e.rpcError.code;
            if (code === "workspace/session-active") {
              this.busy = false;
              this.phase = "active";
              this.activity = (e.rpcError.details && e.rpcError.details.activity) || [];
              this.countdown = 10;
              this.sync();
              startCountdown(this);
            } else {
              this.busy = false;
              this.phase = "error";
              this.error = (e && e.message) || String(e);
              this.sync();
            }
          }
        },
        async stopAndArchive() {
          if (this.busy || this.finished || this.countdown > 0) return;
          this.busy = true;
          this.phase = "busy";
          this.error = null;
          this.sync();
          try {
            const result = await this.orig(this.sessionId, { stopActivity: true });
            this.finish(true, result);
          } catch (e) {
            this.busy = false;
            this.phase = "error";
            this.error = (e && e.message) || String(e);
            this.sync();
          }
        },
        closeError() {
          this.finish(false, new Error(NS + "/failed"));
        },
      };
      currentFlow = flow;
      flow.sync();
      return promise;
    }

    /** 备份状态缓存：弹窗用它决定「会备份 / 不备份」那句文案 */
    let backupCache = null;
    async function refreshBackupCache() {
      try {
        const data = await getJson(API + "/backup");
        backupCache = data;
        return data;
      } catch {
        return backupCache;
      }
    }

    function Overlay() {
      const d = useDlg();
      const [backup, setBackup] = React.useState(backupCache);
      React.useEffect(() => {
        if (!d) return;
        if (backupCache) {
          setBackup(backupCache);
          return;
        }
        refreshBackupCache().then((v) => {
          if (v) setBackup(v);
        });
      }, [d ? d.sessionId : null]);

      if (!d) return null;
      const flow = currentFlow;

      const isActive = d.phase === "active";
      const isError = d.phase === "error";
      const isBusy = d.phase === "busy";
      const title = isActive
        ? zh.dialogActive
        : isError
          ? zh.dialogError
          : isBusy
            ? zh.dialogBusy
            : zh.dialogTitle;
      const badgeClass = "e2r-badge" + (isError ? " e2r-badge--danger" : isActive ? " e2r-badge--warn" : "");
      const badge = isError
        ? h(WarnGlyph, null)
        : isActive
          ? h(WarnGlyph, null)
          : h(ArchiveGlyph, { className: "e2r-glyph" });

      const lines = d.activityLines || [];
      let body = null;
      if (d.phase === "confirm") {
        const backupOn = !backup || backup.enabled !== false;
        body = h(
          "div",
          null,
          h("p", { className: "e2r-p" }, zh.confirmBody),
          h(
            "p",
            { className: "e2r-p e2r-p--tight" },
            backupOn
              ? h(
                  "span",
                  null,
                  zh.backupOn,
                  h("code", { className: "e2r-code" }, (backup && (backup.dir || backup.defaultDir)) || "（未设置）"),
                  "。",
                )
              : h("span", { className: "e2r-warn" }, zh.backupOff),
          ),
        );
      } else if (isActive) {
        body = h(
          "div",
          null,
          h("p", { className: "e2r-p" }, h("span", { className: "e2r-warn" }, zh.dialogActive), "：", zh.activeLead),
          h(
            "ul",
            { className: "e2r-ul" },
            lines.map((line, i) => h("li", { key: i }, line)),
          ),
          h("p", { className: "e2r-p" }, d.countdown > 0 ? zh.waitSeconds(d.countdown) : zh.ready),
        );
      } else if (isError) {
        body = h("div", null, h("p", { className: "e2r-p e2r-danger-text" }, d.error || zh.unknownError));
      } else {
        body = h("div", null, h("p", { className: "e2r-p" }, zh.submitting));
      }

      const cancelBtn = h(
        "button",
        {
          className: "e2r-b",
          disabled: !!d.busy,
          onClick: () => flow && flow.cancel(),
          type: "button",
        },
        zh.cancel,
      );

      let primary;
      if (d.phase === "confirm") {
        primary = h(
          "button",
          {
            className: "e2r-b e2r-b--primary",
            disabled: !!d.busy,
            onClick: () => flow && flow.confirm(),
            type: "button",
          },
          d.busy ? zh.dialogBusy : zh.confirm,
        );
      } else if (isActive) {
        const blocked = d.countdown > 0 || d.busy;
        primary = h(
          "button",
          {
            className: "e2r-b e2r-b--danger",
            disabled: blocked,
            onClick: () => flow && flow.stopAndArchive(),
            type: "button",
          },
          d.busy ? zh.dialogBusy : d.countdown > 0 ? zh.waiting(d.countdown) : zh.stopArchive,
        );
      } else if (isError) {
        primary = h(
          "button",
          { className: "e2r-b e2r-b--primary", onClick: () => flow && flow.closeError(), type: "button" },
          zh.close,
        );
      } else {
        primary = h("button", { className: "e2r-b e2r-b--primary", disabled: true, type: "button" }, zh.dialogBusy);
      }

      return h(
        "div",
        { className: "e2r-backdrop e2r-dlg", role: "dialog", "aria-modal": "true", "aria-label": title },
        h(
          "div",
          { className: "e2r-card" },
          h("div", { className: "e2r-card-head" }, h("span", { className: badgeClass }, badge), h("h3", { className: "e2r-h3" }, title)),
          body,
          h("div", { className: "e2r-foot" }, isError ? null : cancelBtn, primary),
        ),
      );
    }

    /* ================================================================
     *  四、右侧栏「已归档会话」页 + 自动备份设置
     * ================================================================ */

    const ARCHIVE_KIND = "archive-sessions";
    const ARCHIVE_TYPE_ID = NS + "/archive-files";
    /** 迁移前由企业微信插件注册过的旧 kind：保留别名，已保存的右侧栏 tab 不失效 */
    const LEGACY_ARCHIVE_KIND = "wecom-archive";
    const LEGACY_ARCHIVE_TYPE_ID = NS + "/archive-files-legacy";

    function fmtBytes(n) {
      const v = Number(n) || 0;
      if (v < 1024) return v + " B";
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
      if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(2) + " MB";
      return (v / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    function fmtTime(ms) {
      const v = Number(ms) || 0;
      if (!v) return "";
      try {
        return new Date(v).toLocaleString("zh-CN", { hour12: false });
      } catch {
        return new Date(v).toISOString();
      }
    }

    async function getJson(url) {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok || !body || body.ok !== true) {
        throw new Error((body && (body.message || body.code)) || "HTTP " + res.status);
      }
      return body.data;
    }

    /** 树的一行（目录可展开，文件点击用系统资源管理器定位） */
    function ArchiveRow(props) {
      const depth = Math.max(0, Math.min(3, props.depth || 0));
      const cls = "e2r-row" + (props.staticRow ? " e2r-row--static" : "") + (depth ? " e2r-indent-" + depth : "");
      return h(
        "div",
        {
          className: cls,
          role: "treeitem",
          tabIndex: props.staticRow ? undefined : 0,
          title: props.hint || props.label,
          onClick: props.staticRow ? undefined : props.onClick,
          onKeyDown: props.staticRow
            ? undefined
            : (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  if (props.onClick) props.onClick();
                }
              },
        },
        h("span", { className: "e2r-chev" }, props.expandable ? (props.open ? "▾" : "▸") : ""),
        h("span", { className: "e2r-name" }, props.label),
        props.meta ? h("span", { className: "e2r-meta" }, props.meta) : null,
      );
    }

    /** 「自动备份」设置卡片：开/关 + 备份根目录 + 选择/保存 + 紧贴字段的状态行 */
    function BackupSettings(props) {
      const snap = props.snapshot || {};
      const onChanged = props.onChanged || (() => {});
      const envOverride = !!snap.envOverride;
      const [enabled, setEnabled] = React.useState(snap.enabled !== false);
      const [dir, setDir] = React.useState(snap.configDir || "");
      const [busy, setBusy] = React.useState("");
      const [saved, setSaved] = React.useState(false);
      const [error, setError] = React.useState("");
      const [note, setNote] = React.useState("");

      React.useEffect(() => {
        setEnabled(snap.enabled !== false);
        setDir(snap.configDir || "");
      }, [snap.enabled, snap.configDir]);

      const flashSaved = () => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1700);
      };

      async function post(path, payload) {
        const res = await fetch(API + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload || {}),
        });
        let body = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (!res.ok || !body || body.ok !== true) {
          throw new Error((body && (body.message || body.code)) || "HTTP " + res.status);
        }
        return body.data;
      }

      const save = async (nextEnabled, nextDir) => {
        setBusy("save");
        setError("");
        setNote("");
        try {
          const next = await post("/backup", {
            enabled: typeof nextEnabled === "boolean" ? nextEnabled : enabled,
            dir: typeof nextDir === "string" ? nextDir : dir,
          });
          backupCache = next;
          setEnabled(next.enabled !== false);
          setDir(next.configDir || "");
          flashSaved();
          onChanged(next);
        } catch (e) {
          setError(zh.saveFailed + String((e && e.message) || e));
        } finally {
          setBusy("");
        }
      };

      const pick = async () => {
        setBusy("pick");
        setError("");
        setNote("");
        try {
          const data = await post("/backup/pick", { current: dir || snap.dir || "" });
          if (!data || data.cancelled) {
            setNote(zh.pickedCancelled);
            return;
          }
          setDir(data.dir || "");
          if (data.probe && data.probe.ok === false) setError(zh.saveFailed + (data.probe.reason || "目录不可写"));
          else setNote(zh.statusPicked);
        } catch (e) {
          setError(zh.saveFailed + String((e && e.message) || e));
        } finally {
          setBusy("");
        }
      };

      const disabled = envOverride || busy === "save";
      const off = !enabled;

      let statusClass = "e2r-status e2r-status--muted";
      let statusText = zh.statusOff;
      let statusDot = false;
      if (envOverride) {
        statusClass = "e2r-status e2r-status--warn";
        statusText = zh.envBanner(snap.envKey || "env");
      } else if (error) {
        statusClass = "e2r-status e2r-status--danger";
        statusText = error;
      } else if (off) {
        statusClass = "e2r-status e2r-status--muted";
        statusText = zh.statusOff;
      } else if (!snap.exists) {
        statusClass = "e2r-status e2r-status--warn";
        statusText = zh.statusMissing;
      } else if (!snap.writable) {
        statusClass = "e2r-status e2r-status--danger";
        statusText = zh.statusUnwritable;
      } else {
        statusClass = "e2r-status e2r-status--ok";
        statusText = zh.statusOk(snap.backedUp || 0);
        statusDot = true;
      }

      const sourceText =
        snap.source === "env" ? zh.sourceEnv : snap.source === "config" ? zh.sourceUser : zh.sourceDefault;

      return h(
        "div",
        { className: "e2r-card-box" },
        h(
          "div",
          { className: "e2r-card-row" },
          h("span", { className: "e2r-card-lead" }, zh.backupTitle),
          h("span", { style: { flex: 1 } }),
          h(
            "div",
            { className: "e2r-seg", role: "group", "aria-label": zh.backupTitle },
            h(
              "button",
              {
                type: "button",
                className: "e2r-seg-b",
                "aria-pressed": enabled ? "true" : "false",
                disabled: disabled,
                onClick: () => save(true, dir),
              },
              zh.backupEnabled,
            ),
            h(
              "button",
              {
                type: "button",
                className: "e2r-seg-b",
                "aria-pressed": enabled ? "false" : "true",
                disabled: disabled,
                onClick: () => save(false, dir),
              },
              zh.backupDisabled,
            ),
          ),
        ),
        h(
          "div",
          { className: "e2r-card-row", style: { display: "block", paddingTop: 12 } },
          h("div", { className: "e2r-label" }, zh.backupPathLabel),
          h(
            "div",
            { className: "e2r-input-row", style: { marginTop: 6 } },
            h("input", {
              className: "e2r-input" + (error ? " e2r-input--bad" : ""),
              type: "text",
              spellCheck: false,
              value: dir,
              placeholder: zh.dirPlaceholder(snap.defaultDir || ""),
              disabled: disabled || off,
              onChange: (ev) => {
                setDir(ev.target.value);
                setError("");
                setNote("");
              },
            }),
            h(
              "button",
              {
                type: "button",
                className: "e2r-b e2r-b--sm",
                disabled: disabled || off || busy === "pick",
                onClick: pick,
              },
              busy === "pick" ? zh.picking : zh.pick,
            ),
            h(
              "button",
              {
                type: "button",
                className: "e2r-b e2r-b--sm e2r-b--primary",
                disabled: disabled || busy === "save",
                onClick: () => save(enabled, dir),
              },
              busy === "save" ? zh.saving : zh.save,
            ),
            saved ? h("span", { className: "e2r-saved" }, zh.savedOnce) : null,
          ),
          h(
            "div",
            { className: statusClass, style: { marginTop: 8 } },
            statusDot ? h("span", { className: "e2r-dot" }) : null,
            h("span", null, statusText),
          ),
          note && !error ? h("div", { className: "e2r-status e2r-status--muted", style: { marginTop: 4 } }, note) : null,
          h(
            "div",
            { className: "e2r-help", style: { marginTop: 8 } },
            h("span", null, "来源：" + sourceText + "。"),
            " ",
            zh.backupHelp,
          ),
        ),
        props.onCollapse
          ? h(
              "div",
              { className: "e2r-card-row e2r-card-row--foot" },
              h(
                "button",
                { type: "button", className: "e2r-b e2r-b--sm", onClick: props.onCollapse },
                zh.collapse,
              ),
            )
          : null,
      );
    }

    /** 右侧栏「已归档会话」正文 */
    function ArchiveExplorer() {
      const [roots, setRoots] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const [expanded, setExpanded] = React.useState({});
      const [dirs, setDirs] = React.useState({});
      const [notice, setNotice] = React.useState("");
      const [backup, setBackup] = React.useState(backupCache);
      const [openSettings, setOpenSettings] = React.useState(false);

      const loadRoots = React.useCallback(async () => {
        setBusy(true);
        setError("");
        try {
          const data = await getJson(API + "/archive/roots");
          setRoots(data);
        } catch (e) {
          setError(zh.loadFailed + String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
        // 备份快照只认 /backup，别拿 roots 顶替：两者字段不同（dir/defaultDir vs backupRoot）
        const snap = await refreshBackupCache();
        if (snap) setBackup(snap);
      }, []);

      React.useEffect(() => {
        loadRoots();
      }, [loadRoots]);

      const loadDir = React.useCallback(async (dirPath) => {
        setDirs((prev) => Object.assign({}, prev, { [dirPath]: { status: "loading", entries: [] } }));
        try {
          const data = await getJson(API + "/archive/ls?path=" + encodeURIComponent(dirPath));
          setDirs((prev) =>
            Object.assign({}, prev, {
              [dirPath]: { status: "ready", entries: data.entries || [], truncated: !!data.truncated },
            }),
          );
        } catch (e) {
          setDirs((prev) =>
            Object.assign({}, prev, {
              [dirPath]: { status: "failed", entries: [], error: String((e && e.message) || e) },
            }),
          );
        }
      }, []);

      const toggle = React.useCallback(
        (key, dirPath) => {
          setExpanded((prev) => {
            const next = Object.assign({}, prev);
            const now = !next[key];
            next[key] = now;
            if (now && dirPath) loadDir(dirPath);
            return next;
          });
        },
        [loadDir],
      );

      const openPath = React.useCallback(async (target) => {
        if (!target) return;
        setNotice("");
        try {
          const res = await fetch(API + "/archive/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: target }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || body.ok !== true) {
            throw new Error((body && (body.message || body.code)) || "HTTP " + res.status);
          }
          setNotice(zh.opened + target);
        } catch (e) {
          setNotice(zh.openFailed + String((e && e.message) || e));
        }
      }, []);

      function renderEntryRows(dirPath, depth) {
        const state = dirs[dirPath];
        if (!state || state.status === "loading") {
          return [h(ArchiveRow, { key: dirPath + ":loading", depth, label: zh.reading, staticRow: true })];
        }
        if (state.status === "failed") {
          return [h("div", { key: dirPath + ":failed", className: "e2r-err" }, state.error)];
        }
        const rows = [];
        for (const entry of state.entries) {
          const full = dirPath.replace(/[\\/]+$/, "") + "\\" + entry.name;
          const key = "f:" + full.toLowerCase();
          const isDir = entry.kind === "directory";
          const open = !!expanded[key];
          rows.push(
            h(ArchiveRow, {
              key,
              depth,
              label: entry.name,
              meta: isDir ? "文件夹" : fmtBytes(entry.sizeBytes),
              expandable: isDir,
              open,
              hint: full,
              onClick: isDir ? () => toggle(key, full) : () => openPath(full),
            }),
          );
          if (isDir && open) {
            for (const child of renderEntryRows(full, depth + 1)) rows.push(child);
          }
        }
        if (state.truncated) {
          rows.push(h(ArchiveRow, { key: dirPath + ":trunc", depth, label: zh.truncated, staticRow: true }));
        }
        return rows;
      }

      const sections = [];
      if (error) sections.push(h("div", { key: "err", className: "e2r-err" }, error));
      if (!roots && !error) {
        sections.push(h(ArchiveRow, { key: "wait", depth: 0, label: busy ? zh.reading : zh.waiting, staticRow: true }));
      }

      if (roots) {
        const archived = roots.archived || [];
        sections.push(
          h(
            "div",
            { key: "archived-head", className: "e2r-sec" },
            h("div", { className: "e2r-sec-title" }, zh.listTitle),
            h("div", { className: "e2r-count" }, archived.length + " / " + roots.archivedSessionTotal),
          ),
        );
        if (archived.length === 0) {
          sections.push(h("div", { key: "archived-empty", className: "e2r-empty" }, zh.emptyList));
        }
        for (const item of archived) {
          const key = "arc:" + item.id;
          const open = !!expanded[key];
          sections.push(
            h(ArchiveRow, {
              key,
              depth: 0,
              label: item.title || item.id,
              meta: fmtBytes(item.sizeBytes) + " · " + fmtTime(item.mtimeMs),
              expandable: true,
              open,
              hint: item.dir,
              onClick: () => toggle(key, item.dir),
            }),
          );
          if (open) {
            sections.push(h("div", { key: key + ":path", className: "e2r-path e2r-indent-1" }, item.dir));
            for (const row of renderEntryRows(item.dir, 1)) sections.push(row);
          }
        }

        sections.push(h("hr", { key: "hr", className: "e2r-hr" }));
        const rootKey = "root:all";
        sections.push(
          h(
            "div",
            { key: "all-head", className: "e2r-sec" },
            h("div", { className: "e2r-sec-title" }, zh.sessionsRootTitle),
            h("div", { className: "e2r-count" }, zh.allWorkspaces),
          ),
        );
        sections.push(
          h(ArchiveRow, {
            key: rootKey,
            depth: 0,
            label: roots.sessionsRoot,
            expandable: true,
            open: !!expanded[rootKey],
            hint: roots.sessionsRoot,
            onClick: () => toggle(rootKey, roots.sessionsRoot),
          }),
        );
        if (expanded[rootKey]) {
          for (const row of renderEntryRows(roots.sessionsRoot, 1)) sections.push(row);
        }

        // 数据源卡片（带说明）
        sections.push(
          h(
            "div",
            { key: "source-card", className: "e2r-card-box" },
            h(
              "div",
              { className: "e2r-card-row" },
              h("span", { className: "e2r-card-lead" }, zh.sourceTitle),
              h("span", { style: { flex: 1 } }),
              h("span", { className: "e2r-chip e2r-chip--ok" }, h("span", { className: "e2r-dot" }), "已连接"),
            ),
            h(
              "div",
              { className: "e2r-card-body" },
              h("div", { className: "e2r-path" }, roots.sessionsRoot),
              h("div", { className: "e2r-help", style: { marginTop: 6 } }, zh.sourceNote),
            ),
          ),
        );

        // 自动备份：默认收起成一行摘要，点开才是表单（开合两态各自只有一层边界）
        const snap = backup || {};
        const backupOn = snap.enabled !== false;
        const backupDir = snap.dir || snap.defaultDir || "";
        const onBackupChanged = (next) => {
          setBackup(next);
          setRoots((prev) => (prev ? Object.assign({}, prev, {
            backupRoot: next.dir,
            backupEnabled: next.enabled,
            backupSource: next.source,
            backupWritable: next.writable,
            backupExists: next.exists,
            backedUpCount: next.backedUp,
          }) : prev));
        };
        if (openSettings) {
          sections.push(
            h(BackupSettings, {
              key: "backup-card",
              snapshot: snap,
              onChanged: onBackupChanged,
              onCollapse: () => setOpenSettings(false),
            }),
          );
        } else {
          sections.push(
            h(
              "div",
              { key: "backup-card", className: "e2r-card-box" },
              h(
                "div",
                {
                  className: "e2r-summary",
                  role: "button",
                  tabIndex: 0,
                  "aria-expanded": false,
                  onClick: () => setOpenSettings(true),
                  onKeyDown: (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setOpenSettings(true);
                    }
                  },
                },
                h(
                  "span",
                  { className: "e2r-summary-main" },
                  h("span", { className: "e2r-summary-line" }, zh.backupTitle),
                  h("span", { className: "e2r-summary-path" }, backupDir || "（未设置）"),
                ),
                h(
                  "span",
                  { className: "e2r-chip " + (backupOn ? "e2r-chip--ok" : "e2r-chip--off") },
                  backupOn ? zh.backupEnabled : zh.backupDisabled,
                ),
                h("span", { className: "e2r-chev" }, "▸"),
              ),
            ),
          );
        }
      }

      const chip = (() => {
        if (!roots) return null;
        if (roots.backupEnabled === false) return h("span", { className: "e2r-chip e2r-chip--off" }, h("span", { className: "e2r-dot" }), "备份关闭");
        if (roots.backupWritable === false) return h("span", { className: "e2r-chip e2r-chip--warn" }, h("span", { className: "e2r-dot" }), "备份不可写");
        return h("span", { className: "e2r-chip e2r-chip--ok" }, h("span", { className: "e2r-dot" }), "自动备份");
      })();

      return h(
        "div",
        { className: "e2r-pane" },
        h(
          "div",
          { className: "e2r-head" },
          h(
            "div",
            { className: "e2r-head-row" },
            h("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
              h("div", { className: "e2r-title" }, zh.paneTitle),
              chip,
            ),
            h(
              "div",
              { style: { display: "flex", gap: 6, flex: "none" } },
              h("button", { type: "button", className: "e2r-b e2r-b--sm", onClick: loadRoots, disabled: busy }, busy ? zh.refreshing : zh.refresh),
              h(
                "button",
                {
                  type: "button",
                  className: "e2r-b e2r-b--sm",
                  onClick: () => openPath(roots && roots.sessionsRoot),
                  disabled: !roots,
                },
                zh.openFolder,
              ),
            ),
          ),
          h(
            "div",
            { className: "e2r-sub" },
            roots ? roots.sessionsRoot : zh.reading,
          ),
          notice ? h("div", { className: "e2r-sub" }, notice) : null,
        ),
        h("div", { className: "e2r-body" }, sections),
      );
    }

    /** 右侧栏标签页标题 */
    function ArchiveTitle() {
      return h("span", null, zh.paneTitle);
    }

    /* ================================================================
     *  五、插件入口
     * ================================================================ */
    exports.name = NS;
    exports.inject = ["slots", "locale", "uiWorkspace"];

    exports.apply = function apply(ctx) {
      diag(
        "apply-called slots=" +
          Boolean(ctx && ctx.slots) +
          " locale=" +
          Boolean(ctx && ctx.locale) +
          " uiWorkspace=" +
          Boolean(ctx && ctx.uiWorkspace),
      );

      ensureCss();
      refreshBackupCache();

      let t = function (key) {
        return key;
      };
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), NS + ": dict");
        t = ctx.locale.bind(NS);
      } catch (e) {
        diag("locale fail " + (e && e.message ? e.message : String(e)));
      }
      const label = () => t("tooltip");

      // ---------------- 1. 重启按钮 ----------------
      try {
        ctx.slots.inject("sidebar.footer.action", function () {
          try {
            const reg = ctx.slots.register(
              { name: "sidebar.footer.action", id: NS, order: -100, label, locale: NS },
              RestartButton,
            );
            diag("slot registered sidebar.footer.action");
            return reg;
          } catch (e) {
            diag("slot register fail: " + (e && e.message ? e.message : String(e)));
            return undefined;
          }
        });
      } catch (e) {
        diag("slots.inject fail " + (e && e.message ? e.message : String(e)));
      }

      // ---------------- 2. 归档确认框 ----------------
      try {
        ctx.slots.inject("shell.overlay", function registerOverlay() {
          try {
            const registration = ctx.slots.register(
              {
                name: "shell.overlay",
                id: NS + ".dialog",
                locale: NS,
                inject: () => ({}),
              },
              Overlay,
            );
            diag("overlay registered");
            return registration;
          } catch (e) {
            diag("overlay register fail " + (e && e.message ? e.message : String(e)));
            return undefined;
          }
        });
      } catch (e) {
        diag("overlay inject fail " + (e && e.message ? e.message : String(e)));
      }

      // ---------------- 3. 右侧栏「已归档会话」页 ----------------
      try {
        const registerSidebarTypes = (sidebarCtx) => {
          sidebarCtx.effect(
            () =>
              sidebarCtx.sidebarRightTabs.register({
                id: ARCHIVE_TYPE_ID,
                kind: ARCHIVE_KIND,
                priority: "extension",
                title: () => zh.paneTitle,
                guide: [
                  {
                    id: "archive-files",
                    order: 15,
                    title: () => zh.paneTitle,
                    description: () => "归档会话文件夹（非备份）",
                    icon: FolderGlyph,
                  },
                ],
              }),
            NS + ": sidebar archive type",
          );
          sidebarCtx.effect(
            () =>
              sidebarCtx.sidebarRightTabs.register({
                id: LEGACY_ARCHIVE_TYPE_ID,
                kind: LEGACY_ARCHIVE_KIND,
                priority: "extension",
                title: () => zh.paneTitle,
              }),
            NS + ": sidebar archive legacy type",
          );
        };
        if (typeof ctx.inject === "function") ctx.inject(["sidebarRightTabs"], registerSidebarTypes);
        else if (ctx.sidebarRightTabs) registerSidebarTypes(ctx);
        else diag("sidebarRightTabs missing");
      } catch (e) {
        diag("sidebar types fail " + (e && e.message ? e.message : String(e)));
      }
      try {
        ctx.slots.inject("sidebar.right.pane.tab", () =>
          ctx.slots.register({ name: "sidebar.right.pane.tab", key: ARCHIVE_TYPE_ID }, ArchiveExplorer),
        );
        ctx.slots.inject("sidebar.right.pane.tab.title", () =>
          ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: ARCHIVE_TYPE_ID }, ArchiveTitle),
        );
        ctx.slots.inject("sidebar.right.pane.tab", () =>
          ctx.slots.register({ name: "sidebar.right.pane.tab", key: LEGACY_ARCHIVE_TYPE_ID }, ArchiveExplorer),
        );
        ctx.slots.inject("sidebar.right.pane.tab.title", () =>
          ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: LEGACY_ARCHIVE_TYPE_ID }, ArchiveTitle),
        );
      } catch (e) {
        diag("sidebar slots fail " + (e && e.message ? e.message : String(e)));
      }

      // ---------------- 5. 接管归档入口 ----------------
      const uw = ctx.uiWorkspace;
      if (!uw || typeof uw.archiveSession !== "function") {
        diag("uiWorkspace missing; can not intercept");
        try {
          if (typeof console !== "undefined" && console && typeof console.warn === "function") {
            console.warn("[" + NS + "] uiWorkspace service missing");
          }
        } catch (e) {
          /* 忽略 */
        }
        return;
      }
      if (uw.__safeArchiveWrapped) {
        diag("already wrapped");
        return;
      }
      const original = uw.archiveSession.bind(uw);
      uw.__safeArchiveWrapped = original;
      uw.archiveSession = function easy2restartArchive(sessionId, options) {
        if (options && options.__safeArchiveBypass) return original(sessionId, options);
        diag("intercept archive " + sessionId);
        return runFlow(sessionId, original);
      };
      diag("wrapper installed");
    };

    return module.exports;
  },
});
