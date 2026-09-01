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
assert.equal(registeredReviewedIds.length, 632, "the current explicit content-review registry should contain core/high plus the evidence-backed extended batch");
assert.deepEqual(generatedReviewedIds, registeredReviewedIds, "generated reviewed status must come only from the explicit registry");
assert.ok(questionsPayload.questions.some((question) => question.tier === "extended" && question.contentStatus === "outline"), "unselected extended questions must remain honest outlines");

const phase6Extended = questionsPayload.questions.filter((question) =>
  question.tier === "extended"
  && question.importance >= 70
  && Number(question.evidence?.independentInterviewSamples || 0) >= 2
);
assert.equal(phase6Extended.length, 65, "the evidence-backed near-threshold extended batch should remain stable");
assert.ok(phase6Extended.every((question) => question.contentStatus === "reviewed"), "every selected phase-6 extended question should be explicitly reviewed");

const coreQuestionIds = questionsPayload.questions
  .filter((question) => question.tier === "core")
  .map((question) => question.id)
  .sort();
const reviewedCoreQuestionIds = questionsPayload.questions
  .filter((question) => question.tier === "core" && question.contentStatus === "reviewed")
  .map((question) => question.id)
  .sort();
assert.equal(coreQuestionIds.length, 144, "the current research snapshot should retain 144 core questions");
assert.deepEqual(reviewedCoreQuestionIds, coreQuestionIds, "every current core question must have an explicit content review");

const highQuestionIds = questionsPayload.questions
  .filter((question) => question.tier === "high")
  .map((question) => question.id)
  .sort();
const reviewedHighQuestionIds = questionsPayload.questions
  .filter((question) => question.tier === "high" && question.contentStatus === "reviewed")
  .map((question) => question.id)
  .sort();
assert.equal(highQuestionIds.length, 423, "the current research snapshot should retain 423 high questions");
assert.deepEqual(reviewedHighQuestionIds, highQuestionIds, "every current high question must have an explicit content review");

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
