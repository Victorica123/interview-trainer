import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sandboxRoot = await mkdtemp(join(tmpdir(), "interview-trainer-scale-"));
const sandbox = join(sandboxRoot, "project");
let aiCalls = 0;

function mappedConcept() {
  return { name: "HashMap", mapsToExisting: "HashMap", evidenceQuote: "HashMap 为什么线程不安全？", learningHints: [] };
}

async function aiChat(messages) {
  if (messages[0]?.content?.includes("评分复核员")) return "[]";
  aiCalls += 1;
  assert.ok(messages[0]?.content?.includes("批量输入补充规则"), "large-sample mode should batch unresolved sources");
  const raw = messages.at(-1)?.content || "";
  const start = raw.indexOf('{"sources"');
  const payload = JSON.parse(raw.slice(start));
  return JSON.stringify({
    items: payload.sources.map((source) => ({
      key: source.key,
      source: {
        title: source.label,
        type: "interview",
        company: null,
        publishedAt: "2026-08-29",
        position: "Java 后端开发",
        candidateLevel: "campus",
        directQuestionEvidence: true,
        weight: 0.9,
        notes: "300 样本批处理回归"
      },
      concepts: [mappedConcept()]
    }))
  });
}

try {
  await cp(projectRoot, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(projectRoot, source);
      return !rel || (rel !== ".local" && !rel.startsWith(`.local${sep}`));
    }
  });
  const updater = await import(`${pathToFileURL(join(sandbox, "scripts", "updater.mjs")).href}?scale=${Date.now()}`);
  const manualTexts = Array.from({ length: 300 }, (_, index) => ({
    label: `批处理样本 ${String(index + 1).padStart(3, "0")}`,
    text: `候选人 ${index + 1} 的 Java 后端面经：HashMap 为什么线程不安全？扩容机制是什么？项目里如何排查哈希冲突？唯一批次标记 ${index + 1}。`
  }));

  const startedAt = Date.now();
  const first = await updater.runAnalysis({ autoFetch: false, manualTexts, aiChat, analysisMode: "scale", budgetMs: 120_000 });
  const firstCalls = aiCalls;
  assert.equal(first.draft.sourceResults.filter((result) => result.status === "ok").length, 300);
  assert.equal(first.draft.newConcepts.length, 0, "known-concept evidence must not expand the question count");
  assert.equal(first.draft.expectedCounts.total, 985, "300 samples should keep the current question-bank size");
  assert.ok(firstCalls <= 38, `300 sources should need at most 38 batched calls, got ${firstCalls}`);
  assert.equal(first.draft.performance.batchSize, 8);
  assert.equal(first.draft.performance.aiCallsSaved, 300 - firstCalls);

  aiCalls = 0;
  const second = await updater.runAnalysis({ autoFetch: false, manualTexts, aiChat, analysisMode: "scale", budgetMs: 120_000 });
  assert.equal(aiCalls, 0, "unchanged second run should be served entirely from content-hash cache");
  assert.equal(second.draft.performance.cacheHits, 300);
  assert.equal(second.draft.expectedCounts.total, 985);
  console.log(`Updater scale regression passed: 300 sources, ${firstCalls} first-run AI calls, 0 second-run calls, ${Date.now() - startedAt}ms total, question count unchanged.`);
} finally {
  await rm(sandboxRoot, { recursive: true, force: true });
}
