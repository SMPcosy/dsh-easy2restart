/**
 * dsh-easy2restart — 宿主半侧（Cordis 插件）
 * ==================================================================
 * 由两个插件合并而来（0.2.0）：
 *   - dsh-plugin-easy2restart（重启 DSH）
 *   - dsh-plugin-safe-archive（安全归档确认 + 归档即备份 + 右侧栏「已归档会话」）
 *
 * 职责：
 *  A. 重启（原 easy2restart）
 *     用 Windows 计划任务（schtasks）拉起脱离 DSH 进程树的 PowerShell 脚本，
 *     强杀 DSH 进程树后重新启动 DeepSeek Harness.exe。
 *     关键约束：宿主插件运行在 Electron 的 Node worker 进程里，process.ppid 是
 *     Electron 主进程；重启任务由 Task Scheduler 服务启动，因此不受 DSH 自身退出影响。
 *
 *  B. 安全归档（原 safe-archive）
 *     包装 ctx.workspaceRegistry.archiveSession()：任意来源的归档成功后延迟 3 秒
 *     （等 stopActivity 的后台收尾落盘）执行一次备份，并把「已归档但还没备份」的
 *     会话在插件启动时补扫一次。备份落点沿用旧 watcher：
 *       F:\AI\会话归档备份\DSH\<会话名>-<归档日期-时间>\
 *     状态文件复用：_auto-backup-state.json（按 会话ID + SHA256 去重）。
 *
 *  C. 右侧栏「已归档会话」浏览（原 safe-archive）
 *     数据源固定为 <DSH_HOME>/sessions（归档会话文件真实位置），
 *     明确不连接备份目录（备份路径只作为界面提示，路径守卫会拒绝访问它）。
 *
 * HTTP 路由（统一前缀 /api/dsh-easy2restart）：
 *   GET  /health                探针
 *   GET  /state                 重启待办标记（客户端重启后读取）
 *   GET  /active                是否有 Agent 会话在运行
 *   POST /restart               { sessionId, text } 记录标记并触发重启
 *   POST /clear                 清除重启标记
 *   GET  /status                备份状态（已备份会话数）
 *   POST /scan                  手动补扫「已归档未备份」会话
 *   POST /diag                  客户端诊断回写
 *   GET  /archive/roots         归档会话清单 + 数据源路径
 *   GET  /archive/ls?path=      列举会话目录某一层
 *   POST /archive/open          { path } 在资源管理器中打开/定位
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";

export const name = "dsh-easy2restart";
export const inject = ["webServer"];

const NS = "dsh-easy2restart";
const API_PREFIX = "/api/dsh-easy2restart";

const DSH = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const STORAGE_DIR = path.join(DSH, "storages", NS);
const BOOT_FILE = path.join(STORAGE_DIR, "host-boot.log");
const DIAG_FILE = path.join(STORAGE_DIR, "diag.log");

/** 备份相关常量（与旧 watcher / safe-archive 兼容） */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SETTLE_MS = 3000;
const LOG_FILE = path.join(DSH, "archive-backup", "auto-backup.log");

/**
 * 备份根目录：默认值保持老机器行为不变；可在右侧栏「已归档会话」页里改，
 * 也可以用环境变量覆盖（优先级 env > config.json > 默认）。
 *   DSH_EASY2RESTART_BACKUP_DIR=D:\DSH备份   指定目录
 *   DSH_EASY2RESTART_BACKUP=off              关闭自动备份
 */
const DEFAULT_BACKUP_DIR = "F:\\AI\\会话归档备份\\DSH";
const CONFIG_FILE = path.join(STORAGE_DIR, "config.json");
const ENV_BACKUP = process.env.DSH_EASY2RESTART_BACKUP;
const ENV_BACKUP_DIR = process.env.DSH_EASY2RESTART_BACKUP_DIR;
const BACKUP_OFF_WORDS = new Set(["off", "0", "false", "no", "disable", "disabled", "none"]);

// ---------------- 诊断 ----------------
/** 宿主加载诊断：每次启动模块加载/apply 都记一行，便于确认插件是否被 DSH 加载。 */
function bootMark(stage) {
  try {
    fs.mkdirSync(path.dirname(BOOT_FILE), { recursive: true });
    fs.appendFileSync(BOOT_FILE, `${new Date().toISOString()} pid=${process.pid} ${stage}\n`, "utf8");
  } catch {
    /* 诊断失败不阻塞插件 */
  }
}
bootMark("module-imported");

