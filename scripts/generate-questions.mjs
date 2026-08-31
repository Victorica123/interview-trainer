import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { BACKEND_CATEGORY_NAMES, QUESTION_ANGLES, classifyBackendConcept } from "./taxonomy.mjs";
import { buildPublicQuestionAttention, loadPublicQuestionSignals } from "./public-question-signals.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function loadSources() {
  return JSON.parse(await readFile(join(root, "research", "sources.json"), "utf8"));
}

export async function loadNewConcepts() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "new-concepts.json"), "utf8"));
    return Array.isArray(payload.concepts) ? payload.concepts : [];
  } catch {
    return [];
  }
}

export async function loadAiScores() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "ai-scores.json"), "utf8"));
    return payload.scores && typeof payload.scores === "object" && !Array.isArray(payload.scores) ? payload.scores : {};
  } catch {
    return {};
  }
}

export async function loadLearningHints() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "learning-hints.json"), "utf8"));
    return payload.hints && typeof payload.hints === "object" && !Array.isArray(payload.hints) ? payload.hints : {};
  } catch {
    return {};
  }
}

export async function loadContentReviews() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "content-reviews.json"), "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : { schemaVersion: 1, questions: {} };
  } catch {
    return { schemaVersion: 1, questions: {} };
  }
}

export async function loadContentEnhancements() {
  try {
    const payload = JSON.parse(await readFile(join(root, "research", "content-enhancements.json"), "utf8"));
    return payload?.enhancements && typeof payload.enhancements === "object" && !Array.isArray(payload.enhancements)
      ? payload.enhancements
      : {};
  } catch {
    return {};
  }
}

export function sanitizeLearningHints(hints) {
  if (!Array.isArray(hints)) return [];
  const seen = new Set();
  const clean = [];
  for (const hint of hints) {
    if (!hint || typeof hint.title !== "string" || !hint.title.trim()) continue;
    const site = String(hint.site || "其他").slice(0, 30);
    const title = String(hint.title).slice(0, 120);
    const key = site + "|" + title;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({
      site,
      title,
      url: typeof hint.url === "string" && /^https?:\/\//.test(hint.url) ? hint.url.slice(0, 300) : ""
    });
  }
  return clean;
}

export function applyAiScores(questions, scores) {
  for (const question of questions) {
    const score = scores[question.id];
    if (!score || typeof score !== "object") continue;
    const base = Math.round(Number(score.base));
    const final = Math.round(Number(score.importance));
    if (!Number.isInteger(base) || !Number.isInteger(final) || base < 0 || base > 98 || final < 0 || final > 98) continue;
    if (question.importance !== base) continue;
    if (Math.abs(final - base) > 6) continue;
    question.scoreBase = base;
    question.scoreNote = typeof score.note === "string" ? score.note.slice(0, 200) : "";
    question.scoreSource = "ai";
    question.importance = final;
    question.tier = final >= 88 ? "core" : final >= 74 ? "high" : "extended";
  }
  return questions;
}

export function allCatalogConcepts(newConcepts = []) {
  const backend = [...backendConcepts, ...newConcepts.filter((concept) => concept.track === "backend")]
    .map((concept) => ({ ...concept, ...classifyBackendConcept(concept.name, concept.category, concept.topicGroup) }));
  const agent = [...agentConcepts, ...newConcepts.filter((concept) => concept.track === "agent")]
    .map((concept) => ({ ...concept, topicGroup: String(concept.topicGroup || concept.category || "其他") }));
  return { backend, agent };
}

