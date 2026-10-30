/**
 * 离线自检：dsh-easy2restart（重启 + 安全归档 + 自动备份设置，0.2.1）
 *  1) 宿主端：路由注册、重启待办往返、归档浏览契约、路径守卫、归档入口包装、备份设置优先级与探测
 *  2) 客户端：重启按钮插槽、归档确认框插槽、右侧栏 tab 类型/别名/正文插槽、归档入口接管、视觉令牌
 *
 * 不启动 DSH、不触发重启、不弹系统对话框、不写业务数据。
 * 会动的宿主状态只有三个，全部先备份后还原：
 *   pending.json、storages/dsh-easy2restart/config.json、临时目录探针。
 *
 * 用法（插件目录执行）：node test/plugin.selftest.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const SESSIONS = path.join(HOME, "sessions");
const NS = "dsh-easy2restart";
const API = "/api/dsh-easy2restart";
const STORAGE = path.join(HOME, "storages", NS);
const CONFIG_FILE = path.join(STORAGE, "config.json");
const DEFAULT_BACKUP_DIR = "F:\\AI\\会话归档备份\\DSH";

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? "" : String(detail) });
  console.log((cond ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : "  [" + detail + "]"));
}

/* ================================ 宿主端 ================================ */
const host = await import(pathToFileURL(path.join(PLUGIN, "lib/index.js")).href);
check("宿主模块可导入", typeof host.apply === "function");
check("宿主导出名 = dsh-easy2restart", host.name === NS, host.name);
check("宿主注入 webServer", Array.isArray(host.inject) && host.inject.includes("webServer"), (host.inject || []).join(","));
check("保留 __internals 自检出口", !!host.__internals && typeof host.__internals.readPending === "function");
check("保留 __archiveInternals 旧名出口", !!host.__archiveInternals && typeof host.__archiveInternals.archiveRootsSnapshot === "function");

// 归档入口包装：给一个假的 workspaceRegistry，apply 后应被接管
const registry = { archiveSession: async (id) => ({ ok: true, id }), __easy2restartWrapped: undefined };
const originalArchive = registry.archiveSession;

const routes = new Map();
const ctx = {
  effect: (fn) => {
    const d = fn();
    return typeof d === "function" ? d : () => {};
  },
  get: (name) => (name === "workspaceRegistry" ? registry : undefined),
  webServer: {
    register: (def) => {
      routes.set(def.path, def.handler);
      return { dispose() {} };
    },
  },
};
let hostApplyError = null;
try {
  host.apply(ctx);
} catch (e) {
  hostApplyError = e;
}
check("宿主 apply 无异常", !hostApplyError, hostApplyError && hostApplyError.message);

check("已接管 workspaceRegistry.archiveSession", typeof registry.__easy2restartWrapped === "function" && registry.archiveSession !== originalArchive);

const expectedRoutes = [
  "/health",
  "/state",
  "/active",
  "/restart",
  "/clear",
  "/status",
  "/scan",
  "/backup",
  "/backup/pick",
  "/diag",
  "/archive/roots",
  "/archive/ls",
  "/archive/open",
];
const missingRoutes = expectedRoutes.filter((p) => !routes.has(API + p));
check("13 条路由全部注册（前缀 " + API + "）", missingRoutes.length === 0, missingRoutes.join(",") || expectedRoutes.length + " 条");

function call(handler, { method = "GET", url = "/", body = undefined } = {}) {
  return new Promise((resolve) => {
    const req = body === undefined ? { method, url, headers: {} } : Readable.from([Buffer.from(JSON.stringify(body))]);
    if (body !== undefined) {
      req.method = method;
      req.url = url;
      req.headers = { "content-type": "application/json" };
    }
    const res = {
      status: 0,
      body: "",
      writeHead(s) {
        this.status = s;
      },
      end(b) {
        this.body = String(b || "");
        resolve(this);
      },
    };
    try {
      handler(req, res);
    } catch (e) {
      resolve({ status: 500, body: JSON.stringify({ ok: false, message: String(e && e.message) }) });
    }
  });
}

