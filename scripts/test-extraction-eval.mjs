import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backendConcepts } from "./catalog-backend.mjs";
import { agentConcepts } from "./catalog-agent.mjs";
import { groundAiExtraction, summarizeTelemetry } from "./updater.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const payload = JSON.parse(await readFile(join(root, "research", "extraction-eval.json"), "utf8"));
assert.equal(payload.schemaVersion, 1);
assert.ok(Array.isArray(payload.cases) && payload.cases.length >= 10, "evaluation set should contain at least ten labeled cases");

const knownConceptByName = new Map([...backendConcepts, ...agentConcepts].map((concept) => [concept.name, concept]));
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;

for (const fixture of payload.cases) {
  const result = groundAiExtraction(
    { source: { title: fixture.id }, concepts: fixture.predictions },
    { promptText: fixture.text },
    knownConceptByName
  );
  const accepted = result.parsed.concepts.map((concept) => concept.mapsToExisting || concept.name).sort();
  const rejected = result.rejected.map((concept) => concept.name).sort();
  assert.deepEqual(accepted, [...fixture.accepted].sort(), `${fixture.id} accepted concepts should match labels`);
  assert.deepEqual(rejected, [...fixture.rejected].sort(), `${fixture.id} rejected concepts should match labels`);
  truePositive += accepted.filter((name) => fixture.accepted.includes(name)).length;
  falsePositive += accepted.filter((name) => !fixture.accepted.includes(name)).length;
  falseNegative += fixture.accepted.filter((name) => !accepted.includes(name)).length;
}

assert.ok(truePositive >= 5, "evaluation set should retain multiple positive concepts");
assert.equal(falsePositive, 0, "grounding gate should have zero false positives on the labeled set");
assert.equal(falseNegative, 0, "grounding gate should have zero false negatives on the labeled set");

const telemetry = summarizeTelemetry([
  { stage: "batch-extraction", status: "ok", durationMs: 100 },
  { stage: "batch-extraction", status: "parse-error", durationMs: 300 },
  { stage: "single-retry", status: "request-error", durationMs: 500 }
], "本地测试模型");
assert.deepEqual({ calls: telemetry.calls, ok: telemetry.ok, requestErrors: telemetry.requestErrors, parseErrors: telemetry.parseErrors }, { calls: 3, ok: 1, requestErrors: 1, parseErrors: 1 });
assert.equal(telemetry.durationMs.p50, 300);
assert.equal(telemetry.durationMs.p95, 300);
assert.equal(JSON.stringify(telemetry).includes("prompt"), false, "telemetry must not contain prompts or outputs");

console.log(`Extraction evaluation passed: ${payload.cases.length} labeled cases, ${truePositive} accepted concepts, zero false positives/negatives, and aggregate-only telemetry.`);