const angles = [
  {
    key: "definition",
    title: (concept) => `什么是${concept.name}，它主要解决什么问题？`,
    answer: (concept) => concept.definition,
    points: (concept) => [concept.definition, concept.mechanism],
    hint: (concept) => `先说清${concept.name}出现前有什么问题，再用一句话给出定义。`,
    difficulty: 1,
    bonus: 5
  },
  {
    key: "mechanism",
    title: (concept) => `${concept.name}的核心机制和执行过程是什么？`,
    answer: (concept) => concept.mechanism,
    points: (concept) => [concept.mechanism, concept.pitfall],
    hint: () => "尝试按输入、关键步骤、输出的顺序描述，不要只罗列名词。",
    difficulty: 2,
    bonus: 4
  },
  {
    key: "application",
    title: (concept) => `在真实项目中如何正确使用或设计${concept.name}？`,
    answer: (concept) => concept.application,
    points: (concept) => [concept.application, concept.pitfall],
    hint: () => "从业务约束、方案选择、异常处理和验证指标四部分组织回答。",
    difficulty: 2,
    bonus: 3
  },
  {
    key: "pitfall",
    title: (concept) => `${concept.name}有哪些常见错误、异常与排查思路？`,
    answer: (concept) => concept.pitfall,
    points: (concept) => [concept.pitfall, concept.application],
    hint: () => "先列最常见的失败现象，再解释原因、证据和修复顺序。",
    difficulty: 3,
    bonus: 2
  },
  {
    key: "comparison",
    title: (concept) => `${concept.name}与${concept.compare}如何比较和选型？`,
    answer: (concept) => concept.tradeoff,
    points: (concept) => [concept.tradeoff, concept.application],
    hint: () => "不要只说谁更好，比较控制权、一致性、性能、复杂度和适用前提。",
    difficulty: 3,
    bonus: 4
  }
];

const learningSourcesByCategory = {
  "Java基础": ["oracle-java-api-21", "oracle-java-spec-21"],
  "Java集合": ["oracle-java-api-21", "oracle-java-spec-21"],
  "Java并发": ["oracle-java-concurrency-21", "oracle-java-spec-21"],
  "JVM": ["oracle-java-spec-21"],
  "Spring生态": ["spring-framework-reference"],
  "MySQL": ["mysql-innodb-84"],
  "Redis": ["redis-data-types-official", "redis-persistence-official"],
  "计算机网络": ["xiaolin-backend-2026"],
  "操作系统与Linux": ["xiaolin-backend-2026"],
  "消息队列": ["kafka-official-design"],
  "分布式与微服务": ["javaguide-priority-2026", "xiaolin-backend-2026"],
  "系统设计与场景": ["javaguide-priority-2026", "xiaolin-backend-2026"],
  "模型与API": ["openai-chat-api-2026", "javaguide-ai-2026"],
  "Prompt与上下文": ["owasp-genai-top10-2026", "javaguide-ai-2026"],
  "RAG与知识库": ["javaguide-ai-2026", "elegy-agent-wiki-2026"],
  "Agent架构": ["langgraph-official-persistence", "javaguide-ai-2026"],
  "工具与MCP": ["mcp-architecture-official", "javaguide-ai-2026"],
  "记忆与多Agent": ["langgraph-official-persistence", "javaguide-ai-2026"],
  "评测与可靠性": ["owasp-genai-top10-2026", "javaguide-ai-2026"],
  "项目与场景": ["langgraph-official-persistence", "javaguide-ai-2026"]
};

const answerFrameworks = {
  definition: ["先用一句话下定义", "说明它解决的具体问题", "补充一个核心机制", "最后说适用边界"],
  mechanism: ["说明输入或前提", "按顺序讲关键步骤", "说明最终结果", "补一个异常或边界"],
  application: ["先给业务目标与约束", "再说方案和关键参数", "覆盖失败处理", "用指标说明如何验证"],
  pitfall: ["先描述故障现象", "列出需要采集的证据", "按概率分析原因", "给出止损、修复与复盘顺序"],
  comparison: ["先统一比较维度", "分别说优势与代价", "说明各自成立前提", "根据当前场景给结论"]
};

function withoutTrailingPunctuation(value) {
  return String(value || "").trim().replace(/[。！？!?；;]+$/u, "");
}

