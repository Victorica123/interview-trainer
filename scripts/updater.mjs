import { readFile, mkdir, copyFile, rm, readdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { buildQuestions, allCatalogConcepts, loadSources, loadNewConcepts, loadLearningHints, loadContentReviews, loadContentEnhancements, sanitizeLearningHints } from "./generate-questions.mjs";
import { browserStatus, browserFetchText } from "./browser-login.mjs";
import { validatePayload, expectedCounts } from "./validate-data.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./local-json.mjs";
import { detectPlatform, extractExplicitEngagement } from "./source-insights.mjs";
import { BACKEND_TAXONOMY, migrateLegacyBackendCategory } from "./taxonomy.mjs";
import { assessInterviewPost, extractNowcoderMainPost, matchKnownConcepts } from "./source-discovery.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const localRoot = join(root, ".local");
const historyPath = join(localRoot, "update-history.json");
const mutationPath = join(localRoot, "content-mutation.json");
const newConceptsPath = join(root, "research", "new-concepts.json");
const conceptCandidatesPath = join(root, "research", "concept-candidates.json");
const aiScoresPath = join(root, "research", "ai-scores.json");
const learningHintsPath = join(root, "research", "learning-hints.json");
const ANALYSIS_CACHE_SCHEMA = 4;
const EXTRACTION_PROMPT_VERSION = "2026-08-29-7";
const QUESTION_BANK_TARGET = 1_000;
const MAX_NEW_CONCEPTS_PER_RUN = 3;
const BATCH_CIRCUIT_FAILURES = 3;

export const ALL_CATEGORIES = [...new Set([...backendConcepts, ...agentConcepts].map((concept) => concept.category))];
export const EXISTING_CONCEPT_NAMES = [...backendConcepts, ...agentConcepts].map((concept) => concept.name);
const BACKEND_CATEGORIES = new Set(backendConcepts.map((concept) => concept.category));
const AGENT_CATEGORIES = new Set(agentConcepts.map((concept) => concept.category));
const BACKEND_TOPIC_GROUPS = new Map(BACKEND_TAXONOMY.map((category) => [category.name, category.groups.map((group) => group.name)]));
const SOURCE_TYPES = ["interview", "job", "guide", "official", "research"];

async function loadConceptCandidates() {
  try {
    const payload = JSON.parse(await readFile(conceptCandidatesPath, "utf8"));
    return Array.isArray(payload.candidates) ? payload.candidates.filter((candidate) => candidate && typeof candidate.name === "string") : [];
  } catch {
    return [];
  }
}

// ---------------- text / fetch helpers ----------------

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function todayInChina() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function ensureConceptText(value, maxLength, fallback) {
  const text = cleanText(value, maxLength);
  if (text.length >= 40) return text;
  return cleanText(`${text}${text ? "；" : ""}${fallback}`, maxLength);
}

const ANALYSIS_PROFILES = {
  scale: { name: "scale", concurrency: 6, inputChars: 2400, extractionTokens: 6000, candidateLimit: 40, maxConcepts: 8, aiEvaluation: false, batchSize: 8, batchConcurrency: 3, deterministic: true },
  compatible: { name: "compatible", concurrency: 1, inputChars: 3200, extractionTokens: 1600, candidateLimit: 32, maxConcepts: 6, aiEvaluation: false, batchSize: 1, batchConcurrency: 1, deterministic: true },
  balanced: { name: "balanced", concurrency: 4, inputChars: 5600, extractionTokens: 6500, candidateLimit: 72, maxConcepts: 10, aiEvaluation: true, batchSize: 6, batchConcurrency: 2, deterministic: true },
  quality: { name: "quality", concurrency: 3, inputChars: 8000, extractionTokens: 7000, candidateLimit: Infinity, maxConcepts: 16, aiEvaluation: true, batchSize: 5, batchConcurrency: 2, deterministic: false }
};

function analysisProfile(mode) {
  return ANALYSIS_PROFILES[mode] || ANALYSIS_PROFILES.scale;
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

function evidenceTerms(concept) {
  const namedTerms = [concept?.name].flatMap((value) => {
    const text = String(value || "").trim();
    return [text, ...text.split(/[、，,\/与和及或()（）]+/u)].map(normalizedSearchText);
  }).filter((term) => term.length >= 2);
  const tagTerms = (Array.isArray(concept?.tags) ? concept.tags : [])
    .map(normalizedSearchText)
    .filter((term) => term.length >= 3 || (term.length >= 2 && /[a-z0-9]/i.test(term)));
  return [...new Set([...namedTerms, ...tagTerms])].sort((a, b) => b.length - a.length);
}

export function groundAiExtraction(parsed, input, knownConceptByName) {
  const concepts = Array.isArray(parsed?.concepts) ? parsed.concepts : [];
  const sourceText = normalizedSearchText(input.promptText);
  const accepted = [];
  const rejected = [];
  for (const concept of concepts) {
    if (!concept || typeof concept.name !== "string" || !concept.name.trim()) {
      rejected.push({ name: "未命名概念", reason: "概念名称缺失" });
      continue;
    }
    const name = concept.name.trim();
    const quote = cleanText(concept.evidenceQuote, 240);
    const normalizedQuote = normalizedSearchText(quote);
    if (normalizedQuote.length < 4) {
      rejected.push({ name, reason: "缺少足够长的正文证据句" });
      continue;
    }
    if (!sourceText.includes(normalizedQuote)) {
      rejected.push({ name, reason: "证据句不是正文中的连续原文" });
      continue;
    }
    const mappedName = typeof concept.mapsToExisting === "string" && knownConceptByName.has(concept.mapsToExisting)
      ? concept.mapsToExisting
      : knownConceptByName.has(name) ? name : null;
    const evidenceConcept = mappedName ? knownConceptByName.get(mappedName) : concept;
    if (!evidenceTerms(evidenceConcept).some((term) => normalizedQuote.includes(term))) {
      rejected.push({ name: mappedName || name, reason: "证据句与目标知识点没有可验证的名称或同义标签" });
      continue;
    }
    accepted.push({ ...concept, name, evidenceQuote: quote });
  }
  return {
    parsed: { ...parsed, concepts: accepted },
    accepted: accepted.length,
    rejected,
    suspicious: concepts.length > 0 && accepted.length === 0
  };
}

function groundingError(grounded) {
  const detail = grounded.rejected.slice(0, 3).map((entry) => `${entry.name}：${entry.reason}`).join("；");
  const error = new Error(`模型知识点缺少可核对的正文证据${detail ? `（${detail}）` : ""}`);
  error.code = "EVIDENCE_GROUNDING";
  return error;
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
    if (type.includes("html") && /(^|\.)nowcoder\.com$/.test(parsed.hostname)) {
      const post = extractNowcoderMainPost(text, { url });
      if (post.title && post.content) return `标题：${post.title}\n发布日期：${post.publishedAt || "未知"}\n${post.content}`.slice(0, 14000);
    }
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
importance = min(98, 46 + 概念优先级×4 + 角度奖励 + 饱和面经频次(≤16) + 来源多样性(≤5) + 交叉验证(≤2) + 公开题库关注度(≤2))
面经先按正文指纹簇去重并随时间衰减，聚合帖只按0.32倍计入；频次使用指数饱和曲线。岗位/指南/官方资料只作交叉验证，不虚增面经频次。公开题库关注度由本地公开标题快照确定，单快照保持低置信且最多加2分，AI不得把它改写成真实面经频次。

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
13. 每个概念必须给出 evidenceQuote：从本次正文原样复制的一段连续证据句（建议 12-180 字），必须能直接看出该知识点确实被问到或讨论。禁止改写、概括或拼接不连续片段；没有直接证据就不要输出该概念。

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
      "evidenceQuote": "从正文逐字复制的连续证据句",
      "learningHints": [{"site": "JavaGuide", "title": "对应章节名", "url": "章节直达链接或空字符串"}]
    }
  ]
}`;
}

function extractionUserPrompt(ref, text, existingConceptNames = EXISTING_CONCEPT_NAMES, maxConcepts = 12, compatible = false, correction = "") {
  return `本地检索得到的候选现有概念（同义时 mapsToExisting 必须使用其中的精确名称）：\n${existingConceptNames.join("、")}\n\n本次最多提取 ${maxConcepts} 个最有面试价值的概念。${compatible ? "优先保证 JSON 完整；不确定的 learningHints 直接给空数组。" : ""}${correction ? `\n上一次结果未通过本地证据检查：${correction}。请删除无证据概念并重新从正文逐字复制 evidenceQuote。` : ""}\n来源 URL：${ref.url || "无（手动粘贴文本）"}\n来源线索：${cleanText(ref.shortTitle || ref.title || ref.label || "", 200)}\n\n本地筛选后的相关正文：\n${text}`;
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

function batchExtractionSystemPrompt() {
  return `${extractionSystemPrompt()}\n\n## 批量输入补充规则\n本次 user 消息包含多个来源。请返回 {"items":[...]}，每个输入 key 必须原样返回一次；每个 items 元素结构为 {"key":"...","source":同上,"concepts":同上}。不同来源不得互相复制公司、日期或 evidenceQuote；每条 evidenceQuote 只能来自该 key 自己的 text。`;
}