/** 客户端/调度诊断回写：写入 storages/<NS>/diag.log。 */
function diagWrite(msg) {
  try {
    fs.mkdirSync(path.dirname(DIAG_FILE), { recursive: true });
    fs.appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {
    /* 忽略 */
  }
}

// ---------------- 基础工具 ----------------
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

function log(msg) {
  const line = `[${fmt()}] [${NS}] ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    /* 忽略 */
  }
  try {
    const s = backupSetting();
    if (s.enabled) fs.appendFileSync(path.join(s.dir, "_auto-backup.log"), line + "\n", "utf8");
  } catch {
    /* 备份目录不可写时只留在本地日志 */
  }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function atomicWrite(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ================= 备份设置（env > config.json > 默认） =================
/** 读取 config.json 里的 backup 段；返回 { enabled, dir, present, path } */
function readBackupConfig() {
  const j = readJson(CONFIG_FILE);
  const b = j && typeof j === "object" ? j.backup : null;
  const present = Boolean(b && typeof b === "object");
  const dir = present && typeof b.dir === "string" ? b.dir.trim() : "";
  const enabled = present && b.enabled === false ? false : true;
  return { enabled, dir, present, configPath: CONFIG_FILE };
}

/** 写回 config.json（保留其它字段，只改 backup 段） */
function writeBackupConfig(patch) {
  const current = readJson(CONFIG_FILE);
  const base = current && typeof current === "object" ? current : {};
  const prev = base.backup && typeof base.backup === "object" ? base.backup : {};
  const next = { ...prev };
  if (patch && typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (patch && typeof patch.dir === "string") next.dir = patch.dir;
  next.updatedAt = new Date().toISOString();
  const merged = { ...base, version: base.version || 1, backup: next };
  atomicWrite(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

/** 生效的备份设置：环境变量优先，其次配置文件，最后内置默认 */
function backupSetting() {
  const cfg = readBackupConfig();
  const envFlag = typeof ENV_BACKUP === "string" ? ENV_BACKUP.trim() : "";
  const envDir = typeof ENV_BACKUP_DIR === "string" ? ENV_BACKUP_DIR.trim() : "";
  if (envFlag) {
    return {
      enabled: !BACKUP_OFF_WORDS.has(envFlag.toLowerCase()),
      dir: cfg.dir || DEFAULT_BACKUP_DIR,
      source: "env",
      envKey: "DSH_EASY2RESTART_BACKUP",
      configPath: cfg.configPath,
      configDir: cfg.dir,
      configEnabled: cfg.enabled,
      defaultDir: DEFAULT_BACKUP_DIR,
    };
  }
  if (envDir) {
    return {
      enabled: true,
      dir: path.resolve(envDir),
      source: "env",
      envKey: "DSH_EASY2RESTART_BACKUP_DIR",
      configPath: cfg.configPath,
      configDir: cfg.dir,
      configEnabled: cfg.enabled,
      defaultDir: DEFAULT_BACKUP_DIR,
    };
  }
  return {
    enabled: cfg.present ? cfg.enabled : true,
    dir: cfg.dir || DEFAULT_BACKUP_DIR,
    source: cfg.present && cfg.dir ? "config" : cfg.present ? "config" : "default",
    envKey: null,
    configPath: cfg.configPath,
    configDir: cfg.dir,
    configEnabled: cfg.enabled,
    defaultDir: DEFAULT_BACKUP_DIR,
  };
}

/** 备份根目录下的各个派生文件（目录一变，这批路径跟着变） */
function backupPaths() {
  const s = backupSetting();
  return {
    ...s,
    flog: path.join(s.dir, "_auto-backup.log"),
    state: path.join(s.dir, "_auto-backup-state.json"),
    manualManifest: path.join(s.dir, "manifest.json"),
    autoManifest: path.join(s.dir, "_auto-backup-manifest.json"),
    md: path.join(s.dir, "归档清单.md"),
  };
}

/** 探测目录：不存在则建，建好后试写一个探针文件，判断真的能写 */
function probeBackupDir(dir) {
  const raw = typeof dir === "string" ? dir.trim() : "";
  if (!raw) return { ok: false, exists: false, writable: false, path: "", reason: "目录为空" };
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch (e) {
    return { ok: false, exists: false, writable: false, path: raw, reason: "路径无效：" + String(e && e.message) };
  }
  let exists = false;
  try {
    exists = fs.existsSync(resolved);
    if (!exists) {
      fs.mkdirSync(resolved, { recursive: true });
      exists = true;
    }
  } catch (e) {
    return {
      ok: false,
      exists: fs.existsSync(resolved),
      writable: false,
      path: resolved,
      reason: "无法创建目录：" + String((e && e.message) || e),
    };
  }
  try {
    const probe = path.join(resolved, ".dsh-easy2restart-write-probe");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch (e) {
    return {
      ok: false,
      exists: true,
      writable: false,
      path: resolved,
      reason: "目录不可写：" + String((e && e.message) || e),
    };
  }
  return { ok: true, exists: true, writable: true, path: resolved, reason: "" };
}

/** 当前备份状态快照（给右侧栏设置区用，不写盘、不做重活） */
function backupSnapshot() {
  const s = backupPaths();
  let exists = false;
  let writable = false;
  try {
    exists = fs.existsSync(s.dir);
    if (exists) fs.accessSync(s.dir, fs.constants.W_OK);
    writable = exists;
  } catch {
    writable = false;
  }
  let backedUp = 0;
  try {
    const st = loadState();
    backedUp = Object.keys(st.sessions || {}).length;
  } catch {
    backedUp = 0;
  }
  return {
    enabled: s.enabled,
    dir: s.dir,
    source: s.source,
    envKey: s.envKey,
    defaultDir: s.defaultDir,
    configPath: s.configPath,
    configDir: s.configDir,
    configEnabled: s.configEnabled,
    exists,
    writable,
    backedUp,
    envOverride: s.source === "env",
  };
}

/** 在 Windows 上弹一个「选择文件夹」对话框；取消或超时返回空串 */
function pickBackupDirectory(initial) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve("");
      return;
    }
    const start = initial && initial.trim() ? initial.trim() : DEFAULT_BACKUP_DIR;
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = '选择 DSH 归档备份根目录'",
      "$d.ShowNewFolderButton = $true",
      `if (Test-Path -LiteralPath '${start.replace(/'/g, "''")}') { $d.SelectedPath = '${start.replace(/'/g, "''")}' }`,
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    ].join("; ");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 5 * 60 * 1000, windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          diagWrite("pickBackupDirectory failed: " + String((err && err.message) || err));
          resolve("");
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });
}

/** 解压 DSH 会话文件（多帧 zstd 串联）为 Buffer；坏帧跳过。 */
function decompressAll(buf) {
  const idx = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(MAGIC, from);
    if (i < 0) break;
    idx.push(i);
    from = i + 4;
  }
  const parts = [];
  for (let k = 0; k < idx.length; k++) {
    const start = idx[k];
    const end = k + 1 < idx.length ? idx[k + 1] : buf.length;
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)));
    } catch {
      /* 坏帧跳过 */
    }
  }
  return Buffer.concat(parts);
}

/** 解压会话文件为 JSONL 文本；失败返回空串。 */
function decompressSessionFile(filePath) {
  try {
    return decompressAll(fs.readFileSync(filePath)).toString("utf8");
  } catch {
    return "";
  }
}

function sanitizeTitle(t) {
  if (!t) return "未命名会话";
  let s = String(t)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!s) s = "未命名会话";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) s = "_" + s;
  if ([...s].length > 60) s = [...s].slice(0, 60).join("").trim();
  return s;
}
const normId = (id) => String(id).replace(/^session-/, "");

// ================= A. 重启：待办标记 + 计划任务调度 =================
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

/** 本文件位于 <root>/lib/index.js，插件根目录为其上一级 */
function pluginRootDir() {
  let dir = path.dirname(fileURLToPath(new URL(import.meta.url)));
  if (path.basename(dir) === "lib") dir = path.dirname(dir);
  return dir;
}

/**
 * 用 Windows 计划任务拉起一个立即运行的重启任务（由 Task Scheduler 服务启动，
 * 因而脱离 DSH 进程树）。随后 DSH 会随 taskkill /T 被强杀，脚本继续完成重启。
 */
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
      diagWrite(
        "schtasks /Create result: err=" +
          (err ? err.message || err.code : "nil") +
          " out=" +
          String(stdout).trim() +
          " errOut=" +
          String(stderr).trim(),
      );
      if (err) return;
      execFile("schtasks", ["/Run", "/TN", taskName], (err2, out2, errOut2) => {
        diagWrite(
          "schtasks /Run result: err=" +
            (err2 ? err2.message || err2.code : "nil") +
            " out=" +
            String(out2).trim() +
            " errOut=" +
            String(errOut2).trim(),
        );
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

/** 判断是否存在正在运行的 Agent 会话（agents 服务能列出条目即认为有会话）。 */
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

// ================= B. 备份引擎（与旧 watcher 兼容） =================
function loadState() {
  const paths = backupPaths();
  let st = readJson(paths.state);
  if (!st || typeof st !== "object" || !st.sessions) {
    st = { version: 1, createdAt: fmt(), updatedAt: fmt(), sessions: {} };
    const m = readJson(paths.manualManifest);
    if (m && Array.isArray(m.sessions)) {
      for (const s of m.sessions) {
        if (!s.archivedSessionId) continue;
        st.sessions[s.archivedSessionId] = {
          sha: s.sha256,
          folderName: s.folderName,
          title: s.title,
          workspaceEscapedDir: s.workspaceEscapedDir,
          sessionDirName: s.sessionDirName,
          firstBackedUpAt: m.backupTime || fmt(),
          lastBackedUpAt: m.backupTime || fmt(),
          lastBackedUpAtMs: Date.now(),
          versions: [{ sha: s.sha256, at: m.backupTime || fmt(), kind: "manifest-seed" }],
        };
      }
      log(`状态文件不存在，已从 manifest.json 初始化 ${Object.keys(st.sessions).length} 个已备份会话`);
    }
    try {
      atomicWrite(paths.state, JSON.stringify(st, null, 2));
    } catch {
      /* 目录不可写时状态只存在于内存与日志 */
    }
  }
  return st;
}
function saveState(st) {
  st.updatedAt = fmt();
  atomicWrite(backupPaths().state, JSON.stringify(st, null, 2));
}
function buildSessionIndex() {
  const map = new Map();
  const root = path.join(DSH, "sessions");
  if (!fs.existsSync(root)) return map;
  for (const w of fs.readdirSync(root, { withFileTypes: true })) {
    if (!w.isDirectory()) continue;
    const wdir = path.join(root, w.name);
    for (const s of fs.readdirSync(wdir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      map.set(normId(s.name), { workspaceDir: w.name, dirName: s.name, folder: path.join(wdir, s.name) });
    }
  }
  return map;
}
function readTitle(dirName) {
  const p = path.join(DSH, "storages", "session_projcache", "sessions", dirName + ".json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      title: j.record?.rows?.title?.val ?? null,
      input: j.record?.rows?.titleInput?.val?.first?.text ?? null,
      projFile: p,
    };
  } catch {
    return { title: null, input: null, projFile: null };
  }
}
function buildObjectIndex() {
  const map = new Map();
  const root = path.join(DSH, "attachments", "v1", "objects");
  if (!fs.existsSync(root)) return map;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const sub = path.join(root, d.name);
    for (const f of fs.readdirSync(sub, { withFileTypes: true })) if (f.isFile()) map.set(f.name, path.join(sub, f.name));
  }
  return map;
}
function collectAttachments(obj, map) {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectAttachments(v, map);
    return;
  }
  const aid = obj.attachmentId;
  if (typeof aid === "string") {
    const m = /^sha256:([0-9a-f]{64})$/.exec(aid);
    if (m) {
      const prev = map.get(m[1]);
      map.set(m[1], {
        hash: m[1],
        bytes: typeof obj.bytes === "number" ? obj.bytes : prev?.bytes ?? null,
        mediaType: typeof obj.mediaType === "string" ? obj.mediaType : prev?.mediaType ?? null,
        width: typeof obj.width === "number" ? obj.width : prev?.width ?? null,
        height: typeof obj.height === "number" ? obj.height : prev?.height ?? null,
      });
    }
  }
  for (const k of Object.keys(obj)) collectAttachments(obj[k], map);
}
function pickFolderName(st, title, id) {
  const used = new Set();
  const backupDir = backupSetting().dir;
  try {
    for (const d of fs.readdirSync(backupDir, { withFileTypes: true })) if (d.isDirectory()) used.add(d.name);
  } catch {
    /* 备份根目录不存在时从空集合开始 */
  }
  for (const e of Object.values(st.sessions)) if (e.folderName) used.add(e.folderName);
  const s = stamp();
  let n = `${sanitizeTitle(title)}-${s}`;
  if (used.has(n)) n += `-${normId(id).slice(0, 8)}`;
  let i = 2;
  while (used.has(n)) n = `${sanitizeTitle(title)}-${s}-${normId(id).slice(0, 8)}-${i++}`;
  return n;
}
function appendMdRow(row) {
  const header =
    "## 自动备份追加记录（监听 workspace.json 归档标记）\n\n| 时间 | 类型 | 会话名 | 备份文件夹 | 会话文件 | 附件 |\n|---|---|---|---|---|---|\n";
  const mdFile = backupPaths().md;
  let txt = "";
  try {
    txt = fs.readFileSync(mdFile, "utf8");
  } catch {
    txt = "# DSH 归档会话备份清单\n";
  }
  if (!txt.includes("## 自动备份追加记录")) txt = txt.replace(/\s*$/, "\n\n") + header;
  atomicWrite(mdFile, txt.replace(/\s*$/, "\n") + row + "\n");
}
function appendAutoManifest(entry) {
  const autoManifest = backupPaths().autoManifest;
  const m = readJson(autoManifest) || { version: 1, createdAt: fmt(), entries: [] };
  m.updatedAt = fmt();
  m.entries.push(entry);
  if (m.entries.length > 500) m.entries = m.entries.slice(-500);
  atomicWrite(autoManifest, JSON.stringify(m, null, 2));
}

/** 备份一个已归档会话；返回 {action:'archive'|'refresh'|'skip'} 或抛错 */
function backupArchivedSession(sessionId, reason) {
  const setting = backupSetting();
  if (!setting.enabled) return { action: "skip", why: "disabled" };
  const ws = JSON.parse(fs.readFileSync(path.join(DSH, "storages", "workspace.json"), "utf8"));
  const archived = Array.isArray(ws?.global?.archivedSessionIds) ? ws.global.archivedSessionIds : [];
  if (!archived.includes(sessionId)) return { action: "skip", why: "not-archived" };
  const idx = buildSessionIndex().get(normId(sessionId));
  if (!idx) return { action: "skip", why: "folder-missing" };
  const file = path.join(idx.folder, "session.v4.jsonl.zstd");
  if (!fs.existsSync(file)) return { action: "skip", why: "file-missing" };
  const st = fs.statSync(file);
  if (Date.now() - st.mtimeMs < SETTLE_MS) {
    // 归档后台收尾还没写完：稍后再来
    return { action: "skip", why: "settling" };
  }
  const buf = fs.readFileSync(file);
  const srcSha = sha256(buf);
  const state = loadState();
  const entry = state.sessions[sessionId];
  if (entry && entry.sha === srcSha) return { action: "skip", why: "unchanged" };

  const text = decompressAll(buf).toString("utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  let bad = 0;
  let lastTs = null;
  let header = null;
  const attMap = new Map();
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    if (o.type === "session") header = o;
    const t = o.time ?? o.at;
    if (typeof t === "number" && (lastTs === null || t > lastTs)) lastTs = t;
    collectAttachments(o, attMap);
  }
  const t = readTitle(idx.dirName);
  const title = t.title ?? (t.input ? t.input.replace(/\s+/g, " ").slice(0, 40) : null) ?? idx.dirName;
  const mode = entry ? "refresh" : "archive";
  const folderName = mode === "refresh" && entry.folderName ? entry.folderName : pickFolderName(state, title, sessionId);
  const outDir = path.join(setting.dir, folderName);
  ensureDir(outDir);

  const dstFile = path.join(outDir, "session.v4.jsonl.zstd");
  fs.writeFileSync(dstFile + ".tmp", buf);
  fs.renameSync(dstFile + ".tmp", dstFile);
  if (sha256(fs.readFileSync(dstFile)) !== srcSha) throw new Error("会话文件写入校验失败");

  // 附件
  const attDir = path.join(outDir, "attachments");
  const objIndex = buildObjectIndex();
  const attInfo = [];
  for (const [hash, meta] of [...attMap.entries()].sort()) {
    const rec = { ...meta, id: "sha256:" + hash, available: false, copied: false };
    const srcObj = objIndex.get(hash);
    if (srcObj) {
      ensureDir(attDir);
      const dst = path.join(attDir, hash);
      let need = true;
      try {
        need = sha256(fs.readFileSync(dst)) !== hash;
      } catch {
        /* 目标不存在则复制 */
      }
      if (need) fs.copyFileSync(srcObj, dst);
      if (sha256(fs.readFileSync(dst)) !== hash) throw new Error("附件校验失败: " + hash);
      rec.copied = true;
      rec.available = true;
      rec.bytes = fs.statSync(dst).size;
    }
    attInfo.push(rec);
  }
  try {
    if (fs.existsSync(attDir)) {
      const refs = new Set([...attMap.keys()]);
      for (const f of fs.readdirSync(attDir)) if (!refs.has(f)) fs.rmSync(path.join(attDir, f));
      if (fs.readdirSync(attDir).length === 0) fs.rmdirSync(attDir);
    }
  } catch {
    /* 附件清理非关键 */
  }

  let projCopied = false;
  if (t.projFile) {
    try {
      ensureDir(path.join(outDir, "metadata"));
      fs.copyFileSync(t.projFile, path.join(outDir, "metadata", "session-projection-cache.json"));
      projCopied = true;
    } catch {
      /* 投影缓存复制失败不影响主体备份 */
    }
  }

  const now = fmt();
  const info = {
    backupFormat: "dsh-session-archive/v1",
    backupKind: mode,
    backupTime: now,
    trigger: reason,
    folderName,
    archivedSessionId: sessionId,
    sessionDirName: idx.dirName,
    sessionTitle: title,
    sessionTitleInputFirst: t.input,
    workspaceEscapedDir: idx.workspaceDir,
    workspaceCwd: header?.cwd ?? null,
    originalSessionFile: file,
    createdAt: header?.createdAt ? fmt(new Date(header.createdAt)) : null,
    lastActivityAt: lastTs ? fmt(new Date(lastTs)) : null,
    sessionFile: {
      name: "session.v4.jsonl.zstd",
      bytes: buf.length,
      sha256: srcSha,
      decompressedBytes: Buffer.byteLength(text),
      decompressedSha256: sha256(Buffer.from(text, "utf8")),
      lines: lines.length,
      jsonParseErrors: bad,
      partial: bad > 0,
    },
    attachments: attInfo,
    projectionCacheIncluded: projCopied,
    restoreHint:
      "把 session.v4.jsonl.zstd 放回 ~/.dsh/sessions/<workspaceEscapedDir>/<sessionDirName>/ 即可；附件放回 ~/.dsh/attachments/v1/objects/<sha前两位>/<sha>；若会话已从 workspace.json 的 sessionIds 删除，需把 archivedSessionId 加回。",
  };
  atomicWrite(path.join(outDir, "session-info.json"), JSON.stringify(info, null, 2));
  atomicWrite(
    path.join(outDir, "session.sha256.txt"),
    `${srcSha}  session.v4.jsonl.zstd\n${info.sessionFile.decompressedSha256}  decompressed-jsonl\n`,
  );

  const prevVersions = entry?.versions ?? [];
  state.sessions[sessionId] = {
    sha: srcSha,
    folderName,
    title,
    workspaceEscapedDir: idx.workspaceDir,
    sessionDirName: idx.dirName,
    firstBackedUpAt: entry?.firstBackedUpAt ?? now,
    lastBackedUpAt: now,
    lastBackedUpAtMs: Date.now(),
    versions: [...prevVersions, { sha: srcSha, at: now, kind: mode }].slice(-30),
  };
  saveState(state);

  appendMdRow(
    `| ${now} | ${mode === "archive" ? "归档备份" : "内容更新"} | ${title} | \`${folderName}\` | ${(buf.length / 1024).toFixed(0)} KB | ${attInfo.length}${
      attInfo.some((a) => !a.available) ? `（缺 ${attInfo.filter((a) => !a.available).length}）` : ""
    } |`,
  );
  appendAutoManifest({
    at: now,
    kind: mode,
    trigger: reason,
    folderName,
    archivedSessionId: sessionId,
    title,
    workspaceEscapedDir: idx.workspaceDir,
    bytes: buf.length,
    sha256: srcSha,
    lines: lines.length,
    jsonParseErrors: bad,
    attachments: attInfo.length,
    attachmentsMissing: attInfo.filter((a) => !a.available).map((a) => a.id),
  });
  log(
    `${mode === "archive" ? "已备份归档会话" : "已更新已备份会话"} [${title}] -> ${folderName} (${(buf.length / 1024).toFixed(0)} KB, 附件 ${attInfo.length}, trigger=${reason})`,
  );
  return { action: mode, folderName, title, bytes: buf.length, attachments: attInfo.length };
}

