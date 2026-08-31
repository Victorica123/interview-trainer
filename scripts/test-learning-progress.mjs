import assert from "node:assert/strict";
import {
  MAX_ATTEMPT_HISTORY,
  buildWeakFocusQueue,
  buildWeaknessReport,
  recordProgressRating,
  sanitizeProgress
} from "../public/learning-progress.js";

const now = new Date("2026-08-31T08:00:00.000Z");

const sanitized = sanitizeProgress({
  "be-001-1": {
    level: 9,
    attempts: 2,
    reasonCodes: ["forgot-keywords", "forgot-keywords", "not-allowed"],
    history: [
      { level: -2, reasonCodes: ["confused-concepts"], answerPreview: "a".repeat(900), at: now.toISOString() },
      { level: 1, reasonCodes: ["unknown"], at: "not-a-date" }
    ]
  },
  "../../bad": { level: 1 },
  "ai-001-1": null
});

assert.deepEqual(Object.keys(sanitized), ["be-001-1"], "only stable question IDs should survive import sanitization");
assert.equal(sanitized["be-001-1"].level, 4, "ratings should stay inside 0-4");
assert.deepEqual(sanitized["be-001-1"].reasonCodes, ["forgot-keywords"], "unknown and duplicate reason codes should be removed");
assert.equal(sanitized["be-001-1"].history.length, 1, "history entries without valid dates should be removed");
assert.equal(sanitized["be-001-1"].history[0].answerPreview.length, 600, "history answer previews should be bounded");

let progress = recordProgressRating({}, { level: 0, answer: "我暂时不会", now });
assert.equal(progress.attempts, 1);
assert.equal(progress.mistakeCount, 1);
assert.equal(progress.inMistakeBook, true);
assert.deepEqual(progress.reasonCodes, ["unknown"], "a zero rating should get a useful default diagnosis");
assert.equal(progress.history[0].answerPreview, "我暂时不会");

for (let index = 0; index < MAX_ATTEMPT_HISTORY + 3; index += 1) {
  progress = recordProgressRating(progress, {
    level: index % 2,
    answer: `第 ${index + 1} 次回答`,
    reasonCodes: [index % 2 ? "forgot-keywords" : "weak-mechanism"],
    now: new Date(now.getTime() + (index + 1) * 60_000)
  });
}
assert.equal(progress.history.length, MAX_ATTEMPT_HISTORY, "history should keep a bounded recent window");
assert.equal(progress.history.at(-1).answerPreview, `第 ${MAX_ATTEMPT_HISTORY + 3} 次回答`);

progress = recordProgressRating(progress, { level: 3, reasonCodes: ["weak-mechanism"], now: new Date("2026-09-01T08:00:00.000Z") });
assert.deepEqual(progress.reasonCodes, [], "a successful answer should clear active weakness reasons");
assert.deepEqual(progress.history.at(-1).reasonCodes, [], "cleared reasons should also be reflected in the successful attempt");

const questions = [
  { id: "be-001-1", category: "Java并发", concept: "线程池", angle: "mechanism", importance: 95 },
  { id: "be-001-2", category: "Java并发", concept: "线程池", angle: "pitfall", importance: 92 },
  { id: "be-002-1", category: "MySQL", concept: "事务", angle: "mechanism", importance: 90 },
  { id: "ai-001-1", category: "RAG与知识库", concept: "RAG", angle: "application", importance: 88 },
  { id: "ai-001-2", category: "RAG与知识库", concept: "RAG", angle: "pitfall", importance: 87 },
  { id: "ai-002-1", category: "Agent架构", concept: "状态机", angle: "application", importance: 85 },
  { id: "be-003-1", category: "Redis", concept: "缓存", angle: "definition", importance: 80 }
];

const progressMap = {
  "be-001-1": recordProgressRating({}, { level: 0, reasonCodes: ["weak-mechanism"], now }),
  "be-001-2": recordProgressRating({}, { level: 1, reasonCodes: ["weak-troubleshooting"], now }),
  "be-002-1": recordProgressRating({}, { level: 2, reasonCodes: ["confused-concepts"], now }),
  "ai-001-1": recordProgressRating({}, { level: 1, reasonCodes: ["no-example"], now }),
  "ai-001-2": recordProgressRating(recordProgressRating({}, { level: 0, reasonCodes: ["weak-troubleshooting"], now }), { level: 0, reasonCodes: ["weak-troubleshooting"], now: new Date(now.getTime() + 60_000) }),
  "ai-002-1": recordProgressRating({}, { level: 4, now }),
  "be-003-1": { level: 0, attempts: 0 }
};

const report = buildWeaknessReport(questions, progressMap, now.getTime());
assert.equal(report.studied, 6, "unseen questions must not be diagnosed as weak");
assert.equal(report.weak, 5);
assert.equal(report.categories[0].name, "RAG与知识库", "the weakest attempted category should rank first");
assert.equal(report.topReasons[0].id, "weak-troubleshooting", "repeated reason history should drive the reason summary");

const queue = buildWeakFocusQueue(questions, progressMap, 4, now.getTime());
assert.equal(queue.length, 4);
assert.equal(new Set(queue.map((question) => question.id)).size, 4, "focus queue should not contain duplicate questions");
assert.ok(queue.every((question) => progressMap[question.id]?.attempts > 0), "focus queue should contain only attempted weak questions");
assert.ok(!queue.some((question) => question.id === "ai-002-1"), "a mastered question should not displace active weak questions");

console.log("Learning progress regression passed: sanitized v4 history, weakness diagnosis, and focused queue.");