function batchExtractionUserPrompt(entries, maxConcepts, compatible = false) {
  return `请一次分析下面 ${entries.length} 个相互独立的来源。每个来源最多保留 ${maxConcepts} 个最有价值概念。${compatible ? "优先保证 JSON 可完整解析。" : "已有概念的同义问法必须映射，不要重复发明新概念。"}\n${JSON.stringify({
    sources: entries.map((entry) => ({
      key: entry.key,
      url: entry.item.ref.url || null,
      label: cleanText(entry.item.ref.shortTitle || entry.item.ref.title || entry.item.ref.label || entry.item.ref.url, 160),
      existingCandidates: entry.candidateNames,
      text: entry.promptText
    }))
  })}`;
}

export function parseBatchExtraction(raw) {
  const fenced = String(raw || "").match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  const candidate = fenced ? fenced[1] : String(raw || "");
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("批量模型输出中没有 JSON 对象");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("批量模型输出缺少 items 数组");
  return parsed.items;
}

const EXPLICIT_COMPANIES = ["阿里巴巴", "阿里", "蚂蚁", "字节跳动", "字节", "腾讯", "美团", "拼多多", "京东", "百度", "快手", "滴滴", "小米", "网易", "华为", "携程", "小红书", "得物", "虾皮", "Shopee", "微软", "亚马逊"];