// ---- 重启：待办往返（不动 pending 之外的状态，不触发 /restart）----
const pendingFile = path.join(HOME, "storages", NS, "pending.json");
let pendingBackup = null;
try {
  pendingBackup = fs.readFileSync(pendingFile);
} catch {
  pendingBackup = null;
}
try {
  const before = host.__internals.readPending();
  const wrote = host.__internals.writePending({ sessionId: "__selftest__", text: "自检", at: new Date().toISOString() });
  const after = host.__internals.readPending();
  host.__internals.clearPending();
  const cleared = host.__internals.readPending();
  check(
    "pending 往返（write/read/clear）",
    wrote === true && after && after.sessionId === "__selftest__" && cleared === null,
    "before=" + JSON.stringify(before) + " after=" + JSON.stringify(after),
  );
} catch (e) {
  check("pending 往返（write/read/clear）", false, e && e.message);
} finally {
  try {
    if (pendingBackup) {
      fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
      fs.writeFileSync(pendingFile, pendingBackup);
    } else {
      fs.rmSync(pendingFile, { force: true });
    }
  } catch {
    /* 还原失败不阻塞自检 */
  }
}

const health = await call(routes.get(API + "/health"), { url: API + "/health" });
const healthBody = JSON.parse(health.body || "{}");
check("/health 返回 200 且 ok", health.status === 200 && healthBody.ok === true, health.status);
check("/health 带插件名", healthBody.name === NS, healthBody.name);

const state = await call(routes.get(API + "/state"), { url: API + "/state" });
check("/state 返回 200 且 ok", state.status === 200 && JSON.parse(state.body || "{}").ok === true, state.status);

const active = await call(routes.get(API + "/active"), { url: API + "/active" });
const activeBody = JSON.parse(active.body || "{}");
check("/active 返回布尔字段", active.status === 200 && typeof activeBody.active === "boolean", JSON.stringify(activeBody));

// /restart 只验证方法守卫（GET 应为 405），绝不调用真实重启
const restartGuard = await call(routes.get(API + "/restart"), { method: "GET", url: API + "/restart" });
check("/restart 只接受 POST（GET → 405）", restartGuard.status === 405, restartGuard.status);

// ---- 备份状态 ----
const status = await call(routes.get(API + "/status"), { url: API + "/status" });
const statusBody = JSON.parse(status.body || "{}");
check("/status 返回已备份会话数", status.status === 200 && typeof statusBody.backedUp === "number", statusBody.backedUp);

// ---- 归档浏览 ----
const rootsRes = await call(routes.get(API + "/archive/roots"), { url: API + "/archive/roots" });
const rootsBody = JSON.parse(rootsRes.body || "{}");
check("roots 返回 200 且 ok", rootsRes.status === 200 && rootsBody.ok === true, rootsRes.status);
const roots = rootsBody.data || {};
check("sessionsRoot 指向 DSH 会话目录", roots.sessionsRoot === path.resolve(SESSIONS), roots.sessionsRoot);
check("备份根目录 = 生效设置（不再是写死常量）", roots.backupRoot === host.__internals.backupSetting().dir, roots.backupRoot);
check("备份根目录默认值仍是原路径", roots.backupDefaultDir === DEFAULT_BACKUP_DIR, roots.backupDefaultDir);
check("roots 带备份状态字段", typeof roots.backupEnabled === "boolean" && typeof roots.backupWritable === "boolean", roots.backupEnabled + "/" + roots.backupWritable);
check("roots 报出设置来源", typeof roots.backupSource === "string" && roots.backupSource.length > 0, roots.backupSource);
check("明确未连接备份目录", roots.backupConnected === false);
check("归档清单数量自洽", roots.archivedCount === roots.archivedSessionTotal, roots.archivedCount + "/" + roots.archivedSessionTotal);
check("归档会话目录均真实存在", (roots.archived || []).every((a) => a.dir && fs.existsSync(a.dir)), (roots.archived || []).length);
check(
  "归档会话标题可读（不回落 UUID）",
  (roots.archived || []).every((a) => !/^(?:session-)?[0-9a-f-]{20,}$/i.test(a.title || "")),
  (roots.archived || []).filter((a) => /^(?:session-)?[0-9a-f-]{20,}$/i.test(a.title || "")).length + " 个未解析",
);
const first = (roots.archived || [])[0];
check("首条归档会话可定位到会话目录", !!first && first.dir.startsWith(path.resolve(SESSIONS)), first && first.dir);

