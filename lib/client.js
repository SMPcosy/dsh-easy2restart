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
        wide ? [h("span", { key: "ic", style: { fontSize: 14 } }, "⟳"), h("span", { key: "tx", style: { fontSize: 12 } }, "重启 DSH")] : h("span", { style: { fontSize: 15 } }, "⟳"),
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