// ---------------- 事件驱动调度 ----------------
const pendingTimers = new Map();
const inFlight = new Set();

function scheduleBackup(sessionId, reason) {
  if (!sessionId) return;
  if (!backupSetting().enabled) return;
  if (pendingTimers.has(sessionId)) return;
  const timer = setTimeout(async () => {
    pendingTimers.delete(sessionId);
    if (inFlight.has(sessionId)) return;
    inFlight.add(sessionId);
    try {
      const r = await backupArchivedSession(sessionId, reason);
      if (r.action === "skip" && r.why === "settling") {
        // 再等 2 秒补一次
        setTimeout(() => {
          inFlight.delete(sessionId);
          scheduleBackup(sessionId, reason + "+retry");
        }, 2000);
        return;
      }
    } catch (e) {
      log(`备份失败 [${sessionId}]: ${e && e.message ? e.message : String(e)}`);
    } finally {
      inFlight.delete(sessionId);
    }
  }, SETTLE_MS + 200);
  pendingTimers.set(sessionId, timer);
}

async function catchUp(reason) {
  if (!backupSetting().enabled) {
    log("自动备份已关闭（DSH_EASY2RESTART_BACKUP / config.json），跳过补扫: " + reason);
    return 0;
  }
  const ws = JSON.parse(fs.readFileSync(path.join(DSH, "storages", "workspace.json"), "utf8"));
  const archived = Array.isArray(ws?.global?.archivedSessionIds) ? ws.global.archivedSessionIds : [];
  const state = loadState();
  const idx = buildSessionIndex();
  let count = 0;
  for (const id of archived) {
    const hit = idx.get(normId(id));
    if (!hit) continue;
    const file = path.join(hit.folder, "session.v4.jsonl.zstd");
    if (!fs.existsSync(file)) continue;
    const entry = state.sessions[id];
    let sha;
    try {
      sha = sha256(fs.readFileSync(file));
    } catch {
      continue;
    }
    if (entry && entry.sha === sha) continue;
    try {
      const r = await backupArchivedSession(id, reason);
      if (r.action !== "skip") count++;
    } catch (e) {
      log(`补备份失败 [${id}]: ${e.message}`);
    }
  }
  log(`补扫完成: 归档会话=${archived.length}, 本次处理=${count}`);
  return count;
}