const lsRoot = await call(routes.get(API + "/archive/ls"), { url: API + "/archive/ls?path=" + encodeURIComponent(SESSIONS) });
const lsRootBody = JSON.parse(lsRoot.body || "{}");
check("ls 根目录 200 且 ok", lsRoot.status === 200 && lsRootBody.ok === true, lsRoot.status);
check(
  "根目录条目为工作区目录",
  (lsRootBody.data.entries || []).every((e) => e.kind === "directory"),
  (lsRootBody.data.entries || []).length,
);

if (first) {
  const lsSession = await call(routes.get(API + "/archive/ls"), {
    url: API + "/archive/ls?path=" + encodeURIComponent(first.dir),
  });
  const data = JSON.parse(lsSession.body || "{}").data || {};
  check("会话目录可列举", Array.isArray(data.entries) && data.entries.length > 0, data.entries && data.entries.length);
  check(
    "会话目录含会话文件",
    (data.entries || []).some((e) => e.name.startsWith("session.")),
    (data.entries || []).map((e) => e.name).join(","),
  );
}

// 守卫用「生效的备份目录」，这样改过设置之后守卫依然有效
const effectiveBackupDir = host.__internals.backupSetting().dir;

const guardBackup = await call(routes.get(API + "/archive/ls"), {
  url: API + "/archive/ls?path=" + encodeURIComponent(effectiveBackupDir),
});
const guardBackupBody = JSON.parse(guardBackup.body || "{}");
check(
  "拒绝访问备份目录（403 OUT_OF_SCOPE）",
  guardBackup.status === 403 && guardBackupBody.code === "OUT_OF_SCOPE",
  guardBackup.status + " " + guardBackupBody.code,
);

const guardEscape = await call(routes.get(API + "/archive/ls"), {
  url: API + "/archive/ls?path=" + encodeURIComponent(path.join(SESSIONS, "..", "storages")),
});
check("拒绝目录穿越", guardEscape.status === 403, guardEscape.status);

const missingDir = await call(routes.get(API + "/archive/ls"), {
  url: API + "/archive/ls?path=" + encodeURIComponent(path.join(SESSIONS, "__no_such_dir__")),
});
check("不存在的目录返回错误", missingDir.status >= 400, missingDir.status);

const guardOpen = await call(routes.get(API + "/archive/open"), {
  method: "POST",
  url: API + "/archive/open",
  body: { path: effectiveBackupDir },
});
const guardOpenBody = JSON.parse(guardOpen.body || "{}");
check(
  "打开备份路径同样被拒绝",
  guardOpen.status === 403 && guardOpenBody.code === "OUT_OF_SCOPE",
  guardOpen.status + " " + guardOpenBody.code,
);

/* ========================= 备份设置（0.2.1 新增） ========================= */
const cfgBackup = (() => {
  try {
    return fs.readFileSync(CONFIG_FILE);
  } catch {
    return null;
  }
})();
const tmpDir = path.join(os.tmpdir(), "dsh-easy2restart-selftest-" + process.pid);
const tmpFile = tmpDir + "-file";
let tmpWrote = false;
try {
  fs.writeFileSync(tmpFile, "x");
  tmpWrote = true;
} catch {
  tmpWrote = false;
}

