const DAY_MS = 86_400_000;

const PLATFORM_DEFINITIONS = [
  { id: "nowcoder", name: "牛客", hosts: ["nowcoder.com"] },
  { id: "xiaohongshu", name: "小红书", hosts: ["xiaohongshu.com", "xhslink.com"] },
  { id: "csdn", name: "CSDN", hosts: ["csdn.net"] },
  { id: "zhihu", name: "知乎", hosts: ["zhihu.com"] }
];

const COLLECTION_LABELS = {
  "auto-fetch": "自动复查已登记链接",
  "manual-url": "用户粘贴链接",
  "manual-text": "用户粘贴正文",
  "curated-snapshot": "内置调研快照",
  "sitemap-snapshot": "公开 Sitemap 增量样本"
};

function safeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const found = PLATFORM_DEFINITIONS.find((platform) => platform.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)));
    return found ? { id: found.id, name: found.name } : { id: "other", name: "其他网页" };
  } catch {
    return { id: "manual", name: "无网页链接" };
  }
}

function parseMetricNumber(raw) {
  const text = String(raw || "").trim().replace(/,/g, "");
  const matched = text.match(/^(\d+(?:\.\d+)?)\s*(万|w|k)?$/i);
  if (!matched) return null;
  const multiplier = /万|w/i.test(matched[2] || "") ? 10_000 : /k/i.test(matched[2] || "") ? 1_000 : 1;
  const value = Math.round(Number(matched[1]) * multiplier);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function extractExplicitEngagement(text, capturedAt = new Date().toISOString()) {
  const input = String(text || "").slice(0, 80_000);
  const patterns = {
    views: /(?:浏览(?:量|次数)?|阅读(?:量|次数)?|阅读)\s*[：:]?\s*(\d+(?:\.\d+)?\s*(?:万|w|k)?)/i,
    likes: /(?:点赞(?:数)?|赞)\s*[：:]?\s*(\d+(?:\.\d+)?\s*(?:万|w|k)?)/i,
    favorites: /(?:收藏(?:数)?)\s*[：:]?\s*(\d+(?:\.\d+)?\s*(?:万|w|k)?)/i,
    comments: /(?:评论(?:数)?)\s*[：:]?\s*(\d+(?:\.\d+)?\s*(?:万|w|k)?)/i
  };
  const metrics = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const value = parseMetricNumber(input.match(pattern)?.[1]);
    if (value !== null) metrics[key] = value;
  }
  return Object.keys(metrics).length ? { ...metrics, capturedAt, source: "explicit-page-text" } : null;
}

export function publicSourceRecord(source, snapshotDate) {
  const detected = detectPlatform(source.url);
  const method = source.collection?.method || "curated-snapshot";
  const platform = { id: detected.id, name: detected.name };
  const url = typeof source.url === "string" && /^https?:\/\//.test(source.url) ? source.url : null;
  const hasUrl = Boolean(url);
  const hasDate = Boolean(safeDate(source.publishedAt));
  const traceableInterview = Boolean(source.type === "interview" && source.directQuestionEvidence && hasUrl && hasDate && method !== "manual-text");
  const frequencyEligible = Boolean((source.collection?.frequencyEligible ?? traceableInterview) && traceableInterview);
  const traceability = !hasUrl ? "unverified" : hasDate ? "url-and-date" : "url-only";
  const engagementMetrics = ["views", "likes", "favorites", "comments"]
    .filter((key) => Number.isSafeInteger(source.engagement?.[key]) && source.engagement[key] >= 0)
    .map((key) => [key, source.engagement[key]]);
  const engagement = source.engagement?.source === "explicit-page-text" && engagementMetrics.length
    ? Object.fromEntries([
        ...engagementMetrics,
        ["capturedAt", source.engagement.capturedAt || null],
        ["source", "explicit-page-text"]
      ])
    : null;
  return {
    id: source.id,
    title: source.title,
    shortTitle: source.shortTitle,
    url,
    type: source.type,
    track: Array.isArray(source.track) ? source.track : [],
    publishedAt: source.publishedAt || null,
    company: source.company || null,
    position: source.position || null,
    candidateLevel: source.candidateLevel || "unknown",
    weight: source.weight,
    directQuestionEvidence: Boolean(source.directQuestionEvidence),
    notes: source.notes || "",
    supportsConcepts: Array.isArray(source.supportsConcepts) ? source.supportsConcepts : [],
    qualityWarnings: Array.isArray(source.qualityWarnings) ? source.qualityWarnings.filter((warning) => typeof warning === "string") : [],
    platform,
    collection: {
      method,
      methodLabel: COLLECTION_LABELS[method] || "已登记来源",
      capturedAt: source.collection?.capturedAt || snapshotDate || null,
      frequencyEligible,
      traceability
    },
    engagement,
    discovery: source.discovery && typeof source.discovery === "object" ? {
      analysisVersion: source.discovery.analysisVersion || null,
      sitemapLastModified: source.discovery.sitemapLastModified || null,
      duplicateClusterId: source.discovery.duplicateClusterId || source.id,
      sourceKind: source.discovery.sourceKind === "aggregate" ? "aggregate" : "direct-experience",
      questionSignals: Number.isInteger(source.discovery.questionSignals) ? source.discovery.questionSignals : null
    } : null
  };
}

