import assert from "node:assert/strict";
import { buildSourceInsights, extractExplicitEngagement, publicSourceRecord } from "./source-insights.mjs";
import { validatePayload } from "./validate-data.mjs";

const source = {
  id: "test-interview",
  title: "测试公司 Java 后端面经",
  shortTitle: "测试面经",
  url: "https://www.nowcoder.com/feed/main/detail/test",
  type: "interview",
  track: ["backend"],
  publishedAt: "2026-08-20",
  company: "测试公司",
  position: "Java 后端开发",
  candidateLevel: "campus",
  weight: 1,
  directQuestionEvidence: true,
  notes: "测试样本",
  collection: {
    method: "auto-fetch",
    capturedAt: "2026-08-28T08:00:00.000Z",
    platform: "nowcoder",
    frequencyEligible: true
  },
  qualityWarnings: [],
  localPath: "C:\\private\\raw.html",
  apiKey: "must-never-leak"
};

const questions = ["definition", "mechanism", "application", "pitfall", "comparison"].map((angle, index) => ({
  id: `be-001-${index + 1}`,
  concept: "测试知识点",
  track: "backend",
  category: "计算机基础",
  angle,
  importance: 90 - index,
  evidence: { sourceIds: [source.id] }
}));

const insights = buildSourceInsights({ questions, sources: [source], snapshotDate: "2026-08-28" });
assert.equal(insights.coverage.interviewSources, 1);
assert.equal(insights.coverage.frequencyEligibleSources, 1);
assert.deepEqual(insights.coverage.platforms, [{ id: "nowcoder", name: "牛客", count: 1 }]);
assert.equal(insights.trends.length, 1, "five training angles should form one concept trend");
assert.equal(insights.trends[0].mentions, 1, "one source must only count once per concept");
assert.equal(insights.trends[0].confidence, "low", "tiny global samples must never be labeled high-confidence");
assert.equal(insights.trends[0].attention.available, false, "attention must remain unknown without explicit metrics");
assert.equal(insights.companies[0].name, "测试公司");
assert.equal(insights.companies[0].questionIds.length, 1);
assert.deepEqual(insights.companies[0].sourceIds, [source.id]);
assert.deepEqual(insights.companies[0].concepts, ["测试知识点"]);
assert.equal(insights.roles.find((role) => role.id === "backend")?.questionIds.length, 1);

const publicQuestionAttention = {
  available: true,
  attentionBoost: 2,
  publicTitleSamples: 18,
  bankCount: 2,
  signal: "high-attention",
  confidence: "low",
  access: "title-only",
  banks: [{ title: "公开题库", url: "https://www.mianshiya.com/bank/test", rank: 2, heat: 2600 }],
  examples: [{ title: "测试公开标题", url: "https://www.mianshiya.com/question/test" }]
};
const publicSnapshot = {
  source: "面试鸭",
  capturedAt: "2026-08-28T19:02:56.665Z",
  access: "title-only",
  totalTitles: 620,
  inScopeTitles: 559,
  matchedInScopeTitles: 559,
  inScopeCoverage: 1,
  excludedTitles: 61,
  mappedConcepts: 143,
  privateField: "must-not-be-forwarded"
};
const publicSignalInsights = buildSourceInsights({
  questions: questions.map((question) => ({
    ...question,
    evidence: { ...question.evidence, publicQuestionAttention }
  })),
  sources: [source],
  snapshotDate: "2026-08-28",
  publicQuestionSignals: publicSnapshot
});
assert.equal(publicSignalInsights.trends[0].mentions, insights.trends[0].mentions, "public title attention must not alter interview mentions");
assert.deepEqual(publicSignalInsights.trends[0].sourceIds, insights.trends[0].sourceIds, "public title attention must not create interview evidence");
assert.deepEqual(publicSignalInsights.trends[0].publicQuestionAttention, publicQuestionAttention, "public title attention should remain a separate trend field");
assert.deepEqual(publicSignalInsights.coverage.publicQuestionSignals, {
  source: "面试鸭",
  capturedAt: "2026-08-28T19:02:56.665Z",
  access: "title-only",
  totalTitles: 620,
  inScopeTitles: 559,
  matchedInScopeTitles: 559,
  inScopeCoverage: 1,
  excludedTitles: 61,
  mappedConcepts: 143
}, "public snapshot summary should expose only auditable aggregate fields");

assert.equal(extractExplicitEngagement("这篇内容没有展示互动数据", "2026-08-28T08:00:00.000Z"), null);
assert.deepEqual(extractExplicitEngagement("浏览 1.2万，点赞：17，收藏 3", "2026-08-28T08:00:00.000Z"), {
  views: 12_000,
  likes: 17,
  favorites: 3,
  capturedAt: "2026-08-28T08:00:00.000Z",
  source: "explicit-page-text"
});
const engagedInsights = buildSourceInsights({
  questions,
  sources: [{ ...source, engagement: { likes: 17, favorites: 3, capturedAt: "2026-08-28T08:00:00.000Z", source: "explicit-page-text" } }],
  snapshotDate: "2026-08-28"
});
assert.deepEqual(engagedInsights.trends[0].attention.metrics, { likes: 17, favorites: 3 }, "attention should expose explicit metric totals without a synthetic score");
assert.equal(Object.hasOwn(engagedInsights.trends[0].attention, "score"), false);

const publicSource = publicSourceRecord(source, "2026-08-28");
assert.equal(publicSource.platform.name, "牛客");
assert.equal(Object.hasOwn(publicSource.platform, "hosts"), false);
assert.equal(Object.hasOwn(publicSource, "localPath"), false);
assert.equal(Object.hasOwn(publicSource, "apiKey"), false);
assert.equal(JSON.stringify(publicSource).includes("must-never-leak"), false);

const largeSources = Array.from({ length: 130 }, (_, index) => ({
  ...source,
  id: `large-${index}`,
  url: `https://www.nowcoder.com/discuss/large-${index}`,
  company: `样本公司${index % 5}`,
  publishedAt: index < 100 ? "2026-08-20" : "2026-04-20",
  supportsConcepts: index < 12 ? ["测试知识点"] : [],
  discovery: { analysisVersion: "test", duplicateClusterId: `cluster-${String(index).padStart(20, "0")}`, sourceKind: "direct-experience", questionSignals: 5 }
}));
const largeInsights = buildSourceInsights({ questions, sources: largeSources, snapshotDate: "2026-08-28" });
assert.equal(largeInsights.coverage.independentInterviewSamples, 130);
assert.equal(largeInsights.coverage.recent90Sources, 100);
assert.equal(largeInsights.trends[0].mentions, 12);
assert.equal(largeInsights.trends[0].confidence, "high", "high confidence requires both a large global base and repeated diverse concept evidence");

const invalid = validatePayload({ questions: [] }, { sources: [{
  id: "bad-source",
  candidateLevel: "guessed",
  collection: { method: "crawler", frequencyEligible: "yes", capturedAt: "not-a-date" },
  engagement: { likes: -1, source: "model-guessed", capturedAt: "not-a-date" },
  qualityWarnings: [123]
}] });
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.some((error) => error.includes("candidateLevel")));
assert.ok(invalid.errors.some((error) => error.includes("collection.method")));
assert.ok(invalid.errors.some((error) => error.includes("engagement.likes")));
assert.ok(invalid.errors.some((error) => error.includes("qualityWarnings")));

console.log("Source insights regression passed: auditable coverage, concept dedup, explicit/unknown attention, public-field whitelist, optional metadata validation.");