// ================= C. 右侧栏「已归档会话」：归档会话文件夹浏览 =================
// 数据源固定为 DSH 会话目录 `<DSH_HOME>/sessions`（归档会话文件真实位置）；
// 明确不连接备份目录 TARGET（备份路径只作为界面提示，不参与浏览）。
const ARCHIVE_SESSIONS_ROOT = path.join(DSH, "sessions");
const ARCHIVE_WORKSPACE_FILE = path.join(DSH, "storages", "workspace.json");
const ARCHIVE_PROJCACHE_DIR = path.join(DSH, "storages", "session_projcache", "sessions");

/** 读取 workspace.json 里的已归档会话 ID（GUI「已归档」区的唯一数据源） */
function readArchivedSessionIds() {
  try {
    const data = JSON.parse(fs.readFileSync(ARCHIVE_WORKSPACE_FILE, "utf8"));
    const ids = data && data.global && data.global.archivedSessionIds;
    return Array.isArray(ids) ? ids.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

/** 从会话投影缓存里取会话标题（取不到的返回空串） */
function readCachedSessionTitle(id) {
  try {
    const bare = String(id).replace(/^session-/, "");
    const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_PROJCACHE_DIR, bare + ".json"), "utf8"));
    const title = data && data.record && data.record.rows && data.record.rows.title && data.record.rows.title.val;
    return typeof title === "string" ? title : "";
  } catch {
    return "";
  }
}

