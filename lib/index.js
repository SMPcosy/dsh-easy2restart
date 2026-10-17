/**
 * dsh-plugin-easy2restart — 宿主端（Cordis 插件）
 *
 * 职责：
 *  1. 注册 HTTP 路由，供 Web 客户端调用：
 *       GET  /api/dsh-plugin-easy2restart/state    -> 当前「待处理重启完成」标记（客户端重启后读取）
 *       POST /api/dsh-plugin-easy2restart/restart  -> { sessionId, text } 记录标记并触发重启 DSH
 *       POST /api/dsh-plugin-easy2restart/clear    -> 清除标记
 *       GET  /api/dsh-plugin-easy2restart/health   -> 探针
 *  2. 重启：用 Windows 计划任务（schtasks）拉起脱离的 PowerShell 脚本，
 *     强杀 DSH 进程树后重新启动 DeepSeek Harness.exe。
 *
 * 关键约束：宿主插件运行在 Electron 的 Node worker 进程里，
 * process.ppid 是 Electron 主进程；完成后由计划任务（由 Task Scheduler 服务启动）
 * 负责杀进程树并重启，因此不受 DSH 自身退出影响。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

export const name = "dsh-plugin-easy2restart";
export const inject = ["webServer"];

const NS = "dsh-plugin-easy2restart";
const API_PREFIX = "/api/dsh-plugin-easy2restart";

/** 宿主加载诊断：每次启动模块加载/apply 都记一行，便于确认插件是否被 DSH 加载。 */
function bootMark(stage) {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const file = path.join(home, "storages", NS, "host-boot.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${stage}\n`, "utf8");
  } catch {
    /* 诊断失败不阻塞插件 */
  }
}

bootMark("module-imported");

/** 客户端诊断回写：Web 客户端把加载/注册状态 POST 到此，宿主记录到文件，便于无浏览器控制台时排查。 */
function diagWrite(msg) {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const file = path.join(home, "storages", NS, "diag.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {
    /* 忽略 */
  }
}

function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "storages", NS);
}

function pendingFile() {
  return path.join(defaultDataDir(), "pending.json");
}

