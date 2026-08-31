import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { loadContentReviews, loadNewConcepts, loadSources } from "./generate-questions.mjs";
import { BACKEND_CATEGORY_NAMES, QUESTION_ANGLES, backendTaxonomyEntry } from "./taxonomy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export function expectedCounts(newConcepts = []) {
  const backend = backendConcepts.length + newConcepts.filter((concept) => concept.track === "backend").length;
  const agent = agentConcepts.length + newConcepts.filter((concept) => concept.track === "agent").length;
  return { backend: backend * 5, agent: agent * 5, total: (backend + agent) * 5 };
}

export function validatePayload(questionsPayload, sourcesPayload, expected = null, contentReviewsPayload = null) {
  const questions = questionsPayload.questions || [];
  const sources = sourcesPayload.sources || [];
  const sourceIds = new Set(sources.map((source) => source.id));
  const errors = [];
  const collectionMethods = new Set(["curated-snapshot", "sitemap-snapshot", "auto-fetch", "manual-url", "manual-text"]);
  const candidateLevels = new Set(["intern", "campus", "experienced", "unknown"]);
  const contentStatuses = new Set(["outline", "reviewed"]);
  const angles = new Set(QUESTION_ANGLES.map((angle) => angle.id));
  const reviewStatuses = new Set(["reviewed", "needs-revision"]);
  const reviewEntries = contentReviewsPayload?.questions && typeof contentReviewsPayload.questions === "object" && !Array.isArray(contentReviewsPayload.questions)
    ? contentReviewsPayload.questions
    : {};

  if (expected) {
    if (questions.length !== expected.total) errors.push(`题目总数应为${expected.total}，实际为${questions.length}`);
    if (questions.filter((question) => question.track === "backend").length !== expected.backend) errors.push(`后端题目不是${expected.backend}道`);
    if (questions.filter((question) => question.track === "agent").length !== expected.agent) errors.push(`Agent题目不是${expected.agent}道`);
  }

  for (const field of ["id", "title"]) {
    const values = questions.map((question) => question[field]);
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    if (duplicates.length) errors.push(`${field}存在重复：${[...new Set(duplicates)].slice(0, 5).join("、")}`);
  }

  const publicSignals = questionsPayload.publicQuestionSignals;
  if (publicSignals !== undefined) {
    if (!publicSignals || typeof publicSignals !== "object" || Array.isArray(publicSignals)) {
      errors.push("publicQuestionSignals 必须是对象");
    } else {
      if (publicSignals.access !== "title-only") errors.push("publicQuestionSignals.access 必须是 title-only");
      for (const field of ["totalTitles", "inScopeTitles", "matchedInScopeTitles", "excludedTitles", "mappedConcepts"]) {
        if (!Number.isInteger(publicSignals[field]) || publicSignals[field] < 0) errors.push("publicQuestionSignals." + field + " 必须是非负整数");
      }
      if (Number(publicSignals.matchedInScopeTitles) > Number(publicSignals.inScopeTitles) || Number(publicSignals.inScopeTitles) > Number(publicSignals.totalTitles)) {
        errors.push("publicQuestionSignals 的覆盖计数顺序非法");
      }
      if (typeof publicSignals.inScopeCoverage !== "number" || publicSignals.inScopeCoverage < 0 || publicSignals.inScopeCoverage > 1) {
        errors.push("publicQuestionSignals.inScopeCoverage 必须在 0 到 1 之间");
      }
    }
  }

  for (const question of questions) {
    for (const field of ["id", "track", "category", "topicGroup", "concept", "angle", "title", "tier", "quickAnswer", "evidence"]) {
      if (question[field] === undefined || question[field] === "") errors.push(`${question.id || "unknown"} 缺少 ${field}`);
    }
    if (!angles.has(question.angle)) errors.push(`${question.id} 的 angle 非法`);
    if (typeof question.topicGroup !== "string" || !question.topicGroup.trim()) errors.push(`${question.id} 的 topicGroup 非法`);
    if (question.track === "backend") {
      if (!BACKEND_CATEGORY_NAMES.includes(question.category)) errors.push(`${question.id} 的后端专题不在八股目录中`);
      const classified = backendTaxonomyEntry(question.concept);
      if (classified && (classified.category !== question.category || classified.topicGroup !== question.topicGroup)) {
        errors.push(`${question.id} 的后端知识点分类与统一目录不一致`);
      }
    }
    if (question.quickAnswer.length < 18) errors.push(`${question.id} 的精简答案过短`);
    if (!Array.isArray(question.keyPoints) || question.keyPoints.length < 2) errors.push(`${question.id} 缺少评分点`);
    if (!Array.isArray(question.answerFramework) || question.answerFramework.length < 4) errors.push(`${question.id} 缺少回答结构`);
    if (!Array.isArray(question.detailedAnswer) || question.detailedAnswer.length < 5) errors.push(`${question.id} 缺少详细讲解`);
    else if (question.detailedAnswer.some((section) => !section || typeof section.title !== "string" || section.title.trim().length < 4 || typeof section.content !== "string" || section.content.trim().length < 18)) {
      errors.push(`${question.id} 的详细讲解存在空泛或非法段落`);
    }
    if (!question.workedExample || typeof question.workedExample !== "object" || Array.isArray(question.workedExample)) {
      errors.push(`${question.id} 缺少动手示例`);
    } else {
      if (typeof question.workedExample.scenario !== "string" || question.workedExample.scenario.trim().length < 20) errors.push(`${question.id} 的示例场景过短`);
      if (!Array.isArray(question.workedExample.steps) || question.workedExample.steps.length < 3) errors.push(`${question.id} 的示例步骤不足`);
      if (typeof question.workedExample.expected !== "string" || question.workedExample.expected.trim().length < 16) errors.push(`${question.id} 的示例验证结果过短`);
      if (!Array.isArray(question.workedExample.sourceIds) || !question.workedExample.sourceIds.length) {
        errors.push(`${question.id} 的示例缺少核查来源`);
      } else {
        for (const sourceId of question.workedExample.sourceIds) if (!sourceIds.has(sourceId)) errors.push(`${question.id} 的示例引用了不存在的来源 ${sourceId}`);
      }
      if (question.workedExample.code !== undefined) {
        const code = question.workedExample.code;
        if (!code || typeof code !== "object" || Array.isArray(code) || typeof code.language !== "string" || !code.language || typeof code.title !== "string" || code.title.trim().length < 4 || typeof code.content !== "string" || code.content.trim().length < 20) {
          errors.push(`${question.id} 的代码示例非法`);
        }
      }
    }
    if (!Array.isArray(question.interviewFollowUps) || question.interviewFollowUps.length < 3 || new Set(question.interviewFollowUps).size !== question.interviewFollowUps.length) {
      errors.push(`${question.id} 缺少不重复的面试追问`);
    }
    if (!Array.isArray(question.relatedKnowledge) || question.relatedKnowledge.length < 2) errors.push(`${question.id} 缺少关联知识点`);
    if (!contentStatuses.has(question.contentStatus)) errors.push(`${question.id} 的 contentStatus 非法`);
    if (contentReviewsPayload !== null && question.contentStatus === "reviewed" && reviewEntries[question.id]?.status !== "reviewed") {
      errors.push(`${question.id} 标记为已复核但缺少有效复核登记`);
    }
    if (question.contentStatus === "reviewed") {
      if (!question.contentReview || typeof question.contentReview !== "object" || Array.isArray(question.contentReview)) {
        errors.push(`${question.id} 缺少公开复核摘要`);
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(question.contentReview.reviewedAt || "")) errors.push(`${question.id} 的公开复核日期非法`);
        if (typeof question.contentReview.note !== "string" || question.contentReview.note.trim().length < 8) errors.push(`${question.id} 的公开复核说明过短`);
        if (!Array.isArray(question.contentReview.sourceIds) || !question.contentReview.sourceIds.length) errors.push(`${question.id} 的公开复核来源为空`);
        for (const sourceId of question.contentReview.sourceIds || []) if (!sourceIds.has(sourceId)) errors.push(`${question.id} 的公开复核摘要引用了不存在的来源 ${sourceId}`);
      }
    } else if (question.contentReview !== undefined) {
      errors.push(`${question.id} 尚未复核却包含公开复核摘要`);
    }
    for (const hint of question.learningHints || []) {
      if (!hint || typeof hint.title !== "string" || !hint.title.trim()) errors.push(`${question.id} 的 learningHints 缺少标题`);
      if (typeof hint.site !== "string" || !hint.site) errors.push(`${question.id} 的 learningHints 缺少站点`);
    }
    if (question.scoreBase !== undefined) {
      const base = Number(question.scoreBase);
      const importance = Number(question.importance);
      if (!Number.isInteger(base) || base < 0 || base > 98) errors.push(`${question.id} scoreBase 非法`);
      if (!Number.isInteger(importance) || Math.abs(importance - base) > 6) errors.push(`${question.id} AI 调整超出 ±6 边界`);
      if (typeof question.scoreNote !== "string") errors.push(`${question.id} 缺少 scoreNote`);
    }
    const publicAttention = question.evidence?.publicQuestionAttention;
    if (publicAttention !== undefined) {
      if (!publicAttention || typeof publicAttention !== "object" || Array.isArray(publicAttention)) {
        errors.push(question.id + " 的 publicQuestionAttention 必须是对象");
      } else {
        if (publicAttention.access !== "title-only") errors.push(question.id + " 的公开题库关注度必须标记为 title-only");
        if (!Number.isInteger(publicAttention.attentionBoost) || publicAttention.attentionBoost < 0 || publicAttention.attentionBoost > 2) {
          errors.push(question.id + " 的公开题库关注度加分必须是 0 到 2 的整数");
        }
        if (!Number.isInteger(publicAttention.publicTitleSamples) || publicAttention.publicTitleSamples < 0) errors.push(question.id + " 的公开标题数非法");
        if (!Number.isInteger(publicAttention.bankCount) || publicAttention.bankCount < 0) errors.push(question.id + " 的公开题库数非法");
        if (publicAttention.available && publicAttention.confidence !== "low") errors.push(question.id + " 的单快照公开题库关注度只能是低置信");
        if (publicAttention.available !== (publicAttention.publicTitleSamples > 0 && publicAttention.bankCount > 0)) errors.push(question.id + " 的公开题库关注度可用状态与计数不一致");
        if (!Array.isArray(publicAttention.banks) || !Array.isArray(publicAttention.examples)) {
          errors.push(question.id + " 的公开题库关注度缺少题库或标题数组");
        } else {
          for (const bank of publicAttention.banks) if (!/^https:\/\//.test(bank?.url || "")) errors.push(question.id + " 的公开题库链接非法");
          for (const example of publicAttention.examples) if (!/^https:\/\//.test(example?.url || "")) errors.push(question.id + " 的公开标题链接非法");
        }
      }
    }
    for (const sourceId of question.evidence?.sourceIds || []) {
      if (!sourceIds.has(sourceId)) errors.push(`${question.id} 引用了不存在的来源 ${sourceId}`);
    }
    for (const sourceId of question.learningSourceIds || []) {
      if (!sourceIds.has(sourceId)) errors.push(`${question.id} 引用了不存在的学习来源 ${sourceId}`);
    }
  }

  if (contentReviewsPayload !== null) {
    if (contentReviewsPayload?.schemaVersion !== 1) errors.push("content-reviews.json 的 schemaVersion 必须为 1");
    if (!Array.isArray(contentReviewsPayload?.reviewBatches) || !contentReviewsPayload.reviewBatches.length) {
      errors.push("content-reviews.json 缺少 reviewBatches");
    } else {
      const batchIds = new Set();
      let declaredQuestionCount = 0;
      for (const batch of contentReviewsPayload.reviewBatches) {
        if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
          errors.push("reviewBatches 条目必须是对象");
          continue;
        }
        if (typeof batch.id !== "string" || !batch.id.trim() || batchIds.has(batch.id)) errors.push("reviewBatches 的 id 缺失或重复");
        else batchIds.add(batch.id);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.reviewedAt || "")) errors.push(`${batch.id || "unknown-batch"} 的 reviewedAt 非法`);
        if (!Number.isInteger(batch.questionCount) || batch.questionCount < 1) errors.push(`${batch.id || "unknown-batch"} 的 questionCount 非法`);
        else declaredQuestionCount += batch.questionCount;
      }
      if (declaredQuestionCount !== Object.keys(reviewEntries).length) errors.push(`复核批次数量声明为${declaredQuestionCount}，实际登记${Object.keys(reviewEntries).length}`);
    }
    const questionById = new Map(questions.map((question) => [question.id, question]));
    for (const [questionId, review] of Object.entries(reviewEntries)) {
      if (!questionById.has(questionId)) {
        errors.push(`复核登记引用了不存在的题目 ${questionId}`);
        continue;
      }
      if (!review || Array.isArray(review) || typeof review !== "object") {
        errors.push(`${questionId} 的复核登记必须是对象`);
        continue;
      }
      if (!reviewStatuses.has(review.status)) errors.push(`${questionId} 的复核状态非法`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || "")) errors.push(`${questionId} 的 reviewedAt 必须为 YYYY-MM-DD`);
      if (typeof review.note !== "string" || review.note.trim().length < 8) errors.push(`${questionId} 的复核说明过短`);
      if (!Array.isArray(review.sourceIds) || !review.sourceIds.length) {
        errors.push(`${questionId} 的复核登记缺少核查来源`);
      } else {
        for (const sourceId of review.sourceIds) if (!sourceIds.has(sourceId)) errors.push(`${questionId} 的复核登记引用了不存在的来源 ${sourceId}`);
      }
      if (review.status === "reviewed" && questionById.get(questionId).contentStatus !== "reviewed") {
        errors.push(`${questionId} 已登记复核但生成题目未同步状态`);
      }
    }
  }

  for (const source of sources) {
    const label = source.id || "unknown-source";
    if (source.candidateLevel !== undefined && !candidateLevels.has(source.candidateLevel)) {
      errors.push(`${label} 的 candidateLevel 非法`);
    }
    if (source.collection !== undefined) {
      if (!source.collection || Array.isArray(source.collection) || typeof source.collection !== "object") {
        errors.push(`${label} 的 collection 必须是对象`);
      } else {
        if (!collectionMethods.has(source.collection.method)) errors.push(`${label} 的 collection.method 非法`);
        if (typeof source.collection.frequencyEligible !== "boolean") errors.push(`${label} 的 collection.frequencyEligible 必须是布尔值`);
        if (source.collection.frequencyEligible && !(source.type === "interview" && source.directQuestionEvidence && /^https?:\/\//.test(source.url || "") && /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt || "") && source.collection.method !== "manual-text")) {
          errors.push(`${label} 不满足可追溯直接面经条件，不能参与趋势`);
        }
        if (source.collection.capturedAt !== undefined && !Number.isFinite(new Date(source.collection.capturedAt).getTime())) {
          errors.push(`${label} 的 collection.capturedAt 非法`);
        }
      }
    }
    if (source.engagement !== undefined) {
      if (!source.engagement || Array.isArray(source.engagement) || typeof source.engagement !== "object") {
        errors.push(`${label} 的 engagement 必须是对象`);
      } else {
        if (source.engagement.source !== "explicit-page-text") errors.push(`${label} 的 engagement.source 非法`);
        const metricKeys = ["views", "likes", "favorites", "comments"];
        if (!metricKeys.some((key) => source.engagement[key] !== undefined)) errors.push(`${label} 的 engagement 缺少互动数字`);
        for (const key of metricKeys) {
          if (source.engagement[key] !== undefined && (!Number.isSafeInteger(source.engagement[key]) || source.engagement[key] < 0)) {
            errors.push(`${label} 的 engagement.${key} 必须是非负整数`);
          }
        }
        if (!Number.isFinite(new Date(source.engagement.capturedAt).getTime())) errors.push(`${label} 的 engagement.capturedAt 非法`);
      }
    }
    if (source.qualityWarnings !== undefined && (!Array.isArray(source.qualityWarnings) || source.qualityWarnings.some((warning) => typeof warning !== "string"))) {
      errors.push(`${label} 的 qualityWarnings 必须是字符串数组`);
    }
    if (source.discovery !== undefined) {
      if (!source.discovery || Array.isArray(source.discovery) || typeof source.discovery !== "object") {
        errors.push(`${label} 的 discovery 必须是对象`);
      } else {
        if (typeof source.discovery.analysisVersion !== "string" || !source.discovery.analysisVersion) errors.push(`${label} 的 discovery.analysisVersion 非法`);
        if (!/^cluster-[a-f0-9]{20}$/.test(source.discovery.duplicateClusterId || "")) errors.push(`${label} 的 discovery.duplicateClusterId 非法`);
        if (!["direct-experience", "aggregate"].includes(source.discovery.sourceKind)) errors.push(`${label} 的 discovery.sourceKind 非法`);
        if (!Number.isInteger(source.discovery.questionSignals) || source.discovery.questionSignals < 0) errors.push(`${label} 的 discovery.questionSignals 非法`);
      }
    }
  }

  const groupedCategories = questions.reduce((groups, question) => {
    (groups[question.category] ||= []).push(question);
    return groups;
  }, {});
  const categoryCounts = Object.entries(groupedCategories)
    .map(([category, items]) => [category, items.length]);

  if (questionsPayload.taxonomy) {
    const taxonomyAngles = questionsPayload.taxonomy.angles;
    if (!Array.isArray(taxonomyAngles) || taxonomyAngles.map((angle) => angle.id).join("|") !== QUESTION_ANGLES.map((angle) => angle.id).join("|")) {
      errors.push("题库 taxonomy.angles 与五类题型定义不一致");
    }
    for (const track of ["backend", "agent"]) {
      const categories = questionsPayload.taxonomy.tracks?.[track];
      if (!Array.isArray(categories)) {
        errors.push(`题库 taxonomy 缺少 ${track} 分类目录`);
        continue;
      }
      const declaredCount = categories.reduce((sum, category) => sum + Number(category.questionCount || 0), 0);
      const actualCount = questions.filter((question) => question.track === track).length;
      if (declaredCount !== actualCount) errors.push(`题库 taxonomy 的 ${track} 题数与实际不一致`);
    }
  }

  return { ok: errors.length === 0, errors, categoryCounts, sources: sources.length, questions: questions.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const questionsPayload = JSON.parse(await readFile(join(root, "content", "questions.json"), "utf8"));
  const sourcesPayload = await loadSources();
  const newConcepts = await loadNewConcepts();
  const contentReviews = await loadContentReviews();
  const result = validatePayload(questionsPayload, sourcesPayload, expectedCounts(newConcepts), contentReviews);
  if (!result.ok) {
    console.error(`Validation failed with ${result.errors.length} error(s):`);
    result.errors.slice(0, 50).forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("Validation passed.");
  console.log(`Sources: ${result.sources}`);
  console.log(`Questions: ${result.questions}`);
  console.log(`Categories: ${result.categoryCounts.map(([category, count]) => `${category}=${count}`).join(", ")}`);
}