/**
 * 标题兜底：没有投影缓存的老会话直接从会话文件里读 `session/title` 事件；
 * 再取不到就用首条用户消息截断，避免列表里大半显示 UUID。
 */
function readTitleFromSessionFile(sessionDir) {
  const text = decompressSessionFile(path.join(sessionDir, "session.v4.jsonl.zstd"));
  if (!text) return "";
  let firstUser = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.includes('"type":"session/title"')) {
      try {
        const event = JSON.parse(line);
        const title = event && event.data && event.data.title;
        if (typeof title === "string" && title.trim()) return title.trim();
      } catch {
        /* 坏行跳过 */
      }
    } else if (!firstUser && line.includes('"type":"user/message"')) {
      try {
        const event = JSON.parse(line);
        const content = event && event.data && event.data.content;
        if (!Array.isArray(content)) continue;
        const textPart = content
          .filter((block) => block && block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (textPart) firstUser = textPart.slice(0, 40);
      } catch {
        /* 坏行跳过 */
      }
    }
  }
  return firstUser;
}

/** 会话标题：投影缓存优先，老会话回读会话文件 */
function sessionTitleOf(id, sessionDir) {
  const cached = readCachedSessionTitle(id);
  if (cached) return cached;
  if (sessionDir) {
    const fromFile = readTitleFromSessionFile(sessionDir);
    if (fromFile) return fromFile;
  }
  return "";
}

