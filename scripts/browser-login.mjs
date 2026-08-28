import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const legacyChromeProfileDir = join(root, ".local", "chrome-profile");
const browserProfilesDir = join(root, ".local", "browser-profiles");
const statePath = join(root, ".local", "browser-state.json");

function saveState(port, browser) {
  const tempPath = statePath + ".tmp";
  try {
    writeFileSync(tempPath, JSON.stringify({ port, browserId: browser.id, browserName: browser.name }, null, 2) + "\n", "utf8");
    renameSync(tempPath, statePath);
  } catch {
    try { rmSync(tempPath, { force: true }); } catch {}
  }
}

function clearState() {
  try { rmSync(statePath, { force: true }); } catch {}
}

function readSavedState() {
  try {
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    return {
      port: Number(saved.port) || 0,
      browserId: typeof saved.browserId === "string" ? saved.browserId : "",
      browserName: typeof saved.browserName === "string" ? saved.browserName : ""
    };
  } catch {
    return { port: 0, browserId: "", browserName: "" };
  }
}

const windowsRoots = [
  process.env.ProgramFiles,
  process.env["ProgramFiles(x86)"],
  process.env.LOCALAPPDATA,
  "C:/Program Files",
  "C:/Program Files (x86)"
].filter(Boolean);

function underWindowsRoots(...parts) {
  return windowsRoots.map((base) => join(base, ...parts));
}

const BROWSER_DEFINITIONS = process.platform === "win32" ? [
  { id: "chrome", name: "Google Chrome", canCollect: true, candidates: underWindowsRoots("Google", "Chrome", "Application", "chrome.exe") },
  { id: "edge", name: "Microsoft Edge", canCollect: true, candidates: underWindowsRoots("Microsoft", "Edge", "Application", "msedge.exe") },
  { id: "brave", name: "Brave", canCollect: true, candidates: underWindowsRoots("BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
  { id: "chromium", name: "Chromium", canCollect: true, candidates: underWindowsRoots("Chromium", "Application", "chrome.exe") },
  { id: "firefox", name: "Mozilla Firefox（手动 Cookie）", canCollect: false, candidates: underWindowsRoots("Mozilla Firefox", "firefox.exe") }
] : process.platform === "darwin" ? [
  { id: "chrome", name: "Google Chrome", canCollect: true, candidates: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] },
  { id: "edge", name: "Microsoft Edge", canCollect: true, candidates: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] },
  { id: "brave", name: "Brave", canCollect: true, candidates: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] },
  { id: "chromium", name: "Chromium", canCollect: true, candidates: ["/Applications/Chromium.app/Contents/MacOS/Chromium"] },
  { id: "firefox", name: "Mozilla Firefox（手动 Cookie）", canCollect: false, candidates: ["/Applications/Firefox.app/Contents/MacOS/firefox"] }
] : [
  { id: "chrome", name: "Google Chrome", canCollect: true, candidates: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"] },
  { id: "edge", name: "Microsoft Edge", canCollect: true, candidates: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"] },
  { id: "brave", name: "Brave", canCollect: true, candidates: ["/usr/bin/brave-browser", "/usr/bin/brave-browser-stable"] },
  { id: "chromium", name: "Chromium", canCollect: true, candidates: ["/usr/bin/chromium", "/usr/bin/chromium-browser"] },
  { id: "firefox", name: "Mozilla Firefox（手动 Cookie）", canCollect: false, candidates: ["/usr/bin/firefox"] }
];

function installedBrowsers() {
  return BROWSER_DEFINITIONS.flatMap((definition) => {
    const executable = definition.candidates.find((candidate) => existsSync(candidate));
    return executable ? [{ ...definition, executable }] : [];
  });
}

function resolveBrowser(requestedId = "auto") {
  const installed = installedBrowsers();
  if (!requestedId || requestedId === "auto") {
    return installed.find((browser) => browser.canCollect)
      || { id: "system", name: "系统默认浏览器（手动 Cookie）", canCollect: false, executable: null };
  }
  if (requestedId === "system") {
    return { id: "system", name: "系统默认浏览器（手动 Cookie）", canCollect: false, executable: null };
  }
  const selected = installed.find((browser) => browser.id === requestedId);
  if (!selected) throw new Error("所选浏览器未安装或已不可用，请重新选择");
  return selected;
}

export function availableLoginBrowsers() {
  const installed = installedBrowsers();
  const automatic = installed.find((browser) => browser.canCollect);
  return [
    {
      id: "auto",
      name: automatic ? `自动选择（${automatic.name}）` : "自动选择（系统默认浏览器）",
      canCollect: Boolean(automatic)
    },
    ...installed.map(({ id, name, canCollect }) => ({ id, name, canCollect })),
    { id: "system", name: "系统默认浏览器（手动 Cookie）", canCollect: false }
  ];
}

let browserProc = null;
let ws = null;
let debugPort = 0;
let activeBrowser = null;
let seq = 0;
const pending = new Map();

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const { res, rej } = pending.get(message.id);
          pending.delete(message.id);
          message.error ? rej(new Error(message.error.message)) : res(message.result);
        }
      };
      resolve(socket);
    };
    socket.onerror = () => reject(new Error("无法连接浏览器调试端口"));
  });
}

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export function browserStatus() {
  return {
    running: Boolean(browserProc || ws),
    port: debugPort || null,
    browserId: activeBrowser?.id || null,
    browserName: activeBrowser?.name || null,
    canCollect: Boolean(ws),
    availableBrowsers: availableLoginBrowsers()
  };
}