try {
  check("导出自检出口：备份设置族", ["backupSetting", "backupPaths", "backupSnapshot", "probeBackupDir"].every((k) => typeof host.__internals[k] === "function"));
  check("导出 DEFAULT_BACKUP_DIR", host.__internals.DEFAULT_BACKUP_DIR === DEFAULT_BACKUP_DIR, host.__internals.DEFAULT_BACKUP_DIR);

  const setting = host.__internals.backupSetting();
  check("backupSetting: enabled 为布尔", typeof setting.enabled === "boolean", setting.enabled);
  check("backupSetting: dir 非空且绝对", typeof setting.dir === "string" && path.isAbsolute(setting.dir), setting.dir);
  check("backupSetting: source ∈ default/config/env", ["default", "config", "env"].includes(setting.source), setting.source);

  const bpaths = host.__internals.backupPaths();
  check(
    "backupPaths: 派生文件都挂在生效目录下",
    ["flog", "state", "manualManifest", "autoManifest", "md"].every((k) => typeof bpaths[k] === "string" && bpaths[k].startsWith(bpaths.dir)),
    bpaths.state,
  );
  check("backupPaths: 状态文件名沿用原约定", path.basename(bpaths.state) === "_auto-backup-state.json", path.basename(bpaths.state));

  const snap0 = host.__internals.backupSnapshot();
  check("backupSnapshot: 带 envOverride 布尔", typeof snap0.envOverride === "boolean", snap0.envOverride);
  check("backupSnapshot: 带 configPath", snap0.configPath === CONFIG_FILE, snap0.configPath);

  const probeEmpty = host.__internals.probeBackupDir("");
  check("probeBackupDir: 空串直接失败", probeEmpty.ok === false && probeEmpty.writable === false, probeEmpty.reason);

  const probeOk = host.__internals.probeBackupDir(tmpDir);
  check("probeBackupDir: 新目录自动创建并可写", probeOk.ok === true && probeOk.writable === true && fs.existsSync(tmpDir), probeOk.path);
  check("probeBackupDir: 探针文件不残留", !fs.existsSync(path.join(tmpDir, ".dsh-easy2restart-write-probe")));

  if (tmpWrote) {
    const probeBad = host.__internals.probeBackupDir(path.join(tmpFile, "sub"));
    check("probeBackupDir: 目标被文件占位时报不可写", probeBad.ok === false && probeBad.writable === false, probeBad.reason);
  }

  // GET /backup
  const backupGet = await call(routes.get(API + "/backup"), { url: API + "/backup" });
  const backupGetBody = JSON.parse(backupGet.body || "{}");
  check("GET /backup 返回 200 且 ok", backupGet.status === 200 && backupGetBody.ok === true, backupGet.status);
  check("GET /backup 带生效目录", typeof (backupGetBody.data || {}).dir === "string", (backupGetBody.data || {}).dir);

  // POST /backup：空 body 应拒绝
  const backupEmpty = await call(routes.get(API + "/backup"), { method: "POST", url: API + "/backup", body: {} });
  const backupEmptyBody = JSON.parse(backupEmpty.body || "{}");
  check("POST /backup: 空 body → 400 NOTHING_TO_SAVE", backupEmpty.status === 400 && backupEmptyBody.code === "NOTHING_TO_SAVE", backupEmpty.status + " " + backupEmptyBody.code);

  // POST /backup：不可写目录 → 400，不落盘
  if (tmpWrote) {
    const backupBad = await call(routes.get(API + "/backup"), {
      method: "POST",
      url: API + "/backup",
      body: { dir: path.join(tmpFile, "sub") },
    });
    const backupBadBody = JSON.parse(backupBad.body || "{}");
    check(
      "POST /backup: 不可写目录 → 400 BACKUP_DIR_UNWRITABLE",
      backupBad.status === 400 && backupBadBody.code === "BACKUP_DIR_UNWRITABLE",
      backupBad.status + " " + backupBadBody.code,
    );
    const afterBad = host.__internals.backupSetting();
    check("不可写目录不会写进配置", afterBad.configDir !== path.join(tmpFile, "sub"), afterBad.configDir);
  }

  // POST /backup：正常保存 → 生效并落盘（随后还原 config.json）
  const backupOk = await call(routes.get(API + "/backup"), { method: "POST", url: API + "/backup", body: { dir: tmpDir } });
  const backupOkBody = JSON.parse(backupOk.body || "{}");
  const savedDir = (backupOkBody.data || {}).dir;
  check("POST /backup: 可写目录保存成功", backupOk.status === 200 && backupOkBody.ok === true, backupOk.status);
  check("POST /backup: 生效目录变为新值", savedDir === path.resolve(tmpDir), savedDir);
  check("POST /backup: 配置文件落盘", fs.existsSync(CONFIG_FILE) && (JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).backup || {}).dir === tmpDir, CONFIG_FILE);
  check("POST /backup: 派生路径跟着变", host.__internals.backupPaths().md === path.join(path.resolve(tmpDir), "归档清单.md"), host.__internals.backupPaths().md);

  // POST /backup：关闭自动备份
  const backupOff = await call(routes.get(API + "/backup"), { method: "POST", url: API + "/backup", body: { enabled: false } });
  const backupOffBody = JSON.parse(backupOff.body || "{}");
  check("POST /backup: 可关闭自动备份", backupOff.status === 200 && (backupOffBody.data || {}).enabled === false, (backupOffBody.data || {}).enabled);
  check("关闭后 backupSetting 也是关闭态", host.__internals.backupSetting().enabled === false);

  // 清空目录 → 回默认
  const backupReset = await call(routes.get(API + "/backup"), { method: "POST", url: API + "/backup", body: { enabled: true, dir: "" } });
  const backupResetBody = JSON.parse(backupReset.body || "{}");
  check("POST /backup: 清空目录回默认", (backupResetBody.data || {}).dir === DEFAULT_BACKUP_DIR, (backupResetBody.data || {}).dir);

  const pickGuard = await call(routes.get(API + "/backup/pick"), { method: "GET", url: API + "/backup/pick" });
  check("/backup/pick 只接受 POST（GET → 405）", pickGuard.status === 405, pickGuard.status);
} catch (e) {
  check("备份设置段无异常", false, e && e.stack ? e.stack.split("\n")[0] + " | " + e.message : e);
} finally {
  try {
    if (cfgBackup) {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, cfgBackup);
    } else {
      fs.rmSync(CONFIG_FILE, { force: true });
    }
  } catch {
    /* 还原失败不阻塞自检 */
  }
  fs.rmSync(tmpFile, { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/* =============================== 客户端 =============================== */
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (mod) => {
      captured = mod;
    },
  },
};
const ReactStub = {
  createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
  Fragment: "Fragment",
};
await import(pathToFileURL(path.join(PLUGIN, "lib/client.js")).href);
check("客户端 bundle 通过 ModuleLoader 注册", !!captured && captured.id === NS, captured && captured.id);
const clientExports = captured.factory((name) => {
  if (name === "react") return ReactStub;
  return {};
});
const clientInject = clientExports.inject || [];
check(
  "客户端 inject = slots/locale/uiWorkspace",
  ["slots", "locale", "uiWorkspace"].every((k) => clientInject.includes(k)),
  clientInject.join(","),
);
check("客户端导出名 = dsh-easy2restart", clientExports.name === NS, clientExports.name);

