/**
 * dsh-plugin-easy2restart — Web 客户端（客户端半侧）
 *
 * 挂载点：sidebar.footer.action（侧边栏底部、账号头像/设置上方）。
 * 交互：
 *  - 双击按钮 => 调用宿主 /restart 记录「重启完成」待办并重启 DSH。
 *  - 有 Agent 会话运行中时按钮置灰禁用（通过宿主 /active 轮询判定）。
 *  - 重启后，DSH 恢复会话；本组件的「自动发送」交给宿主端在频道
 *    （apply 后检测 pending）尽力恢复会话并注入『重启完成』用户消息。
 *
 * 数据/动作走宿主 HTTP 路由：
 *   GET  /api/dsh-plugin-easy2restart/active   -> { active }
 *   GET  /api/dsh-plugin-easy2restart/state    -> { data: pending }
 *   POST /api/dsh-plugin-easy2restart/restart  -> { sessionId, text }
 *   POST /api/dsh-plugin-easy2restart/clear
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-easy2restart",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const { createElement: h, useState, useEffect, useRef, useCallback } = require("react");

    const NS = "dsh-plugin-easy2restart";
    const API = "/api/dsh-plugin-easy2restart";
    const POLL_MS = 1200;

    // 按钮图标：与插件列表共用同一张 ⟳ 图标（内联 data URI，随位置缩放）
    const ICON = "data:image/png;base64,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";

    const zh = {
      tooltip: "重启 DSH",
      tooltipDisabled: "有会话运行中，无法重启",
      done: "重启完成",
      restartHint: "双击重启",
      unavailable: "宿主不可用",
    };

    function RestartButton(props) {
      const { wide, useSessionStatus } = props || {};
      // 诊断回写宿主（host 写入 diag.log）
      function diag(msg) {
        try {
          fetch(API + "/diag", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ msg }),
          }).catch(() => {});
        } catch (e) {
          /* 忽略 */
        }
      }
      // 是否正在重启（防重复触发）
      const [restarting, setRestarting] = useState(false);
      // 宿主是否可及（/health 轮询）
      const [alive, setAlive] = useState(true);
      const busyRef = useRef(false);

      // 是否有会话正在运行（禁用依据）。useSessionStatus 是 DSH 注入的快照 hook，
      // snapshot 为 Map：sessionId -> status（含 running 字段）。若未见注入则视为无运行。
      const running = (typeof useSessionStatus === "function" ? useSessionStatus : () => false)((snapshot) => {
        if (!snapshot || typeof snapshot.values !== "function") return false;
        for (const st of snapshot.values()) {
          if (st && st.running) return true;
        }
        return false;
      });

      const fetchJson = useCallback(async (path, options) => {
        const res = await fetch(`${API}${path}`, {
          headers: { "content-type": "application/json" },
          ...(options || {}),
        });
        return res.json().catch(() => ({}));
      }, []);

      // 轮询宿主存活性（存在 /health 路由 = alive）
      useEffect(() => {
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

      // 双击触发重启
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

      const style = {
        boxSizing: "border-box",
        width: wide ? "100%" : 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        border: "none",
        borderRadius: 6,
        background: "transparent",
        color: disabled ? "var(--dsw-alias-label-dimmed, #9aa0a6)" : "var(--dsw-alias-label-secondary, #5f6368)",
        cursor: disabled ? "default" : "pointer",
        fontSize: 15,
        opacity: disabled ? 0.45 : 1,
      };

      return h(
        "button",
        {
          type: "button",
          "aria-label": label,
          title: `${label} — ${zh.restartHint}`,
          style,
          disabled,
          onDoubleClick,
        },
        wide ? [h("img", { key: "ic", src: ICON, alt: "", "aria-hidden": "true", style: { width: 14, height: 14, display: "block", objectFit: "contain" } }), h("span", { key: "tx", style: { fontSize: 12 } }, "重启 DSH")] : h("img", { src: ICON, alt: "", "aria-hidden": "true", style: { width: 16, height: 16, display: "block", objectFit: "contain" } }),
      );
    }

    exports.name = NS;
    exports.inject = ["slots", "locale"];

    exports.apply = function apply(ctx) {
      // 诊断回写宿主（host 写入 ~/.dsh/storages/dsh-plugin-easy2restart/diag.log），便于排查 client 加载链路。
      function diag(msg) {
        try {
          fetch(API + "/diag", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ msg }),
          }).catch(() => {});
        } catch (e) {
          /* 诊断失败忽略 */
        }
      }
      diag("apply-called slots=" + Boolean(ctx && ctx.slots) + " inject=" + Boolean(ctx && ctx.slots && ctx.slots.inject));
      let t = function (key) {
        return key;
      };
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en: { tooltip: "Restart DSH", tooltipDisabled: "Session running; cannot restart", done: "Restart done", restartHint: "Double-click to restart" } }), NS + ": dict");
        t = ctx.locale.bind(NS);
      } catch (e) {
        /* 降级 */
      }
      const label = () => t("tooltip");

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
        try { if (typeof console !== "undefined" && console && typeof console.warn === "function") console.warn("[" + NS + "] inject fail: " + (e && e.message)); } catch (e2) {}
      }
    };

    return module.exports;
  },
});