/** 在 <DSH_HOME>/sessions/<工作区目录>/ 下找会话目录（目录名可能带或不带 session- 前缀） */
function findSessionDirectory(id) {
  const bare = String(id).replace(/^session-/, "");
  const names = [String(id), bare, "session-" + bare];
  try {
    for (const workspaceDir of fs.readdirSync(ARCHIVE_SESSIONS_ROOT, { withFileTypes: true })) {
      if (!workspaceDir.isDirectory()) continue;
      for (const name of names) {
        const candidate = path.join(ARCHIVE_SESSIONS_ROOT, workspaceDir.name, name);
        try {
          if (fs.statSync(candidate).isDirectory()) return candidate;
        } catch {
          /* 不存在则试下一个名字 */
        }
      }
    }
  } catch {
    /* 会话根目录不可读 */
  }
  return "";
}

function statSummary(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    return { sizeBytes: stat.isDirectory() ? 0 : stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { sizeBytes: 0, mtimeMs: 0 };
  }
}

/** 路径守卫：只放行 <DSH_HOME>/sessions 之下的路径（含根本身） */
function resolveArchivePath(targetPath) {
  const root = path.resolve(ARCHIVE_SESSIONS_ROOT);
  const raw = String(targetPath || "").trim();
  const resolved = raw ? path.resolve(raw) : root;
  const rel = path.relative(root, resolved);
  const escapes = rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
  if (escapes) {
    const err = new Error("只允许浏览 DSH 会话目录（归档会话数据源）：" + resolved);
    err.code = "OUT_OF_SCOPE";
    throw err;
  }
  return resolved;
}

