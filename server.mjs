import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runAnalysis, applyUpdate, rollbackLatest, readLastUpdate, recoverInterruptedMutation } from "./scripts/updater.mjs";
import { launchLoginBrowser, openLoginPage, openExternalLoginPage, collectBrowserCookies, closeLoginBrowser, browserStatus, browserFetchText } from "./scripts/browser-login.mjs";
import { writeJsonAtomic } from "./scripts/local-json.mjs";
import { buildSourceInsights, publicSourceRecord } from "./scripts/source-insights.mjs";
import { addSourceCandidates, listSourceCandidates, removeSourceCandidates, useSourceCandidates } from "./scripts/source-candidates.mjs";
import { discoverRecentInterviewSources } from "./scripts/source-discovery.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const localRoot = join(root, ".local");
const configPath = join(localRoot, "ai-config.json");
const siteCookiesPath = join(localRoot, "site-cookies.json");
const pendingUpdatePath = join(localRoot, "pending-update.json");
const pendingUpdateTempPath = join(localRoot, "pending-update.tmp");
const host = process.env.INTERVIEW_TRAINER_HOST || "127.0.0.1";
const preferredPort = Number(process.env.INTERVIEW_TRAINER_PORT || 4173);
const maxPortAttempts = 20;

if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
  console.error(`\nInterview Trainer 启动失败：端口“${process.env.INTERVIEW_TRAINER_PORT}”无效，请使用 0 到 65535 之间的整数。\n`);
  process.exit(1);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

let aiConfig = {
  name: "自定义模型",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.2,
  maxTokens: 1200,
  customHeaders: {},
  rememberKey: false,
  telemetryEnabled: false
};
let apiKeyStorage = "none";
let lastUpdateRun = null;
let activeUpdate = null;
let activeDiscovery = false;

await mkdir(localRoot, { recursive: true });
const recoveredMutation = await recoverInterruptedMutation();
if (recoveredMutation) console.warn("[recovery] 检测到上次内容写入被中断，已从备份恢复并完成校验。");
await loadConfig();
lastUpdateRun = await loadPendingUpdate();

async function loadConfig() {
  if (!existsSync(configPath)) return;
  try {
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    aiConfig = { ...aiConfig, ...saved };
    aiConfig.apiKey = typeof aiConfig.apiKey === "string" ? aiConfig.apiKey.trim() : "";
    apiKeyStorage = aiConfig.apiKey ? "saved" : "none";
    aiConfig.rememberKey = apiKeyStorage === "saved";
  } catch (error) {
    console.warn("[config] 无法读取本地AI配置：", error.message);
  }
}

async function loadPendingUpdate() {
  for (const candidate of [pendingUpdatePath, pendingUpdateTempPath]) {
    try {
      const payload = JSON.parse(await readFile(candidate, "utf8"));
      const valid = payload?.draft && Array.isArray(payload.newSources) && Array.isArray(payload.newConcepts);
      if (!valid) continue;
      if (candidate === pendingUpdateTempPath) await savePendingUpdate(payload);
      return payload;
    } catch {}
  }
  return null;
}

async function savePendingUpdate(payload) {
  await writeJsonAtomic(pendingUpdatePath, payload, { tempPath: pendingUpdateTempPath });
}

async function clearPendingUpdate() {
  await Promise.all([
    rm(pendingUpdatePath, { force: true }),
    rm(pendingUpdateTempPath, { force: true })
  ]).catch(() => {});
}

function publicConfig() {
  const { apiKey, ...safe } = aiConfig;
  return { ...safe, hasApiKey: Boolean(apiKey), apiKeyStorage };
}