function auditableCompany(source) {
  if (source.type !== "interview" || !source.directQuestionEvidence) return null;
  const company = String(source.company || "").trim();
  if (!company || /多公司|企业招聘|冲突|汇总|等|[\/、]/.test(company)) return null;
  return company;
}

function aggregateSource(source) {
  return source.discovery?.sourceKind === "aggregate" || /多公司|汇总|合集|盘点|题库|八股文/.test(`${source.company || ""} ${source.title || ""} ${source.notes || ""}`);
}

function uniqueSourceClusters(sources) {
  const byCluster = new Map();
  for (const source of sources) {
    const cluster = source.discovery?.duplicateClusterId || source.id;
    const current = byCluster.get(cluster);
    if (!current || Number(source.weight || 0) > Number(current.weight || 0)) byCluster.set(cluster, source);
  }
  return [...byCluster.values()];
}

function primaryQuestion(questions) {
  return [...questions].sort((a, b) => {
    const angleRank = { definition: 0, mechanism: 1, application: 2, pitfall: 3, comparison: 4 };
    return (angleRank[a.angle] ?? 9) - (angleRank[b.angle] ?? 9) || b.importance - a.importance;
  })[0];
}

export function buildSourceInsights({ questions = [], sources = [], snapshotDate = null, sampleAudit = null, publicQuestionSignals = null } = {}) {
  const publicSources = sources.map((source) => publicSourceRecord(source, snapshotDate));
  const sourceMap = new Map(publicSources.map((source) => [source.id, source]));
  const asOf = safeDate(snapshotDate) || new Date();
  const allInterviewSources = publicSources.filter((source) => source.type === "interview");
  const allEligibleSources = allInterviewSources.filter((source) => source.collection.frequencyEligible);
  const independentEligibleSources = uniqueSourceClusters(allEligibleSources);
  const directIndependentSources = independentEligibleSources.filter((source) => !aggregateSource(source));
  const globalRecent90 = directIndependentSources.filter((source) => {
    const date = safeDate(source.publishedAt);
    return date && Math.max(0, Math.floor((asOf.getTime() - date.getTime()) / DAY_MS)) <= 90;
  }).length;
  const globalPrevious90 = directIndependentSources.filter((source) => {
    const date = safeDate(source.publishedAt);
    if (!date) return false;
    const age = Math.max(0, Math.floor((asOf.getTime() - date.getTime()) / DAY_MS));
    return age > 90 && age <= 180;
  }).length;
  const conceptGroups = new Map();
  for (const question of questions) {
    if (!conceptGroups.has(question.concept)) conceptGroups.set(question.concept, []);
    conceptGroups.get(question.concept).push(question);
  }

  const trendRows = [];
  for (const [concept, conceptQuestions] of conceptGroups) {
    const primary = primaryQuestion(conceptQuestions);
    const sourceIds = unique([
      ...conceptQuestions.flatMap((question) => question.evidence?.sourceIds || []),
      ...publicSources.filter((source) => source.supportsConcepts.includes(concept)).map((source) => source.id)
    ]);
    const interviewSources = uniqueSourceClusters(sourceIds
      .map((id) => sourceMap.get(id))
      .filter((source) => source?.type === "interview" && source.directQuestionEvidence && source.collection.frequencyEligible));
    if (!interviewSources.length) continue;
    let recent90 = 0;
    let previous90 = 0;
    let rawHeat = 0;
    for (const source of interviewSources) {
      const published = safeDate(source.publishedAt);
      if (!published) continue;
      const ageDays = Math.max(0, Math.floor((asOf.getTime() - published.getTime()) / DAY_MS));
      if (ageDays <= 90) recent90 += 1;
      else if (ageDays <= 180) previous90 += 1;
      const recency = Math.exp(-ageDays / 180);
      rawHeat += Number(source.weight || 0.5) * recency * (aggregateSource(source) ? 0.32 : auditableCompany(source) ? 1 : 0.75);
    }
    const companies = unique(interviewSources.map(auditableCompany));
    rawHeat += Math.min(0.8, Math.max(0, companies.length - 1) * 0.2);
    const attentionSources = interviewSources.filter((source) => source.engagement);
    const attention = attentionSources.length ? {
      available: true,
      sourceCount: attentionSources.length,
      metrics: Object.fromEntries(["views", "likes", "favorites", "comments"]
        .filter((key) => attentionSources.some((source) => Number.isInteger(source.engagement?.[key])))
        .map((key) => [key, attentionSources.reduce((sum, source) => sum + Number(source.engagement?.[key] || 0), 0)]))
    } : { available: false, sourceCount: 0, metrics: null };
    trendRows.push({
      concept,
      track: primary.track,
      category: primary.category,
      questionId: primary.id,
      sourceIds: interviewSources.map((source) => source.id),
      mentions: interviewSources.length,
      recent90,
      previous90,
      companyCount: companies.length,
      platformCount: unique(interviewSources.map((source) => source.platform.id)).length,
      lastObserved: interviewSources.map((source) => source.publishedAt).filter(Boolean).sort().at(-1) || null,
      rawHeat,
      attention,
      publicQuestionAttention: primary.evidence?.publicQuestionAttention || {
        available: false,
        attentionBoost: 0,
        publicTitleSamples: 0,
        bankCount: 0,
        signal: "none",
        confidence: "none",
        access: "title-only",
        banks: [],
        examples: []
      }
    });
  }

  const maxHeat = Math.max(1, ...trendRows.map((row) => row.rawHeat));
  const trends = trendRows.map((row) => {
    const recentRate = (row.recent90 + 1) / (globalRecent90 + 8);
    const previousRate = (row.previous90 + 1) / (globalPrevious90 + 8);
    const signal = row.recent90 >= 4 && recentRate >= previousRate * 1.35
      ? "rising"
      : row.recent90 >= 4
        ? "hot"
        : row.recent90 >= 2 && row.previous90 === 0
          ? "emerging"
          : row.mentions >= 4
            ? "stable"
            : "sample-low";
    const confidence = directIndependentSources.length >= 120 && row.mentions >= 10 && row.recent90 >= 5 && (row.companyCount >= 3 || row.platformCount >= 2)
      ? "high"
      : directIndependentSources.length >= 40 && row.mentions >= 4 && row.recent90 >= 2
        ? "medium"
        : "low";
    const { rawHeat, ...safe } = row;
    return { ...safe, heat: Math.round(rawHeat / maxHeat * 100), signal, confidence, recentRate: Number(recentRate.toFixed(4)), previousRate: Number(previousRate.toFixed(4)) };
  }).sort((a, b) => b.heat - a.heat || b.recent90 - a.recent90 || a.concept.localeCompare(b.concept, "zh-CN"));

  const auditableSources = directIndependentSources.filter((source) => auditableCompany(source));
  const companies = unique(auditableSources.map(auditableCompany)).map((company) => {
    const companySources = auditableSources.filter((source) => auditableCompany(source) === company);
    const companySourceIds = new Set(companySources.map((source) => source.id));
    const companyTrends = trends.filter((row) => row.sourceIds.some((id) => companySourceIds.has(id)));
    return {
      name: company,
      sourceCount: companySources.length,
      sourceIds: companySources.map((source) => source.id),
      tracks: unique(companySources.flatMap((source) => source.track || [])),
      latest: companySources.map((source) => source.publishedAt).filter(Boolean).sort().at(-1) || null,
      conceptCount: companyTrends.length,
      concepts: companyTrends.map((row) => row.concept),
      questionIds: companyTrends.sort((a, b) => b.heat - a.heat).map((row) => row.questionId)
    };
  }).filter((company) => company.questionIds.length).sort((a, b) => b.sourceCount - a.sourceCount || b.conceptCount - a.conceptCount || a.name.localeCompare(b.name, "zh-CN"));

  const roles = [
    { id: "backend", name: "Java 后端" },
    { id: "agent", name: "AI / Agent 应用开发" }
  ].map((role) => {
    const roleTrends = trends.filter((row) => row.track === role.id);
    const sourceIds = unique(roleTrends.flatMap((row) => row.sourceIds));
    return {
      ...role,
      sourceCount: sourceIds.length,
      conceptCount: roleTrends.length,
      questionIds: roleTrends.map((row) => row.questionId)
    };
  });

  const dated = allEligibleSources.map((source) => source.publishedAt).filter(Boolean).sort();
  const platformCounts = new Map();
  for (const source of allEligibleSources) {
    const key = source.platform.id;
    const entry = platformCounts.get(key) || { id: key, name: source.platform.name, count: 0 };
    entry.count += 1;
    platformCounts.set(key, entry);
  }
  const engagementSources = allEligibleSources.filter((source) => source.engagement).length;
  const analysisMethods = new Map();
  for (const source of allEligibleSources) {
    const method = source.discovery?.analysisVersion ? "deterministic" : source.collection.method === "sitemap-snapshot" ? "sitemap" : "curated-or-ai";
    analysisMethods.set(method, (analysisMethods.get(method) || 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    snapshotDate,
    coverage: {
      registeredSources: publicSources.length,
      interviewSources: allInterviewSources.length,
      frequencyEligibleSources: allEligibleSources.length,
      independentInterviewSamples: directIndependentSources.length,
      mappedInterviewSources: allEligibleSources.filter((source) => source.supportsConcepts.length).length,
      recent90Sources: globalRecent90,
      previous90Sources: globalPrevious90,
      aggregateSources: independentEligibleSources.filter(aggregateSource).length,
      duplicateExcluded: allEligibleSources.length - independentEligibleSources.length,
      excludedSources: allInterviewSources.length - allEligibleSources.length,
      datedSources: dated.length,
      earliest: dated[0] || null,
      latest: dated.at(-1) || null,
      engagementSources,
      publicQuestionSignals: publicQuestionSignals && typeof publicQuestionSignals === "object" && !Array.isArray(publicQuestionSignals)
        ? {
            source: publicQuestionSignals.source || null,
            capturedAt: publicQuestionSignals.capturedAt || null,
            access: publicQuestionSignals.access || "title-only",
            totalTitles: Number(publicQuestionSignals.totalTitles || 0),
            inScopeTitles: Number(publicQuestionSignals.inScopeTitles || 0),
            matchedInScopeTitles: Number(publicQuestionSignals.matchedInScopeTitles || 0),
            inScopeCoverage: Number(publicQuestionSignals.inScopeCoverage || 0),
            excludedTitles: Number(publicQuestionSignals.excludedTitles || 0),
            mappedConcepts: Number(publicQuestionSignals.mappedConcepts || 0)
          }
        : null,
      sampleAudit,
      analysisMethods: [...analysisMethods].map(([id, count]) => ({ id, count })),
      platforms: [...platformCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
      limitations: [
        "趋势只代表已登记且可追溯的公开面经样本，不代表牛客、小红书或招聘市场全站概率。",
        "公开 Sitemap 只用于发现候选；只有正文含直接问题、日期可核验且完成知识点映射的帖子才进入趋势。转载簇最多计一次，聚合帖显著降权。",
        "小红书 Sitemap 不提供标题或日期，且普通自动抓取受平台限制；未通过用户登录浏览器或明确链接核验的笔记不会伪装成有效样本。",
        "同一知识点的五个训练角度只计作一次概念出现；高置信度还要求全局样本、近期重复和公司/平台多样性同时达标。",
        engagementSources ? "面经帖子关注度只使用页面明确出现且已记录的互动数字。" : "当前没有可核验的面经浏览、点赞、收藏或评论数字，因此帖子互动不参与排序。",
        "公开题库关注度只使用公开榜单、热度和题目标题；不访问 VIP 答案，不计入面经频次，单次快照保持低置信且最多只加 2 分。"
      ]
    },
    companies,
    roles,
    trends,
    sources: publicSources
  };
}
