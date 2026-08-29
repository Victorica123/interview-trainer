import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sandboxRoot = await mkdtemp(join(tmpdir(), "interview-trainer-updater-"));
const sandbox = join(sandboxRoot, "project");
const conceptName = "更新管线回归概念";
let sourceServer;
let extractionCalls = 0;
let refreshAnalysis = false;
const trackedFiles = [
  ["content", "questions.json"],
  ["research", "sources.json"],
  ["research", "new-concepts.json"],
  ["research", "concept-candidates.json"],
  ["research", "ai-scores.json"],
  ["research", "learning-hints.json"]
];

async function snapshotBusinessFiles() {
  const snapshot = {};
  for (const parts of trackedFiles) {
    const name = parts.join("/");
    snapshot[name] = await readFile(join(sandbox, ...parts)).catch(() => null);
  }
  return snapshot;
}

function extractionPayload(userText = "") {
  const suffix = userText.match(/interview-([a-z])/)?.[1] || "a";
  const company = ({ a: "本地甲公司", b: "本地乙公司", c: "本地丙公司" })[suffix] || "本地测试";
  return JSON.stringify({
    source: {
      title: `${company}更新管线测试面经`,
      type: "interview",
      company,
      publishedAt: refreshAnalysis ? null : "2026-08-28",
      ...(refreshAnalysis ? {} : { directQuestionEvidence: true }),
      position: refreshAnalysis ? null : "Java 后端开发",
      candidateLevel: refreshAnalysis ? "unknown" : "campus",
      weight: 1,
      notes: "只用于隔离的自动化测试"
    },
    concepts: [{
      name: conceptName,
      track: "backend",
      category: "计算机基础",
      mapsToExisting: null,
      definition: "用于验证更新管线能把新的面试概念安全地加入隔离题库。",
      mechanism: "通过本地来源、模型桩、草稿审阅、生成校验与备份应用形成闭环。",
      application: "维护者修改更新逻辑后运行该测试，确认重复更新不会制造重复概念或来源。",
      pitfall: "如果动态概念未加入去重集合，第二次分析可能再次创建同名的五道题。",
      compare: "只运行静态校验",
      tradeoff: "隔离端到端测试较慢，但能覆盖纯函数测试无法发现的文件写入问题。",
      priority: 3,
      tags: ["更新测试"],
      evidenceQuote: `${conceptName} 是什么？`,
      learningHints: []
    }]
  });
}

async function aiChat(messages) {
  if (messages[0]?.content?.includes("评分复核员")) return "[]";
  extractionCalls += 1;
  return extractionPayload(messages.at(-1)?.content || "");
}

