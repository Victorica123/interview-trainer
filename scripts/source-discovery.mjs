import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { writeJsonAtomic } from "./local-json.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cachePath = join(root, ".local", "discovery-cache.json");
const sourcesPath = join(root, "research", "sources.json");
const DISCOVERY_SCHEMA = 1;
const ANALYSIS_VERSION = "deterministic-2026-08-29-6";
const MAX_CACHE_ENTRIES = 30_000;
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const NOWCODER_SITEMAPS = [
  "https://www.nowcoder.com/sitemap1.xml",
  "https://www.nowcoder.com/sitemap2.xml"
];

const COMPANY_NAMES = [
  "阿里巴巴", "阿里", "蚂蚁", "字节跳动", "字节", "腾讯", "美团", "拼多多", "京东", "百度", "快手", "滴滴",
  "小米", "网易", "华为", "携程", "哔哩哔哩", "B站", "小红书", "得物", "虾皮", "Shopee", "微软", "亚马逊",
  "Meta", "Google", "理想", "蔚来", "小鹏", "联想", "科大讯飞", "同程", "货拉拉", "去哪儿"
];

const GENERIC_TERMS = new Set(["基础", "原理", "机制", "项目", "应用", "接口", "模型", "网络", "线程", "缓存", "数据库", "并发", "系统", "框架"]);

function hash(value, size = 20) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, size);
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlFragmentToText(value) {
  return decodeEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|blockquote|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\u003C/gi, "<").replace(/\\u003E/gi, ">").replace(/\\u002F/gi, "/").replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.delete("urlSource");
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}

export function parseSitemap(xml) {
  const rows = [];
  for (const block of String(xml || "").matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = block[1].match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim();
    if (!loc) continue;
    const lastModified = block[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim() || null;
    try {
      rows.push({ url: canonicalUrl(decodeEntities(loc)), lastModified });
    } catch {
      // Ignore malformed sitemap rows while keeping the rest of the public index usable.
    }
  }
  return rows;
}

function chinaCalendarDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? CHINA_DATE_FORMATTER.format(date) : null;
}

function publishedDateFromHtml(html, searchFrom = 0) {
  const nearby = String(html).slice(Math.max(0, searchFrom), Math.max(0, searchFrom) + 30_000);
  const timestamp = Number(nearby.match(/"createTime"\s*:\s*(\d{12,13})/)?.[1]);
  if (Number.isFinite(timestamp)) return chinaCalendarDate(timestamp);
  return null;
}

export function extractNowcoderMainPost(html, { url = "", lastModified = null } = {}) {
  const input = String(html || "");
  const rawTitle = input.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]
    || input.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1]
    || input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || "";
  const contentMatch = input.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const rawContent = contentMatch?.[1]
    || input.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]
    || "";
  const title = htmlFragmentToText(decodeJsonString(rawTitle)).replace(/_牛客网.*$/i, "").trim().slice(0, 180);
  const content = htmlFragmentToText(decodeJsonString(rawContent)).slice(0, 60_000);
  return {
    url: canonicalUrl(url),
    title,
    content,
    publishedAt: publishedDateFromHtml(input, (contentMatch?.index || 0) + (contentMatch?.[0]?.length || 0))
  };
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function titleRoleExcluded(title) {
  const value = String(title || "");
  if (/前端|客户端|测试开发|测试岗|数据分析|数据科学|算法岗|算法工程师|大模型算法|视觉算法|推荐算法|搜索算法|多模态算法/i.test(value)) return true;
  if (/(?:^|[\s_-])hr\s*面|人力面/i.test(value) && !/一面|二面|三面|技术面/i.test(value)) return true;
  return false;
}