function detailedAnswerForAngle(concept, angle) {
  const alternatives = concept.compare || "相邻方案";
  const sections = {
    definition: [
      { title: "一句话先懂", content: concept.definition },
      { title: "它为什么会出现", content: `先从问题出发：${withoutTrailingPunctuation(concept.application)}。${concept.name}的价值不是背名词，而是让这类约束有明确的处理方式。` },
      { title: "抓住一个核心机制", content: concept.mechanism },
      { title: "什么时候不能只套定义", content: `真实系统还要结合数据规模、并发、失败恢复和可观测性判断；${concept.pitfall}` },
      { title: `别和${alternatives}混淆`, content: concept.tradeoff }
    ],
    mechanism: [
      { title: "先明确输入与前提", content: `${withoutTrailingPunctuation(concept.definition)}。讲机制前先说明参与者、输入以及成立条件，避免直接跳到实现细节。` },
      { title: "按因果顺序讲执行链", content: concept.mechanism },
      { title: "执行后得到什么", content: `机制最终要服务于项目目标：${concept.application}` },
      { title: "链路最容易在哪里断", content: concept.pitfall },
      { title: "如何证明机制真的生效", content: `不要只复述源码或流程图，应通过日志、指标、状态变化或对照实验验证；选型时还要说明：${concept.tradeoff}` }
    ],
    application: [
      { title: "先说业务目标与约束", content: `${withoutTrailingPunctuation(concept.definition)}。落到项目时先交代流量、数据量、一致性、延迟和团队维护成本等约束。` },
      { title: "给出可落地的设计", content: concept.application },
      { title: "解释关键参数和链路", content: concept.mechanism },
      { title: "覆盖失败处理", content: `设计不能只描述成功路径。需要提前处理这些风险：${concept.pitfall}` },
      { title: "用指标和对照验证", content: `上线前后用成功率、P95/P99、资源消耗和故障恢复结果验证，并说明为什么没有选择${alternatives}：${concept.tradeoff}` }
    ],
    pitfall: [
      { title: "先描述可观察的故障", content: `不要从猜原因开始。先说明错误、延迟、资源曲线、数据状态或用户影响，再围绕${concept.name}缩小范围。` },
      { title: "收集证据再定位", content: `结合调用链、日志、指标、配置和最小复现检查核心链路：${concept.mechanism}` },
      { title: "高概率原因", content: concept.pitfall },
      { title: "止损、修复与验证", content: `先降低影响面，再按项目约束修复：${withoutTrailingPunctuation(concept.application)}。修复后用同一组证据和回归用例确认问题消失。` },
      { title: "避免错误归因", content: `还要排除${alternatives}等相邻机制，并说明两者边界：${concept.tradeoff}` }
    ],
    comparison: [
      { title: "先统一比较维度", content: `围绕功能目标、正确性、性能、复杂度、成本和适用前提比较${concept.name}与${alternatives}，不要直接宣布谁更好。` },
      { title: `${concept.name}的优势与代价`, content: `${withoutTrailingPunctuation(concept.definition)}。核心实现是：${concept.mechanism}` },
      { title: `${alternatives}适合什么情况`, content: concept.tradeoff },
      { title: "带入真实约束做决定", content: concept.application },
      { title: "结论必须带边界", content: `如果约束变化，选择也可能变化；同时要规避这些常见误判：${concept.pitfall}` }
    ]
  };
  return sections[angle.key] || sections.definition;
}

function interviewFollowUps(concept, angle) {
  const alternatives = concept.compare || "相邻方案";
  const followUps = {
    definition: [
      `如果不用${concept.name}，最先出现的工程问题是什么？`,
      `${concept.name}成立需要哪些前提或边界？`,
      `它和${alternatives}最容易混淆的区别是什么？`
    ],
    mechanism: [
      `请按时间或调用顺序完整讲一遍${concept.name}，中间有哪些状态变化？`,
      `链路中任一步失败时，系统如何发现、重试或恢复？`,
      `你会查看哪些日志、指标或数据来证明机制按预期运行？`
    ],
    application: [
      `如果流量或数据量增长十倍，你的${concept.name}方案要改哪里？`,
      `这个设计的失败路径、降级策略和回滚方案是什么？`,
      `你用什么基线和指标证明该方案比${alternatives}更合适？`
    ],
    pitfall: [
      `线上出现相关告警时，你最先看哪三项证据，为什么？`,
      `如何区分${concept.name}自身问题和${alternatives}引发的相似现象？`,
      `临时止损后，你会补哪些监控、测试或机制避免复发？`
    ],
    comparison: [
      `在什么约束变化下，你会从${concept.name}切换到${alternatives}？`,
      `请从正确性、性能、复杂度和成本四个维度给出取舍。`,
      `如果团队缺少相关经验，你会如何降低选型和迁移风险？`
    ]
  };
  return followUps[angle.key] || followUps.definition;
}