async function saveConfig(next) {
  const rememberKey = Boolean(next.rememberKey);
  const nextConfig = {
    name: cleanText(next.name, 80) || "自定义模型",
    baseUrl: validateBaseUrl(next.baseUrl),
    apiKey: typeof next.apiKey === "string" && next.apiKey ? next.apiKey.trim() : aiConfig.apiKey,
    model: cleanText(next.model, 160),
    temperature: clampNumber(next.temperature, 0, 2, 0.2),
    maxTokens: Math.round(clampNumber(next.maxTokens, 64, 32768, 1200)),
    customHeaders: validateHeaders(next.customHeaders),
    rememberKey,
    telemetryEnabled: Boolean(next.telemetryEnabled)
  };

  const persisted = rememberKey ? nextConfig : { ...nextConfig, apiKey: "" };
  await writeJsonAtomic(configPath, persisted);
  aiConfig = nextConfig;
  apiKeyStorage = aiConfig.apiKey ? (rememberKey ? "saved" : "session") : "none";
  return publicConfig();
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function validateBaseUrl(value) {
  const raw = cleanText(value, 500).replace(/\/+$/, "");
  if (!raw) return "";
  const parsed = new URL(raw);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("Base URL 只支持 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("请不要把密钥写入 Base URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

function validateHeaders(value) {
  if (!value) return {};
  const headers = typeof value === "string" ? JSON.parse(value) : value;
  if (!headers || Array.isArray(headers) || typeof headers !== "object") {
    throw new Error("自定义请求头必须是 JSON 对象");
  }
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding"]);
  const clean = {};
  for (const [key, headerValue] of Object.entries(headers)) {
    if (blocked.has(key.toLowerCase())) continue;
    clean[String(key).slice(0, 120)] = String(headerValue).slice(0, 1000);
  }
  return clean;
}

function apiEndpoint(baseUrl, resource) {
  const parsed = new URL(baseUrl);
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  if (resource === "chat" && cleanPath.endsWith("/chat/completions")) return parsed.toString();
  if (resource === "models" && cleanPath.endsWith("/models")) return parsed.toString();
  parsed.pathname = cleanPath.endsWith("/v1")
    ? `${cleanPath}/${resource === "chat" ? "chat/completions" : "models"}`
    : `${cleanPath}/v1/${resource === "chat" ? "chat/completions" : "models"}`;
  return parsed.toString();
}

function upstreamHeaders() {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    ...aiConfig.customHeaders
  };
  if (aiConfig.apiKey) headers.authorization = `Bearer ${aiConfig.apiKey}`;
  return headers;
}

async function upstreamChat(messages, { temperature = 0.2, maxTokens = 4000, timeoutMs = 180_000, signal } = {}) {
  if (!aiConfig.baseUrl || !aiConfig.model) throw new Error("请先配置 Base URL 和模型名称");
  const endpoint = apiEndpoint(aiConfig.baseUrl, "chat");
  const primaryPayload = {
    model: aiConfig.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false
  };
  const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const requestUpstream = (payload) => fetch(endpoint, {
    method: "POST",
    headers: upstreamHeaders(),
    body: JSON.stringify(payload),
    signal: requestSignal()
  });
  let upstream = await requestUpstream(primaryPayload);
  let errorText = "";
  if (!upstream.ok) {
    errorText = await upstream.text();
    const compatibilityError = [400, 422].includes(upstream.status)
      && /max_tokens|max_completion_tokens|unknown|unsupported|extra field/i.test(errorText);
    if (compatibilityError) {
      const fallbackPayload = { ...primaryPayload, max_completion_tokens: maxTokens };
      delete fallbackPayload.max_tokens;
      upstream = await requestUpstream(fallbackPayload);
      errorText = upstream.ok ? "" : await upstream.text();
    }
  }
  if (!upstream.ok) throw new Error(`模型请求失败（${upstream.status}）：${errorText.slice(0, 500)}`);
  const rawText = await upstream.text();
  const contentType = upstream.headers.get("content-type") || "";
  let content = "";
  if (contentType.includes("text/event-stream") || rawText.trimStart().startsWith("data:")) {
    const parts = [];
    for (const line of rawText.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content;
        if (typeof delta === "string") parts.push(delta);
      } catch {
        // 忽略心跳与非 JSON 行
      }
    }
    content = parts.join("");
    if (!content.trim()) throw new Error("模型返回了空的流式响应");
  } else {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error("模型响应不是有效 JSON，请检查该服务是否兼容 Chat Completions 格式");
    }
    content = parsed.choices?.[0]?.message?.content;
  }
  if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回文本内容");
  return content;
}