function titleSeriesCluster(title) {
  const value = String(title || "").trim();
  if (!/面经.*(?:[-_#—–]\s*|第)\d{1,3}(?:篇)?\s*$/i.test(value)) return null;
  const base = normalizedText(value.replace(/(?:[-_#—–]\s*|第)\d{1,3}(?:篇)?\s*$/i, ""));
  return base.length >= 8 ? `cluster-${hash(`series\0${base}`, 20)}` : null;
}

export function applyCurrentSourcePolicy(source) {
  if (!source || titleRoleExcluded(source.title)) return null;
  const seriesCluster = titleSeriesCluster(source.title);
  if (!seriesCluster) return source;
  return {
    ...source,
    discovery: { ...(source.discovery || {}), duplicateClusterId: seriesCluster },
    qualityWarnings: [...new Set([
      ...(source.qualityWarnings || []),
      "连续编号面经系列按同一发布簇去重，避免批量转载或连续发布放大频次"
    ])]
  };
}

function countMatches(value, pattern) {
  return [...String(value || "").matchAll(pattern)].length;
}

function sourceTrack(text) {
  const tracks = [];
  if (/java|后端|服务端|spring|jvm|mysql|redis|中间件|分布式/i.test(text)) tracks.push("backend");
  if (/\bai\b|人工智能|大模型|llm|agent|rag|prompt|智能体|算法工程/i.test(text)) tracks.push("agent");
  return tracks;
}

function explicitCompany(title) {
  return COMPANY_NAMES.find((name) => title.toLowerCase().includes(name.toLowerCase())) || null;
}

function candidateLevel(title) {
  if (/实习|暑期|日常实习/.test(title)) return "intern";
  if (/校招|秋招|春招|应届|2[6-9]届/.test(title)) return "campus";
  if (/社招|工作\d+年|[1-9]\d*年经验/.test(title)) return "experienced";
  return "unknown";
}

function questionEvidence(text) {
  const punctuation = countMatches(text, /[?？]/g);
  const numbered = countMatches(text, /(?:^|\n)\s*(?:\d{1,2}[.、)]|[一二三四五六七八九十]+[、.])/gm);
  const interviewPhrases = countMatches(text, /(?:问了|问到|追问|面试官问|如何|为什么|区别|原理|怎么排查|怎么实现)/g);
  return { punctuation, numbered, interviewPhrases, total: punctuation + Math.min(numbered, 20) + Math.min(interviewPhrases, 20) };
}

function conceptTerms(concept) {
  return [...new Set([concept.name, ...(concept.tags || []), concept.compare]
    .map((term) => String(term || "").trim())
    .filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term)))]
    .sort((a, b) => b.length - a.length);
}

export function matchKnownConcepts(text, concepts = [...backendConcepts, ...agentConcepts], limit = 18) {
  const lines = String(text || "").split(/\n+|(?<=[。！？?])/).map((line) => line.trim()).filter(Boolean);
  const questionText = normalizedText(lines.filter((line) => /[?？]|为什么|如何|怎么|区别|原理|机制|排查|实现|作用/.test(line)).join("\n"));
  const allText = normalizedText(text);
  return concepts.map((concept, index) => {
    let score = 0;
    let matchedTerm = "";
    for (const term of conceptTerms(concept)) {
      const normalized = normalizedText(term);
      if (!normalized || normalized.length < 2) continue;
      if (questionText.includes(normalized)) {
        const next = 8 + Math.min(6, normalized.length);
        if (next > score) { score = next; matchedTerm = term; }
      } else if (allText.includes(normalized)) {
        const next = 2 + Math.min(5, normalized.length / 2);
        if (next > score) { score = next; matchedTerm = term; }
      }
    }
    return { concept, score, matchedTerm, index };
  }).filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score || Number(b.concept.priority || 0) - Number(a.concept.priority || 0) || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.concept.name);
}

export function assessInterviewPost(post, concepts = [...backendConcepts, ...agentConcepts]) {
  const title = String(post?.title || "").trim();
  const content = String(post?.content || "").trim();
  const combined = `${title}\n${content}`;
  const tracks = sourceTrack(combined);
  const evidence = questionEvidence(content);
  const interviewTitle = /面经|面试复盘|[一二三四五六七八九十0-9]+面(?:\W|$)|终面|hr面|offer复盘/i.test(title);
  const interviewBody = /面试官|一面|二面|三面|面经|追问|技术面/i.test(content);
  const promotional = /加微|私信领取|公众号|训练营|付费|专栏|资料包|课程|面试辅导|简历优化|内推码|内推/i.test(combined);
  const aggregate = /汇总|合集|盘点|趋势|题库|八股文|高频题|整理了?\d+|多家公司|多厂/i.test(title);
  const irrelevantTitle = /硬件|芯片|电路|嵌入式|产品经理|运营|市场|财务|法务|销售|机械|结构岗|题解|刷题|算法竞赛|笔试题解/i.test(title) || titleRoleExcluded(title);
  const titleHasTrack = /java|后端|服务端|大模型|llm|agent|rag|prompt|智能体|算法工程|ai开发|ai应用/i.test(title);
  const bodyTrackSignals = countMatches(content, /java|spring|jvm|mysql|redis|后端|大模型|llm|agent|rag|prompt|智能体/gi);
  const directQuestionEvidence = Boolean(tracks.length && interviewTitle && interviewBody && evidence.total >= 3 && content.length >= 100);
  const interviewCandidate = Boolean(tracks.length && interviewTitle && content.length >= 80 && !irrelevantTitle && (titleHasTrack || bodyTrackSignals >= 4));
  const accepted = interviewCandidate && (!promotional || evidence.total >= 3);
  const supportsConcepts = accepted ? matchKnownConcepts(content, concepts) : [];
  const normalizedContent = normalizedText(content).slice(0, 8_000);
  const contentHash = hash(normalizedContent, 24);
  const duplicateClusterId = `cluster-${contentHash.slice(0, 20)}`;
  return {
    accepted: Boolean(accepted),
    directQuestionEvidence,
    tracks,
    evidence,
    aggregate,
    promotional,
    supportsConcepts,
    contentHash,
    duplicateClusterId
  };
}

function sourceRecord(post, assessment, capturedAt, lastModified) {
  const match = post.url.match(/\/(?:discuss|detail)\/([^/?]+)/);
  const stablePart = (match?.[1] || hash(post.url, 18)).slice(0, 32);
  const company = explicitCompany(post.title);
  const warnings = [];
  if (assessment.aggregate) warnings.push("聚合或题库型帖子只按一个低权重样本计数，不冒充多次独立面试经历");
  if (assessment.promotional) warnings.push("正文含推广线索，已降低样本权重");
  if (!assessment.directQuestionEvidence) warnings.push("已识别为面经候选，但直接问题信号不足；保留覆盖审计，不参与趋势频次");
  return {
    id: `nc-sitemap-${stablePart}`,
    title: post.title,
    shortTitle: post.title.slice(0, 28),
    url: post.url,
    type: "interview",
    track: assessment.tracks,
    publishedAt: post.publishedAt,
    company,
    position: /agent|智能体|大模型|llm|rag|ai开发|ai应用/i.test(post.title) ? "AI / Agent 相关岗位" : /java|后端|服务端/i.test(post.title) ? "Java / 后端相关岗位" : null,
    candidateLevel: candidateLevel(post.title),
    weight: assessment.promotional ? 0.55 : assessment.aggregate ? 0.62 : 0.92,
    directQuestionEvidence: assessment.directQuestionEvidence,
    notes: `公开 Sitemap 发现；正文含 ${assessment.evidence.total} 个问题信号，本地规则映射 ${assessment.supportsConcepts.length} 个已有知识点。`,
    supportsConcepts: assessment.supportsConcepts,
    collection: {
      method: "sitemap-snapshot",
      capturedAt,
      platform: "nowcoder",
      frequencyEligible: Boolean(assessment.directQuestionEvidence && post.publishedAt)
    },
    discovery: {
      analysisVersion: ANALYSIS_VERSION,
      sitemapLastModified: lastModified,
      contentHash: assessment.contentHash,
      duplicateClusterId: assessment.duplicateClusterId,
      sourceKind: assessment.aggregate ? "aggregate" : "direct-experience",
      questionSignals: assessment.evidence.total
    },
    qualityWarnings: warnings
  };
}

async function loadCache() {
  try {
    const payload = JSON.parse(await readFile(cachePath, "utf8"));
    return payload.schemaVersion === DISCOVERY_SCHEMA && payload.entries && typeof payload.entries === "object" ? payload.entries : {};
  } catch {
    return {};
  }
}

async function saveCache(entries) {
  const keys = Object.keys(entries).sort((a, b) => String(entries[b].fetchedAt || "").localeCompare(String(entries[a].fetchedAt || "")));
  for (const key of keys.slice(MAX_CACHE_ENTRIES)) delete entries[key];
  await writeJsonAtomic(cachePath, { schemaVersion: DISCOVERY_SCHEMA, analysisVersion: ANALYSIS_VERSION, updatedAt: new Date().toISOString(), entries });
}

async function fetchText(url, signal, timeoutMs = 20_000, maxBytes = 2_000_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 interview-trainer-research/1.0",
      accept: "text/html,application/xml,text/xml;q=0.9,*/*;q=0.5"
    },
    redirect: "follow",
    signal: requestSignal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error("response-too-large");
  return buffer.toString("utf8");
}

async function runPool(items, concurrency, worker, signal) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      if (signal?.aborted) throw signal.reason || new Error("discovery-aborted");
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function sitemapRecency(row) {
  const id = row.url.match(/\/discuss\/(\d+)/)?.[1];
  return id ? BigInt(id) : 0n;
}

export function selectSitemapCandidates(rows, { excludeUrls = [], limit = 30_000 } = {}) {
  const excluded = new Set(excludeUrls.map((url) => {
    try { return canonicalUrl(url); } catch { return ""; }
  }).filter(Boolean));
  const eligible = [...new Map(rows.map((row) => [row.url, row])).values()]
    .filter((row) => /www\.nowcoder\.com\/(?:discuss|feed\/main\/detail)\//.test(row.url) && !excluded.has(row.url));
  const discuss = eligible.filter((row) => /\/discuss\//.test(row.url))
    .sort((a, b) => sitemapRecency(a) < sitemapRecency(b) ? 1 : sitemapRecency(a) > sitemapRecency(b) ? -1 : String(a.url).localeCompare(String(b.url)));
  const feed = eligible.filter((row) => /\/feed\/main\/detail\//.test(row.url))
    .sort((a, b) => String(b.lastModified || "").localeCompare(String(a.lastModified || "")) || String(a.url).localeCompare(String(b.url)));
  const selected = [];
  const maximum = Math.min(30_000, Math.max(1, Number(limit) || 30_000));
  for (let index = 0; selected.length < maximum && (index < discuss.length || index < feed.length); index += 1) {
    if (index < discuss.length) selected.push(discuss[index]);
    if (selected.length < maximum && index < feed.length) selected.push(feed[index]);
  }
  return selected;
}

export async function discoverRecentInterviewSources({ target = 300, scanLimit, concurrency = 6, excludeUrls = [], signal, onProgress = () => {} } = {}) {
  const wanted = Math.min(500, Math.max(1, Number(target) || 300));
  const maximumScan = Math.min(30_000, Math.max(wanted, Number(scanLimit) || Math.max(2_500, wanted * 45)));
  const capturedAt = new Date().toISOString();
  const sitemapPayloads = await Promise.all(NOWCODER_SITEMAPS.map(async (url) => ({ url, xml: await fetchText(url, signal, 30_000, 8_000_000) })));
  const candidates = selectSitemapCandidates(sitemapPayloads.flatMap(({ xml }) => parseSitemap(xml)), { excludeUrls, limit: maximumScan });
  const cache = await loadCache();
  const sources = [];
  let scanned = 0;
  let cacheHits = 0;
  let failed = 0;
  let lastCheckpoint = 0;
  const batchSize = Math.max(concurrency * 4, 12);

  try {
    for (let offset = 0; offset < candidates.length && sources.length < wanted; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      await runPool(batch, concurrency, async (row) => {
        if (sources.length >= wanted) return;
        scanned += 1;
        let cached = cache[row.url];
        if (cached?.analysisVersion === ANALYSIS_VERSION && typeof cached.accepted === "boolean") {
          cacheHits += 1;
          if (cached.accepted) {
            const source = applyCurrentSourcePolicy(cached.source);
            cache[row.url] = { ...cached, accepted: Boolean(source), source };
            if (source) sources.push(source);
          }
          return;
        }
        try {
          const html = await fetchText(row.url, signal);
          const post = extractNowcoderMainPost(html, row);
          const assessment = assessInterviewPost(post);
          const source = assessment.accepted ? applyCurrentSourcePolicy(sourceRecord(post, assessment, capturedAt, row.lastModified)) : null;
          cache[row.url] = { analysisVersion: ANALYSIS_VERSION, fetchedAt: capturedAt, accepted: Boolean(source), source };
          if (source) sources.push(source);
        } catch (error) {
          failed += 1;
          cache[row.url] = { analysisVersion: ANALYSIS_VERSION, fetchedAt: capturedAt, accepted: false, source: null, error: String(error.message || error).slice(0, 120) };
        }
      }, signal);
      onProgress({ scanned, accepted: Math.min(sources.length, wanted), target: wanted, cacheHits, failed, candidates: candidates.length });
      if (scanned - lastCheckpoint >= 1_000) {
        await saveCache(cache);
        lastCheckpoint = scanned;
      }
    }
  } finally {
    await saveCache(cache);
  }
  const uniqueSources = [...new Map(sources.slice(0, wanted).map((source) => [source.id, source])).values()];
  return {
    generatedAt: capturedAt,
    sources: uniqueSources,
    stats: { target: wanted, candidates: candidates.length, scanned, accepted: uniqueSources.length, cacheHits, failed, aiCalls: 0 }
  };
}

async function mergeSnapshotSources(discovery) {
  const payload = JSON.parse(await readFile(sourcesPath, "utf8"));
  const originalSources = payload.sources || [];
  const currentSources = originalSources.flatMap((source) => {
    if (source.collection?.method !== "sitemap-snapshot") return [source];
    if (source.discovery?.analysisVersion !== ANALYSIS_VERSION) return [];
    const current = applyCurrentSourcePolicy(source);
    return current ? [current] : [];
  });
  const retired = originalSources.length - currentSources.length;
  const byId = new Map(currentSources.map((source) => [source.id, source]));
  const byUrl = new Map(currentSources.filter((source) => source.url).map((source) => {
    try { return [canonicalUrl(source.url), source.id]; } catch { return ["", source.id]; }
  }).filter(([url]) => url));
  let added = 0;
  let refreshed = 0;
  for (const source of discovery.sources) {
    const existingId = byUrl.get(canonicalUrl(source.url));
    if (existingId && byId.has(existingId)) {
      const existing = byId.get(existingId);
      const automatedSnapshot = existing.collection?.method === "sitemap-snapshot";
      byId.set(existingId, {
        ...existing,
        ...(automatedSnapshot ? source : { discovery: source.discovery }),
        id: existingId,
        supportsConcepts: [...new Set([...(existing.supportsConcepts || []), ...(source.supportsConcepts || [])])],
        qualityWarnings: [...new Set([...(existing.qualityWarnings || []), ...(source.qualityWarnings || [])])]
      });
      refreshed += 1;
      continue;
    }
    if (byId.has(source.id)) refreshed += 1;
    else added += 1;
    byId.set(source.id, source);
    byUrl.set(canonicalUrl(source.url), source.id);
  }
  payload.schemaVersion = Math.max(1, Number(payload.schemaVersion) || 1);
  payload.snapshotDate = chinaCalendarDate(discovery.generatedAt);
  payload.methodology = "近期直接面经优先；通过公开 Sitemap 增量发现，正文只保留必要元数据、内容指纹与知识点映射；转载簇和聚合帖降权且每簇最多计一次。岗位与官方资料用于交叉验证，不虚增面经频次。";
  payload.sources = [...byId.values()];
  payload.sampleAudit = {
    updatedAt: discovery.generatedAt,
    discovery: "public-sitemap",
    analysisVersion: ANALYSIS_VERSION,
    target: discovery.stats.target,
    scanned: discovery.stats.scanned,
    accepted: discovery.stats.accepted,
    retiredStaleSnapshots: retired,
    aiCalls: 0,
    note: "本次内置快照使用确定性规则匹配已有知识点；未来增量更新只把低置信或疑似新概念样本送入批量 AI。"
  };
  await writeJsonAtomic(sourcesPath, payload);
  return { added, refreshed, retired, total: payload.sources.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const valueOf = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? Number(process.argv[index + 1]) || fallback : fallback;
  };
  const target = valueOf("--target", 300);
  const scanLimit = valueOf("--scan", Math.max(2_500, target * 45));
  const concurrency = Math.min(8, Math.max(1, valueOf("--concurrency", 6)));
  const quiet = process.argv.includes("--quiet");
  const discovery = await discoverRecentInterviewSources({
    target,
    scanLimit,
    concurrency,
    onProgress(progress) {
      if (quiet) return;
      process.stdout.write(`\r已扫描 ${progress.scanned}/${progress.candidates}，有效面经 ${progress.accepted}/${progress.target}，缓存 ${progress.cacheHits}，失败 ${progress.failed}   `);
    }
  });
  if (!quiet) process.stdout.write("\n");
  console.log(JSON.stringify(discovery.stats));
  if (process.argv.includes("--write")) console.log(JSON.stringify(await mergeSnapshotSources(discovery)));
}