/** 列出一层目录（前端「已归档会话」页懒加载用） */
function listArchiveDirectory(targetPath) {
  const dir = resolveArchivePath(targetPath);
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    const err = new Error("目录不存在：" + dir);
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!stat.isDirectory()) throw new Error("不是目录：" + dir);
  const MAX_ENTRIES = 500;
  let dirents = [];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    const err = new Error("读取目录失败：" + String((e && e.message) || e));
    err.code = "READ_FAILED";
    throw err;
  }
  const truncated = dirents.length > MAX_ENTRIES;
  if (truncated) dirents = dirents.slice(0, MAX_ENTRIES);
  const entries = dirents.map((dirent) => {
    const summary = statSummary(path.join(dir, dirent.name));
    return {
      name: dirent.name,
      kind: dirent.isDirectory() ? "directory" : "file",
      sizeBytes: summary.sizeBytes,
      mtimeMs: summary.mtimeMs,
    };
  });
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return { path: dir, root: path.resolve(ARCHIVE_SESSIONS_ROOT), entries, truncated };
}

/** 「已归档会话」页根数据：归档会话清单 + 数据源路径 + 未连接备份的说明 */
function archiveRootsSnapshot() {
  const ids = readArchivedSessionIds();
  const archived = [];
  for (const id of ids) {
    const dir = findSessionDirectory(id);
    if (!dir) continue;
    let sizeBytes = 0;
    try {
      for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!dirent.isFile()) continue;
        try {
          sizeBytes += fs.statSync(path.join(dir, dirent.name)).size;
        } catch {
          /* 单个文件读取失败不阻塞 */
        }
      }
    } catch {
      /* 目录不可读则大小计 0 */
    }
    const summary = statSummary(dir);
    archived.push({
      id,
      title: sessionTitleOf(id, dir) || id,
      dir,
      workspace: path.basename(path.dirname(dir)),
      sizeBytes,
      mtimeMs: summary.mtimeMs,
    });
  }
  archived.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const backup = backupSnapshot();
  return {
    sessionsRoot: path.resolve(ARCHIVE_SESSIONS_ROOT),
    backupRoot: backup.dir,
    backupConnected: false,
    backupEnabled: backup.enabled,
    backupSource: backup.source,
    backupWritable: backup.writable,
    backupExists: backup.exists,
    backupDefaultDir: backup.defaultDir,
    backupEnvKey: backup.envKey,
    backupConfigPath: backup.configPath,
    backupConfiguredDir: backup.configDir,
    backedUpCount: backup.backedUp,
    archivedCount: archived.length,
    archivedSessionTotal: ids.length,
    archived,
  };
}