async function readJsonBody(request, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function tutorInstruction(question, mode, studyContext) {
  const detailed = Array.isArray(question?.detailedAnswer)
    ? question.detailedAnswer.slice(0, 5).map((section) => `${cleanText(section.title, 80)}：${cleanText(section.content, 1200)}`).join("\n")
    : "";
  const safeReviewKind = ["independent", "hinted", "revealed"].includes(studyContext?.reviewKind) ? studyContext.reviewKind : "independent";
  const studyEvidence = question
    ? `\n本轮学习证据：${safeReviewKind === "revealed" ? "用户已经展开题库答案，不能把照着答案复述视为独立掌握" : safeReviewKind === "hinted" ? "用户使用过提示，评价时需区分提示后完成与独立掌握" : "用户尚未使用提示或展开答案，可按独立回忆评价"}。历史熟悉度 ${Math.min(4, Math.max(0, Number(studyContext?.level) || 0))}/4，历史作答 ${Math.min(100000, Math.max(0, Math.round(Number(studyContext?.attempts) || 0)))} 次。`
    : "";
  const context = question
    ? `\n当前题目：${cleanText(question.title, 500)}\n题目所属模块：${cleanText(question.category, 120)}\n题库精简答案：${cleanText(question.quickAnswer, 2000) || "暂无"}\n评分点：${(question.keyPoints || []).slice(0, 8).map((point) => cleanText(point, 400)).join("；") || "暂无"}\n题库详细讲解：\n${detailed || "暂无"}${studyEvidence}`
    : "";
  const modeRules = {
    hint: "只给一到两个方向提示，不直接公布完整答案。提示后停下，等待用户作答。",
    explain: "面向完全新手解释，先用生活化类比，再给准确技术定义。",
    review: "严格依据题目评分点评价用户回答，不按语言流畅度猜测掌握。固定输出五段：①本轮结论（0–4级及一句理由）；②覆盖评分点（逐项标记已覆盖/部分/缺失）；③说对的内容；④最关键的遗漏或错误（最多3项）；⑤下一道追问（只问1个，不附答案）。如果用户没有提供实际回答，只给回答框架和第一个引导问题，不泄露完整标准答案。",
    followup: "扮演结构化技术面试官。一次只问一个问题；优先追问用户刚才遗漏或含糊的评分点，等待回答后再继续。不要在问题后附标准答案，不要一次列出题单。",
    chat: "直接回答用户问题，保持简洁；不确定时明确说明，并建议核对官方资料。"
  };
  return `你是一个面向实习、校招和0到1年经验初学者的技术面试教练。${modeRules[mode] || modeRules.chat}\n不得把题库提示当作绝对真理；发现其可能过时或有争议时要明确指出。不得声称已经修改用户的本地熟悉度或复习计划。回答以中文为主，先结论后解释。${context}`;
}

async function handleModels(response) {
  if (!aiConfig.baseUrl) throw new Error("请先配置 Base URL");
  const upstream = await fetch(apiEndpoint(aiConfig.baseUrl, "models"), {
    method: "GET",
    headers: upstreamHeaders(),
    signal: AbortSignal.timeout(15_000)
  });
  const text = await upstream.text();
  if (!upstream.ok) throw new Error(`模型列表请求失败（${upstream.status}）：${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const models = Array.isArray(payload.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
  sendJson(response, 200, { models });
}

async function handleChat(request, response) {
  if (!aiConfig.baseUrl || !aiConfig.model) throw new Error("请先配置 Base URL 和模型名称");
  const body = await readJsonBody(request);
  const messages = Array.isArray(body.messages)
    ? body.messages.slice(-20).map((item) => ({
        role: ["user", "assistant"].includes(item.role) ? item.role : "user",
        content: cleanText(item.content, 20_000)
      }))
    : [];
  if (!messages.length) throw new Error("没有可发送的消息");

  const endpoint = apiEndpoint(aiConfig.baseUrl, "chat");
  const primaryPayload = {
    model: aiConfig.model,
    messages: [
      { role: "system", content: tutorInstruction(body.question, body.mode, body.studyContext) },
      ...messages
    ],
    temperature: aiConfig.temperature,
    max_tokens: aiConfig.maxTokens,
    stream: true,
    stream_options: { include_usage: true }
  };
  const requestUpstream = (payload) => fetch(endpoint, {
    method: "POST",
    headers: upstreamHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000)
  });

  let upstream = await requestUpstream(primaryPayload);
  let errorText = "";
  if (!upstream.ok) {
    errorText = await upstream.text();
    const compatibilityError = [400, 422].includes(upstream.status)
      && /max_tokens|max_completion_tokens|stream_options|unknown|unsupported|extra field/i.test(errorText);
    if (compatibilityError) {
      const fallbackPayload = { ...primaryPayload, max_completion_tokens: aiConfig.maxTokens };
      delete fallbackPayload.max_tokens;
      delete fallbackPayload.stream_options;
      upstream = await requestUpstream(fallbackPayload);
      errorText = upstream.ok ? "" : await upstream.text();
    }
  }

  if (!upstream.ok || !upstream.body) {
    throw new Error(`模型请求失败（${upstream.status}）：${errorText.slice(0, 500)}`);
  }

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) response.write(`${JSON.stringify({ delta })}\n`);
        if (parsed.usage) response.write(`${JSON.stringify({ usage: parsed.usage })}\n`);
      } catch {
        // 部分兼容服务会发送非JSON心跳，安全忽略。
      }
    }
  }
  response.end(`${JSON.stringify({ done: true })}\n`);
}

async function loadSiteCookies() {
  try {
    const saved = JSON.parse(await readFile(siteCookiesPath, "utf8"));
    return {
      nowcoder: saved.nowcoder && typeof saved.nowcoder === "object" ? saved.nowcoder : {},
      xiaohongshu: saved.xiaohongshu && typeof saved.xiaohongshu === "object" ? saved.xiaohongshu : {}
    };
  } catch {
    return { nowcoder: {}, xiaohongshu: {} };
  }
}

function publicSiteCookies(siteCookies) {
  const mask = (entry) => {
    const cookie = typeof entry.cookie === "string" ? entry.cookie.trim() : "";
    return {
      hasCookie: Boolean(cookie),
      tail: cookie ? "…" + cookie.slice(-8) : null,
      savedAt: entry.savedAt || null
    };
  };
  return { nowcoder: mask(siteCookies.nowcoder), xiaohongshu: mask(siteCookies.xiaohongshu) };
}

async function handleSiteCookiesGet(request, response) {
  return sendJson(response, 200, publicSiteCookies(await loadSiteCookies()));
}

async function handleSiteCookiesPost(request, response) {
  const body = await readJsonBody(request, 100_000).catch(() => ({}));
  const current = await loadSiteCookies();
  const clean = (value) => (typeof value === "string" ? value.trim().slice(0, 10_000) : "");
  const next = { nowcoder: {}, xiaohongshu: {} };
  const defaultHosts = { nowcoder: ["nowcoder.com"], xiaohongshu: ["xiaohongshu.com", "xhslink.com"] };
  for (const site of ["nowcoder", "xiaohongshu"]) {
    const incoming = clean(body[site]);
    if (body[site] === undefined) next[site] = current[site];
    else if (!incoming) next[site] = {};
    else next[site] = { cookie: incoming, savedAt: new Date().toISOString(), hosts: defaultHosts[site] };
  }
  await writeJsonAtomic(siteCookiesPath, next);
  return sendJson(response, 200, publicSiteCookies(next));
}

async function handleSiteCookiesDelete(request, response) {
  await writeJsonAtomic(siteCookiesPath, { nowcoder: {}, xiaohongshu: {} });
  return sendJson(response, 200, { cleared: true });
}

async function handleLoginLaunch(request, response) {
  const body = await readJsonBody(request, 10_000).catch(() => ({}));
  const loginUrls = {
    nowcoder: "https://www.nowcoder.com/login",
    xiaohongshu: "https://www.xiaohongshu.com/explore"
  };
  const site = loginUrls[body.site] ? body.site : "xiaohongshu";
  const browserId = typeof body.browserId === "string" ? body.browserId : "auto";
  const launched = await launchLoginBrowser(browserId);
  const startUrl = typeof body.startUrl === "string" && /^https?:\/\//.test(body.startUrl) ? body.startUrl : loginUrls[site];
  if (launched.canCollect) {
    await openLoginPage(startUrl);
    return sendJson(response, 200, {
      ...launched,
      site,
      loginUrl: startUrl,
      message: `${launched.browserName} 已打开，请在窗口中完成登录后回来点「采集登录态」`
    });
  }
  await openExternalLoginPage(launched.browserId, startUrl);
  return sendJson(response, 200, {
    ...launched,
    site,
    loginUrl: startUrl,
    message: `${launched.browserName} 已打开；此方式不能自动读取登录态，请登录后按下方说明手动粘贴 Cookie`
  });
}

async function handleLoginCollect(request, response) {
  const body = await readJsonBody(request, 10_000).catch(() => ({}));
  const nowcoderHosts = body.allowLocalhost ? ["127.0.0.1"] : ["nowcoder.com"];
  const xhsHosts = body.allowLocalhost ? [] : ["xiaohongshu.com", "xhslink.com"];
  const collectedNowcoder = await collectBrowserCookies(nowcoderHosts);
  const collectedXhs = xhsHosts.length ? await collectBrowserCookies(xhsHosts) : { count: 0, cookie: "" };
  const current = await loadSiteCookies();
  const next = { ...current };
  if (collectedNowcoder.count) next.nowcoder = { cookie: collectedNowcoder.cookie, savedAt: new Date().toISOString(), hosts: nowcoderHosts };
  if (collectedXhs.count) next.xiaohongshu = { cookie: collectedXhs.cookie, savedAt: new Date().toISOString(), hosts: xhsHosts };
  await writeJsonAtomic(siteCookiesPath, next);
  const total = Math.max(collectedNowcoder.total || 0, collectedXhs.total || 0);
  const domains = [...new Set([...(collectedNowcoder.domains || []), ...(collectedXhs.domains || [])])].sort();
  if (!collectedNowcoder.count && !collectedXhs.count) {
    return sendJson(response, 200, {
      ...publicSiteCookies(next),
      count: 0,
      totalCookies: total,
      domains,
      message: `浏览器里共找到 ${total} 条 Cookie，但其中没有牛客/小红书的登录 Cookie（现有 Cookie 域名：${domains.length ? domains.join("、") : "无"}）。请确认你是在【点「打开登录页」后弹出的自动采集浏览器窗口】里完成的登录；系统默认浏览器和 Firefox 需要手动粘贴 Cookie。`
    });
  }
  const parts = [];
  if (collectedNowcoder.count) parts.push(`牛客 ${collectedNowcoder.count} 条`);
  if (collectedXhs.count) parts.push(`小红书 ${collectedXhs.count} 条`);
  return sendJson(response, 200, {
    ...publicSiteCookies(next),
    count: collectedNowcoder.count + collectedXhs.count,
    collected: { nowcoder: collectedNowcoder.count, xiaohongshu: collectedXhs.count },
    totalCookies: total,
    message: `已采集登录态（${parts.join("、")}）并保存到本机。之后更新题库抓取对应网站会走这个已登录的浏览器。`
  });
}

async function handleLoginFetch(request, response) {
  const body = await readJsonBody(request, 10_000).catch(() => ({}));
  const target = String(body.url || "");
  if (!/^https?:\/\//.test(target)) return sendJson(response, 400, { error: "URL 必须以 http/https 开头" });
  try {
    const html = await browserFetchText(target, 20_000);
    return sendJson(response, 200, { ok: true, chars: html.length, preview: html.slice(0, 80) });
  } catch (error) {
    return sendJson(response, 400, { ok: false, error: error.message });
  }
}

async function handleLoginClose(request, response) {
  const result = await closeLoginBrowser();
  return sendJson(response, 200, result);
}

async function handleSourceCandidatesPost(request, response) {
  const body = await readJsonBody(request, 120_000);
  try {
    return sendJson(response, 200, await addSourceCandidates(body.urls));
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "保存候选链接失败" });
  }
}

async function handleSourceCandidatesDelete(request, response) {
  const body = await readJsonBody(request, 120_000);
  try {
    return sendJson(response, 200, await removeSourceCandidates(body.ids));
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "删除候选链接失败" });
  }
}

async function handleSourceDiscoveryRefresh(request, response) {
  if (activeDiscovery) return sendJson(response, 409, { error: "已有一项来源发现任务正在运行" });
  activeDiscovery = true;
  try {
  const body = await readJsonBody(request, 100_000);
  const sourceData = JSON.parse(await readFile(join(root, "research", "sources.json"), "utf8"));
  const target = Math.min(400, Math.max(10, Number(body.target) || 300));
  const discovery = await discoverRecentInterviewSources({
    target,
    scanLimit: Math.min(30_000, Math.max(target, Number(body.scanLimit) || Math.max(2_500, target * 45))),
    concurrency: Math.min(8, Math.max(1, Number(body.concurrency) || 8)),
    excludeUrls: (sourceData.sources || []).map((source) => source.url).filter(Boolean)
  });
  const candidates = await addSourceCandidates(discovery.sources.map((source) => source.url));
  return sendJson(response, 200, { ...candidates, discovery: discovery.stats });
  } finally {
    activeDiscovery = false;
  }
}

async function handleUpdateRun(request, response) {
  if (!aiConfig.baseUrl || !aiConfig.model) {
    return sendJson(response, 400, { error: "请先在 AI 模型设置中配置 Base URL 和模型名称；更新题库需要 AI 参与分析。" });
  }
  if (activeUpdate) {
    return sendJson(response, 409, { error: "已有更新分析正在运行，请等待完成或先取消。", startedAt: activeUpdate.startedAt });
  }
  if (lastUpdateRun?.draft) {
    return sendJson(response, 409, { error: "存在尚未处理的更新草案，请先应用或放弃草案后再开始新的分析。" });
  }
  const controller = new AbortController();
  const finalizeController = new AbortController();
  activeUpdate = { controller, finalizeController, startedAt: new Date().toISOString(), completed: 0, usable: 0, planned: 0, finished: new Set(), finalizing: false };
  lastUpdateRun = null;
  let body;
  try {
    body = await readJsonBody(request, 2_000_000);
  } catch (error) {
    if (activeUpdate?.controller === controller) activeUpdate = null;
    return sendJson(response, 400, { error: error.message || "请求内容无效" });
  }
  let candidateUrls;
  try {
    candidateUrls = await useSourceCandidates(body.candidateIds ?? []);
  } catch (error) {
    if (activeUpdate?.controller === controller) activeUpdate = null;
    return sendJson(response, 400, { error: error.message || "候选链接无效" });
  }
  await clearPendingUpdate();
  response.once("close", () => {
    if (!response.writableEnded && activeUpdate?.controller === controller) controller.abort();
  });
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });
  const streamEvent = (payload) => {
    if (activeUpdate?.controller === controller) {
      if (payload.phase === "start") {
        activeUpdate.planned = (payload.plan?.auto?.length || 0) + (payload.plan?.manualUrls || 0) + (payload.plan?.manualTexts || 0);
        activeUpdate.analysisMode = payload.plan?.analysisMode || "compatible";
      }
      if (payload.phase === "analyze" && ["ok", "empty", "fail", "skipped-budget", "skipped-partial"].includes(payload.status)) {
        const key = `${payload.id || ""}\0${payload.label || ""}`;
        if (!activeUpdate.finished.has(key)) {
          activeUpdate.finished.add(key);
          activeUpdate.completed += 1;
          if (payload.status === "ok" && Number(payload.conceptCount) > 0) activeUpdate.usable += 1;
        }
      }
    }
    if (payload.phase !== "draft") console.log("[update]", payload.phase, payload.status || "", String(payload.label || payload.id || ""));
    if (payload.phase === "fetch" && payload.status === "fail") console.log("[update] fetch fail:", String(payload.error || ""));
    if (payload.phase === "analyze" && (payload.status === "fail" || payload.status === "ok" || payload.status === "empty")) console.log("[update] analyze", payload.status, "concepts:", payload.conceptCount ?? "-", "durationMs:", payload.durationMs ?? "-");
    if (payload.phase === "evaluate") console.log("[update] evaluate", JSON.stringify(payload));
    if (!response.destroyed) response.write(`${JSON.stringify(payload)}\n`);
  };
  try {
    const manualUrls = (Array.isArray(body.manualUrls) ? body.manualUrls : [])
      .map((value) => String(value).trim())
      .filter(Boolean)
      .slice(0, 100);
    const result = await runAnalysis({
      autoFetch: body.autoFetch !== false,
      maxAutoSources: body.maxAutoSources,
      manualUrls: [...new Set([...candidateUrls, ...manualUrls])].slice(0, 500),
      manualTexts: (Array.isArray(body.manualTexts) ? body.manualTexts : []).map((item) => ({ label: cleanText(item?.label, 120), text: cleanText(item?.text, 60_000) })).filter((item) => item.text).slice(0, 10),
      perSourceTimeoutMs: Math.min(900_000, Math.max(30_000, Number(body.perSourceTimeoutMs) || 300_000)),
      budgetMs: Number(body.budgetMs) > 0 ? Math.min(4 * 3600_000, Number(body.budgetMs)) : 0,
      analysisMode: ["scale", "compatible", "balanced", "quality"].includes(body.analysisMode) ? body.analysisMode : "scale",
      aiChat: (messages, options) => upstreamChat(messages, options),
      onEvent: streamEvent,
      signal: controller.signal,
      finalizeSignal: finalizeController.signal,
      telemetryEnabled: aiConfig.telemetryEnabled,
      telemetryLabel: aiConfig.name
    });
    if (result.draft) {
      lastUpdateRun = result;
      await savePendingUpdate(result);
      streamEvent({ phase: "draft", draft: result.draft });
    }
    streamEvent({ phase: "done" });
    if (!response.destroyed) response.end();
  } catch (error) {
    streamEvent(error.name === "AbortError" || controller.signal.aborted
      ? { phase: "cancelled", error: "更新分析已取消" }
      : { phase: "error", error: error.message || "更新分析失败" });
    if (!response.destroyed) response.end();
  } finally {
    if (activeUpdate?.controller === controller) activeUpdate = null;
  }
}

function handleUpdateCancel(response) {
  if (!activeUpdate) return sendJson(response, 200, { cancelled: false, message: "当前没有运行中的更新分析。" });
  activeUpdate.controller.abort();
  return sendJson(response, 200, { cancelled: true });
}

function handleUpdateFinalizePartial(response) {
  if (!activeUpdate) return sendJson(response, 200, { finalizing: false, message: "当前没有运行中的更新分析。" });
  if (activeUpdate.finalizing) return sendJson(response, 200, { finalizing: true, completed: activeUpdate.completed, usable: activeUpdate.usable });
  if (activeUpdate.usable < 1) return sendJson(response, 409, { error: "还没有成功分析出可用内容，请至少等待一个来源完成。" });
  activeUpdate.finalizing = true;
  activeUpdate.finalizeController.abort();
  return sendJson(response, 200, { finalizing: true, completed: activeUpdate.completed, usable: activeUpdate.usable, planned: activeUpdate.planned });
}

async function handleUpdateApply(request, response) {
  const body = await readJsonBody(request, 500_000).catch(() => ({}));
  try {
    const result = await applyUpdate({
      selectedSourceIds: Array.isArray(body.selectedSourceIds) ? body.selectedSourceIds : null,
      selectedConceptNames: Array.isArray(body.selectedConceptNames) ? body.selectedConceptNames : null,
      lastRun: lastUpdateRun
    });
    lastUpdateRun = null;
    await clearPendingUpdate();
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "应用失败" });
  }
}

async function handleUpdateRollback(request, response) {
  if (activeUpdate) return sendJson(response, 409, { error: "更新分析仍在运行，请先取消或等待分析结束后再撤销。" });
  try {
    const result = await rollbackLatest();
    lastUpdateRun = null;
    await clearPendingUpdate();
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "撤销失败" });
  }
}

async function serveFile(requestPath, response) {
  const relative = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(publicRoot, safePath);
  const resolvedPublicRoot = resolve(publicRoot);
  if (filePath !== resolvedPublicRoot && !filePath.startsWith(`${resolvedPublicRoot}${sep}`)) {
    sendJson(response, 403, { error: "拒绝访问" });
    return;
  }
  if (!existsSync(filePath)) {
    const fallback = join(publicRoot, "index.html");
    response.writeHead(200, { "content-type": mimeTypes[".html"] });
    createReadStream(fallback).pipe(response);
    return;
  }
  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/api/questions") {
      const data = JSON.parse(await readFile(join(root, "content", "questions.json"), "utf8"));
      return sendJson(response, 200, data);
    }
    if (request.method === "GET" && url.pathname === "/api/sources") {
      const data = JSON.parse(await readFile(join(root, "research", "sources.json"), "utf8"));
      return sendJson(response, 200, { ...data, sources: data.sources.map((source) => publicSourceRecord(source, data.snapshotDate)) });
    }
    if (request.method === "GET" && url.pathname === "/api/insights") {
      const [questionData, sourceData] = await Promise.all([
        readFile(join(root, "content", "questions.json"), "utf8").then(JSON.parse),
        readFile(join(root, "research", "sources.json"), "utf8").then(JSON.parse)
      ]);
      return sendJson(response, 200, buildSourceInsights({
        questions: questionData.questions,
        sources: sourceData.sources,
        snapshotDate: sourceData.snapshotDate,
        sampleAudit: sourceData.sampleAudit || null,
        publicQuestionSignals: questionData.publicQuestionSignals || null
      }));
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, publicConfig());
    }
    if (request.method === "POST" && url.pathname === "/api/config") {
      return sendJson(response, 200, await saveConfig(await readJsonBody(request, 100_000)));
    }
    if (request.method === "GET" && url.pathname === "/api/models") {
      return await handleModels(response);
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return await handleChat(request, response);
    }
    if (request.method === "GET" && url.pathname === "/api/update/status") {
      const lastUpdate = await readLastUpdate();
      return sendJson(response, 200, {
        configured: Boolean(aiConfig.baseUrl && aiConfig.model),
        model: aiConfig.model || null,
        apiKeyStorage,
        lastUpdate,
        running: Boolean(activeUpdate),
        startedAt: activeUpdate?.startedAt || null,
        completed: activeUpdate?.completed || 0,
        usable: activeUpdate?.usable || 0,
        planned: activeUpdate?.planned || 0,
        finalizing: Boolean(activeUpdate?.finalizing),
        analysisMode: activeUpdate?.analysisMode || null,
        draftAvailable: Boolean(lastUpdateRun?.draft)
      });
    }
    if (request.method === "GET" && url.pathname === "/api/site-cookies") {
      return await handleSiteCookiesGet(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/site-cookies") {
      return await handleSiteCookiesPost(request, response);
    }
    if (request.method === "DELETE" && url.pathname === "/api/site-cookies") {
      return await handleSiteCookiesDelete(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/login/launch") {
      return await handleLoginLaunch(request, response);
    }
    if (request.method === "GET" && url.pathname === "/api/login/status") {
      return sendJson(response, 200, browserStatus());
    }
    if (request.method === "POST" && url.pathname === "/api/login/collect") {
      return await handleLoginCollect(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/login/close") {
      return await handleLoginClose(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/login/fetch") {
      return await handleLoginFetch(request, response);
    }
    if (request.method === "GET" && url.pathname === "/api/discovery/candidates") {
      return sendJson(response, 200, await listSourceCandidates());
    }
    if (request.method === "POST" && url.pathname === "/api/discovery/candidates") {
      return await handleSourceCandidatesPost(request, response);
    }
    if (request.method === "DELETE" && url.pathname === "/api/discovery/candidates") {
      return await handleSourceCandidatesDelete(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/discovery/refresh") {
      return await handleSourceDiscoveryRefresh(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/update/run") {
      return await handleUpdateRun(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/update/cancel") {
      return handleUpdateCancel(response);
    }
    if (request.method === "POST" && url.pathname === "/api/update/finalize-partial") {
      return handleUpdateFinalizePartial(response);
    }
    if (request.method === "POST" && url.pathname === "/api/update/apply") {
      return await handleUpdateApply(request, response);
    }
    if (request.method === "GET" && url.pathname === "/api/update/draft") {
      return sendJson(response, 200, { draft: lastUpdateRun?.draft || null });
    }
    if (request.method === "POST" && url.pathname === "/api/update/rollback") {
      return await handleUpdateRollback(request, response);
    }
    if (request.method === "POST" && url.pathname === "/api/update/discard") {
      lastUpdateRun = null;
      await clearPendingUpdate();
      return sendJson(response, 200, { discarded: true });
    }
    if (request.method === "GET") return await serveFile(url.pathname, response);
    sendJson(response, 404, { error: "未找到接口" });
  } catch (error) {
    if (!response.headersSent) sendJson(response, 400, { error: error.message || "请求失败" });
    else response.end(`${JSON.stringify({ error: error.message || "请求失败" })}\n`);
  }
});

let activePort = preferredPort;
let portAttempts = 1;

server.on("error", (error) => {
  const canTryNextPort = error.code === "EADDRINUSE" && activePort > 0 && activePort < 65535 && portAttempts < maxPortAttempts;
  if (canTryNextPort) {
    const blockedPort = activePort;
    activePort += 1;
    portAttempts += 1;
    console.warn(`端口 ${blockedPort} 已被占用，正在尝试 ${activePort}…`);
    setTimeout(() => server.listen(activePort, host), 0);
    return;
  }

  const detail = error.code === "EADDRINUSE"
    ? `从 ${preferredPort} 开始连续尝试了 ${portAttempts} 个端口，仍未找到可用端口`
    : error.message;
  console.error(`\nInterview Trainer 启动失败：${detail}。\n`);
  process.exitCode = 1;
});

server.once("listening", () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : activePort;
  const localUrl = `http://${host}:${boundPort}`;
  console.log(`\nInterview Trainer 已启动：${localUrl}`);
  console.log("按 Ctrl+C 停止。AI密钥不会输出到日志。\n");
  if (process.argv.includes("--open")) {
    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", localUrl] : [localUrl];
    const opener = spawn(command, args, { detached: true, stdio: "ignore" });
    opener.unref();
  }
});

server.listen(activePort, host);
