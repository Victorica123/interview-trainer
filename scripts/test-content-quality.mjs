import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const payload = JSON.parse(await readFile(join(root, "content", "questions.json"), "utf8"));
const enhancementPayload = JSON.parse(await readFile(join(root, "research", "content-enhancements.json"), "utf8"));
const sourcesPayload = JSON.parse(await readFile(join(root, "research", "sources.json"), "utf8"));
const questions = payload.questions || [];
const enhancements = enhancementPayload.enhancements || {};
const sourceIds = new Set((sourcesPayload.sources || []).map((source) => source.id));
const questionsByConcept = new Map();

for (const question of questions) {
  if (!questionsByConcept.has(question.concept)) questionsByConcept.set(question.concept, []);
  questionsByConcept.get(question.concept).push(question);
  assert.equal(question.detailedAnswer.length, 5, `${question.id} should have five focused sections`);
  assert.equal(question.interviewFollowUps.length, 3, `${question.id} should have three follow-ups`);
  assert.equal(new Set(question.interviewFollowUps).size, 3, `${question.id} follow-ups should be unique`);
  assert.ok(question.workedExample?.scenario?.length >= 20, `${question.id} should have a concrete scenario`);
  assert.ok(question.workedExample?.steps?.length >= 3, `${question.id} should have executable steps`);
  assert.ok(question.workedExample?.expected?.length >= 16, `${question.id} should explain the verification target`);
  assert.ok(question.workedExample?.sourceIds?.length >= 1, `${question.id} should expose at least one example verification source`);
  assert.ok(question.workedExample.sourceIds.every((sourceId) => sourceIds.has(sourceId)), `${question.id} example sources should be registered`);
  assert.ok(
    question.detailedAnswer.every((section) => !/[。！？!?；;]{2,}/u.test(section.content)),
    `${question.id} should not contain duplicated sentence punctuation`
  );
}

for (const [concept, conceptQuestions] of questionsByConcept) {
  assert.equal(conceptQuestions.length, 5, `${concept} should retain five question angles`);
  const bodies = conceptQuestions.map((question) => JSON.stringify(question.detailedAnswer));
  assert.equal(new Set(bodies).size, 5, `${concept} should not reuse one detailed answer across five angles`);
}

const coreQuestions = questions.filter((question) => question.tier === "core");
const coreConcepts = [...new Set(coreQuestions.map((question) => question.concept))];
assert.equal(coreQuestions.length, 144, "core question count should remain stable");
assert.equal(coreConcepts.length, 40, "core concept count should remain stable");
for (const concept of coreConcepts) assert.ok(enhancements[concept]?.code?.content, `${concept} should have a curated code or command example`);
assert.ok(coreQuestions.every((question) => question.workedExample?.code?.content), "every core question should expose its concept's curated example");

const phase2Domains = enhancementPayload.qualityPhases?.["phase2-high-mainline"]?.domains || {};
const phase2Concepts = [...new Set(Object.values(phase2Domains).flat())];
const phase2ConceptSet = new Set(phase2Concepts);
const phase2HighQuestions = questions.filter((question) => question.tier === "high" && phase2ConceptSet.has(question.concept));
assert.equal(Object.keys(phase2Domains).length, 6, "phase 2 should retain six priority domains");
assert.equal(phase2Concepts.length, 51, "phase 2 should retain 51 high-mainline concepts");
assert.equal(phase2HighQuestions.length, 201, "phase 2 should retain 201 high-mainline questions in the current snapshot");
for (const concept of phase2Concepts) {
  assert.ok(enhancements[concept]?.code?.content, `${concept} should have a curated phase-2 example`);
}
assert.ok(phase2HighQuestions.every((question) => question.contentStatus === "reviewed"), "every phase-2 high question should be explicitly reviewed");
assert.ok(phase2HighQuestions.every((question) => question.workedExample?.code?.content), "every phase-2 high question should expose curated code or pseudocode");
assert.ok(phase2HighQuestions.every((question) => question.workedExample?.sourceIds?.length), "every phase-2 high question should expose verification sources");

const phase4Domains = enhancementPayload.qualityPhases?.["phase4-high-remainder"]?.domains || {};
const phase4Concepts = [...new Set(Object.values(phase4Domains).flat())];
const allHighQuestions = questions.filter((question) => question.tier === "high");
assert.equal(Object.keys(phase4Domains).length, 14, "phase 4 should retain the audited remainder across 14 categories");
assert.equal(phase4Concepts.length, 57, "phase 4 should retain the 57 concepts represented by the former high-question remainder");
assert.equal(allHighQuestions.length, 423, "the current snapshot should retain 423 high questions");
assert.ok(allHighQuestions.every((question) => question.contentStatus === "reviewed"), "every high question should be explicitly reviewed after phase 4");
assert.ok(allHighQuestions.every((question) => question.workedExample?.code?.content), "every high question should expose curated code, command, or pseudocode");
assert.ok(allHighQuestions.every((question) => question.workedExample?.sourceIds?.length), "every high question should expose verification sources");

const phase6Extended = questions.filter((question) =>
  question.tier === "extended"
  && question.importance >= 70
  && Number(question.evidence?.independentInterviewSamples || 0) >= 2
);
assert.equal(phase6Extended.length, 65, "phase 6 should retain the evidence-backed extended review scope");
assert.ok(phase6Extended.every((question) => question.contentStatus === "reviewed"), "every phase-6 extended question should be explicitly reviewed");
assert.ok(phase6Extended.every((question) => question.contentReview?.sourceIds?.length), "every phase-6 extended review should expose verification sources");
const phase6Concepts = [...new Set(phase6Extended.map((question) => question.concept))];
assert.equal(phase6Concepts.length, 27, "phase 6 should retain 27 evidence-backed concepts");
assert.ok(phase6Concepts.every((concept) => enhancementPayload.enhancements?.[concept]?.code?.content), "every phase-6 concept should expose a curated code, command, or pseudocode example");

const distinctBodies = new Set(questions.map((question) => JSON.stringify(question.detailedAnswer))).size;
assert.equal(distinctBodies, questions.length, "all generated detailed answers should be question-specific");
assert.ok(Object.keys(enhancements).length >= 123, "the curated enhancement registry should cover every current core and high concept");

console.log(`Content quality regression passed: ${questions.length} question-specific explanations, ${coreQuestions.length} core questions, ${phase2HighQuestions.length} phase-2 high questions, and ${questions.length * 3} follow-ups.`);