function readPending() {
  try {
    const raw = fs.readFileSync(pendingFile(), "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj.sessionId === "string") return obj;
    return null;
  } catch {
    return null;
  }
}

function writePending(entry) {
  try {
    fs.mkdirSync(defaultDataDir(), { recursive: true });
    fs.writeFileSync(pendingFile(), JSON.stringify(entry, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function clearPending() {
  try {
    fs.rmSync(pendingFile(), { force: true });
  } catch {
    /* 清理失败不阻塞 */
  }
}

/**
 * 用 Windows 计划任务拉起一个立即运行的重启任务（由 Task Scheduler 服务启动，
 * 因而脱离 DSH 进程树）。随后 DSH 会随 taskkill /T 被强杀，脚本继续完成重启。
 */
function pluginRootDir() {
  // 本文件位于 <root>/lib/index.js，插件根目录为其上一级
  let dir = path.dirname(fileURLToPath(new URL(import.meta.url)));
  if (path.basename(dir) === "lib") dir = path.dirname(dir);
  return dir;
}

function scheduleRestart(mainPid, exePath) {
  try {
    const ps = path.join(pluginRootDir(), "restart", "restart.ps1");
    const exe = exePath && exePath.length > 0 ? exePath : process.execPath; // DeepSeek Harness.exe
    const mainId = typeof mainPid === "number" && mainPid > 0 ? mainPid : process.ppid;
    const taskName = "DSHRestartPlugin_" + Date.now();
    const action = `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps}" ${mainId} "${exe}"`;
    diagWrite("scheduleRestart: ps=" + ps + " exe=" + exe + " mainId=" + mainId + " ppid=" + process.ppid);
    diagWrite("action=" + action);
    // /ST 00:00 仅作占位，/Run 会立即触发，无视时间。
    execFile("schtasks", ["/Create", "/TN", taskName, "/TR", action, "/SC", "ONCE", "/ST", "00:00", "/F"], (err, stdout, stderr) => {
      diagWrite("schtasks /Create result: err=" + (err ? (err.message || err.code) : "nil") + " out=" + String(stdout).trim() + " errOut=" + String(stderr).trim());
      if (err) return;
      execFile("schtasks", ["/Run", "/TN", taskName], (err2, out2, errOut2) => {
        diagWrite("schtasks /Run result: err=" + (err2 ? (err2.message || err2.code) : "nil") + " out=" + String(out2).trim() + " errOut=" + String(errOut2).trim());
        try {
          execFile("schtasks", ["/Delete", "/TN", taskName, "/F"], (e3) => {
            if (e3) diagWrite("schtasks /Delete err=" + (e3.message || e3.code));
          });
        } catch {
          /* 任务删除非关键 */
        }
      });
    });
    return true;
  } catch (e) {
    diagWrite("scheduleRestart threw: " + (e && e.message ? e.message : String(e)));
    return false;
  }
}

/** 判断是否存在正在运行的 Agent 会话（live agent > 0 即认为有活动会话）。 */
function hasActiveAgentSessions(ctx) {
  try {
    const agents = ctx && typeof ctx.get === "function" ? ctx.get("agents") : undefined;
    if (agents && typeof agents.list === "function") {
      const rows = agents.list();
      return Array.isArray(rows) && rows.length > 0;
    }
  } catch {
    /* 取不到则视为可重启（返回 false） */
  }
  return false;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  try {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    /* 写响应失败忽略 */
  }
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (e) => reject(e));
  });
}

export function apply(ctx) {
  bootMark("apply-called");
  try {
    const cm = typeof ctx.get === "function" ? ctx.get("clientModules") : undefined;
    let pathRes = "(no clientModules)";
    if (cm && typeof cm.clientPath === "function") {
      pathRes = String(cm.clientPath(NS) ?? "(null)");
    }
    bootMark("clientPath=" + pathRes);
  } catch (e) {
    bootMark("clientModules check fail: " + (e && e.message ? e.message : String(e)));
  }
  const api = {
    readPending,
    writePending,
    clearPending,
    scheduleRestart,
    bootChannel: "apply",
  };

  ctx.effect(() => {
    if (!ctx.webServer || typeof ctx.webServer.register !== "function") return;
    const route = (p, handler) =>
      ctx.effect(
        () => ctx.webServer.register({ kind: "exact", path: `${API_PREFIX}${p}`, handler }),
        `${NS}: route ${p}`,
      );

    route("/health", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, name: NS });
    });

    route("/state", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, data: readPending() });
    });

    route("/active", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, active: hasActiveAgentSessions(ctx) });
    });

    route("/restart", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, code: "BAD_BODY" });
      }
      const sessionId = typeof payload?.sessionId === "string" && payload.sessionId.length > 0 ? payload.sessionId : null;
      const text = typeof payload?.text === "string" && payload.text.length > 0 ? payload.text : "重启完成";
      writePending({ sessionId, text, at: new Date().toISOString() });
      diagWrite("restart-request sessionId=" + sessionId);
      const scheduled = scheduleRestart(process.ppid, process.execPath);
      diagWrite("scheduleRestart returned " + scheduled);
      return sendJson(res, 200, { ok: true, scheduled });
    });

    route("/clear", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        await readBody(req);
      } catch {
        /* 忽略请求体 */
      }
      clearPending();
      return sendJson(res, 200, { ok: true });
    });

    route("/diag", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        payload = {};
      }
      const m = typeof payload?.msg === "string" ? payload.msg : JSON.stringify(payload);
      diagWrite("client: " + m);
      return sendJson(res, 200, { ok: true });
    });
  });
}

export const __internals = { scheduleRestart, readPending, writePending, clearPending, hasActiveAgentSessions };