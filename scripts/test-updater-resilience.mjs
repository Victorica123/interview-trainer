import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sandboxRoot = await mkdtemp(join(tmpdir(), "interview-trainer-resilience-"));
const sandbox = join(sandboxRoot, "project");

function sourceMeta(label) {
  return {
    title: label,
    type: "interview",
    company: null,
    publishedAt: "2026-08-29",
    position: "Java 后端开发",
    candidateLevel: "campus",
    directQuestionEvidence: true,
    weight: 0.9,
    notes: "语义证据与熔断隔离回归"
  };
}

function concept(name = "HashMap") {
  return {
    name,
    mapsToExisting: name,
    evidenceQuote: "HashMap 为什么线程不安全？",
    learningHints: []
  };
}

function batchInputs(messages) {
  const raw = messages.at(-1)?.content || "";
  const start = raw.indexOf('{"sources"');
  return JSON.parse(raw.slice(start)).sources;
}

function labelIndex(label) {
  return Number(String(label || "").match(/(\d+)/)?.[1] || 0);
}

function singleLabel(messages) {
  return messages.at(-1)?.content?.match(/来源线索：([^\n]+)/)?.[1] || "单篇复核";
}

function manualTexts(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    label: `${prefix} ${index + 1}`,
    text: `第 ${index + 1} 篇 Java 后端面经：HashMap 为什么线程不安全？扩容机制是什么？唯一标记 ${prefix}-${index + 1}。`
  }));
}

try {
  await cp(projectRoot, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(projectRoot, source);
      return !rel || (rel !== ".local" && !rel.startsWith(`.local${sep}`));
    }
  });
  const updater = await import(`${pathToFileURL(join(sandbox, "scripts", "updater.mjs")).href}?resilience=${Date.now()}`);

  let semanticBatchCalls = 0;
  let semanticSingleCalls = 0;
  const semanticAi = async (messages) => {
    if (messages[0]?.content?.includes("评分复核员")) return "[]";
    if (messages[0]?.content?.includes("批量输入补充规则")) {
      semanticBatchCalls += 1;
      const sources = batchInputs(messages);
      return JSON.stringify({
        items: sources.map((source) => {
          const index = labelIndex(source.label);
          const extracted = index % 8 === 1 ? concept("B+树索引") : concept();
          return { key: source.key, source: sourceMeta(source.label), concepts: [extracted] };
        })
      });
    }
    semanticSingleCalls += 1;
    const label = singleLabel(messages);
    return JSON.stringify({ source: sourceMeta(label), concepts: [concept()] });
  };

  const semantic = await updater.runAnalysis({
    autoFetch: false,
    manualTexts: manualTexts("语义样本", 32),
    aiChat: semanticAi,
    analysisMode: "scale",
    budgetMs: 120_000
  });
  assert.equal(semantic.draft.sourceResults.filter((row) => row.status === "ok").length, 32);
  assert.equal(semanticBatchCalls, 4, "32 sources should still use four initial batches");
  assert.equal(semanticSingleCalls, 4, "only the four unsupported mappings should receive targeted single-source review");
  assert.equal(semantic.draft.performance.evidenceRejected, 4);
  assert.equal(semantic.draft.performance.semanticRechecks, 4);
  assert.equal(semantic.links.some((link) => link.conceptName === "B+树索引"), false, "a structurally valid but unsupported concept must not enter evidence links");
  assert.equal(semantic.links.filter((link) => link.conceptName === "HashMap").length, 32);

  await rm(join(sandbox, ".local"), { recursive: true, force: true });
  let circuitCalls = 0;
  const circuitAi = async (messages) => {
    if (messages[0]?.content?.includes("评分复核员")) return "[]";
    circuitCalls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    if (messages[0]?.content?.includes("批量输入补充规则")) return "批量 JSON 持续不可用";
    const label = singleLabel(messages);
    return JSON.stringify({ source: sourceMeta(label), concepts: [concept()] });
  };
  const circuitTexts = manualTexts("熔断样本", 96);
  const circuit = await updater.runAnalysis({
    autoFetch: false,
    manualTexts: circuitTexts,
    aiChat: circuitAi,
    analysisMode: "scale",
    budgetMs: 120_000
  });
  assert.equal(circuit.draft.sourceResults.filter((row) => row.status === "ok").length, 96);
  assert.equal(circuit.draft.performance.batchCircuitTrips, 1, "three consecutive unusable batches should open the circuit once");
  assert.ok(circuit.draft.performance.batchBypassedSources >= 48, "the open circuit should protect a meaningful remainder from repeated bad batch calls");
  assert.ok(circuit.draft.performance.batchCalls < 24, "the circuit should stop before all 12 batches consume two failed attempts");

  circuitCalls = 0;
  const repeat = await updater.runAnalysis({
    autoFetch: false,
    manualTexts: circuitTexts,
    aiChat: circuitAi,
    analysisMode: "scale",
    budgetMs: 120_000
  });
  assert.equal(circuitCalls, 0, "successfully grounded single-source fallbacks should be cached for the unchanged rerun");
  assert.equal(repeat.draft.performance.cacheHits, 96);
  assert.equal(repeat.draft.expectedCounts.total, 985);

  console.log(`Updater resilience regression passed: 4 unsupported mappings rechecked; circuit used ${circuit.draft.performance.batchCalls} failed batch calls, bypassed ${circuit.draft.performance.batchBypassedSources} sources, and cached all 96 corrected results.`);
} finally {
  await rm(sandboxRoot, { recursive: true, force: true });
}
