import assert from "node:assert/strict";
import { buildPayload, loadContentReviews, loadNewConcepts, loadSources } from "./generate-questions.mjs";
import { expectedCounts, validatePayload } from "./validate-data.mjs";

const [questionsPayload, sourcesPayload, reviewsPayload, newConcepts] = await Promise.all([
  buildPayload(),
  loadSources(),
  loadContentReviews(),
  loadNewConcepts()
]);

const registeredReviewedIds = Object.entries(reviewsPayload.questions || {})
  .filter(([, review]) => review.status === "reviewed")
  .map(([id]) => id)
  .sort();
const generatedReviewedIds = questionsPayload.questions
  .filter((question) => question.contentStatus === "reviewed")
  .map((question) => question.id)
  .sort();

const declaredReviewCount = (reviewsPayload.reviewBatches || []).reduce((sum, batch) => sum + Number(batch.questionCount || 0), 0);
assert.equal(registeredReviewedIds.length, declaredReviewCount, "explicit review entries should match the declared batch counts");
assert.equal(registeredReviewedIds.length, 80, "the first two explicit content-review batches should contain 80 questions");
assert.deepEqual(generatedReviewedIds, registeredReviewedIds, "generated reviewed status must come only from the explicit registry");
assert.equal(questionsPayload.questions.find((question) => question.id === "be-001-1")?.contentStatus, "outline", "priority alone must not automatically claim human review");

const valid = validatePayload(questionsPayload, sourcesPayload, expectedCounts(newConcepts), reviewsPayload);
assert.equal(valid.ok, true, valid.errors.join("\n"));

const missingReview = structuredClone(reviewsPayload);
delete missingReview.questions[registeredReviewedIds[0]];
const missingReviewResult = validatePayload(questionsPayload, sourcesPayload, expectedCounts(newConcepts), missingReview);
assert.ok(missingReviewResult.errors.some((error) => error.includes("缺少有效复核登记")), "validator should reject an unregistered reviewed claim");

const unknownQuestion = structuredClone(reviewsPayload);
unknownQuestion.questions["be-999-1"] = {
  status: "reviewed",
  reviewedAt: "2026-08-28",
  note: "不存在题目的无效复核登记",
  sourceIds: [sourcesPayload.sources[0].id]
};
const unknownQuestionResult = validatePayload(questionsPayload, sourcesPayload, expectedCounts(newConcepts), unknownQuestion);
assert.ok(unknownQuestionResult.errors.some((error) => error.includes("不存在的题目 be-999-1")), "validator should reject review IDs that are not in the generated bank");

console.log(`Content review regression passed: ${generatedReviewedIds.length} explicitly reviewed questions.`);