const tabDefs = [];
const slotRegs = [];
const archiveOriginal = async (id, opts) => ({ ok: true, id, opts });
const clientCtx = {
  effect: (fn) => {
    const d = fn();
    return typeof d === "function" ? d : () => {};
  },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (name, cb) => cb(),
    register: (opts, comp) => {
      slotRegs.push({ opts, comp });
      return { dispose() {} };
    },
  },
  inject: (deps, cb) => cb(clientCtx),
  sidebarRightTabs: {
    register: (def) => {
      tabDefs.push(def);
      return { dispose() {} };
    },
  },
  uiWorkspace: { archiveSession: archiveOriginal },
};
let clientApplyError = null;
try {
  clientExports.apply(clientCtx);
} catch (e) {
  clientApplyError = e;
}
check("客户端 apply 无异常", !clientApplyError, clientApplyError && clientApplyError.message);

// ---- 1. 重启按钮 ----
const footerSlot = slotRegs.find((r) => r.opts.name === "sidebar.footer.action" && r.opts.id === NS);
check("注册了底部重启按钮插槽", !!footerSlot, footerSlot && footerSlot.opts.id);
check("重启按钮组件为函数组件", !!footerSlot && typeof footerSlot.comp === "function");
check("重启按钮带 locale 文案", !!footerSlot && footerSlot.opts.locale === NS && typeof footerSlot.opts.label === "function");