function deterministicExtraction(item, promptText, knownConcepts) {
  if (!item.ref.url || detectPlatform(item.ref.url).id !== "nowcoder") return null;
  const title = promptText.match(/^标题：(.+)$/m)?.[1]?.trim() || cleanText(item.ref.title || item.ref.shortTitle, 180);
  const publishedAt = promptText.match(/^发布日期：(\d{4}-\d{2}-\d{2})$/m)?.[1] || null;
  const content = promptText.replace(/^标题：.*$/m, "").replace(/^发布日期：.*$/m, "").trim();
  const assessment = assessInterviewPost({ title, content, publishedAt, url: item.ref.url }, knownConcepts);
  if (!assessment.accepted || !assessment.directQuestionEvidence) return null;
  const names = matchKnownConcepts(content, knownConcepts, 14);
  if (!names.length) return null;
  const company = EXPLICIT_COMPANIES.find((name) => title.toLowerCase().includes(name.toLowerCase())) || null;
  const candidateLevel = /实习|暑期|日常实习/.test(title) ? "intern" : /校招|秋招|春招|应届|2[6-9]届/.test(title) ? "campus" : /社招|[1-9]\d*年经验/.test(title) ? "experienced" : "unknown";
  const position = /agent|智能体|大模型|llm|rag|ai开发|ai应用/i.test(title) ? "AI / Agent 相关岗位" : /java|后端|服务端/i.test(title) ? "Java / 后端相关岗位" : null;
  return {
    source: {
      title,
      type: "interview",
      company,
      publishedAt,
      position,
      candidateLevel,
      directQuestionEvidence: true,
      weight: assessment.promotional ? 0.55 : assessment.aggregate ? 0.62 : 0.92,
      notes: `本地高置信预筛：${assessment.evidence.total} 个问题信号；${assessment.aggregate ? "聚合内容已降权" : "直接面经"}`
    },
    concepts: names.map((name) => ({ name, mapsToExisting: name, learningHints: [] }))
  };
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
importance = min(98, 46 + 概念优先级×4 + 角度奖励(2~5) + 饱和面经频次(≤16) + 来源多样性(≤5) + 交叉验证(≤2) + 公开题库关注度(≤2))
面经证据按转载簇去重、时间衰减、聚合帖降权后进入指数饱和曲线；岗位、指南和官方资料不作为面经出现次数。公开题库标题只提供单独的低置信关注度，不能被当作面经样本或高置信趋势。
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

function sourceDiscoveryAudit(item, sourceMeta) {
  const normalized = normalizedSearchText(item.text).slice(0, 20_000);
  const contentHash = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  const questionSignals = (String(item.text).match(/[?？]|为什么|如何|怎么|区别|原理|机制|排查|实现/g) || []).length;
  const aggregate = /多公司|汇总|合集|盘点|题库|八股文|推广|内推/.test(`${sourceMeta.company || ""} ${sourceMeta.title || ""} ${sourceMeta.notes || ""}`);
  return {
    analysisVersion: EXTRACTION_PROMPT_VERSION,
    sitemapLastModified: null,
    contentHash,
    duplicateClusterId: `cluster-${createHash("sha256").update(normalized.slice(0, 4_000)).digest("hex").slice(0, 20)}`,
    sourceKind: aggregate ? "aggregate" : "direct-experience",
    questionSignals
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

function conceptPromotionStats(concept, sources, asOf = new Date()) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const uniqueByCluster = new Map();
  for (const sourceId of concept.sourceIds || []) {
    const source = sourceMap.get(sourceId);
    if (!source) continue;
    const cluster = source.discovery?.duplicateClusterId || source.id;
    const current = uniqueByCluster.get(cluster);
    if (!current || Number(source.weight || 0) > Number(current.weight || 0)) uniqueByCluster.set(cluster, source);
  }
  const independent = [...uniqueByCluster.values()];
  const eligible = independent.filter((source) => source.type === "interview" && source.directQuestionEvidence && source.collection?.frequencyEligible !== false && source.discovery?.sourceKind !== "aggregate");
  const recent = eligible.filter((source) => {
    const time = new Date(`${source.publishedAt || ""}T00:00:00Z`).getTime();
    return Number.isFinite(time) && asOf.getTime() - time <= 180 * 86_400_000;
  });
  const companies = new Set(eligible.map((source) => source.company).filter((company) => company && !/多公司|汇总|等|[\/、]/.test(company)));
  const platforms = new Set(eligible.map((source) => detectPlatform(source.url).id).filter((platform) => platform && platform !== "manual"));
  const qualified = eligible.length >= 3 && recent.length >= 3 && (companies.size >= 2 || platforms.size >= 2 || eligible.length >= 5);
  return {
    independentSources: independent.length,
    eligibleSources: eligible.length,
    recentSources: recent.length,
    companyCount: companies.size,
    platformCount: platforms.size,
    qualified,
    reason: qualified ? "达到独立来源、近期重复与来源多样性门槛" : `观察中：需 ≥3 个近期独立直接面经，且覆盖 ≥2 家公司/平台（当前 ${recent.length} 个近期、${companies.size} 家公司、${platforms.size} 个平台）`
  };
}

function mergeConceptObservation(previous, current) {
  const merged = { ...(previous || {}), ...(current || {}) };
  merged.name = current?.name || previous?.name;
  merged.sourceIds = [...new Set([...(previous?.sourceIds || []), ...(current?.sourceIds || [])])];
  delete merged.originSource;
  return merged;
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
  if (keys.length > 5_000) {
    const sorted = keys.sort((a, b) => (entries[b].analyzedAt || "").localeCompare(entries[a].analyzedAt || ""));
    for (const key of sorted.slice(5_000)) delete entries[key];
  }
  try {
    await mkdir(localRoot, { recursive: true });
    await writeJsonAtomic(join(localRoot, "analysis-cache.json"), { schemaVersion: ANALYSIS_CACHE_SCHEMA, promptVersion: EXTRACTION_PROMPT_VERSION, entries });
  } catch {}
}

export function summarizeTelemetry(samples, label = "自定义模型") {
  const clean = (Array.isArray(samples) ? samples : []).filter((sample) => Number.isFinite(sample?.durationMs) && sample.durationMs >= 0);
  const durations = clean.map((sample) => Math.round(sample.durationMs)).sort((a, b) => a - b);
  const percentile = (ratio) => durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * ratio))] : null;
  const byStage = {};
  for (const sample of clean) {
    const stage = cleanText(sample.stage, 60) || "unknown";
    const bucket = byStage[stage] ||= { calls: 0, ok: 0, requestErrors: 0, parseErrors: 0, totalDurationMs: 0 };
    bucket.calls += 1;
    bucket.totalDurationMs += Math.round(sample.durationMs);
    if (sample.status === "ok") bucket.ok += 1;
    else if (sample.status === "parse-error") bucket.parseErrors += 1;
    else bucket.requestErrors += 1;
  }
  for (const bucket of Object.values(byStage)) {
    bucket.averageDurationMs = bucket.calls ? Math.round(bucket.totalDurationMs / bucket.calls) : null;
    delete bucket.totalDurationMs;
  }
  return {
    localOnly: true,
    label: cleanText(label, 80) || "自定义模型",
    calls: clean.length,
    ok: clean.filter((sample) => sample.status === "ok").length,
    requestErrors: clean.filter((sample) => sample.status === "request-error").length,
    parseErrors: clean.filter((sample) => sample.status === "parse-error").length,
    durationMs: {
      average: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: durations.at(-1) ?? null
    },
    byStage
  };
}