function normalizeContentEnhancement(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const scenario = String(raw.scenario || "").trim().slice(0, 500);
  const steps = Array.isArray(raw.steps) ? raw.steps.map((step) => String(step).trim().slice(0, 260)).filter(Boolean).slice(0, 6) : [];
  const expected = String(raw.expected || "").trim().slice(0, 400);
  const sourceIds = Array.isArray(raw.sourceIds)
    ? [...new Set(raw.sourceIds.map((sourceId) => String(sourceId).trim()).filter(Boolean))].slice(0, 8)
    : [];
  const code = raw.code && typeof raw.code === "object" && !Array.isArray(raw.code)
    ? {
        language: String(raw.code.language || "text").trim().slice(0, 30),
        title: String(raw.code.title || "参考片段").trim().slice(0, 100),
        content: String(raw.code.content || "").replace(/\r\n/g, "\n").trim().slice(0, 5000)
      }
    : null;
  if (!scenario && !steps.length && !code?.content) return null;
  return { scenario, steps, expected, ...(sourceIds.length ? { sourceIds } : {}), ...(code?.content ? { code } : {}) };
}

function workedExample(concept, angle, enhancement, fallbackSourceIds = []) {
  const curated = normalizeContentEnhancement(enhancement);
  const sourceIds = curated?.sourceIds?.length
    ? curated.sourceIds
    : [...new Set((fallbackSourceIds || []).map(String).filter(Boolean))].slice(0, 8);
  return {
    title: curated?.code ? curated.code.title : `${concept.name}最小演练`,
    scenario: curated?.scenario || `把“${concept.application}”作为一个最小项目场景，先写下目标、输入和约束。`,
    steps: curated?.steps?.length ? curated.steps : [
      `画出${concept.name}的关键执行链：${concept.mechanism}`,
      `主动注入一个失败条件并观察：${concept.pitfall}`,
      `记录验证指标，再与${concept.compare}做一次对照。`
    ],
    expected: curated?.expected || `能够用当前题型“${angle.key}”复述设计、证据和边界，而不是只背结论。`,
    ...(sourceIds.length ? { sourceIds } : {}),
    ...(curated?.code ? { code: curated.code } : {})
  };
}

export function effectiveSourceIds(concept, sourcesArray) {
  const direct = concept.sourceIds || [];
  const viaSupport = sourcesArray
    .filter((source) => Array.isArray(source.supportsConcepts) && source.supportsConcepts.includes(concept.name))
    .map((source) => source.id);
  return [...new Set([...direct, ...viaSupport])];
}

function frequencyEligibleSource(source) {
  const inferred = source.type === "interview" && source.directQuestionEvidence && /^https?:\/\//.test(source.url || "") && /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt || "");
  return Boolean((source.collection?.frequencyEligible ?? inferred) && inferred);
}