// ---- 2. 归档确认框 ----
const overlaySlot = slotRegs.find((r) => r.opts.name === "shell.overlay" && r.opts.id === NS + ".dialog");
check("注册了归档确认框 overlay", !!overlaySlot, overlaySlot && overlaySlot.opts.id);
check("确认框组件为函数组件", !!overlaySlot && typeof overlaySlot.comp === "function");

// ---- 3. 右侧栏「已归档会话」 ----
const primary = tabDefs.find((d) => d.kind === "archive-sessions");
const legacy = tabDefs.find((d) => d.kind === "wecom-archive");
check("注册了主 tab 类型 kind=archive-sessions", !!primary, primary && primary.id);
check("主 tab 类型 id = dsh-easy2restart/archive-files", !!primary && primary.id === NS + "/archive-files", primary && primary.id);
check("注册了旧 kind 别名（已保存布局不失效）", !!legacy, legacy && legacy.id);
check("旧 kind 类型 id = dsh-easy2restart/archive-files-legacy", !!legacy && legacy.id === NS + "/archive-files-legacy", legacy && legacy.id);
if (primary) {
  check("tab 标题 = 已归档会话", primary.title() === "已归档会话", primary.title());
  const guide = (primary.guide || [])[0] || {};
  check("引导页条目标题 = 已归档会话", guide.title && guide.title() === "已归档会话", guide.title && guide.title());
  check("引导页条目标注非备份", guide.description && guide.description().includes("非备份"), guide.description && guide.description());
  check("引导页条目有图标组件", typeof guide.icon === "function");
}
const bodySlots = slotRegs.filter((r) => r.opts.name === "sidebar.right.pane.tab");
check("注册了主 tab 正文插槽", bodySlots.some((r) => r.opts.key === NS + "/archive-files"));
check("注册了旧 tab 正文插槽", bodySlots.some((r) => r.opts.key === NS + "/archive-files-legacy"));
check("正文组件为函数组件", bodySlots.length > 0 && bodySlots.every((r) => typeof r.comp === "function"));
check(
  "注册了标签标题插槽",
  slotRegs.some((r) => r.opts.name === "sidebar.right.pane.tab.title" && r.opts.key === NS + "/archive-files"),
);

// ---- 4. 归档入口接管 ----
check("已接管 uiWorkspace.archiveSession", clientCtx.uiWorkspace.archiveSession !== archiveOriginal && typeof clientCtx.uiWorkspace.archiveSession === "function");
let bypassResult = null;
try {
  bypassResult = await clientCtx.uiWorkspace.archiveSession("sess-1", { __safeArchiveBypass: true });
} catch (e) {
  bypassResult = { error: String(e && e.message) };
}
check("直通开关（__safeArchiveBypass）透传原实现", !!bypassResult && bypassResult.id === "sess-1", JSON.stringify(bypassResult));

// 再次 apply 不应重复包装（__safeArchiveWrapped 幂等）
const wrappedOnce = clientCtx.uiWorkspace.archiveSession;
try {
  clientExports.apply(clientCtx);
} catch {
  /* 第二次 apply 的异常不计入判定 */
}
check("重复 apply 不重复接管", clientCtx.uiWorkspace.archiveSession === wrappedOnce);