export async function runAnalysis({ autoFetch = true, maxAutoSources = 80, manualUrls = [], manualTexts = [], aiChat, onEvent = () => {}, perSourceTimeoutMs = 300_000, budgetMs = 30 * 60_000, analysisMode = "scale", signal, finalizeSignal, telemetryEnabled = false, telemetryLabel = "自定义模型" } = {}) {
  if (typeof aiChat !== "function") throw new Error("缺少 aiChat 函数");
  throwIfAborted(signal);
  const deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
  const profile = analysisProfile(analysisMode);
  const sourcesPayload = await loadSources();
  const existingDynamicConcepts = await loadNewConcepts();
  const existingConceptCandidates = await loadConceptCandidates();
  const contentReviewsPayload = await loadContentReviews();
  const contentReviews = contentReviewsPayload.questions || {};
  const contentEnhancements = await loadContentEnhancements();
  const knownConcepts = [...backendConcepts, ...agentConcepts, ...existingDynamicConcepts];
  const knownConceptNames = [...new Set(knownConcepts.map((concept) => concept.name).filter(Boolean))];
  const knownConceptSet = new Set(knownConceptNames);
  const knownConceptByName = new Map(knownConcepts.map((concept) => [concept.name, concept]));
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
        .filter((source) => source.type === "interview" && source.url)
        .sort((a, b) => {
          const stale = String(a.collection?.capturedAt || "").localeCompare(String(b.collection?.capturedAt || ""));
          return stale || String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
        })
        .slice(0, Math.min(200, Math.max(1, Number(maxAutoSources) || 80)))
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
      aiBatchSize: profile.batchSize,
      aiBatchConcurrency: profile.batchConcurrency,
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

  const analysisInputs = new Map();
  const preparedAnalyses = new Map();
  const aiPerformance = {
    calls: 0,
    batchCalls: 0,
    singleCalls: 0,
    singleRetries: 0,
    cacheHits: 0,
    deterministicSources: 0,
    batchSources: 0,
    fallbackSingleSources: 0,
    evidenceAccepted: 0,
    evidenceRejected: 0,
    semanticRechecks: 0,
    batchCircuitTrips: 0,
    batchBypassedSources: 0
  };
  const telemetrySamples = [];
  const trackedAi = async (stage, messages, options, parse) => {
    const startedAt = Date.now();
    let rawReceived = false;
    try {
      const raw = await aiChat(messages, options);
      rawReceived = true;
      const parsed = parse(raw);
      if (telemetryEnabled) telemetrySamples.push({ stage, status: "ok", durationMs: Date.now() - startedAt });
      return parsed;
    } catch (error) {
      if (telemetryEnabled) telemetrySamples.push({
        stage,
        status: rawReceived ? "parse-error" : "request-error",
        durationMs: Date.now() - startedAt,
        errorClass: cleanText(error?.code || error?.name || "Error", 60)
      });
      throw error;
    }
  };
  const unresolved = [];
  items.forEach((item, index) => {
    const promptText = selectRelevantText(item.text, profile.inputChars);
    const candidateNames = selectCandidateConceptNames(promptText, knownConcepts, profile.candidateLimit);
    const cacheKey = textHash(item.kind, promptText, `${profile.name}\0${candidateNames.join("\0")}`);
    const input = { key: `source-${index + 1}`, item, promptText, candidateNames, cacheKey };
    analysisInputs.set(item, input);
    const cached = analysisCache[cacheKey];
    if (cached && Array.isArray(cached.concepts) && cached.source && typeof cached.source === "object") {
      preparedAnalyses.set(item, { parsed: { source: cached.source, concepts: cached.concepts }, method: "cache" });
      aiPerformance.cacheHits += 1;
      return;
    }
    const deterministic = profile.deterministic ? deterministicExtraction(item, promptText, knownConcepts) : null;
    if (deterministic) {
      preparedAnalyses.set(item, { parsed: deterministic, method: "deterministic" });
      analysisCache[cacheKey] = { analyzedAt: new Date().toISOString(), source: deterministic.source, concepts: deterministic.concepts, method: "deterministic" };
      cacheDirty = true;
      aiPerformance.deterministicSources += 1;
      return;
    }
    unresolved.push(input);
  });

  let consecutiveBatchFailures = 0;
  let batchCircuitOpen = false;
  if (profile.batchSize > 1 && unresolved.length) {
    const batches = [];
    for (let index = 0; index < unresolved.length; index += profile.batchSize) batches.push(unresolved.slice(index, index + profile.batchSize));
    await runPool(batches, profile.batchConcurrency, async (batch) => {
      if (deadline && Date.now() > deadline) return;
      const batchId = `batch-${batches.indexOf(batch) + 1}`;
      if (batchCircuitOpen) {
        aiPerformance.batchBypassedSources += batch.length;
        onEvent({ phase: "batch", id: batchId, status: "circuit-bypass", sources: batch.length });
        return;
      }
      onEvent({ phase: "batch", id: batchId, status: "pending", sources: batch.length });
      const startedAt = Date.now();
      const storeBatchResult = (raw) => {
        const parsedItems = parseBatchExtraction(raw);
        const byKey = new Map(parsedItems.filter((entry) => entry && typeof entry.key === "string").map((entry) => [entry.key, entry]));
        let usable = 0;
        for (const input of batch) {
          const entry = byKey.get(input.key);
          if (!entry || !Array.isArray(entry.concepts) || !entry.source || typeof entry.source !== "object") continue;
          const grounded = groundAiExtraction({ source: entry.source, concepts: entry.concepts }, input, knownConceptByName);
          aiPerformance.evidenceAccepted += grounded.accepted;
          aiPerformance.evidenceRejected += grounded.rejected.length;
          if (grounded.suspicious) {
            aiPerformance.semanticRechecks += 1;
            continue;
          }
          const parsed = grounded.parsed;
          preparedAnalyses.set(input.item, { parsed, method: "batch-ai" });
          analysisCache[input.cacheKey] = { analyzedAt: new Date().toISOString(), source: parsed.source, concepts: parsed.concepts, method: "batch-ai" };
          cacheDirty = true;
          usable += 1;
        }
        if (!usable) throw new Error("批量结果没有可用来源");
        aiPerformance.batchSources += usable;
        return usable;
      };
      try {
        aiPerformance.calls += 1;
        aiPerformance.batchCalls += 1;
        const usable = await trackedAi("batch-extraction",
          [
            { role: "system", content: batchExtractionSystemPrompt() },
            { role: "user", content: batchExtractionUserPrompt(batch, profile.maxConcepts, profile.name === "compatible") }
          ],
          { maxTokens: profile.extractionTokens, temperature: 0.15, timeoutMs: perSourceTimeoutMs, signal: combineSignals(signal, finalizeSignal) },
          storeBatchResult
        );
        consecutiveBatchFailures = 0;
        onEvent({ phase: "batch", id: batchId, status: "ok", sources: batch.length, usable, durationMs: Date.now() - startedAt });
      } catch (error) {
        if (signal?.aborted) throw abortError();
        try {
          const compactBatch = batch.map((input) => ({ ...input, promptText: selectRelevantText(input.promptText, 1_200) }));
          aiPerformance.calls += 1;
          aiPerformance.batchCalls += 1;
          const usable = await trackedAi("batch-retry",
            [
              { role: "system", content: batchExtractionSystemPrompt() },
              { role: "user", content: batchExtractionUserPrompt(compactBatch, Math.min(6, profile.maxConcepts), true) }
            ],
            { maxTokens: Math.min(4_500, profile.extractionTokens), temperature: 0.1, timeoutMs: perSourceTimeoutMs, signal: combineSignals(signal, finalizeSignal) },
            storeBatchResult
          );
          consecutiveBatchFailures = 0;
          onEvent({ phase: "batch", id: batchId, status: "ok", sources: batch.length, usable, retry: true, durationMs: Date.now() - startedAt });
        } catch (retryError) {
          if (signal?.aborted) throw abortError();
          consecutiveBatchFailures += 1;
          if (!batchCircuitOpen && consecutiveBatchFailures >= BATCH_CIRCUIT_FAILURES) {
            batchCircuitOpen = true;
            aiPerformance.batchCircuitTrips += 1;
            onEvent({ phase: "batch", id: "batch-circuit", status: "circuit-open", failures: consecutiveBatchFailures });
          }
          onEvent({ phase: "batch", id: batchId, status: "fallback", sources: batch.length, error: String(retryError.message || error).slice(0, 160), durationMs: Date.now() - startedAt });
        }
      }
    }, signal, finalizeSignal);
    if (cacheDirty) await persistCache();
  }

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
      const analysisInput = analysisInputs.get(item);
      const { promptText, candidateNames, cacheKey } = analysisInput;
      const prepared = preparedAnalyses.get(item);
      let parsed;
      let analysisMethod = prepared?.method || "single-ai";
      if (prepared) {
        parsed = prepared.parsed;
      } else {
        const workSignal = combineSignals(signal, finalizeSignal);
        const chatOptions = { maxTokens: profile.extractionTokens, temperature: 0.2, timeoutMs: perSourceTimeoutMs };
        const parseGrounded = (raw) => {
          const grounded = groundAiExtraction(parseExtraction(raw), analysisInput, knownConceptByName);
          aiPerformance.evidenceAccepted += grounded.accepted;
          aiPerformance.evidenceRejected += grounded.rejected.length;
          if (grounded.suspicious) throw groundingError(grounded);
          return grounded.parsed;
        };
        try {
          aiPerformance.calls += 1;
          aiPerformance.singleCalls += 1;
          parsed = await trackedAi("single-extraction",
            [
              { role: "system", content: extractionSystemPrompt() },
              { role: "user", content: extractionUserPrompt(item.ref, promptText, candidateNames, profile.maxConcepts, profile.name === "compatible") }
            ],
            { ...chatOptions, signal: workSignal },
            parseGrounded
          );
        } catch (firstError) {
          if (finalizeSignal?.aborted) throw firstError;
          if (signal?.aborted) throw abortError();
          if (deadline && Date.now() > deadline) throw firstError;
          if (firstError.code === "EVIDENCE_GROUNDING") aiPerformance.semanticRechecks += 1;
          aiPerformance.singleRetries += 1;
          onEvent({ phase: "analyze", label, status: "pending", retry: true });
          aiPerformance.calls += 1;
          aiPerformance.singleCalls += 1;
          const compactText = selectRelevantText(promptText, Math.max(1200, Math.floor(profile.inputChars / 2)));
          parsed = await trackedAi("single-retry",
            [
              { role: "system", content: extractionSystemPrompt() },
              { role: "user", content: extractionUserPrompt(item.ref, compactText, candidateNames, profile.maxConcepts, true, cleanText(firstError.message, 180)) }
            ],
            { ...chatOptions, maxTokens: Math.max(800, Math.floor(profile.extractionTokens * 0.75)), signal: workSignal },
            parseGrounded
          );
        }
        aiPerformance.fallbackSingleSources += 1;
        analysisCache[cacheKey] = { analyzedAt: new Date().toISOString(), source: parsed.source, concepts: parsed.concepts, method: analysisMethod };
        cacheDirty = true;
        await persistCache();
      }
      throwIfAborted(signal);
      const sourceMeta = parsed.source && typeof parsed.source === "object" ? parsed.source : {};
      const existingSource = sourceById.get(item.ref.id) || sourceByUrl.get(normalizedSourceUrl(item.ref.url));
      const sourceId = existingSource?.id || allocateSourceId();
      const capturedAt = new Date().toISOString();
      const extractedPublishedAt = /^\d{4}-\d{2}-\d{2}$/.test(sourceMeta.publishedAt || "") ? sourceMeta.publishedAt : null;
      const auditedMeta = {
        ...(existingSource || {}),
        ...sourceMeta,
        publishedAt: existingSource?.publishedAt || extractedPublishedAt,
        directQuestionEvidence: Boolean(existingSource?.directQuestionEvidence || sourceMeta.directQuestionEvidence)
      };
      const collection = sourceCollection(item, auditedMeta, capturedAt);
      const discovery = sourceDiscoveryAudit(item, auditedMeta);
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
          discovery,
          ...(engagement ? { engagement } : {}),
          qualityWarnings
        };
        newSources.push(source);
      } else {
        sourceRefreshes.push({
          sourceId,
          collection: { ...(existingSource.collection || {}), ...collection },
          discovery,
          ...(engagement ? { engagement } : {}),
          qualityWarnings,
          ...(cleanText(sourceMeta.position, 80) ? { position: cleanText(sourceMeta.position, 80) } : {}),
          ...(["intern", "campus", "experienced"].includes(sourceMeta.candidateLevel) ? { candidateLevel: sourceMeta.candidateLevel } : {}),
          ...(auditedMeta.directQuestionEvidence && !existingSource.directQuestionEvidence ? { directQuestionEvidence: true } : {}),
          ...(auditedMeta.publishedAt && !existingSource.publishedAt ? { publishedAt: auditedMeta.publishedAt } : {})
        });
      }
      sourceResults.push({ id: sourceId, label, status: "ok", conceptCount });
      onEvent({ phase: "analyze", id: sourceId, label, status: "ok", conceptCount, durationMs: Date.now() - startedAt, analysisMethod, ...(analysisMethod === "cache" ? { cached: true } : {}) });
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
  const observationsByName = new Map(existingConceptCandidates
    .filter((candidate) => !knownConceptSet.has(candidate.name))
    .map((candidate) => [candidate.name, candidate]));
  for (const concept of newConcepts) observationsByName.set(concept.name, mergeConceptObservation(observationsByName.get(concept.name), concept));
  const observedConcepts = [...observationsByName.values()].map((concept) => ({
    ...concept,
    promotion: conceptPromotionStats(concept, mergedSources)
  }));
  const availableConceptSlots = Math.max(0, Math.floor((QUESTION_BANK_TARGET - beforePayload.questions.length) / 5));
  const promotionBudget = Math.min(MAX_NEW_CONCEPTS_PER_RUN, availableConceptSlots);
  const promotedNames = new Set(observedConcepts
    .filter((concept) => concept.promotion.qualified)
    .sort((a, b) => b.promotion.eligibleSources - a.promotion.eligibleSources || b.promotion.companyCount - a.promotion.companyCount || b.priority - a.priority || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, promotionBudget)
    .map((concept) => concept.name));
  const promotedConcepts = observedConcepts.filter((concept) => promotedNames.has(concept.name));
  const conceptWatchlist = observedConcepts.filter((concept) => !promotedNames.has(concept.name)).slice(0, 300);
  const cleanConcepts = promotedConcepts.map(({ originSource, promotion, ...rest }) => rest);
  const { backend, agent } = allCatalogConcepts([...existingDynamicConcepts, ...cleanConcepts]);
  const afterQuestions = [
    ...buildQuestions(backend, "backend", "be", mergedSources, sourcesPayload.snapshotDate, null, contentReviews, new Map(), contentEnhancements),
    ...buildQuestions(agent, "agent", "ai", mergedSources, sourcesPayload.snapshotDate, null, contentReviews, new Map(), contentEnhancements)
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
        ? trackedAi("score-evaluation",
            [
              { role: "system", content: evaluationSystemPrompt() },
              { role: "user", content: evaluationUserPrompt(makeRows(batch)) }
            ],
            { maxTokens: 4000, temperature: 0.1, timeoutMs: evalTimeout, signal },
            parseEvaluation
          )
        : Promise.reject(new Error("空批次"))));
      const adjustments = [];
      throwIfAborted(signal);
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        adjustments.push(...result.value);
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
    newConcepts: promotedConcepts,
    conceptWatchlist: conceptWatchlist.map((concept) => ({ name: concept.name, track: concept.track, category: concept.category, topicGroup: concept.topicGroup, priority: concept.priority, sourceIds: concept.sourceIds, promotion: concept.promotion })),
    capacityPolicy: {
      targetQuestions: QUESTION_BANK_TARGET,
      beforeQuestions: beforePayload.questions.length,
      availableConceptSlots,
      promotionBudget,
      promoted: promotedConcepts.length,
      observed: observedConcepts.length
    },
    sourceResults,
    newConceptQuestions,
    existingSourcePatches: Object.entries(linkNames).filter(([sourceId]) => sourceById.has(sourceId)).map(([sourceId, conceptNames]) => ({
      sourceId,
      conceptNames: [...new Set(conceptNames)],
      qualityWarnings: refreshById.get(sourceId)?.qualityWarnings || []
    })),
    sourceRefreshes: sourceRefreshes.map(({ sourceId, collection, discovery, engagement, qualityWarnings, directQuestionEvidence, publishedAt }) => ({
      sourceId,
      collection,
      discovery,
      engagement: engagement || null,
      qualityWarnings,
      ...(directQuestionEvidence ? { directQuestionEvidence: true } : {}),
      ...(publishedAt ? { publishedAt } : {})
    })),
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
    performance: {
      inputSources: items.length,
      ...aiPerformance,
      aiCallsSaved: Math.max(0, items.length - aiPerformance.calls),
      cacheHitRate: items.length ? Number((aiPerformance.cacheHits / items.length).toFixed(3)) : 0,
      deterministicRate: items.length ? Number((aiPerformance.deterministicSources / items.length).toFixed(3)) : 0,
      evidenceAcceptanceRate: aiPerformance.evidenceAccepted + aiPerformance.evidenceRejected
        ? Number((aiPerformance.evidenceAccepted / (aiPerformance.evidenceAccepted + aiPerformance.evidenceRejected)).toFixed(3))
        : null,
      batchSize: profile.batchSize,
      batchConcurrency: profile.batchConcurrency,
      ...(telemetryEnabled ? { providerTelemetry: summarizeTelemetry(telemetrySamples, telemetryLabel) } : {})
    },
    expectedCounts: draftExpectedCounts,
    analysisMode: profile.name,
    partial: partialFinalized ? {
      finalized: true,
      plannedSources: items.length,
      completedSources: sourceResults.filter((item) => item.status === "ok").length,
      skippedSources: Math.max(0, items.length - sourceResults.filter((item) => item.status === "ok").length)
    } : null
  };
  return { draft, newSources, newConcepts: promotedConcepts, conceptWatchlist, links, aiScores, hintEntries, sourceRefreshes };
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
  if (existsSync(join(backupDir, "concept-candidates.json"))) {
    await writeFileAtomic(conceptCandidatesPath, await readFile(join(backupDir, "concept-candidates.json")));
  } else {
    await rm(conceptCandidatesPath, { force: true });
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
    .map(({ originSource, promotion, ...rest }) => ({ ...rest, sourceIds: rest.sourceIds.filter((id) => allowedSourceIds.has(id)) }))
    .filter((concept) => concept.sourceIds.length);
  const selectedConceptNameSet = new Set(newConcepts.map((concept) => concept.name));
  const conceptWatchlist = [...(lastRun.conceptWatchlist || []), ...(lastRun.newConcepts || []).filter((concept) => !selectedConceptNameSet.has(concept.name))]
    .map(({ originSource, promotion, ...concept }) => ({ ...concept, sourceIds: (concept.sourceIds || []).filter((id) => allowedSourceIds.has(id)) }))
    .filter((concept) => concept.name && concept.sourceIds.length);
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
  if (existsSync(conceptCandidatesPath)) await copyFile(conceptCandidatesPath, join(backupDir, "concept-candidates.json"));
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
    sourcesPayload.snapshotDate = todayInChina();
    await writeJsonAtomic(join(root, "research", "sources.json"), sourcesPayload);

    const existingNew = await loadNewConcepts();
    const mergedConcepts = [...existingNew, ...newConcepts.filter((concept) => !existingNew.some((item) => item.name === concept.name))];
    if (mergedConcepts.length) {
      await mkdir(dirname(newConceptsPath), { recursive: true });
      await writeJsonAtomic(newConceptsPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), concepts: mergedConcepts });
    } else {
      await rm(newConceptsPath, { force: true });
    }

    const knownAfterPromotion = new Set([...backendConcepts, ...agentConcepts, ...mergedConcepts].map((concept) => concept.name));
    const watchlistByName = new Map();
    for (const concept of conceptWatchlist) {
      if (knownAfterPromotion.has(concept.name)) continue;
      watchlistByName.set(concept.name, mergeConceptObservation(watchlistByName.get(concept.name), concept));
    }
    await writeJsonAtomic(conceptCandidatesPath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      policy: { targetQuestions: QUESTION_BANK_TARGET, minimumRecentIndependentSources: 3, maximumPromotionsPerRun: MAX_NEW_CONCEPTS_PER_RUN },
      candidates: [...watchlistByName.values()].slice(0, 300)
    });

    const { buildPayload, buildQuestions, allCatalogConcepts, loadAiScores, loadContentReviews, loadContentEnhancements } = await import("./generate-questions.mjs");
    const sourcesAfterWrite = await loadSources();
    const { backend: bConcepts, agent: aConcepts } = allCatalogConcepts(await loadNewConcepts());
    const contentReviews = (await loadContentReviews()).questions || {};
    const contentEnhancements = await loadContentEnhancements();
    const formulaQuestions = [
      ...buildQuestions(bConcepts, "backend", "be", sourcesAfterWrite.sources, sourcesAfterWrite.snapshotDate, null, contentReviews, new Map(), contentEnhancements),
      ...buildQuestions(aConcepts, "agent", "ai", sourcesAfterWrite.sources, sourcesAfterWrite.snapshotDate, null, contentReviews, new Map(), contentEnhancements)
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
    const history = { appliedAt: new Date().toISOString(), backupDir, addedSources: newSources.length, patchedSources, refreshedSources: sourceRefreshes.length, addedConcepts: newConcepts.length, observedConcepts: watchlistByName.size, aiScoreAdjustments, learningHintConcepts, performance: lastRun.draft.performance || null, counts: generated.counts };
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
