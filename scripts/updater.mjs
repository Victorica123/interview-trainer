import { readFile, mkdir, copyFile, rm, readdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { buildQuestions, allCatalogConcepts, loadSources, loadNewConcepts, loadLearningHints, loadContentReviews, sanitizeLearningHints } from "./generate-questions.mjs";
import { browserStatus, browserFetchText } from "./browser-login.mjs";
import { validatePayload, expectedCounts } from "./validate-data.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./local-json.mjs";
import { detectPlatform, extractExplicitEngagement } from "./source-insights.mjs";
import { BACKEND_TAXONOMY, migrateLegacyBackendCategory } from "./taxonomy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const localRoot = join(root, ".local");
const historyPath = join(localRoot, "update-history.json");
const mutationPath = join(localRoot, "content-mutation.json");
const newConceptsPath = join(root, "research", "new-concepts.json");
const aiScoresPath = join(root, "research", "ai-scores.json");
const learningHintsPath = join(root, "research", "learning-hints.json");
const ANALYSIS_CACHE_SCHEMA = 2;
const EXTRACTION_PROMPT_VERSION = "2026-08-28-5";

export const ALL_CATEGORIES = [...new Set([...backendConcepts, ...agentConcepts].map((concept) => concept.category))];
export const EXISTING_CONCEPT_NAMES = [...backendConcepts, ...agentConcepts].map((concept) => concept.name);
const BACKEND_CATEGORIES = new Set(backendConcepts.map((concept) => concept.category));
const AGENT_CATEGORIES = new Set(agentConcepts.map((concept) => concept.category));
const BACKEND_TOPIC_GROUPS = new Map(BACKEND_TAXONOMY.map((category) => [category.name, category.groups.map((group) => group.name)]));
const SOURCE_TYPES = ["interview", "job", "guide", "official", "research"];

// ---------------- text / fetch helpers ----------------

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function ensureConceptText(value, maxLength, fallback) {
  const text = cleanText(value, maxLength);
  if (text.length >= 40) return text;
  return cleanText(`${text}${text ? "；" : ""}${fallback}`, maxLength);
}

const ANALYSIS_PROFILES = {
  compatible: { name: "compatible", concurrency: 1, inputChars: 3200, extractionTokens: 1600, candidateLimit: 32, maxConcepts: 6, aiEvaluation: false },
  balanced: { name: "balanced", concurrency: 2, inputChars: 7000, extractionTokens: 2800, candidateLimit: 80, maxConcepts: 12, aiEvaluation: true },
  quality: { name: "quality", concurrency: 2, inputChars: 10000, extractionTokens: 4000, candidateLimit: Infinity, maxConcepts: 20, aiEvaluation: true }
};

function analysisProfile(mode) {
  return ANALYSIS_PROFILES[mode] || ANALYSIS_PROFILES.compatible;
}

function normalizedSearchText(value) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function selectCandidateConceptNames(text, concepts, limit) {
  if (!Number.isFinite(limit) || concepts.length <= limit) return concepts.map((concept) => concept.name);
  const haystack = normalizedSearchText(text);
  return concepts
    .map((concept, index) => {
      const terms = [concept.name, concept.category, concept.compare, ...(concept.tags || [])]
        .map(normalizedSearchText)
        .filter((term) => term.length >= 2);
      let score = Number(concept.priority || 0) / 100 - index / 1_000_000;
      for (const term of terms) {
        if (haystack.includes(term)) score += 50 + Math.min(20, term.length);
        const grams = [...new Set(Array.from({ length: Math.max(0, term.length - 1) }, (_, i) => term.slice(i, i + 2)))];
        if (grams.length) score += grams.filter((gram) => haystack.includes(gram)).length / grams.length * 12;
      }
      return { name: concept.name, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.name);
}

function selectRelevantText(value, maxLength) {
  const text = cleanText(value, 60_000);
  if (text.length <= maxLength) return text;
  const parts = text.split(/(?<=[。！？?])|\n+/).map((part) => part.trim()).filter(Boolean);
  const ranked = parts.map((part, index) => ({
    part,
    index,
    score: (/\?|？|是什么|为什么|如何|怎么|区别|原理|机制|项目|场景|面试|技术栈|排查/.test(part) ? 10 : 0) + (index < 8 ? 4 : 0)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let size = 0;
  for (const entry of ranked) {
    if (selected.includes(entry.part)) continue;
    if (size + entry.part.length + 1 > maxLength && selected.length) continue;
    selected.push(entry.part);
    size += entry.part.length + 1;
    if (size >= maxLength) break;
  }
  return selected.join("\n").slice(0, maxLength);
}

function combineSignals(...signals) {
  const active = signals.filter(Boolean);
  return active.length > 1 ? AbortSignal.any(active) : active[0];
}

function abortError() {
  const error = new Error("更新分析已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function htmlToText(html) {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return ((title ? `标题：${title}\n` : "") + text).slice(0, 14000);
}

async function siteCookieFor(url) {
  try {
    const saved = JSON.parse(await readFile(join(localRoot, "site-cookies.json"), "utf8"));
    const hostname = new URL(url).hostname;
    const matchesHost = (hosts) => Array.isArray(hosts) && hosts.some((host) => hostname === host || hostname.endsWith("." + host));
    if (saved.nowcoder?.cookie && matchesHost(saved.nowcoder.hosts || ["nowcoder.com"])) return { cookie: saved.nowcoder.cookie, site: "nowcoder" };
    if (saved.xiaohongshu?.cookie && matchesHost(saved.xiaohongshu.hosts || ["xiaohongshu.com", "xhslink.com"])) return { cookie: saved.xiaohongshu.cookie, site: "xiaohongshu" };
    return null;
  } catch {
    return null;
  }
}

export async function fetchSourceText(url, { signal } = {}) {
  throwIfAborted(signal);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("URL 格式不正确"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("仅支持 http/https 链接");
  if (parsed.username || parsed.password) throw new Error("链接不能包含用户名或密码");
  // 牛客/小红书：优先用已登录的本地浏览器抓取（真浏览器会话），失败回退 Node 抓取 + Cookie
  if (/(^|\.)(nowcoder|xiaohongshu|xhslink)\.com$/.test(parsed.hostname) && browserStatus().running) {
    try {
      const text = await browserFetchText(url, 20_000, { signal });
      return text.slice(0, 14000);
    } catch {
      // 回退到下方 Node 抓取
    }
  }
  const siteAuth = await siteCookieFor(url);
  const timeoutSignal = AbortSignal.timeout(12_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 interview-trainer-updater/1.0",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        ...(siteAuth ? { cookie: siteAuth.cookie } : {})
      },
      signal: requestSignal,
      redirect: "follow"
    });
    if (!response.ok) {
      const needsLogin = [401, 403].includes(response.status) && /nowcoder|xiaohongshu|xhslink/.test(parsed.hostname);
      const hint = needsLogin
        ? (siteAuth ? "（登录态可能已过期，请在更新题库页重新粘贴 Cookie）" : "（页面需要登录：在浏览器登录该站后，把 Cookie 粘贴到更新题库页的「站点登录态」）")
        : "";
      throw new Error(`HTTP ${response.status}${hint}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 1_500_000) throw new Error("页面过大（超过 1.5MB）");
    const type = response.headers.get("content-type") || "";
    const text = buffer.toString("utf8");
    return (type.includes("html") ? htmlToText(text) : text).slice(0, 14000);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error(`抓取失败：${error.name === "AbortError" || error.name === "TimeoutError" ? "超时" : error.message}`);
  }
}

// ---------------- AI extraction ----------------

function extractionSystemPrompt() {
  const categories = ALL_CATEGORIES.join("、");
  const backendGroups = BACKEND_TAXONOMY.map((category) => `${category.name}：${category.groups.map((group) => group.name).join("、")}`).join("\n");
  return `你是面试题库研究助理。输入是一段网页正文（面经、岗位要求或技术资料），你的任务是从中提取可训练的知识点，并输出严格的 JSON。

## 背景
题库服务于 Java 后端与 AI / Agent 应用开发的实习、校招和 0-1 年经验求职者。重要度公式（本地计算，你不用算分）：
importance = min(98, 38 + 概念优先级×7 + 角度奖励 + 多来源加权支持(≤13) + 来源多样性(≤4))
来源类型系数：面经1.0 > 岗位0.6 > 维护指南0.35 > 研究0.3 > 官方0.25；2026年前来源×0.55；非直接问题证据×0.8。

## 规则
1. 只输出 JSON，不要输出任何其他文字。
2. concepts 只收录有面试价值的概念：真实面经中出现的原题考点优先，其次是岗位明确要求和基础必要性。
3. 同义归并：如果提取的概念和"现有概念列表"里的某个概念是同一个知识点，就把 mapsToExisting 设为该概念的精确名称（一字不差），此时 definition/mechanism/application/pitfall/tradeoff 可以留空字符串，只为现有概念提供新证据。
4. 新概念（mapsToExisting 为 null）：name 要简短通用；category 必须是分类列表之一；Java 后端概念的 topicGroup 必须选对应专题下的二级知识组，AI / Agent 概念可将 topicGroup 填成 category；track 选 backend 或 agent；definition/mechanism/application/pitfall 各 40-160 字，tradeoff 30-120 字；compare 写相邻的对比方案名。
5. priority（1-5）：5=近期面经反复出现或岗位明确要求，4=高频主线，3=基础必要，2=边缘，1=低频。不要因为网页提到一次就给 5。
6. 不要编造网页里没有的内容；转载/推广/疑似加工答案要在 notes 说明。
7. publishedAt 从正文提取（YYYY-MM-DD），提取不到就填 null。
8. weight（0.2-1.0）：真实一手面经 0.9-1.0，多公司汇总 0.8-0.9，转载/加工 0.5-0.7，个人整理 0.4-0.6。
9. 只收录可以口头问答的知识型概念；**不收录算法题、手撕代码题、SQL 题**（如螺旋矩阵、反转链表、LRU 手写、两数之和），也不收录需要画图或写大段代码的系统设计原题。
10. 只要提取的概念与现有列表中的某个概念是同一知识点，即使名称不完全一致（如「RPC」对应「REST、RPC、WebSocket与SSE」），也必须把 mapsToExisting 设为列表中的精确名称，不要当作新概念。
11. 为每个概念给出它在主流八股文网站中的对应学习章节 learningHints：site 取 JavaGuide / 面试鸭 / 小林coding / 牛客题库 / 官方文档 / 其他之一；title 写该站内的具体章节或知识点名；url 写章节直达链接（以 https:// 开头），不确定就填空字符串。禁止编造不存在的章节或链接；完全不确定就把 learningHints 设为空数组。学习位置是辅助参考，不参与「高频」分数计算。
12. position 和 candidateLevel 只能按正文明确内容填写；未明确岗位或候选人类型时分别填 null 和 unknown，禁止根据公司或题目难度猜测。

## 分类列表
${categories}

## Java 后端二级知识组
${backendGroups}

## JSON 结构（必须严格符合）
{
  "source": {
    "title": "来源标题",
    "type": "interview|job|guide|official|research",
    "company": "公司名或null",
    "publishedAt": "YYYY-MM-DD或null",
    "position": "正文明确的岗位名称或null",
    "candidateLevel": "intern|campus|experienced|unknown",
    "directQuestionEvidence": true,
    "weight": 0.9,
    "notes": "一句话备注"
  },
  "concepts": [
    {
      "name": "概念名",
      "track": "backend|agent",
      "category": "分类之一",
      "topicGroup": "二级知识组",
      "mapsToExisting": null,
      "definition": "是什么、解决什么问题",
      "mechanism": "核心机制和执行过程",
      "application": "项目里怎么用",
      "pitfall": "常见错误与排查",
      "compare": "相邻对比方案名",
      "tradeoff": "如何比较和选型",
      "priority": 3,
      "tags": ["标签1"],
      "learningHints": [{"site": "JavaGuide", "title": "对应章节名", "url": "章节直达链接或空字符串"}]
    }
  ]
}`;
}

function extractionUserPrompt(ref, text, existingConceptNames = EXISTING_CONCEPT_NAMES, maxConcepts = 12, compatible = false) {
  return `本地检索得到的候选现有概念（同义时 mapsToExisting 必须使用其中的精确名称）：\n${existingConceptNames.join("、")}\n\n本次最多提取 ${maxConcepts} 个最有面试价值的概念。${compatible ? "优先保证 JSON 完整；不确定的 learningHints 直接给空数组。" : ""}\n来源 URL：${ref.url || "无（手动粘贴文本）"}\n来源线索：${cleanText(ref.shortTitle || ref.title || ref.label || "", 200)}\n\n本地筛选后的相关正文：\n${text}`;
}

export function parseExtraction(raw) {
  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型输出中没有 JSON 对象");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.concepts)) throw new Error("JSON 缺少 concepts 数组");
  return parsed;
}
const MAX_AI_EVAL = 40;
const AI_SCORE_DELTA = 6;

export function tierOfScore(score) {
  return score >= 88 ? "core" : score >= 74 ? "high" : "extended";
}

function evaluationSystemPrompt() {
  return `你是面试题库的评分复核员。本地公式已经按固定规则给每题算出一个基线分，你的职责是在约束范围内判断基线是否贴合真实面试价值，并给出最终分。

## 硬性约束（违反会被系统驳回）
1. 最终分必须是 0-98 的整数，且与基线分的差值绝对值不超过 6。
2. 只依据提供的证据字段和你对面试趋势的知识判断，不得编造新证据。
3. 只输出 JSON 数组，不要输出任何其他文字。

## 评分 skill（本地公式规则，作为你的判断基线）
importance = min(98, 38 + 概念优先级×7 + 角度奖励(2~5) + 多来源加权支持(≤13) + 来源多样性(≤4))
来源类型系数：真实面经1.0 > 岗位0.6 > 维护指南0.35 > 研究0.3 > 官方0.25；2026年前来源×0.55；非直接问题证据×0.8。
层级：≥88 核心必会，≥74 高频主线，其余扩展。

## 何时上调（+1~+6）
- 2026 年多个公司/多条直接面经反复出现；
- 岗位要求明确点名，且是初学者高频基础；
- 证据等级 strong 且概念通用性高（跨项目可迁移）。

## 何时下调（-1~-6）
- 证据只有单一来源，且疑似转载/加工/推广；
- 题目过偏、过时，或对 0-1 年岗位相关性低；
- 证据等级 foundation，且当前招聘市场已弱化该考点。

## 输出格式
[{"id":"题号","importance":最终分,"reason":"不超过60字的调整理由"}]
若认为基线分无需调整，可以不给该项，或 importance 与基线分相同。`;
}

function evaluationUserPrompt(rows) {
  return `待复核题目（基线分为本地公式计算结果，按重要度降序）：\n${JSON.stringify(rows)}`;
}

export function parseEvaluation(raw) {
  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("模型输出中没有 JSON 数组");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("评分输出不是数组");
  return parsed;
}

// ---------------- analysis pipeline ----------------

const FETCH_CONCURRENCY = 6;

async function runPool(items, limit, worker, signal, stopSignal = null) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      throwIfAborted(signal);
      if (stopSignal?.aborted) return;
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function textHash(kind, text, variant = "") {
  return createHash("sha256").update(EXTRACTION_PROMPT_VERSION).update("\0").update(variant).update("\0").update(kind).update("\0").update(text).digest("hex").slice(0, 24);
}

function normalizedSourceUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sourceCollection(item, sourceMeta, capturedAt) {
  const url = item.ref.url || null;
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(sourceMeta.publishedAt || "") ? sourceMeta.publishedAt : null;
  const directQuestionEvidence = Boolean(sourceMeta.directQuestionEvidence);
  return {
    method: item.kind === "auto" ? "auto-fetch" : item.kind,
    capturedAt,
    platform: detectPlatform(url).id,
    frequencyEligible: Boolean(url && publishedAt && directQuestionEvidence && item.kind !== "manual-text")
  };
}

function sourceQualityWarnings({ item, sourceMeta, textLength, collection, engagement }) {
  const warnings = [];
  if (!item.ref.url) warnings.push("没有原始网页链接，只能作为待核验材料，不能进入趋势频次统计");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceMeta.publishedAt || "")) warnings.push("缺少可核验发布日期，不计入近期趋势");
  if (!sourceMeta.directQuestionEvidence) warnings.push("不是直接面经问题证据，只能辅助答案或岗位覆盖");
  if (textLength < 800) warnings.push("抓取正文较短，可能存在登录、折叠或动态渲染导致的内容缺失");
  if (/多公司|汇总|整理|推广|内推|冲突/.test(`${sourceMeta.company || ""} ${sourceMeta.notes || ""}`)) warnings.push("来源可能是聚合、加工或推广内容，不应当作多个独立公司样本");
  if (!collection.frequencyEligible && sourceMeta.type === "interview") warnings.push("该来源不会提升近期面经热度，补齐链接、日期和直接性后再参与统计");
  if (!engagement) warnings.push("页面未出现可明确识别的浏览、点赞、收藏或评论数字，关注度保持未知");
  return [...new Set(warnings)];
}

function sourceIdAllocator(sources) {
  const year = new Date().getFullYear();
  const prefix = `upd-${year}-`;
  const used = new Set(sources.map((source) => source.id));
  let sequence = sources.reduce((max, source) => {
    const match = String(source.id || "").match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return () => {
    let id;
    do {
      sequence += 1;
      id = `${prefix}${String(sequence).padStart(3, "0")}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

async function loadAnalysisCache() {
  try {
    const payload = JSON.parse(await readFile(join(localRoot, "analysis-cache.json"), "utf8"));
    return payload.schemaVersion === ANALYSIS_CACHE_SCHEMA && payload.entries && typeof payload.entries === "object" ? payload.entries : {};
  } catch {
    return {};
  }
}

async function saveAnalysisCache(entries) {
  const keys = Object.keys(entries);
  if (keys.length > 300) {
    const sorted = keys.sort((a, b) => (entries[b].analyzedAt || "").localeCompare(entries[a].analyzedAt || ""));
    for (const key of sorted.slice(300)) delete entries[key];
  }
  try {
    await mkdir(localRoot, { recursive: true });
    await writeJsonAtomic(join(localRoot, "analysis-cache.json"), { schemaVersion: ANALYSIS_CACHE_SCHEMA, promptVersion: EXTRACTION_PROMPT_VERSION, entries });
  } catch {}
}

export async function runAnalysis({ autoFetch = true, maxAutoSources = 16, manualUrls = [], manualTexts = [], aiChat, onEvent = () => {}, perSourceTimeoutMs = 300_000, budgetMs = 30 * 60_000, analysisMode = "compatible", signal, finalizeSignal } = {}) {
  if (typeof aiChat !== "function") throw new Error("缺少 aiChat 函数");
  throwIfAborted(signal);
  const deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
  const profile = analysisProfile(analysisMode);
  const sourcesPayload = await loadSources();
  const existingDynamicConcepts = await loadNewConcepts();
  const contentReviewsPayload = await loadContentReviews();
  const contentReviews = contentReviewsPayload.questions || {};
  const knownConcepts = [...backendConcepts, ...agentConcepts, ...existingDynamicConcepts];
  const knownConceptNames = [...new Set(knownConcepts.map((concept) => concept.name).filter(Boolean))];
  const knownConceptSet = new Set(knownConceptNames);
  const conceptTrack = new Map([
    ...backendConcepts.map((concept) => [concept.name, "backend"]),
    ...agentConcepts.map((concept) => [concept.name, "agent"]),
    ...existingDynamicConcepts.map((concept) => [concept.name, concept.track === "agent" ? "agent" : "backend"])
  ]);
  const sourceById = new Map(sourcesPayload.sources.map((source) => [source.id, source]));
  const sourceByUrl = new Map(sourcesPayload.sources.map((source) => [normalizedSourceUrl(source.url), source]).filter(([url]) => url));
  const allocateSourceId = sourceIdAllocator(sourcesPayload.sources);
  const uniqueManualUrls = [];
  const seenManualUrls = new Set();
  for (const value of manualUrls) {
    const url = String(value || "").trim();
    const key = normalizedSourceUrl(url) || url;
    if (!url || seenManualUrls.has(key)) continue;
    seenManualUrls.add(key);
    uniqueManualUrls.push(url);
  }
  const uniqueManualTexts = [];
  const seenManualTexts = new Set();
  for (const input of manualTexts) {
    const text = cleanText(input?.text, 60_000);
    if (!text || seenManualTexts.has(text)) continue;
    seenManualTexts.add(text);
    uniqueManualTexts.push({ label: cleanText(input?.label, 120), text });
  }
  const autoSources = autoFetch
    ? sourcesPayload.sources
        .filter((source) => source.type === "interview")
        .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
        .slice(0, Math.min(20, Math.max(1, Number(maxAutoSources) || 12)))
    : [];
  onEvent({
    phase: "start",
    plan: {
      auto: autoSources.map((s) => ({ id: s.id, label: s.shortTitle || s.title, url: s.url })),
      manualUrls: uniqueManualUrls.length,
      manualTexts: uniqueManualTexts.length,
      existingConcepts: knownConceptNames.length,
      categories: ALL_CATEGORIES.length,
      analysisMode: profile.name,
      analysisConcurrency: profile.concurrency,
      aiEvaluation: profile.aiEvaluation
    }
  });

  const items = [];
  const fetchTasks = [
    ...autoSources.map((source) => ({ kind: "auto", ref: source })),
    ...uniqueManualUrls.map((url) => ({ kind: "manual-url", ref: { url } }))
  ];
  await runPool(fetchTasks, FETCH_CONCURRENCY, async (task) => {
    const label = task.ref.shortTitle || task.ref.title || task.ref.url;
    try {
      const text = await fetchSourceText(task.ref.url, { signal });
      throwIfAborted(signal);
      items.push({ kind: task.kind, ref: task.ref, text });
      onEvent({ phase: "fetch", id: task.ref.id || task.ref.url, label, status: "ok", chars: text.length });
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") throw abortError();
      onEvent({ phase: "fetch", id: task.ref.id || task.ref.url, label, status: "fail", error: error.message });
    }
  }, signal);
  for (const input of uniqueManualTexts) {
    items.push({ kind: "manual-text", ref: { label: input.label }, text: input.text });
    onEvent({ phase: "fetch", id: "manual", label: input.label || "手动粘贴文本", status: "ok", chars: input.text.length });
  }

  if (!items.length) {
    onEvent({ phase: "error", error: "没有拿到任何可分析的文本。自动来源全部失败时，请粘贴面经链接或正文。" });
    return { draft: null };
  }

  const newSources = [];
  const newConcepts = [];
  const links = [];
  const skipped = [];
  const sourceResults = [];
  const hintEntries = [];
  const sourceRefreshes = [];
  const analysisCache = await loadAnalysisCache();
  let cacheDirty = false;
  let cacheSaveChain = Promise.resolve();
  const persistCache = async () => {
    cacheSaveChain = cacheSaveChain.then(() => saveAnalysisCache(analysisCache));
    await cacheSaveChain;
  };

  await runPool(items, profile.concurrency, async (item) => {
    const label = cleanText(item.ref.shortTitle || item.ref.title || item.ref.label || item.ref.url, 160) || "未命名来源";
    const startedAt = Date.now();
    if (deadline && Date.now() > deadline) {
      sourceResults.push({ label, status: "skipped-budget", conceptCount: 0 });
      onEvent({ phase: "analyze", label, status: "skipped-budget", durationMs: 0 });
      return;
    }
    onEvent({ phase: "analyze", label, status: "pending" });
    try {
      const promptText = selectRelevantText(item.text, profile.inputChars);
      const candidateNames = selectCandidateConceptNames(promptText, knownConcepts, profile.candidateLimit);
      const cacheKey = textHash(item.kind, promptText, `${profile.name}\0${candidateNames.join("\0")}`);
      const cached = analysisCache[cacheKey];
      let parsed;
      let fromCache = false;
      if (cached && Array.isArray(cached.concepts) && cached.source && typeof cached.source === "object") {
        parsed = { source: cached.source, concepts: cached.concepts };
        fromCache = true;
      } else {
        let raw;
        const workSignal = combineSignals(signal, finalizeSignal);
        const chatOptions = { maxTokens: profile.extractionTokens, temperature: 0.2, timeoutMs: perSourceTimeoutMs };
        try {
          raw = await aiChat(
            [
              { role: "system", content: extractionSystemPrompt() },
              { role: "user", content: extractionUserPrompt(item.ref, promptText, candidateNames, profile.maxConcepts, profile.name === "compatible") }
            ],
            { ...chatOptions, signal: workSignal }
          );
        } catch (firstError) {
          if (finalizeSignal?.aborted) throw firstError;
          if (!/timeout|aborted/i.test(firstError.message || "")) throw firstError;
          if (deadline && Date.now() > deadline) throw firstError;
          onEvent({ phase: "analyze", label, status: "pending", retry: true });
          raw = await aiChat(
            [
              { role: "system", content: extractionSystemPrompt() },
              { role: "user", content: extractionUserPrompt(item.ref, selectRelevantText(promptText, Math.max(1200, Math.floor(profile.inputChars / 2))), candidateNames, profile.maxConcepts, profile.name === "compatible") }
            ],
            { ...chatOptions, maxTokens: Math.max(800, Math.floor(profile.extractionTokens * 0.75)), signal: workSignal }
          );
        }
        parsed = parseExtraction(raw);
        analysisCache[cacheKey] = { analyzedAt: new Date().toISOString(), source: parsed.source, concepts: parsed.concepts };
        cacheDirty = true;
        await persistCache();
      }
      throwIfAborted(signal);
      const sourceMeta = parsed.source && typeof parsed.source === "object" ? parsed.source : {};
      const existingSource = sourceById.get(item.ref.id) || sourceByUrl.get(normalizedSourceUrl(item.ref.url));
      const sourceId = existingSource?.id || allocateSourceId();
      const capturedAt = new Date().toISOString();
      const auditedMeta = {
        ...(existingSource || {}),
        ...sourceMeta,
        publishedAt: sourceMeta.publishedAt ?? existingSource?.publishedAt,
        directQuestionEvidence: typeof sourceMeta.directQuestionEvidence === "boolean"
          ? sourceMeta.directQuestionEvidence
          : existingSource?.directQuestionEvidence
      };
      const collection = sourceCollection(item, auditedMeta, capturedAt);
      const engagement = extractExplicitEngagement(item.text, capturedAt);
      const qualityWarnings = sourceQualityWarnings({ item, sourceMeta: auditedMeta, textLength: item.text.length, collection, engagement });
      const mappedNames = [];
      const freshConcepts = [];
      const localHints = [];
      for (const concept of parsed.concepts || []) {
        if (!concept || typeof concept.name !== "string" || !concept.name.trim()) continue;
        const name = concept.name.trim();
        const hints = sanitizeLearningHints(concept.learningHints);
        if (concept.mapsToExisting && knownConceptSet.has(concept.mapsToExisting)) {
          if (!mappedNames.includes(concept.mapsToExisting)) mappedNames.push(concept.mapsToExisting);
          if (hints.length) localHints.push({ conceptName: concept.mapsToExisting, hints });
          continue;
        }
        if (knownConceptSet.has(name)) {
          // 模型常直接给出已存在概念名而不填 mapsToExisting：自动并入现有概念的证据
          if (!mappedNames.includes(name)) mappedNames.push(name);
          if (hints.length) localHints.push({ conceptName: name, hints });
          continue;
        }
        const sameRunConcept = newConcepts.find((candidate) => candidate.name === name);
        if (sameRunConcept) {
          if (!sameRunConcept.sourceIds.includes(sourceId)) sameRunConcept.sourceIds.push(sourceId);
          if (!mappedNames.includes(name)) mappedNames.push(name);
          if (hints.length) localHints.push({ conceptName: name, hints });
          skipped.push({ name, mappedTo: "本次分析中的同名概念（已合并证据）" });
          continue;
        }
        const fuzzyMatch = knownConceptNames.find((existing) =>
          (name.length >= 3 && existing.includes(name)) ||
          (name.length >= 6 && existing.length >= 4 && name.includes(existing))
        );
        if (fuzzyMatch) {
          skipped.push({ name, mappedTo: fuzzyMatch });
          if (!mappedNames.includes(fuzzyMatch)) mappedNames.push(fuzzyMatch);
          if (hints.length) localHints.push({ conceptName: fuzzyMatch, hints });
          continue;
        }
        if (/螺旋矩阵|反转链表|两数之和|动态规划|二叉树|LRU缓存|滑动窗口|快排|归并排序|手撕/.test(name)) {
          skipped.push({ name, mappedTo: "算法题不收录" });
          continue;
        }
        const track = concept.track === "agent" ? "agent" : "backend";
        const migrated = track === "backend"
          ? migrateLegacyBackendCategory(name, concept.category, concept.topicGroup, concept.tags)
          : { category: concept.category, topicGroup: concept.topicGroup };
        const category = migrated.category;
        if (!ALL_CATEGORIES.includes(category)) continue;
        if (track === "backend" ? !BACKEND_CATEGORIES.has(category) : !AGENT_CATEGORIES.has(category)) continue;
        const requestedTopicGroup = cleanText(concept.topicGroup, 80);
        const allowedGroups = BACKEND_TOPIC_GROUPS.get(category) || [];
        const topicGroup = track === "backend"
          ? (allowedGroups.includes(requestedTopicGroup) ? requestedTopicGroup : migrated.topicGroup || "其他")
          : (requestedTopicGroup || category);
        const compare = cleanText(concept.compare, 80) || "同类方案";
        freshConcepts.push({
          name,
          track,
          category,
          topicGroup,
          definition: ensureConceptText(concept.definition, 400, `${name}是面试中需要说明问题背景、目标与适用边界的知识点，回答时还应交代它主要解决什么问题。`),
          mechanism: ensureConceptText(concept.mechanism, 400, `${name}的机制应按照输入或前提、关键处理步骤、输出结果以及异常边界来说明，不能只罗列名词。`),
          application: ensureConceptText(concept.application, 400, `在项目中使用${name}时，应明确业务目标与约束，再说明方案、关键参数、失败处理以及验证指标。`),
          pitfall: ensureConceptText(concept.pitfall, 400, `${name}的排查应从故障现象、日志或指标证据、可能原因、止损措施、修复与复盘顺序展开。`),
          compare,
          tradeoff: ensureConceptText(concept.tradeoff, 300, `选择${name}或${compare}时，应比较正确性、性能、复杂度、可维护性和适用前提，再结合当前场景给出结论。`),
          priority: Math.min(5, Math.max(1, Math.round(Number(concept.priority) || 3))),
          tags: Array.isArray(concept.tags) ? concept.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 6) : [],
          ...(hints.length ? { learningHints: hints } : {}),
          originSource: label
        });
      }
      const conceptCount = mappedNames.length + freshConcepts.length;
      if (!conceptCount) {
        sourceResults.push({ label, status: "empty", conceptCount: 0 });
        onEvent({ phase: "analyze", label, status: "empty", conceptCount: 0, durationMs: Date.now() - startedAt });
        return;
      }
      for (const conceptName of mappedNames) links.push({ sourceId, conceptName });
      for (const entry of localHints) hintEntries.push({ sourceId, conceptName: entry.conceptName, hints: entry.hints });
      for (const concept of freshConcepts) newConcepts.push({ ...concept, sourceIds: [sourceId] });
      if (!existingSource) {
        const tracks = [...new Set([...mappedNames.map((name) => conceptTrack.get(name)), ...freshConcepts.map((concept) => concept.track)].filter(Boolean))];
        const candidateLevel = ["intern", "campus", "experienced"].includes(sourceMeta.candidateLevel) ? sourceMeta.candidateLevel : "unknown";
        const source = {
          id: sourceId,
          title: cleanText(sourceMeta.title, 160) || label,
          shortTitle: cleanText(sourceMeta.title, 160) ? cleanText(sourceMeta.title, 24) : cleanText(label, 24),
          url: item.ref.url || null,
          type: SOURCE_TYPES.includes(sourceMeta.type) ? sourceMeta.type : "guide",
          track: tracks,
          publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(sourceMeta.publishedAt || "") ? sourceMeta.publishedAt : null,
          company: cleanText(sourceMeta.company, 60) || null,
          position: cleanText(sourceMeta.position, 80) || null,
          candidateLevel,
          weight: Math.min(1, Math.max(0.2, Number(sourceMeta.weight) || 0.8)),
          directQuestionEvidence: Boolean(sourceMeta.directQuestionEvidence),
          notes: cleanText(sourceMeta.notes, 300),
          collection,
          ...(engagement ? { engagement } : {}),
          qualityWarnings
        };
        newSources.push(source);
      } else {
        sourceRefreshes.push({
          sourceId,
          collection: { ...(existingSource.collection || {}), ...collection },
          ...(engagement ? { engagement } : {}),
          qualityWarnings,
          ...(cleanText(sourceMeta.position, 80) ? { position: cleanText(sourceMeta.position, 80) } : {}),
          ...(["intern", "campus", "experienced"].includes(sourceMeta.candidateLevel) ? { candidateLevel: sourceMeta.candidateLevel } : {})
        });
      }
      sourceResults.push({ id: sourceId, label, status: "ok", conceptCount });
      onEvent({ phase: "analyze", id: sourceId, label, status: "ok", conceptCount, durationMs: Date.now() - startedAt, ...(fromCache ? { cached: true } : {}) });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (finalizeSignal?.aborted) {
        sourceResults.push({ label, status: "skipped-partial", conceptCount: 0 });
        onEvent({ phase: "analyze", label, status: "skipped-partial", durationMs: Date.now() - startedAt });
        return;
      }
      if (error.name === "AbortError") throw abortError();
      sourceResults.push({ label, status: "fail", error: error.message.slice(0, 200) });
      onEvent({ phase: "analyze", label, status: "fail", error: error.message.slice(0, 200), durationMs: Date.now() - startedAt });
    }
  }, signal, finalizeSignal);
  if (cacheDirty) await saveAnalysisCache(analysisCache);
  throwIfAborted(signal);
  const partialFinalized = Boolean(finalizeSignal?.aborted);
  if (partialFinalized) {
    onEvent({ phase: "partial", status: "finalizing", completed: sourceResults.filter((item) => item.status === "ok").length, planned: items.length });
  }

  const linkNames = {};
  for (const link of links) (linkNames[link.sourceId] ||= []).push(link.conceptName);
  const refreshById = new Map(sourceRefreshes.map((refresh) => [refresh.sourceId, refresh]));
  const mergedSources = [
    ...sourcesPayload.sources.map((source) => {
      const { sourceId: _sourceId, ...refresh } = refreshById.get(source.id) || {};
      return {
        ...source,
        ...refresh,
        id: source.id,
        supportsConcepts: [...new Set([...(source.supportsConcepts || []), ...(linkNames[source.id] || [])])]
      };
    }),
    ...newSources.map((source) => ({ ...source, supportsConcepts: [...new Set(linkNames[source.id] || [])] }))
  ];

  const beforePayload = JSON.parse(await readFile(join(root, "content", "questions.json"), "utf8"));
  const cleanConcepts = newConcepts.map(({ originSource, ...rest }) => rest);
  const { backend, agent } = allCatalogConcepts([...existingDynamicConcepts, ...cleanConcepts]);
  const afterQuestions = [
    ...buildQuestions(backend, "backend", "be", mergedSources, sourcesPayload.snapshotDate, null, contentReviews),
    ...buildQuestions(agent, "agent", "ai", mergedSources, sourcesPayload.snapshotDate, null, contentReviews)
  ];
  const beforeById = new Map(beforePayload.questions.map((q) => [q.id, q]));
  const formulaImportance = new Map(afterQuestions.map((q) => [q.id, q.importance]));

  // ---- AI 评分复核：本地公式作为约束基线，AI 在 ±6 内给最终分 ----
  const evalCandidates = afterQuestions
    .filter((question) => !beforeById.has(question.id) || formulaImportance.get(question.id) !== beforeById.get(question.id).importance || beforeById.get(question.id).evidence.weightedSupport !== question.evidence.weightedSupport)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MAX_AI_EVAL);
  const aiScores = {};
  let evaluation = { status: "skipped", reviewed: evalCandidates.length, adjusted: 0 };
  const evalStartedAt = Date.now();
  const budgetExhausted = deadline && Date.now() > deadline - 30_000;
  if (profile.aiEvaluation && !partialFinalized && evalCandidates.length && !budgetExhausted) {
    try {
      throwIfAborted(signal);
      const sourceMapNow = new Map(mergedSources.map((source) => [source.id, source]));
      const makeRows = (questions) => questions.map((question) => ({
        id: question.id,
        title: question.title,
        track: question.track,
        category: question.category,
        concept: question.concept,
        angle: question.angle,
        baseline: question.importance,
        evidence: {
          level: question.evidence.level,
          weightedSupport: question.evidence.weightedSupport,
          recentInterviewSamples: question.evidence.recentInterviewSamples
        },
        sources: (question.evidence.sourceIds || []).map((sourceId) => {
          const source = sourceMapNow.get(sourceId);
          return source ? { type: source.type, company: source.company, publishedAt: source.publishedAt, title: source.shortTitle || source.title } : null;
        }).filter(Boolean).slice(0, 6)
      }));
      // 并行分两批（各 ≤20 题），总耗时约等于一批；单批 240s，超时回退公式基线分
      const evalTimeout = deadline ? Math.min(240_000, Math.max(60_000, deadline - Date.now() - 10_000)) : 240_000;
      const batches = [evalCandidates.slice(0, 20), evalCandidates.slice(20)];
      const settled = await Promise.allSettled(batches.map((batch) => batch.length
        ? aiChat(
            [
              { role: "system", content: evaluationSystemPrompt() },
              { role: "user", content: evaluationUserPrompt(makeRows(batch)) }
            ],
            { maxTokens: 4000, temperature: 0.1, timeoutMs: evalTimeout, signal }
          )
        : Promise.reject(new Error("空批次"))));
      const adjustments = [];
      throwIfAborted(signal);
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        try { adjustments.push(...parseEvaluation(result.value)); } catch {}
      }
      if (!adjustments.length && settled.every((result) => result.status === "rejected")) {
        throw settled[0].reason || new Error("评分复核失败");
      }
      const candidatesById = new Map(evalCandidates.map((question) => [question.id, question]));
      for (const item of adjustments) {
        if (!item || typeof item.id !== "string") continue;
        const question = candidatesById.get(item.id);
        if (!question) continue;
        const final = Math.round(Number(item.importance));
        if (!Number.isInteger(final) || final < 0 || final > 98) continue;
        if (Math.abs(final - question.importance) > AI_SCORE_DELTA) continue;
        if (final === question.importance) continue;
        aiScores[question.id] = {
          base: question.importance,
          importance: final,
          note: typeof item.reason === "string" ? item.reason.slice(0, 120) : "AI 复核调整"
        };
      }
      evaluation = { status: "ok", reviewed: evalCandidates.length, adjusted: Object.keys(aiScores).length, durationMs: Date.now() - evalStartedAt };
      for (const question of afterQuestions) {
        const score = aiScores[question.id];
        if (!score) continue;
        question.importance = score.importance;
        question.tier = tierOfScore(score.importance);
        question.scoreBase = score.base;
        question.scoreNote = score.note;
        question.scoreSource = "ai";
      }
      onEvent({ phase: "evaluate", ...evaluation });
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") throw abortError();
      evaluation = { status: "fallback", reviewed: evalCandidates.length, adjusted: 0, error: error.message.slice(0, 160), durationMs: Date.now() - evalStartedAt };
      onEvent({ phase: "evaluate", ...evaluation });
    }
  } else if (partialFinalized) {
    evaluation = { status: "partial-skip", reviewed: evalCandidates.length, adjusted: 0, durationMs: 0 };
    onEvent({ phase: "evaluate", ...evaluation });
  } else if (!profile.aiEvaluation) {
    evaluation = { status: "mode-skip", reviewed: evalCandidates.length, adjusted: 0, durationMs: 0 };
    onEvent({ phase: "evaluate", ...evaluation });
  } else if (budgetExhausted) {
    evaluation = { status: "budget-skip", reviewed: evalCandidates.length, adjusted: 0, durationMs: 0 };
    onEvent({ phase: "evaluate", ...evaluation });
  }

  const rescore = [];
  for (const question of afterQuestions) {
    const before = beforeById.get(question.id);
    if (!before) continue;
    const formula = formulaImportance.get(question.id) ?? question.importance;
    const formulaTier = tierOfScore(formula);
    const formulaChanged =
      before.importance !== formula ||
      before.tier !== formulaTier ||
      before.evidence.level !== question.evidence.level ||
      before.evidence.weightedSupport !== question.evidence.weightedSupport;
    const aiAdjusted = question.scoreSource === "ai" && question.importance !== formula;
    if (!formulaChanged && !aiAdjusted) continue;
    rescore.push({
      id: question.id,
      title: question.title,
      before: { importance: before.importance, tier: before.tier, evidence: before.evidence.level, weightedSupport: before.evidence.weightedSupport },
      formula: { importance: formula, tier: formulaTier, evidence: question.evidence.level, weightedSupport: question.evidence.weightedSupport },
      final: { importance: question.importance, tier: question.tier },
      adjusted: question.scoreSource === "ai",
      note: question.scoreNote || ""
    });
  }
  const newConceptQuestions = afterQuestions
    .filter((question) => !beforeById.has(question.id))
    .map((question) => ({ id: question.id, concept: question.concept, title: question.title, tier: question.tier, importance: question.importance, category: question.category, adjusted: question.scoreSource === "ai", note: question.scoreNote || "" }));
  throwIfAborted(signal);
  const draftExpectedCounts = expectedCounts([...existingDynamicConcepts, ...cleanConcepts]);
  const draftValidation = validatePayload({ questions: afterQuestions }, { sources: mergedSources }, draftExpectedCounts, contentReviewsPayload);
  if (!draftValidation.ok) {
    throw new Error(`新增题目草案校验失败，未生成可应用报告：${draftValidation.errors.slice(0, 3).join("；")}`);
  }

  const draft = {
    generatedAt: new Date().toISOString(),
    newSources,
    newConcepts,
    sourceResults,
    newConceptQuestions,
    existingSourcePatches: Object.entries(linkNames).filter(([sourceId]) => sourceById.has(sourceId)).map(([sourceId, conceptNames]) => ({
      sourceId,
      conceptNames: [...new Set(conceptNames)],
      qualityWarnings: refreshById.get(sourceId)?.qualityWarnings || []
    })),
    sourceRefreshes: sourceRefreshes.map(({ sourceId, collection, engagement, qualityWarnings }) => ({ sourceId, collection, engagement: engagement || null, qualityWarnings })),
    evaluation,
    rescorePreview: {
      affected: rescore.slice(0, 200),
      changed: rescore.length,
      upgraded: rescore.filter((r) => r.final.importance > r.before.importance).length,
      downgraded: rescore.filter((r) => r.final.importance < r.before.importance).length,
      aiAdjusted: rescore.filter((r) => r.adjusted).length,
      formulaChanged: rescore.filter((r) => r.before.importance !== r.formula.importance || r.before.tier !== r.formula.tier || r.before.evidence !== r.formula.evidence).length
    },
    duplicatesSkipped: skipped,
    learningHintConcepts: new Set(hintEntries.map((entry) => entry.conceptName)).size,
    expectedCounts: draftExpectedCounts,
    analysisMode: profile.name,
    partial: partialFinalized ? {
      finalized: true,
      plannedSources: items.length,
      completedSources: sourceResults.filter((item) => item.status === "ok").length,
      skippedSources: Math.max(0, items.length - sourceResults.filter((item) => item.status === "ok").length)
    } : null
  };
  return { draft, newSources, newConcepts, links, aiScores, hintEntries, sourceRefreshes };
}

// ---------------- apply / rollback ----------------

async function restoreBackup(backupDir) {
  await writeFileAtomic(join(root, "content", "questions.json"), await readFile(join(backupDir, "questions.json")));
  await writeFileAtomic(join(root, "research", "sources.json"), await readFile(join(backupDir, "sources.json")));
  if (existsSync(join(backupDir, "new-concepts.json"))) {
    await writeFileAtomic(newConceptsPath, await readFile(join(backupDir, "new-concepts.json")));
  } else {
    await rm(newConceptsPath, { force: true });
  }
  if (existsSync(join(backupDir, "ai-scores.json"))) {
    await writeFileAtomic(aiScoresPath, await readFile(join(backupDir, "ai-scores.json")));
  } else {
    await rm(aiScoresPath, { force: true });
  }
  if (existsSync(join(backupDir, "learning-hints.json"))) {
    await writeFileAtomic(learningHintsPath, await readFile(join(backupDir, "learning-hints.json")));
  } else {
    await rm(learningHintsPath, { force: true });
  }
}

function safeBackupDir(value) {
  const backupsRoot = resolve(localRoot, "backups");
  const candidate = resolve(String(value || ""));
  return candidate.startsWith(`${backupsRoot}${sep}`) ? candidate : null;
}

async function validateCurrentBusinessState(context) {
  const sourcesPayload = await loadSources();
  const questionsPayload = JSON.parse(await readFile(join(root, "content", "questions.json"), "utf8"));
  const validation = validatePayload(questionsPayload, sourcesPayload, expectedCounts(await loadNewConcepts()), await loadContentReviews());
  if (!validation.ok) throw new Error(`${context}校验未通过：${validation.errors.slice(0, 3).join("；")}`);
  return questionsPayload;
}

export async function recoverInterruptedMutation() {
  let transaction;
  try {
    transaction = JSON.parse(await readFile(mutationPath, "utf8"));
  } catch {
    return null;
  }
  const backupDir = safeBackupDir(transaction?.backupDir);
  if (!backupDir) throw new Error("检测到无效的内容更新恢复标记，已停止启动以避免覆盖题库。");
  await restoreBackup(backupDir);
  const questionsPayload = await validateCurrentBusinessState("中断恢复后");
  const history = {
    rolledBackAt: new Date().toISOString(),
    from: backupDir,
    recoveredInterruptedMutation: true,
    interruptedOperation: transaction.operation || "apply",
    counts: questionsPayload.counts
  };
  await writeJsonAtomic(historyPath, history);
  await rm(mutationPath, { force: true });
  return history;
}

export async function readLastUpdate() {
  try {
    return JSON.parse(await readFile(historyPath, "utf8"));
  } catch {
    return null;
  }
}

export async function applyUpdate({ selectedSourceIds = null, selectedConceptNames = null, lastRun }) {
  if (!lastRun || !lastRun.draft) throw new Error("没有待应用的更新草稿，请先运行一次更新分析。");
  const currentSourcesPayload = await loadSources();
  const existingSourceIdSet = new Set(currentSourcesPayload.sources.map((source) => source.id));
  const wantedSources = selectedSourceIds ? new Set(selectedSourceIds) : null;
  const wantedConcepts = selectedConceptNames ? new Set(selectedConceptNames) : null;
  const newSources = lastRun.newSources.filter((source) => !wantedSources || wantedSources.has(source.id));
  const selectedSourceIdSet = new Set(newSources.map((source) => source.id));
  const allowedSourceIds = new Set([...existingSourceIdSet, ...selectedSourceIdSet]);
  const newConcepts = lastRun.newConcepts
    .filter((concept) => !wantedConcepts || wantedConcepts.has(concept.name))
    .map(({ originSource, ...rest }) => ({ ...rest, sourceIds: rest.sourceIds.filter((id) => allowedSourceIds.has(id)) }))
    .filter((concept) => concept.sourceIds.length);
  const links = lastRun.links.filter((link) => allowedSourceIds.has(link.sourceId));
  const selectedHintEntries = (lastRun.hintEntries || []).filter((entry) => allowedSourceIds.has(entry.sourceId));
  const sourceRefreshes = (lastRun.sourceRefreshes || []).filter((refresh) => existingSourceIdSet.has(refresh.sourceId));

  if (!newSources.length && !newConcepts.length && !links.length && !sourceRefreshes.length) throw new Error("没有选择任何更新内容。");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupsRoot = join(localRoot, "backups");
  await mkdir(backupsRoot, { recursive: true });
  const backupDir = await mkdtemp(join(backupsRoot, `update-${stamp}-`));
  await copyFile(join(root, "content", "questions.json"), join(backupDir, "questions.json"));
  await copyFile(join(root, "research", "sources.json"), join(backupDir, "sources.json"));
  if (existsSync(newConceptsPath)) await copyFile(newConceptsPath, join(backupDir, "new-concepts.json"));
  if (existsSync(aiScoresPath)) await copyFile(aiScoresPath, join(backupDir, "ai-scores.json"));
  if (existsSync(learningHintsPath)) await copyFile(learningHintsPath, join(backupDir, "learning-hints.json"));
  await writeJsonAtomic(mutationPath, { schemaVersion: 1, operation: "apply", startedAt: new Date().toISOString(), backupDir });

  try {
    const sourcesPayload = await loadSources();
    const linkNames = {};
    for (const link of links) (linkNames[link.sourceId] ||= []).push(link.conceptName);
    const refreshById = new Map(sourceRefreshes.map((refresh) => [refresh.sourceId, refresh]));
    sourcesPayload.sources = sourcesPayload.sources.map((source) => {
      const { sourceId: _sourceId, ...refresh } = refreshById.get(source.id) || {};
      return {
        ...source,
        ...refresh,
        supportsConcepts: [...new Set([...(source.supportsConcepts || []), ...(linkNames[source.id] || [])])]
      };
    });
    sourcesPayload.sources.push(...newSources.map((source) => ({ ...source, supportsConcepts: [...new Set(linkNames[source.id] || [])] })));
    sourcesPayload.snapshotDate = new Date().toISOString().slice(0, 10);
    await writeJsonAtomic(join(root, "research", "sources.json"), sourcesPayload);

    const existingNew = await loadNewConcepts();
    const mergedConcepts = [...existingNew, ...newConcepts.filter((concept) => !existingNew.some((item) => item.name === concept.name))];
    if (mergedConcepts.length) {
      await mkdir(dirname(newConceptsPath), { recursive: true });
      await writeJsonAtomic(newConceptsPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), concepts: mergedConcepts });
    } else {
      await rm(newConceptsPath, { force: true });
    }

    const { buildPayload, buildQuestions, allCatalogConcepts, loadAiScores, loadContentReviews } = await import("./generate-questions.mjs");
    const sourcesAfterWrite = await loadSources();
    const { backend: bConcepts, agent: aConcepts } = allCatalogConcepts(await loadNewConcepts());
    const contentReviews = (await loadContentReviews()).questions || {};
    const formulaQuestions = [
      ...buildQuestions(bConcepts, "backend", "be", sourcesAfterWrite.sources, sourcesAfterWrite.snapshotDate, null, contentReviews),
      ...buildQuestions(aConcepts, "agent", "ai", sourcesAfterWrite.sources, sourcesAfterWrite.snapshotDate, null, contentReviews)
    ];
    const baseById = new Map(formulaQuestions.map((q) => [q.id, q.importance]));
    const existingScores = await loadAiScores();
    const mergedScores = { ...existingScores };
    let aiScoreAdjustments = 0;
    for (const [id, entry] of Object.entries(lastRun.aiScores || {})) {
      if (baseById.get(id) !== entry.base) continue;
      mergedScores[id] = { base: entry.base, importance: entry.importance, note: entry.note, updatedAt: new Date().toISOString() };
      aiScoreAdjustments += 1;
    }
    for (const id of Object.keys(mergedScores)) {
      if (!baseById.has(id)) delete mergedScores[id];
    }
    if (Object.keys(mergedScores).length) {
      await writeJsonAtomic(aiScoresPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), scores: mergedScores });
    } else {
      await rm(aiScoresPath, { force: true });
    }

    const existingHints = await loadLearningHints();
    const mergedHints = { ...existingHints };
    let learningHintConcepts = 0;
    for (const entry of selectedHintEntries) {
      const merged = sanitizeLearningHints([...(mergedHints[entry.conceptName] || []), ...entry.hints]);
      if (!merged.length) continue;
      if (!mergedHints[entry.conceptName]) learningHintConcepts += 1;
      mergedHints[entry.conceptName] = merged;
    }
    if (Object.keys(mergedHints).length) {
      await writeJsonAtomic(learningHintsPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), hints: mergedHints });
    } else {
      await rm(learningHintsPath, { force: true });
    }

    const generated = await buildPayload();
    await writeJsonAtomic(join(root, "content", "questions.json"), generated);

    const sourcesAfter = await loadSources();
    const validation = validatePayload(generated, sourcesAfter, expectedCounts(await loadNewConcepts()), await loadContentReviews());
    if (!validation.ok) {
      throw new Error(`更新后校验失败：${validation.errors.slice(0, 3).join("；")}`);
    }

    const patchedSources = Object.keys(linkNames).filter((sourceId) => existingSourceIdSet.has(sourceId)).length;
    const history = { appliedAt: new Date().toISOString(), backupDir, addedSources: newSources.length, patchedSources, refreshedSources: sourceRefreshes.length, addedConcepts: newConcepts.length, aiScoreAdjustments, learningHintConcepts, counts: generated.counts };
    await writeJsonAtomic(historyPath, history);
    await rm(mutationPath, { force: true });
    return { applied: true, counts: generated.counts, backupDir, history };
  } catch (error) {
    try {
      await restoreBackup(backupDir);
      await validateCurrentBusinessState("自动回滚后");
      await rm(mutationPath, { force: true });
    } catch (restoreError) {
      throw new Error(`${error.message}；自动回滚未完成：${restoreError.message}。下次启动会继续从备份恢复。`);
    }
    throw new Error(`${error.message}（已自动回滚）`);
  }
}

export async function rollbackLatest() {
  const backupsRoot = join(localRoot, "backups");
  let dirs = [];
  try {
    dirs = (await readdir(backupsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  } catch {
    dirs = [];
  }
  if (!dirs.length) throw new Error("没有可恢复的备份。");
  const backupDir = join(backupsRoot, dirs[0]);
  await writeJsonAtomic(mutationPath, { schemaVersion: 1, operation: "rollback", startedAt: new Date().toISOString(), backupDir });
  await restoreBackup(backupDir);
  const questionsPayload = await validateCurrentBusinessState("恢复后");
  const history = { rolledBackAt: new Date().toISOString(), from: backupDir, counts: questionsPayload.counts };
  await writeJsonAtomic(historyPath, history);
  await rm(mutationPath, { force: true });
  return { rolledBack: true, from: backupDir, counts: questionsPayload.counts };
}
