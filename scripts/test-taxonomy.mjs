import assert from "node:assert/strict";
import { buildPayload, loadNewConcepts } from "./generate-questions.mjs";
import { BACKEND_CATEGORY_NAMES, QUESTION_ANGLES } from "./taxonomy.mjs";

const payload = await buildPayload();
const newConcepts = await loadNewConcepts();
const backendQuestions = payload.questions.filter((question) => question.track === "backend");
const backendConcepts = [...new Set(backendQuestions.map((question) => question.concept))];

assert.equal(newConcepts.filter((concept) => concept.track === "backend").length, 45);
assert.equal(backendQuestions.length, 725);
assert.equal(backendConcepts.length, 145);
assert.deepEqual(payload.taxonomy.angles, QUESTION_ANGLES);
assert.deepEqual(payload.taxonomy.tracks.backend.map((category) => category.name), BACKEND_CATEGORY_NAMES);
assert.ok(backendQuestions.every((question) => typeof question.topicGroup === "string" && question.topicGroup.length > 0));

const byId = new Map(payload.questions.map((question) => [question.id, question]));
assert.deepEqual(
  ["be-001-1", "be-013-1", "be-029-1", "be-038-1"].map((id) => [id, byId.get(id)?.concept]),
  [
    ["be-001-1", "TCP三次握手"],
    ["be-013-1", "面向对象与SOLID"],
    ["be-029-1", "Java线程状态"],
    ["be-038-1", "JVM运行时内存区域"]
  ],
  "分类迁移不能改变既有概念顺序和题目 ID"
);

const threadPool = backendQuestions.find((question) => question.concept === "ThreadPoolExecutor");
assert.equal(threadPool?.category, "Java并发");
assert.equal(threadPool?.topicGroup, "线程池");
const mvcc = backendQuestions.find((question) => question.concept === "MVCC与Read View");
assert.equal(mvcc?.category, "MySQL");
assert.equal(mvcc?.topicGroup, "事务与MVCC");

for (const concept of backendConcepts) {
  const questions = backendQuestions.filter((question) => question.concept === concept);
  assert.equal(questions.length, 5, `${concept} 应保持五类问法`);
  assert.deepEqual(questions.map((question) => question.angle), QUESTION_ANGLES.map((angle) => angle.id));
}

console.log("Taxonomy regression passed: 12 peer backend topics, 145 concepts, five angles, and stable question IDs.");