// ---- 5. 视觉层（0.2.1 淡暖纸本重做）：令牌、类名、图标、无障碍 ----
const clientSrc = fs.readFileSync(path.join(PLUGIN, "lib/client.js"), "utf8");
const wants = [
  ["令牌：纸/卡/墨/线", /--e2r-paper\s*:/],
  ["令牌：语义色齐全", /--e2r-ok\s*:[\s\S]*--e2r-danger\s*:/],
  ["令牌：圆角只 16/10", /--e2r-r\s*:\s*16px[\s\S]*--e2r-r-sm\s*:\s*10px/],
  ["令牌：动效 120–300ms", /--e2r-in\s*:\s*(?:1[2-9]\d|2\d\d|300)ms/],
  ["尊重 prefers-reduced-motion", /prefers-reduced-motion\s*:\s*reduce/],
  ["禁用态不用透明度", /\.e2r-btn:disabled\{(?:(?!\}).)*?background/],
  ["备份设置组件存在", /function BackupSettings\s*\(/],
  ["重启图标改为内联 SVG", /function RestartGlyph\s*\(/],
  ["右侧栏引导图标", /function FolderGlyph\s*\(/],
  ["不再使用 PNG data URI 图标", /^(?![\s\S]*data:image\/png)/],
  ["弹窗卡片类名", /\.e2r-card\b/],
  ["右侧栏面板类名", /\.e2r-pane\b/],
  ["设置字段：标签在上 + 报错贴字段", /\.e2r-label\b[\s\S]*\.e2r-status--danger/],
  ["输入框可读性错误态", /\.e2r-input--bad\b/],
  ["保存成功淡出提示", /\.e2r-saved\b/],
  ["env 覆盖横幅", /dsEnvBanner|envBanner/],
];
for (const [label, re] of wants) {
  check("视觉层：" + label, re.test(clientSrc));
}
check(
  "视觉层：一屏语义色不超过两种（无渐变）",
  !/linear-gradient|radial-gradient/.test(clientSrc),
  "gradient",
);
check(
  "视觉层：圆角无一次性值（除 50%/999px/3px）",
  !/border-radius\s*:\s*(?!var\(--e2r-r(?:-sm)?\)|50%|999px|3px|0\b|inherit|[\d.]+%\s*\/)[0-9]/i.test(clientSrc.replace(/--e2r-r[\s\S]{0,40}/g, "")),
);

// ---- 6. 0.2.2 回归：备份快照来源 / 卡片单层边界 / 摘要不重复状态 ----
check(
  "0.2.2：roots 不再冒充备份快照（setBackup(data) 已移除）",
  !/setBackup\(data\)/.test(clientSrc),
  "loadRoots 必须只 setRoots，备份快照走 /backup",
);
check(
  "0.2.2：loadRoots 内改用 refreshBackupCache()",
  /setRoots\(data\);[\s\S]{0,400}refreshBackupCache\(\)/.test(clientSrc),
);
check(
  "0.2.2：弹窗路径回退到 defaultDir",
  /backup\.dir\s*\|\|\s*backup\.defaultDir/.test(clientSrc),
);
check(
  "0.2.2：自动备份开合两态各自只有一层边界",
  !/className: "e2r-card-box"[\s\S]{0,200}h\(BackupSettings/.test(clientSrc),
  "展开态直接渲染 BackupSettings，不再套 e2r-card-box",
);
check(
  "0.2.2：展开态自带收起按钮",
  /onCollapse:\s*\(\)\s*=>/.test(clientSrc) && /zh\.collapse/.test(clientSrc),
);
check(
  "0.2.2：摘要行不重复状态文案",
  !/zh\.backupTitle \+ " · "/.test(clientSrc),
  "状态只交给右侧 chip",
);
check(
  "0.2.2：重启按钮禁用态保留描边",
  /\.e2r-btn:disabled\{[^}]*border-color:var\(--e2r-line\)/.test(clientSrc),
);
check(
  "0.2.2：卡片行右内边距 ≥15px（分段控件不再贴边）",
  /\.e2r-card-box>\.e2r-card-row\{[^}]*padding:11px 15px/.test(clientSrc),
);

/* =============================== 汇总 =============================== */
const failed = results.filter((r) => !r.ok);
console.log("\n===== 自检汇总: " + (results.length - failed.length) + "/" + results.length + " 通过 =====");
if (failed.length) {
  for (const f of failed) console.log("FAILED: " + f.name + " " + f.detail);
  process.exitCode = 1;
}
// apply 会留下后台定时器（归档补扫 / 服务重试）；自检不等待它们
process.exit(failed.length ? 1 : 0);