try {
  await cp(projectRoot, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(projectRoot, source);
      return !rel || (rel !== ".local" && !rel.startsWith(`.local${sep}`));
    }
  });

  sourceServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<html><title>更新测试</title><body>点赞：11。路径 ${request.url}。${conceptName} 是什么？它在项目中如何使用？为什么需要它？</body></html>`);
  });
  await new Promise((resolve, reject) => {
    sourceServer.once("error", reject);
    sourceServer.listen(0, "127.0.0.1", resolve);
  });
  const address = sourceServer.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/interview-a`;
  const secondSourceUrl = `http://127.0.0.1:${address.port}/interview-b`;
  const thirdSourceUrl = `http://127.0.0.1:${address.port}/interview-c`;

  const updater = await import(`${pathToFileURL(join(sandbox, "scripts", "updater.mjs")).href}?test=${Date.now()}`);
  const baseline = await snapshotBusinessFiles();
  const baselineCount = JSON.parse(baseline["content/questions.json"].toString("utf8")).counts.total;
  const first = await updater.runAnalysis({ autoFetch: false, manualUrls: [sourceUrl, sourceUrl], aiChat, budgetMs: 60_000, analysisMode: "compatible" });
  assert.equal(first.draft.newConcepts.length, 0, "a one-off concept must stay out of the question bank");
  assert.equal(first.draft.conceptWatchlist.length, 1, "a one-off concept should enter the observation pool");
  assert.equal(first.draft.newSources.length, 1, "first analysis should create one source");
  assert.equal(extractionCalls, 1, "duplicate manual URLs should be analyzed only once");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "analysis preview must not mutate business files");
  const sourceId = first.draft.newSources[0].id;
  const appliedFirst = await updater.applyUpdate({ selectedSourceIds: [sourceId], selectedConceptNames: [], lastRun: first });
  assert.equal(appliedFirst.counts.total, baselineCount, "observation-pool concepts must not add questions");
  const afterFirstApply = await snapshotBusinessFiles();
  const firstStoredSource = JSON.parse(await readFile(join(sandbox, "research", "sources.json"), "utf8")).sources.find((source) => source.id === sourceId);
  assert.equal(firstStoredSource.collection.method, "manual-url", "new URL sources should record their collection method");
  assert.equal(firstStoredSource.collection.frequencyEligible, true, "traceable direct interviews should participate in trends");
  assert.equal(firstStoredSource.engagement.likes, 11, "only explicit page metrics should be stored");
  assert.equal(firstStoredSource.candidateLevel, "campus");
  const observedAfterFirst = JSON.parse(await readFile(join(sandbox, "research", "concept-candidates.json"), "utf8")).candidates;
  assert.equal(observedAfterFirst.some((concept) => concept.name === conceptName), true, "observation pool should persist after apply");

  const promotion = await updater.runAnalysis({ autoFetch: false, manualUrls: [secondSourceUrl, thirdSourceUrl], aiChat, budgetMs: 60_000, analysisMode: "compatible" });
  assert.equal(promotion.draft.newConcepts.length, 1, "three recent independent sources across companies should promote one concept");
  assert.equal(promotion.draft.newSources.length, 2);
  const promotionSourceIds = promotion.draft.newSources.map((source) => source.id);
  const appliedPromotion = await updater.applyUpdate({ selectedSourceIds: promotionSourceIds, selectedConceptNames: [conceptName], lastRun: promotion });
  assert.equal(appliedPromotion.counts.total, baselineCount + 5, "a qualified concept should add exactly five stable-angle questions");
  const afterPromotion = await snapshotBusinessFiles();

  refreshAnalysis = true;
  await rm(join(sandbox, ".local", "analysis-cache.json"), { force: true });
  const second = await updater.runAnalysis({ autoFetch: false, manualUrls: [sourceUrl], aiChat, budgetMs: 60_000, analysisMode: "compatible" });
  assert.equal(second.draft.newConcepts.length, 0, "cached extraction must recognize an already-added dynamic concept");
  assert.equal(second.draft.newSources.length, 0, "same URL must reuse the existing source");
  assert.equal(second.draft.existingSourcePatches.length, 1, "same source should become an evidence patch");
  assert.deepEqual(await snapshotBusinessFiles(), afterPromotion, "repeat preview must remain read-only");
  const appliedSecond = await updater.applyUpdate({ selectedSourceIds: [], selectedConceptNames: [], lastRun: second });
  assert.equal(appliedSecond.counts.total, baselineCount + 5, "evidence-only update must not duplicate questions");
  assert.equal(appliedSecond.history.refreshedSources, 1, "existing source audit metadata should be persisted");
  const patchedSources = JSON.parse(await readFile(join(sandbox, "research", "sources.json"), "utf8")).sources;
  const refreshedSource = patchedSources.find((source) => source.id === sourceId);
  assert.ok(refreshedSource?.supportsConcepts.includes(conceptName), "evidence-only apply should patch the reused source");
  assert.equal(refreshedSource.collection.frequencyEligible, true, "a refresh must preserve known publication/directness metadata when the model omits it");
  assert.equal(Object.hasOwn(refreshedSource, "sourceId"), false, "refresh helper IDs must not leak into stored source records");

  const rolledBack = await updater.rollbackLatest();
  assert.equal(rolledBack.counts.total, baselineCount + 5, "rollback of the evidence-only pass should keep the previously added concept");
  assert.deepEqual(await snapshotBusinessFiles(), afterPromotion, "rollback must byte-restore the state before the latest apply");

  const sources = JSON.parse(await readFile(join(sandbox, "research", "sources.json"), "utf8")).sources;
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length, "source IDs must remain unique");
  assert.equal(sources.filter((source) => source.url === sourceUrl).length, 1, "same URL must be stored once");
  const dynamic = JSON.parse(await readFile(join(sandbox, "research", "new-concepts.json"), "utf8")).concepts;
  assert.equal(dynamic.filter((concept) => concept.name === conceptName).length, 1, "dynamic concept must be stored once");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    updater.runAnalysis({ autoFetch: false, manualTexts: [{ label: "cancel", text: "cancel" }], aiChat, signal: controller.signal }),
    (error) => error?.name === "AbortError",
    "an aborted run must stop before model work"
  );

  console.log("Updater regression passed: observation gate, qualified promotion, read-only preview, repeat-run dedup, evidence-only apply, byte-equivalent rollback, unique IDs, cancellation.");
} finally {
  if (sourceServer) await new Promise((resolve) => sourceServer.close(resolve));
  await rm(sandboxRoot, { recursive: true, force: true });
}