function sourcePlatform(source) {
  try {
    const host = new URL(source.url).hostname.toLowerCase();
    if (host.endsWith("nowcoder.com")) return "nowcoder";
    if (host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com")) return "xiaohongshu";
    return host;
  } catch {
    return "unknown";
  }
}

function aggregateSource(source) {
  return source.discovery?.sourceKind === "aggregate" || /多公司|汇总|合集|盘点|题库|八股文/.test(`${source.company || ""} ${source.title || ""} ${source.notes || ""}`);
}

function uniqueClusterSources(sources) {
  const byCluster = new Map();
  for (const source of sources) {
    const cluster = source.discovery?.duplicateClusterId || source.id;
    const current = byCluster.get(cluster);
    if (!current || Number(source.weight || 0) > Number(current.weight || 0)) byCluster.set(cluster, source);
  }
  return [...byCluster.values()];
}

function ageDays(date, asOf) {
  const time = new Date(`${date || ""}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((asOf.getTime() - time) / 86_400_000)) : 10_000;
}

export function buildQuestions(concepts, track, prefix, sourcesArray, snapshotDate, hintsMap = null, contentReviews = {}, publicAttentionMap = new Map(), contentEnhancements = {}) {
  const sourceMap = new Map(sourcesArray.map((source) => [source.id, source]));
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || "") ? new Date(`${snapshotDate}T00:00:00Z`) : new Date();
  const globalInterviewSamples = uniqueClusterSources(sourcesArray.filter(frequencyEligibleSource)).filter((source) => !aggregateSource(source)).length;
  const globalConfidence = Math.min(1, Math.log1p(globalInterviewSamples) / Math.log1p(120));
  return concepts.flatMap((concept, conceptIndex) => angles.map((angle, angleIndex) => {
    const questionId = `${prefix}-${String(conceptIndex + 1).padStart(3, "0")}-${angleIndex + 1}`;
    const contentReview = contentReviews?.[questionId]?.status === "reviewed" ? contentReviews[questionId] : null;
    const conceptHints = sanitizeLearningHints([
      ...(hintsMap?.get(concept.name) || []),
      ...(concept.learningHints || [])
    ]);
    const contentEnhancement = contentEnhancements?.[concept.name];
    const sources = effectiveSourceIds(concept, sourcesArray).map((id) => sourceMap.get(id)).filter(Boolean);
    const independentSources = uniqueClusterSources(sources);
    const interviewSources = independentSources.filter(frequencyEligibleSource);
    const directInterviewSources = interviewSources.filter((source) => !aggregateSource(source));
    const recentInterviewSources = directInterviewSources.filter((source) => ageDays(source.publishedAt, asOf) <= 90);
    const weightedSupport = interviewSources.reduce((sum, source) => {
      const recency = Math.exp(-ageDays(source.publishedAt, asOf) / 240);
      const aggregateFactor = aggregateSource(source) ? 0.32 : 1;
      return sum + Number(source.weight || 0.5) * recency * aggregateFactor;
    }, 0);
    const validationSupport = independentSources.filter((source) => source.type !== "interview").reduce((sum, source) => sum + Number(source.weight || 0) * ({ job: 0.5, guide: 0.2, official: 0.15, research: 0.18 }[source.type] || 0), 0);
    const saturatedFrequency = 16 * (1 - Math.exp(-weightedSupport / 6));
    const frequencyBoost = Math.min(16, Math.round(saturatedFrequency * (0.78 + globalConfidence * 0.22)));
    const companyCount = new Set(directInterviewSources.map((source) => source.company).filter((company) => company && !/多公司|汇总|等|[\/、]/.test(company))).size;
    const platformCount = new Set(directInterviewSources.map(sourcePlatform).filter((platform) => platform !== "unknown")).size;
    const levelCount = new Set(directInterviewSources.map((source) => source.candidateLevel).filter((level) => level && level !== "unknown")).size;
    const sourceDiversityBoost = Math.min(5, Math.min(3, Math.max(0, companyCount - 1)) + Math.min(1, Math.max(0, platformCount - 1)) + Math.min(1, Math.max(0, levelCount - 1)));
    const validationBoost = Math.min(2, Math.round(2 * (1 - Math.exp(-validationSupport / 1.5))));
    const publicAttention = publicAttentionMap.get(concept.name);
    const publicAttentionBoost = Math.min(2, Math.max(0, Number(publicAttention?.attentionBoost || 0)));
    const importance = Math.min(98, 46 + concept.priority * 4 + angle.bonus + frequencyBoost + sourceDiversityBoost + validationBoost + publicAttentionBoost);
    const evidenceLevel = globalInterviewSamples >= 80 && recentInterviewSources.length >= 4 && directInterviewSources.length >= 8 && (companyCount >= 3 || platformCount >= 2)
      ? "strong"
      : directInterviewSources.length >= 2 || sources.some((source) => source.type === "job")
        ? "medium"
        : "foundation";
    const tier = importance >= 88 ? "core" : importance >= 74 ? "high" : "extended";
    const lastObserved = sources.map((source) => source.publishedAt).filter(Boolean).sort().at(-1) || snapshotDate;
    const learningSourceIds = learningSourcesByCategory[concept.category] || [];
    const keyPoints = angle.points(concept)
      .flatMap((text) => String(text).split(/[；。]/))
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 6);

    return {
      id: questionId,
      track,
      category: concept.category,
      topicGroup: concept.topicGroup || concept.category,
      concept: concept.name,
      angle: angle.key,
      title: angle.title(concept),
      tier,
      difficulty: Math.min(5, angle.difficulty + (concept.priority <= 2 ? 1 : 0)),
      importance,
      tags: [...new Set([concept.name, concept.category, concept.topicGroup, ...(concept.tags || [])])].filter(Boolean),
      beginnerHint: angle.hint(concept),
      quickAnswer: angle.answer(concept),
      keyPoints,
      answerFramework: answerFrameworks[angle.key],
      detailedAnswer: detailedAnswerForAngle(concept, angle),
      workedExample: workedExample(concept, angle, contentEnhancement, learningSourceIds),
      interviewFollowUps: interviewFollowUps(concept, angle),
      relatedKnowledge: [...new Set([...(concept.tags || []), concept.compare, concept.topicGroup, concept.category])].filter(Boolean),
      learningSourceIds,
      ...(conceptHints.length ? { learningHints: conceptHints } : {}),
      contentStatus: contentReview ? "reviewed" : "outline",
      ...(contentReview ? { contentReview: {
        reviewedAt: String(contentReview.reviewedAt || "").slice(0, 10),
        note: String(contentReview.note || "").slice(0, 300),
        sourceIds: Array.isArray(contentReview.sourceIds) ? [...new Set(contentReview.sourceIds.map(String))].slice(0, 8) : []
      } } : {}),
      evidence: {
        level: evidenceLevel,
        sourceIds: sources.map((source) => source.id),
        recentInterviewSamples: recentInterviewSources.length,
        weightedSupport: Number(weightedSupport.toFixed(2)),
        independentInterviewSamples: directInterviewSources.length,
        globalInterviewSamples,
        sampleConfidence: Number(globalConfidence.toFixed(3)),
        frequencyBoost,
        companyCount,
        platformCount,
        publicQuestionAttention: publicAttention?.available ? {
          available: true,
          attentionBoost: publicAttentionBoost,
          publicTitleSamples: publicAttention.publicTitleSamples,
          bankCount: publicAttention.bankCount,
          bestBankRank: publicAttention.bestBankRank,
          signal: publicAttention.signal,
          confidence: publicAttention.confidence,
          capturedAt: publicAttention.capturedAt,
          access: publicAttention.access,
          banks: publicAttention.banks.map((bank) => ({
            title: bank.title,
            url: bank.url,
            rank: bank.rank,
            heat: bank.heat,
            bestPosition: bank.bestPosition,
            questionCount: bank.questionCount
          })),
          examples: publicAttention.titles.slice(0, 3)
        } : {
          available: false,
          attentionBoost: 0,
          publicTitleSamples: 0,
          bankCount: 0,
          signal: "none",
          confidence: "none",
          capturedAt: publicAttention?.capturedAt || null,
          access: "title-only",
          banks: [],
          examples: []
        },
        lastObserved,
        note: evidenceLevel === "strong"
          ? "达到大样本、近期重复和来源多样性门槛；分数采用饱和曲线，样本继续增加不会线性涨分。"
          : evidenceLevel === "medium"
            ? "由面经、岗位要求或多个维护资料共同支持。"
            : "属于岗位前置基础；公开面经常默认掌握，直接出现样本较少。"
      }
    };
  }));
}

function buildTrackTaxonomy(questions, track, preferredCategoryOrder = []) {
  const trackQuestions = questions.filter((question) => question.track === track);
  const categoryNames = [...new Set(trackQuestions.map((question) => question.category))]
    .sort((a, b) => {
      const ai = preferredCategoryOrder.indexOf(a);
      const bi = preferredCategoryOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b, "zh-CN");
    });
  return categoryNames.map((category) => {
    const categoryQuestions = trackQuestions.filter((question) => question.category === category);
    const groupNames = [...new Set(categoryQuestions.map((question) => question.topicGroup))];
    return {
      name: category,
      questionCount: categoryQuestions.length,
      groups: groupNames.map((topicGroup) => {
        const groupQuestions = categoryQuestions.filter((question) => question.topicGroup === topicGroup);
        return {
          name: topicGroup,
          questionCount: groupQuestions.length,
          concepts: [...new Set(groupQuestions.map((question) => question.concept))].map((concept) => ({
            name: concept,
            questionCount: groupQuestions.filter((question) => question.concept === concept).length
          }))
        };
      })
    };
  });
}

export function buildTaxonomy(questions) {
  return {
    angles: QUESTION_ANGLES,
    tracks: {
      backend: buildTrackTaxonomy(questions, "backend", BACKEND_CATEGORY_NAMES),
      agent: buildTrackTaxonomy(questions, "agent")
    }
  };
}

export async function buildPayload() {
  const sourcePayload = await loadSources();
  const newConcepts = await loadNewConcepts();
  const hintsMap = new Map(Object.entries(await loadLearningHints()));
  const contentReviews = (await loadContentReviews()).questions || {};
  const contentEnhancements = await loadContentEnhancements();
  const { backend, agent } = allCatalogConcepts(newConcepts);
  const publicSignalPayload = await loadPublicQuestionSignals();
  const publicSignalResult = buildPublicQuestionAttention(publicSignalPayload, [
    ...backend.map((concept) => ({ ...concept, track: "backend" })),
    ...agent.map((concept) => ({ ...concept, track: "agent" }))
  ]);
  const questions = applyAiScores([
    ...buildQuestions(backend, "backend", "be", sourcePayload.sources, sourcePayload.snapshotDate, hintsMap, contentReviews, publicSignalResult.attention, contentEnhancements),
    ...buildQuestions(agent, "agent", "ai", sourcePayload.sources, sourcePayload.snapshotDate, hintsMap, contentReviews, publicSignalResult.attention, contentEnhancements)
  ], await loadAiScores());
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    researchSnapshot: sourcePayload.snapshotDate,
    disclaimer: "重要度是基于当前收录公开样本的可解释排序，不是全市场精确命中率。提纲版答案用于主动回忆起点，变化快或有争议的内容仍应核对官方文档。",
    publicQuestionSignals: {
      source: publicSignalPayload.site || null,
      capturedAt: publicSignalPayload.capturedAt || null,
      access: publicSignalPayload.access || "title-only",
      totalTitles: publicSignalResult.audit.totalTitles,
      inScopeTitles: publicSignalResult.audit.inScopeTitles,
      matchedInScopeTitles: publicSignalResult.audit.matchedInScopeTitles,
      inScopeCoverage: publicSignalResult.audit.inScopeCoverage,
      excludedTitles: publicSignalResult.audit.excludedTitles,
      mappedConcepts: publicSignalResult.audit.mappedConcepts
    },
    taxonomy: buildTaxonomy(questions),
    counts: {
      total: questions.length,
      backend: questions.filter((question) => question.track === "backend").length,
      agent: questions.filter((question) => question.track === "agent").length,
      core: questions.filter((question) => question.tier === "core").length,
      high: questions.filter((question) => question.tier === "high").length,
      extended: questions.filter((question) => question.tier === "extended").length
    },
    questions
  };
}

export async function writePayload() {
  const output = await buildPayload();
  const outputPath = join(root, "content", "questions.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Generated ${output.counts.total} questions (${output.counts.backend} backend, ${output.counts.agent} agent).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writePayload();
}
