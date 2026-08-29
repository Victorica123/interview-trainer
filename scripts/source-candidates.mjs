import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./local-json.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidatesPath = join(root, ".local", "source-candidates.json");
const sourcesPath = join(root, "research", "sources.json");
const MAX_CANDIDATES = 600;
const MAX_URL_LENGTH = 2_000;

const PLATFORM_NAMES = {
  nowcoder: "牛客",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  csdn: "CSDN",
  juejin: "稀土掘金",
  other: "其他网站"
};

function cleanTimestamp(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function normalizeSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("候选链接不能为空");
  if (raw.length > MAX_URL_LENGTH) throw new Error("候选链接过长");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("候选链接格式不正确");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("候选链接只支持 http/https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("候选链接不能包含用户名或密码");
  }
  parsed.hash = "";
  parsed.searchParams.sort();
  return parsed.toString().replace(/\/$/, "");
}

export function detectCandidatePlatform(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (/(^|\.)nowcoder\.com$/.test(hostname)) return "nowcoder";
  if (/(^|\.)(xiaohongshu|xhslink)\.com$/.test(hostname)) return "xiaohongshu";
  if (/(^|\.)zhihu\.com$/.test(hostname)) return "zhihu";
  if (/(^|\.)csdn\.net$/.test(hostname)) return "csdn";
  if (/(^|\.)juejin\.cn$/.test(hostname)) return "juejin";
  return "other";
}

function candidateId(url) {
  return `candidate-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

function sanitizeCandidate(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  try {
    const url = normalizeSourceUrl(value.url);
    const addedAt = cleanTimestamp(value.addedAt) || new Date().toISOString();
    return {
      id: candidateId(url),
      url,
      platform: detectCandidatePlatform(url),
      addedAt,
      lastUsedAt: cleanTimestamp(value.lastUsedAt)
    };
  } catch {
    return null;
  }
}

async function loadStoredCandidates() {
  try {
    const payload = JSON.parse(await readFile(candidatesPath, "utf8"));
    const candidates = Array.isArray(payload.candidates)
      ? payload.candidates.map(sanitizeCandidate).filter(Boolean)
      : [];
    return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

async function saveStoredCandidates(candidates) {
  await writeJsonAtomic(candidatesPath, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    candidates
  });
}

async function registeredSourcesByUrl() {
  const payload = JSON.parse(await readFile(sourcesPath, "utf8"));
  const byUrl = new Map();
  for (const source of payload.sources || []) {
    if (!source?.url) continue;
    try {
      const url = normalizeSourceUrl(source.url);
      byUrl.set(url, { id: String(source.id || ""), title: String(source.shortTitle || source.title || source.id || "已登记来源").slice(0, 120) });
    } catch {
      // 历史来源中的非标准 URL 不进入候选匹配，但不影响读取其他候选。
    }
  }
  return byUrl;
}

function publicPayload(candidates, registeredByUrl, extra = {}) {
  const publicCandidates = candidates.map((candidate) => {
    const registered = registeredByUrl.get(candidate.url);
    return {
      ...candidate,
      platformName: PLATFORM_NAMES[candidate.platform] || PLATFORM_NAMES.other,
      status: registered ? "registered" : "pending",
      registeredSource: registered || null
    };
  });
  return {
    schemaVersion: 1,
    candidates: publicCandidates,
    counts: {
      total: publicCandidates.length,
      pending: publicCandidates.filter((candidate) => candidate.status === "pending").length,
      registered: publicCandidates.filter((candidate) => candidate.status === "registered").length
    },
    ...extra
  };
}

export async function listSourceCandidates() {
  const [candidates, registeredByUrl] = await Promise.all([loadStoredCandidates(), registeredSourcesByUrl()]);
  return publicPayload(candidates, registeredByUrl);
}

export async function addSourceCandidates(values) {
  if (!Array.isArray(values)) throw new Error("urls 必须是数组");
  const requested = values.map(normalizeSourceUrl);
  const candidates = await loadStoredCandidates();
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const addedIds = [];
  let duplicates = 0;
  const addedAt = new Date().toISOString();
  for (const url of requested.slice(0, 500)) {
    if (byUrl.has(url)) {
      duplicates += 1;
      continue;
    }
    if (byUrl.size >= MAX_CANDIDATES) break;
    const candidate = { id: candidateId(url), url, platform: detectCandidatePlatform(url), addedAt, lastUsedAt: null };
    byUrl.set(url, candidate);
    addedIds.push(candidate.id);
  }
  const next = [...byUrl.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  await saveStoredCandidates(next);
  return publicPayload(next, await registeredSourcesByUrl(), { added: addedIds.length, addedIds, duplicates });
}

function validateCandidateIds(values) {
  if (!Array.isArray(values)) throw new Error("ids 必须是数组");
  const ids = [...new Set(values.map((value) => String(value || "")))].slice(0, 500);
  if (ids.some((id) => !/^candidate-[a-f0-9]{20}$/.test(id))) throw new Error("候选 ID 格式不正确");
  return ids;
}

export async function removeSourceCandidates(values) {
  const ids = new Set(validateCandidateIds(values));
  const candidates = await loadStoredCandidates();
  const next = candidates.filter((candidate) => !ids.has(candidate.id));
  await saveStoredCandidates(next);
  return publicPayload(next, await registeredSourcesByUrl(), { removed: candidates.length - next.length });
}

export async function useSourceCandidates(values) {
  const ids = validateCandidateIds(values);
  if (!ids.length) return [];
  const candidates = await loadStoredCandidates();
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error("所选候选链接已不存在，请刷新候选池后重试");
  const usedAt = new Date().toISOString();
  for (const id of ids) byId.get(id).lastUsedAt = usedAt;
  await saveStoredCandidates(candidates);
  return ids.map((id) => byId.get(id).url);
}