/** 在系统资源管理器中打开归档会话目录（或定位文件）；路径守卫同浏览接口 */
function openPathInExplorer(targetPath) {
  const resolved = resolveArchivePath(targetPath);
  if (!fs.existsSync(resolved)) throw new Error("路径不存在：" + resolved);
  const isDir = fs.statSync(resolved).isDirectory();
  const child = spawn("explorer.exe", isDir ? [resolved] : ["/select,", resolved], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  log("explorer opened: " + resolved + (isDir ? " (dir)" : " (select file)"));
  return { ok: true, opened: resolved, kind: isDir ? "directory" : "file" };
}

// ================= HTTP 工具 =================
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

// ================= 归档入口接管 =================
/** 包装宿主归档入口：任何来源的归档成功 → 立即安排备份 */
function wrapArchiveRegistry(ctx) {
  try {
    const wrap = (attempt = 0) => {
      const reg = typeof ctx.get === "function" ? ctx.get("workspaceRegistry") : undefined;
      if (reg && typeof reg.archiveSession === "function" && !reg.__easy2restartWrapped) {
        const original = reg.archiveSession.bind(reg);
        reg.archiveSession = async function easy2restartArchive(sessionId, options) {
          const result = await original(sessionId, options);
          bootMark("archive-event " + sessionId);
          scheduleBackup(sessionId, "archive-event");
          return result;
        };
        reg.__easy2restartWrapped = original;
        bootMark("workspaceRegistry wrapped");
        log("已接管 workspaceRegistry.archiveSession（归档成功即备份）");
      } else if (attempt < 30) {
        setTimeout(() => wrap(attempt + 1), 1000);
      } else {
        bootMark("workspaceRegistry service not found");
        log("警告: 未找到 workspaceRegistry 服务，归档事件驱动不可用");
      }
    };
    wrap();
  } catch (e) {
    bootMark("wrap failed: " + (e && e.message));
  }
}

// ================= 插件入口 =================
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

  // 归档事件驱动 + 启动补扫（插件加载前可能已有归档未备份）
  wrapArchiveRegistry(ctx);
  setTimeout(() => {
    catchUp("plugin-startup").catch((e) => log("启动补扫失败: " + e.message));
  }, 5000);

  ctx.effect(() => {
    if (!ctx.webServer || typeof ctx.webServer.register !== "function") return;
    const route = (p, handler) =>
      ctx.effect(
        () => ctx.webServer.register({ kind: "exact", path: `${API_PREFIX}${p}`, handler }),
        `${NS}: route ${p}`,
      );

    // ---------------- 重启 ----------------
    route("/health", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, name: NS, wrapped: true });
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

    // ---------------- 诊断 ----------------
    route("/diag", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        payload = {};
      }
      const msg = typeof payload?.msg === "string" ? payload.msg : JSON.stringify(payload);
      bootMark("client: " + String(msg).slice(0, 500));
      diagWrite("client: " + msg);
      return sendJson(res, 200, { ok: true });
    });

    // ---------------- 备份 ----------------
    route("/status", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        const st = loadState();
        return sendJson(res, 200, { ok: true, backedUp: Object.keys(st.sessions).length, updatedAt: st.updatedAt });
      } catch (e) {
        return sendJson(res, 500, { ok: false, code: "STATUS_FAILED", message: String((e && e.message) || e) });
      }
    });

    route("/scan", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        const count = await catchUp("manual-scan");
        return sendJson(res, 200, { ok: true, count });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e && e.message });
      }
    });

    // ---------------- 备份设置（右侧栏「已归档会话」页里可改） ----------------
    route("/backup", async (req, res) => {
      if (req.method === "GET") {
        try {
          return sendJson(res, 200, { ok: true, data: backupSnapshot() });
        } catch (e) {
          return sendJson(res, 500, { ok: false, code: "BACKUP_SNAPSHOT_FAILED", message: String((e && e.message) || e) });
        }
      }
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, code: "BAD_BODY" });
      }
      const hasEnabled = typeof payload?.enabled === "boolean";
      const hasDir = typeof payload?.dir === "string";
      if (!hasEnabled && !hasDir) {
        return sendJson(res, 400, { ok: false, code: "NOTHING_TO_SAVE", message: "需要 enabled 或 dir 字段" });
      }
      const patch = {};
      if (hasEnabled) patch.enabled = payload.enabled;
      if (hasDir) {
        const dir = payload.dir.trim();
        // 留空 = 回到内置默认；否则先探测（不存在会自动创建），写不进去就不落盘。
        if (dir) {
          const probe = probeBackupDir(dir);
          if (!probe.ok) {
            return sendJson(res, 400, {
              ok: false,
              code: "BACKUP_DIR_UNWRITABLE",
              message: probe.reason || "目录不可写",
              data: probe,
            });
          }
          patch.dir = probe.path;
        } else {
          patch.dir = "";
        }
      }
      try {
        writeBackupConfig(patch);
      } catch (e) {
        return sendJson(res, 500, { ok: false, code: "CONFIG_WRITE_FAILED", message: String((e && e.message) || e) });
      }
      const snap = backupSnapshot();
      log(
        "备份设置已更新: enabled=" +
          String(snap.enabled) +
          " dir=" +
          snap.dir +
          " source=" +
          snap.source +
          (hasDir ? " (目录已探测可写)" : ""),
      );
      return sendJson(res, 200, { ok: true, data: snap });
    });

    route("/backup/pick", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload = {};
      try {
        payload = await readBody(req);
      } catch {
        payload = {};
      }
      const current = typeof payload?.current === "string" && payload.current ? payload.current : backupSetting().dir;
      const picked = await pickBackupDirectory(current);
      if (!picked) return sendJson(res, 200, { ok: true, data: { cancelled: true, dir: "" } });
      const probe = probeBackupDir(picked);
      return sendJson(res, 200, {
        ok: true,
        data: { cancelled: false, dir: probe.path || picked, probe },
      });
    });

    // ---------------- 右侧栏「已归档会话」 ----------------
    route("/archive/roots", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        return sendJson(res, 200, { ok: true, data: archiveRootsSnapshot() });
      } catch (e) {
        return sendJson(res, 500, {
          ok: false,
          code: "ARCHIVE_ROOTS_FAILED",
          message: String((e && e.message) || e),
        });
      }
    });

    route("/archive/ls", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        const url = new URL(req.url || "", "http://localhost");
        return sendJson(res, 200, { ok: true, data: listArchiveDirectory(url.searchParams.get("path") || "") });
      } catch (e) {
        const status = e && e.code === "OUT_OF_SCOPE" ? 403 : 500;
        return sendJson(res, status, {
          ok: false,
          code: (e && e.code) || "ARCHIVE_LIST_FAILED",
          message: String((e && e.message) || e),
        });
      }
    });

    route("/archive/open", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      try {
        const payload = await readBody(req);
        return sendJson(res, 200, { ok: true, data: openPathInExplorer(payload && payload.path) });
      } catch (e) {
        const status = e && e.code === "OUT_OF_SCOPE" ? 403 : 500;
        return sendJson(res, status, {
          ok: false,
          code: (e && e.code) || "OPEN_FAILED",
          message: String((e && e.message) || e),
        });
      }
    });
  });
}

/**
 * 内部导出：供离线自检 / 诊断脚本直接验证宿主半侧，
 * 不参与插件运行（apply 才是入口）。
 */
export const __internals = {
  // 重启
  scheduleRestart,
  readPending,
  writePending,
  clearPending,
  hasActiveAgentSessions,
  // 备份
  loadState,
  buildSessionIndex,
  backupArchivedSession,
  scheduleBackup,
  catchUp,
  // 备份设置
  DEFAULT_BACKUP_DIR,
  backupSetting,
  backupPaths,
  backupSnapshot,
  readBackupConfig,
  writeBackupConfig,
  probeBackupDir,
  pickBackupDirectory,
  // 已归档会话浏览
  archiveRootsSnapshot,
  listArchiveDirectory,
  resolveArchivePath,
  openPathInExplorer,
};

/** 兼容旧名（safe-archive 的自检脚本按这个名字取） */
export const __archiveInternals = {
  archiveRootsSnapshot,
  listArchiveDirectory,
  resolveArchivePath,
  openPathInExplorer,
};
