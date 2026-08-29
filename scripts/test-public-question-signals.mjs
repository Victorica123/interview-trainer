import assert from "node:assert/strict";
import { backendConcepts } from "./catalog-backend.mjs";
import { allCatalogConcepts, buildQuestions, loadNewConcepts } from "./generate-questions.mjs";
import { buildPublicQuestionAttention, loadPublicQuestionSignals } from "./public-question-signals.mjs";

const payload = await loadPublicQuestionSignals();
const catalogs = allCatalogConcepts(await loadNewConcepts());
const concepts = [
  ...catalogs.backend.map((concept) => ({ ...concept, track: "backend" })),
  ...catalogs.agent.map((concept) => ({ ...concept, track: "agent" }))
];
const result = buildPublicQuestionAttention(payload, concepts);

assert.equal(payload.schemaVersion, 1);
assert.equal(payload.access, "title-only");
assert.equal(payload.banks.length, 50);
assert.equal(payload.questions.length, 620);
assert.equal(new Set(payload.questions.map((question) => question.bankId + ":" + question.questionId)).size, 620);
assert.equal(result.audit.totalTitles, 620);
assert.equal(result.audit.inScopeTitles, 559);
assert.equal(result.audit.matchedInScopeTitles, 559, "every in-scope public title must map to an existing concept");
assert.equal(result.audit.inScopeCoverage, 1, "Java backend and applied AI/Agent public-title coverage must remain complete");
assert.deepEqual(result.audit.unmapped, [], "in-scope public titles must not silently remain unmapped");
assert.ok(result.audit.excludedTitles > 0, "classic NLP and product-internal titles must be reported rather than force-mapped");
assert.ok(result.audit.mappedConcepts >= 140);

for (const [concept, attention] of result.attention) {
  assert.ok(concepts.some((item) => item.name === concept), "title-only data must never create a new concept");
  assert.ok(Number.isInteger(attention.attentionBoost) && attention.attentionBoost >= 0 && attention.attentionBoost <= 2);
  assert.equal(attention.access, "title-only");
  if (attention.available) {
    assert.equal(attention.confidence, "low", "one public-bank snapshot cannot claim trend confidence");
    assert.ok(attention.bankCount >= 1);
    assert.ok(attention.publicTitleSamples >= 1);
  }
}

const duplicatePayload = {
  schemaVersion: 1,
  access: "title-only",
  capturedAt: "2026-08-29T00:00:00.000Z",
  banks: [{ bankId: "bank-1", title: "测试热门题库", url: "https://example.com/bank-1", rank: 1, heat: 1000, titleSnapshotIncluded: true }],
  questions: [
    { bankId: "bank-1", questionId: "q-1", position: 1, title: "说说 Java 中 HashMap 的原理？", url: "https://example.com/q-1" },
    { bankId: "bank-1", questionId: "q-2", position: 2, title: "说说 Java 中 HashMap 的原理？", url: "https://example.com/q-2" }
  ]
};
const hashMapConcept = concepts.find((concept) => concept.name === "HashMap");
const duplicateAttention = buildPublicQuestionAttention(duplicatePayload, [hashMapConcept]).attention.get("HashMap");
assert.equal(duplicateAttention.publicTitleSamples, 1, "duplicate titles in the same bank must count once");
assert.equal(duplicateAttention.bankCount, 1);

const noAttention = buildQuestions([backendConcepts.find((concept) => concept.name === "HashMap")], "backend", "test", [], "2026-08-29");
const withAttention = buildQuestions(
  [backendConcepts.find((concept) => concept.name === "HashMap")],
  "backend",
  "test",
  [],
  "2026-08-29",
  null,
  {},
  new Map([["HashMap", {
    available: true,
    attentionBoost: 2,
    publicTitleSamples: 6,
    bankCount: 1,
    bestBankRank: 2,
    signal: "snapshot-only",
    confidence: "low",
    capturedAt: "2026-08-29T00:00:00.000Z",
    access: "title-only",
    banks: [{ title: "测试热门题库", url: "https://example.com/bank-1", rank: 2, heat: 1000, bestPosition: 1, questionCount: 200 }],
    titles: [{ title: "HashMap 原理", url: "https://example.com/q-1", bankId: "bank-1", position: 1 }]
  }]])
);
for (let index = 0; index < noAttention.length; index += 1) {
  assert.equal(withAttention[index].evidence.independentInterviewSamples, noAttention[index].evidence.independentInterviewSamples);
  assert.equal(withAttention[index].evidence.recentInterviewSamples, noAttention[index].evidence.recentInterviewSamples);
  assert.equal(withAttention[index].evidence.frequencyBoost, noAttention[index].evidence.frequencyBoost);
  assert.equal(withAttention[index].importance - noAttention[index].importance, 2);
}

console.log("Public question signal regression passed: 620 title-only samples, scoped coverage, bank dedup, +2 cap, and zero interview-frequency leakage.");