async function tryReconnectSaved(selectedBrowser) {
  const saved = readSavedState();
  if (!saved.port || (saved.browserId && saved.browserId !== selectedBrowser.id)) return false;
  try {
    const version = await (await fetch("http://127.0.0.1:" + saved.port + "/json/version", { signal: AbortSignal.timeout(2000) })).json();
    ws = await connect(version.webSocketDebuggerUrl);
    debugPort = saved.port;
    browserProc = null;
    activeBrowser = { ...selectedBrowser, name: saved.browserName || selectedBrowser.name };
    await send("Network.enable").catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function launchLoginBrowser(requestedId = "auto") {
  const selectedBrowser = resolveBrowser(requestedId);
  if (!selectedBrowser.canCollect) {
    return {
      running: false,
      port: null,
      browserId: selectedBrowser.id,
      browserName: selectedBrowser.name,
      canCollect: false,
      message: "将使用需要手动粘贴 Cookie 的浏览器"
    };
  }
  if (ws) {
    if (requestedId !== "auto" && activeBrowser?.id !== selectedBrowser.id) {
      throw new Error(`当前 ${activeBrowser?.name || "登录浏览器"} 正在运行，请先关闭再切换浏览器`);
    }
    return { running: true, port: debugPort, browserId: activeBrowser?.id, browserName: activeBrowser?.name, canCollect: true, message: "登录浏览器已在运行" };
  }
  if (await tryReconnectSaved(selectedBrowser)) {
    return { running: true, port: debugPort, browserId: activeBrowser.id, browserName: activeBrowser.name, canCollect: true, message: "已重新连接登录浏览器（登录态保留）" };
  }
  debugPort = 9500 + Math.floor(Math.random() * 300);
  const profileDir = selectedBrowser.id === "chrome" ? legacyChromeProfileDir : join(browserProfilesDir, selectedBrowser.id);
  mkdirSync(profileDir, { recursive: true });
  const launchedProc = spawn(selectedBrowser.executable, [
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profileDir,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1200,860",
    "about:blank"
  ], { stdio: "ignore" });
  browserProc = launchedProc;
  activeBrowser = selectedBrowser;
  let spawnError = null;
  launchedProc.once("error", (error) => {
    spawnError = error;
    if (browserProc === launchedProc) browserProc = null;
  });
  launchedProc.on("exit", () => {
    if (browserProc === launchedProc) {
      browserProc = null;
      ws = null;
      activeBrowser = null;
      debugPort = 0;
    }
  });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    if (spawnError) break;
    try {
      const res = await fetch("http://127.0.0.1:" + debugPort + "/json/version");
      version = await res.json();
    } catch {}
    if (!version) await new Promise((r) => setTimeout(r, 250));
  }
  if (!version) {
    try { launchedProc.kill(); } catch {}
    if (browserProc === launchedProc) browserProc = null;
    activeBrowser = null;
    debugPort = 0;
    throw new Error(spawnError ? `浏览器启动失败：${spawnError.message}` : "浏览器调试服务启动失败");
  }
  ws = await connect(version.webSocketDebuggerUrl);
  saveState(debugPort, selectedBrowser);
  await send("Network.enable").catch(() => {});
  await send("Target.createTarget", { url: "about:blank" }).catch(() => {});
  return { running: true, port: debugPort, browserId: selectedBrowser.id, browserName: selectedBrowser.name, canCollect: true, message: "登录浏览器已启动" };
}

export async function openExternalLoginPage(browserId, url) {
  if (!/^https?:\/\//.test(url)) throw new Error("登录地址必须以 http/https 开头");
  const selectedBrowser = resolveBrowser(browserId);
  if (selectedBrowser.canCollect) throw new Error("该浏览器应通过自动采集模式打开");
  let executable = selectedBrowser.executable;
  let args = [url];
  if (selectedBrowser.id === "system") {
    if (process.platform === "win32") {
      executable = "rundll32.exe";
      args = ["url.dll,FileProtocolHandler", url];
    } else if (process.platform === "darwin") {
      executable = "open";
    } else {
      executable = "xdg-open";
    }
  }
  const opener = spawn(executable, args, { detached: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    opener.once("spawn", resolve);
    opener.once("error", reject);
  });
  opener.unref();
  return { browserId: selectedBrowser.id, browserName: selectedBrowser.name, canCollect: false };
}

export async function openLoginPage(url) {
  if (!ws) throw new Error("登录浏览器未启动，请先点击「拉起登录浏览器」");
  const target = await send("Target.createTarget", { url });
  await new Promise((r) => setTimeout(r, 800));
  return { targetId: target.targetId, url };
}

export async function collectBrowserCookies(hosts) {
  if (!ws) throw new Error("登录浏览器未启动");
  const target = await send("Target.createTarget", { url: "about:blank" });
  const targetId = target.targetId;
  try {
    const list = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
    const sessionUrl = list.find((t) => t.id === targetId)?.webSocketDebuggerUrl;
    if (!sessionUrl) throw new Error("无法连接页面会话");
    const pageWs = await connect(sessionUrl);
    const pageSend = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      pageWs.send(JSON.stringify({ id, method, params }));
    });
    let all = [];
    try {
      // 新版 API：按浏览器上下文取全部 Cookie（Chrome 151 已废弃 getAllCookies）
      const contexts = await send("Target.getBrowserContexts", {});
      const contextId = contexts.browserContextIds?.[0] ?? "";
      const storage = await pageSend("Storage.getCookies", { browserContextId: contextId });
      all = Array.isArray(storage.cookies) ? storage.cookies : [];
    } catch {
      try {
        await pageSend("Network.enable").catch(() => {});
        const legacy = await pageSend("Network.getAllCookies", {});
        all = Array.isArray(legacy.cookies) ? legacy.cookies : [];
      } catch {
        all = [];
      }
    }
    pageWs.close();
    const normalize = (domain) => String(domain || "").replace(/^\./, "").toLowerCase();
    const domains = [...new Set(all.map((cookie) => normalize(cookie.domain)).filter(Boolean))].sort();
    const matched = all.filter((cookie) => hosts.some((host) => {
      const domain = normalize(cookie.domain);
      return domain === host || domain.endsWith("." + host);
    }));
    if (!matched.length) return { count: 0, cookie: "", total: all.length, domains };
    const cookieString = matched
      .map((cookie) => cookie.name + "=" + cookie.value)
      .join("; ");
    return { count: matched.length, cookie: cookieString, total: all.length, domains };
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

function waitWithSignal(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(Object.assign(new Error("更新分析已取消"), { name: "AbortError" }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error("更新分析已取消"), { name: "AbortError" })); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function browserFetchText(url, timeoutMs = 20_000, { signal } = {}) {
  if (!ws) throw new Error("登录浏览器未启动");
  if (signal?.aborted) throw Object.assign(new Error("更新分析已取消"), { name: "AbortError" });
  const target = await send("Target.createTarget", { url: "about:blank" });
  const targetId = target.targetId;
  let pageWs = null;
  try {
    const sessionWsUrl = (await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json())
      .find((t) => t.id === targetId)?.webSocketDebuggerUrl;
    if (!sessionWsUrl) throw new Error("无法连接页面会话");
    pageWs = await connect(sessionWsUrl);
    const pageSend = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      pageWs.send(JSON.stringify({ id, method, params }));
    });
    await pageSend("Page.enable");
    await pageSend("Runtime.enable");
    await pageSend("Page.navigate", { url });
    // 等初始加载完成
    const deadline = Date.now() + Math.min(timeoutMs, 25_000);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw Object.assign(new Error("更新分析已取消"), { name: "AbortError" });
      const state = await pageSend("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true
      }).catch(() => null);
      if (state && state.result?.value === "complete") break;
      await waitWithSignal(500, signal);
    }
    // SPA 异步渲染：等稳定 + 滚动触发虚拟列表加载
    await waitWithSignal(2500, signal);
    for (let round = 0; round < 3; round++) {
      await pageSend("Runtime.evaluate", {
        expression: "window.scrollTo(0, document.body ? document.body.scrollHeight : 0)",
        returnByValue: true
      }).catch(() => {});
      await waitWithSignal(1200, signal);
    }
    const doc = await pageSend("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : (document.documentElement ? document.documentElement.outerHTML : '')",
      returnByValue: true
    });
    const text = String(doc.result?.value || "");
    if (!text.trim()) throw new Error("页面加载超时或内容为空");
    return text.slice(0, 60_000);
  } finally {
    try { if (pageWs) pageWs.close(); } catch {}
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

export async function closeLoginBrowser() {
  const spawned = Boolean(browserProc);
  if (browserProc) {
    try { browserProc.kill(); } catch {}
  }
  try { if (ws) ws.close(); } catch {}
  browserProc = null;
  ws = null;
  debugPort = 0;
  activeBrowser = null;
  if (spawned) clearState();
  return { running: false, message: spawned ? "已关闭登录浏览器" : "已断开连接；登录浏览器窗口可自行关闭（登录态已保存在本机）" };
}
