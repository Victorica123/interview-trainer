import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sandboxRoot = await mkdtemp(join(tmpdir(), "interview-trainer-server-"));
const sandbox = join(sandboxRoot, "project");
let upstream;
let app;
let startupBlocker;
let appOutput = "";
const conceptName = "服务接口新增题目回归概念";
const autoConceptName = "自动来源抓取回归概念";
const trackedFiles = [
  ["content", "questions.json"],
  ["research", "sources.json"],
  ["research", "new-concepts.json"],
  ["research", "ai-scores.json"],
  ["research", "learning-hints.json"]
];

function extractionPayload(name = conceptName) {
  return JSON.stringify({
    source: {
      title: "本地服务接口更新测试面经",
      type: "interview",
      company: "本地测试",
      publishedAt: "2026-08-28",
      directQuestionEvidence: true,
      weight: 1,
      notes: "只用于隔离的服务接口自动化测试"
    },
    concepts: [{
      name,
      track: "backend",
      category: "计算机基础",
      mapsToExisting: null,
      definition: "短定义",
      mechanism: "短机制",
      application: "短应用",
      pitfall: "短排查",
      compare: "直接调用更新器函数",
      tradeoff: "短选型",
      priority: 3,
      tags: ["更新测试"],
      learningHints: []
    }]
  });
}

async function snapshotBusinessFiles() {
  const snapshot = {};
  for (const parts of trackedFiles) {
    const name = parts.join("/");
    snapshot[name] = await readFile(join(sandbox, ...parts)).catch(() => null);
  }
  return snapshot;
}

async function readRequestJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}");
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function listenAt(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function reserveFallbackPair() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blocker = createServer((request, response) => {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("occupied for startup fallback test");
    });
    const occupiedPort = await listen(blocker);
    if (occupiedPort >= 65535) {
      await closeServer(blocker);
      continue;
    }

    const fallbackPort = occupiedPort + 1;
    const probe = createServer();
    try {
      await listenAt(probe, fallbackPort);
      await closeServer(probe);
      return { blocker, occupiedPort, fallbackPort };
    } catch {
      await closeServer(probe);
      await closeServer(blocker);
    }
  }
  throw new Error("unable to reserve adjacent ports for startup fallback test");
}

async function waitFor(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`server did not become ready: ${url}\n${appOutput}`);
}

async function startApp(port, readyPort = port) {
  appOutput = "";
  app = spawn(process.execPath, ["server.mjs"], {
    cwd: sandbox,
    env: { ...process.env, INTERVIEW_TRAINER_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  app.stdout.on("data", (chunk) => { appOutput += chunk; });
  app.stderr.on("data", (chunk) => { appOutput += chunk; });
  await waitFor(`http://127.0.0.1:${readyPort}/api/update/status`);
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise((resolve) => app.once("exit", resolve));
  app.kill();
  await exited;
}

async function readUntil(response, predicate) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (predicate(event)) return { reader, decoder, buffer, events };
    }
  }
  throw new Error("stream ended before expected event");
}

async function readRemaining({ reader, decoder, buffer, events }) {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  }
  if (buffer.trim()) events.push(JSON.parse(buffer));
  return events;
}

try {
  await cp(projectRoot, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(projectRoot, source);
      return !rel || (rel !== ".local" && !rel.startsWith(`.local${sep}`));
    }
  });

  upstream = createServer(async (request, response) => {
    if (request.url?.startsWith("/source")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<html><title>自动来源测试</title><body>${autoConceptName} 是什么？请说明机制和项目应用。</body></html>`);
      return;
    }
    if (request.url === "/v1/chat/completions") {
      const body = await readRequestJson(request);
      const prompt = (body.messages || []).map((message) => message.content || "").join("\n");
      if (prompt.includes("等待取消") || prompt.includes("等待部分收口")) {
        const timer = setTimeout(() => {
          if (response.destroyed) return;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
        }, 10_000);
        response.once("close", () => clearTimeout(timer));
        return;
      }
      const content = prompt.includes("评分复核员") ? "[]" : extractionPayload(prompt.includes(autoConceptName) ? autoConceptName : conceptName);
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }, 20);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  const upstreamPort = await listen(upstream);

  const sourcesPath = join(sandbox, "research", "sources.json");
  const sourcePayload = JSON.parse(await readFile(sourcesPath, "utf8"));
  const newestInterview = sourcePayload.sources
    .filter((source) => source.type === "interview")
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))[0];
  assert.ok(newestInterview, "fixture requires at least one interview source");
  newestInterview.url = `http://127.0.0.1:${upstreamPort}/source`;
  newestInterview.title = "隔离自动抓取来源";
  newestInterview.shortTitle = "隔离自动来源";
  newestInterview.localPath = "C:\\private\\raw-source.html";
  newestInterview.apiKey = "source-secret-must-not-leak";
  await writeFile(sourcesPath, `${JSON.stringify(sourcePayload, null, 2)}\n`, "utf8");

  await mkdir(join(sandbox, ".local"), { recursive: true });
  await writeFile(join(sandbox, ".local", "ai-config.json"), JSON.stringify({
    name: "local-stub",
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    apiKey: "test-only",
    model: "stub",
    temperature: 0.2,
    maxTokens: 1200,
    customHeaders: {},
    rememberKey: true
  }), "utf8");

  const fallbackPair = await reserveFallbackPair();
  startupBlocker = fallbackPair.blocker;
  await startApp(fallbackPair.occupiedPort, fallbackPair.fallbackPort);
  assert.match(appOutput, new RegExp(`端口 ${fallbackPair.occupiedPort} 已被占用`), "occupied startup port should produce a readable warning");
  assert.match(appOutput, new RegExp(`已启动：http://127\\.0\\.0\\.1:${fallbackPair.fallbackPort}`), "startup should report the actual fallback URL");
  await stopApp();
  await closeServer(startupBlocker);
  startupBlocker = null;

  const portProbe = createServer();
  const appPort = await listen(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  const base = `http://127.0.0.1:${appPort}`;
  await startApp(appPort);
  const baseline = await snapshotBusinessFiles();
  const baselineCount = JSON.parse(baseline["content/questions.json"].toString("utf8")).counts.total;

  const publicSources = await (await fetch(`${base}/api/sources`)).json();
  assert.ok(Array.isArray(publicSources.sources), "public sources endpoint should return source cards");
  assert.equal(JSON.stringify(publicSources).includes("source-secret-must-not-leak"), false, "source API must whitelist fields instead of exposing arbitrary metadata");
  assert.equal(JSON.stringify(publicSources).includes("C:\\\\private"), false, "source API must not expose local file paths");
  const insights = await (await fetch(`${base}/api/insights`)).json();
  assert.ok(insights.coverage?.interviewSources > 0, "insights should publish its interview sample coverage");
  assert.ok(Array.isArray(insights.trends), "insights should expose concept-level trends");
  assert.ok(Array.isArray(insights.companies), "insights should expose auditable company lists");
  assert.ok(Array.isArray(insights.roles), "insights should expose role-specific lists");
  assert.equal(JSON.stringify(insights).includes("source-secret-must-not-leak"), false, "insights must not expose arbitrary private source fields");

  const publicConfig = await (await fetch(`${base}/api/config`)).json();
  assert.equal(publicConfig.hasApiKey, true, "fixture should expose only the presence of its test key");
  assert.equal(publicConfig.apiKeyStorage, "saved", "a key loaded from disk should be reported as restart-persistent");
  assert.equal(Object.hasOwn(publicConfig, "apiKey"), false, "public config must never return the API key");
  const sessionConfig = await (await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...publicConfig, apiKey: "session-only-test-key", rememberKey: false })
  })).json();
  assert.equal(sessionConfig.apiKeyStorage, "session", "an unremembered key should be identified as session-only");
  assert.equal(JSON.parse(await readFile(join(sandbox, ".local", "ai-config.json"), "utf8")).apiKey, "", "a session-only key must not be written to disk");
  await stopApp();
  await startApp(appPort);
  const afterSessionRestart = await (await fetch(`${base}/api/config`)).json();
  assert.equal(afterSessionRestart.hasApiKey, false, "a session-only key should disappear after restart by design");
  assert.equal(afterSessionRestart.apiKeyStorage, "none");
  const savedAgain = await (await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...publicConfig, apiKey: "test-only", rememberKey: true })
  })).json();
  assert.equal(savedAgain.apiKeyStorage, "saved");
  await stopApp();
  await startApp(appPort);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).apiKeyStorage, "saved", "a remembered key should survive restart");
  assert.equal((await readdir(join(sandbox, ".local"))).some((name) => name.endsWith(".tmp")), false, "atomic config writes should not leave temporary files");
  const testCookie = "session=test-only-cookie-value";
  const cookieStatus = await (await fetch(`${base}/api/site-cookies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nowcoder: testCookie, xiaohongshu: "" })
  })).json();
  assert.equal(cookieStatus.nowcoder.hasCookie, true, "test cookie should be saved inside the isolated fixture");
  assert.equal(JSON.stringify(cookieStatus).includes(testCookie), false, "cookie status must not echo the raw cookie");
  const clearedCookies = await (await fetch(`${base}/api/site-cookies`, { method: "DELETE" })).json();
  assert.equal(clearedCookies.cleared, true);
  assert.equal((await (await fetch(`${base}/api/site-cookies`)).json()).nowcoder.hasCookie, false, "cookie clear should reset masked status");
  const loginStatus = await (await fetch(`${base}/api/login/status`)).json();
  assert.ok(Array.isArray(loginStatus.availableBrowsers), "login status should expose detected safe browser choices");
  assert.ok(loginStatus.availableBrowsers.some((browser) => browser.id === "auto"), "browser choices should include automatic selection");
  assert.ok(loginStatus.availableBrowsers.some((browser) => browser.id === "system"), "browser choices should include the system default fallback");
  assert.equal(JSON.stringify(loginStatus).includes("executable"), false, "browser status must not expose executable paths");
  const invalidBrowser = await fetch(`${base}/api/login/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: "xiaohongshu", browserId: "not-an-allowed-browser" })
  });
  assert.equal(invalidBrowser.status, 400, "the local API must reject arbitrary browser identifiers before launching anything");

  const emptyCandidates = await (await fetch(`${base}/api/discovery/candidates`)).json();
  assert.deepEqual(emptyCandidates.candidates, [], "a fresh isolated project should start with an empty discovery queue");
  const invalidCandidateUrl = await fetch(`${base}/api/discovery/candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: ["file:///C:/private/source.html"] })
  });
  assert.equal(invalidCandidateUrl.status, 400, "candidate storage must reject non-http/https URLs");
  const credentialCandidateUrl = await fetch(`${base}/api/discovery/candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: [`http://user:secret@127.0.0.1:${upstreamPort}/source`] })
  });
  assert.equal(credentialCandidateUrl.status, 400, "candidate storage must reject URLs containing credentials");
  const candidateResponse = await fetch(`${base}/api/discovery/candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: [
      `${newestInterview.url}#first`,
      `${newestInterview.url}#duplicate`,
      `http://127.0.0.1:${upstreamPort}/source?candidate=1#first`,
      `http://127.0.0.1:${upstreamPort}/source?candidate=1#duplicate`
    ] })
  });
  const candidatePayload = await candidateResponse.json();
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidatePayload.added, 2, "fragments and equivalent duplicate URLs should collapse to one candidate");
  assert.equal(candidatePayload.duplicates, 2);
  const registeredCandidate = candidatePayload.candidates.find((candidate) => candidate.status === "registered");
  const pendingCandidate = candidatePayload.candidates.find((candidate) => candidate.status === "pending");
  assert.equal(registeredCandidate?.registeredSource?.id, newestInterview.id, "queue status should be derived from the current source registry");
  assert.ok(pendingCandidate, "a genuinely new URL should remain pending");
  const maliciousCandidateId = await fetch(`${base}/api/discovery/candidates`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["../../research/sources.json"] })
  });
  assert.equal(maliciousCandidateId.status, 400, "candidate IDs must never be interpreted as filesystem paths");
  const unknownCandidateId = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, candidateIds: ["candidate-00000000000000000000"] })
  });
  assert.equal(unknownCandidateId.status, 400, "unknown but well-formed candidate IDs must be rejected before analysis");
  const candidateAnalysis = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, candidateIds: [pendingCandidate.id], analysisMode: "compatible", budgetMs: 60_000 })
  });
  assert.equal(candidateAnalysis.status, 200);
  const candidateEvents = (await candidateAnalysis.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(candidateEvents.some((event) => event.phase === "fetch" && event.status === "ok"), "a selected candidate ID should resolve to its saved URL and reach fetch");
  assert.equal(candidateEvents.find((event) => event.phase === "draft")?.draft?.newConcepts[0]?.name, autoConceptName, "candidate page content should reach extraction and draft preview");
  const candidatesAfterUse = await (await fetch(`${base}/api/discovery/candidates`)).json();
  assert.ok(candidatesAfterUse.candidates.find((candidate) => candidate.id === pendingCandidate.id)?.lastUsedAt, "using a candidate should record its latest analysis time");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "candidate queue and preview state must stay outside business files");
  await fetch(`${base}/api/update/discard`, { method: "POST" });
  await stopApp();
  await startApp(appPort);
  const candidatesAfterRestart = await (await fetch(`${base}/api/discovery/candidates`)).json();
  assert.equal(candidatesAfterRestart.candidates.length, 2, "candidate queue should persist across local server restarts");
  const removedCandidates = await (await fetch(`${base}/api/discovery/candidates`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: candidatesAfterRestart.candidates.map((candidate) => candidate.id) })
  })).json();
  assert.equal(removedCandidates.removed, 2);
  assert.equal(removedCandidates.candidates.length, 0);

  const autoResponse = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: true, maxAutoSources: 1, analysisMode: "compatible", budgetMs: 60_000 })
  });
  assert.equal(autoResponse.status, 200);
  const autoEvents = (await autoResponse.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(autoEvents.some((event) => event.phase === "fetch" && event.status === "ok"), "auto-fetch should retrieve the newest configured interview source");
  const autoDraft = autoEvents.find((event) => event.phase === "draft")?.draft;
  assert.equal(autoDraft?.newConcepts[0]?.name, autoConceptName, "auto-fetch content should reach extraction and draft preview");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "auto-fetch preview must not mutate business files");
  const blockedByDraft = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, manualTexts: [{ label: "must-discard-first", text: "pending draft guard" }] })
  });
  assert.equal(blockedByDraft.status, 409, "a pending review draft must not be silently replaced by a new run");
  await fetch(`${base}/api/update/discard`, { method: "POST" });
  assert.equal((await (await fetch(`${base}/api/update/status`)).json()).draftAvailable, false, "discard should clear the auto-fetch draft");

  const firstResponse = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, manualTexts: [{ label: "slow", text: "等待取消的本地文本" }], budgetMs: 60_000 })
  });
  assert.equal(firstResponse.status, 200);

  const running = await (await fetch(`${base}/api/update/status`)).json();
  assert.equal(running.running, true, "status should expose the active update");
  const duplicate = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, manualTexts: [{ label: "second", text: "second" }] })
  });
  assert.equal(duplicate.status, 409, "a concurrent update must be rejected");

  const cancelled = await (await fetch(`${base}/api/update/cancel`, { method: "POST" })).json();
  assert.equal(cancelled.cancelled, true);
  const streamText = await firstResponse.text();
  assert.match(streamText, /"phase":"cancelled"/, "the active stream should report cancellation");
  const stopped = await (await fetch(`${base}/api/update/status`)).json();
  assert.equal(stopped.running, false, "status should clear after cancellation");

  const partialResponse = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      autoFetch: false,
      analysisMode: "compatible",
      manualTexts: [
        { label: "fast-result", text: `${conceptName} 是什么？` },
        { label: "slow-result", text: "等待部分收口的慢来源" },
        { label: "queued-result", text: "尚未开始的排队来源" }
      ],
      budgetMs: 60_000
    })
  });
  assert.equal(partialResponse.status, 200);
  const partialStream = await readUntil(partialResponse, (event) => event.phase === "analyze" && event.status === "ok");
  const cachePayload = JSON.parse(await readFile(join(sandbox, ".local", "analysis-cache.json"), "utf8"));
  assert.ok(Object.keys(cachePayload.entries || {}).length >= 1, "each completed source should be cached immediately");
  const finalizeResponse = await fetch(`${base}/api/update/finalize-partial`, { method: "POST" });
  const finalizeResult = await finalizeResponse.json();
  assert.equal(finalizeResponse.status, 200);
  assert.equal(finalizeResult.finalizing, true);
  assert.ok(finalizeResult.usable >= 1, "partial finalize requires at least one usable result");
  const partialEvents = await readRemaining(partialStream);
  const partialDraft = partialEvents.find((event) => event.phase === "draft")?.draft;
  assert.equal(partialDraft?.partial?.finalized, true, "partial finalize should emit a marked review draft");
  assert.equal(partialDraft.newConcepts.length, 1, "completed source content should survive partial finalize");
  assert.ok(partialDraft.partial.skippedSources >= 1, "unfinished sources should be reported as skipped");
  assert.equal(partialDraft.evaluation.status, "partial-skip", "partial finalize should skip slow AI score review");
  const savedDraft = await (await fetch(`${base}/api/update/draft`)).json();
  assert.equal(savedDraft.draft?.partial?.finalized, true, "partial draft should be recoverable after page reload");
  const statusWithDraft = await (await fetch(`${base}/api/update/status`)).json();
  assert.equal(statusWithDraft.draftAvailable, true, "status should expose a recoverable pending draft");
  await stopApp();
  await rename(join(sandbox, ".local", "pending-update.json"), join(sandbox, ".local", "pending-update.tmp"));
  await startApp(appPort);
  const restoredAfterRestart = await (await fetch(`${base}/api/update/draft`)).json();
  assert.equal(restoredAfterRestart.draft?.partial?.finalized, true, "a complete pending-draft temp file should be promoted after restart");
  await fetch(`${base}/api/update/discard`, { method: "POST" });
  const statusAfterDiscard = await (await fetch(`${base}/api/update/status`)).json();
  assert.equal(statusAfterDiscard.draftAvailable, false, "discard should clear the persisted draft");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "partial preview and discard must not mutate business files");

  const initialQuestions = await (await fetch(`${base}/api/questions`)).json();
  assert.equal(initialQuestions.counts.total, baselineCount, "isolated bank should start with the fixture question count");
  const analysisResponse = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      autoFetch: false,
      analysisMode: "balanced",
      manualTexts: [{ label: "add-one", text: `${conceptName} 是什么？实际项目里怎么使用？` }],
      budgetMs: 60_000
    })
  });
  assert.equal(analysisResponse.status, 200);
  const events = (await analysisResponse.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const draft = events.find((event) => event.phase === "draft")?.draft;
  assert.ok(draft, "successful analysis should expose an applicable draft");
  assert.equal(events.find((event) => event.phase === "evaluate")?.status, "ok", "balanced mode should execute the constrained AI score-review phase");
  assert.equal(draft.newConcepts.length, 1, "draft should contain one new concept");
  assert.equal(draft.newConceptQuestions.length, 5, "draft should preview five generated questions");
  assert.ok(draft.newConceptQuestions.every((question) => question.title.length > 0), "all five preview questions should be renderable");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "full draft preview must not mutate business files before apply");
  const applyResponse = await fetch(`${base}/api/update/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      selectedSourceIds: draft.newSources.map((source) => source.id),
      selectedConceptNames: draft.newConcepts.map((concept) => concept.name)
    })
  });
  const applied = await applyResponse.json();
  assert.equal(applyResponse.status, 200, applied.error || "apply endpoint should succeed");
  assert.equal(applied.counts.total, baselineCount + 5, "applying one concept should add five questions");
  const questionsAfterApply = await (await fetch(`${base}/api/questions`)).json();
  assert.equal(questionsAfterApply.counts.total, baselineCount + 5, "new questions should be readable after apply");
  const addedQuestions = questionsAfterApply.questions.filter((question) => question.concept === conceptName);
  assert.equal(addedQuestions.length, 5, "all five new questions should be present");
  assert.ok(addedQuestions.every((question) => question.quickAnswer.length >= 18), "short model fields should be normalized before apply");
  const statusAfterApply = await (await fetch(`${base}/api/update/status`)).json();
  assert.equal(statusAfterApply.draftAvailable, false, "successful apply should clear the pending draft");

  const rollbackGuardRun = await fetch(`${base}/api/update/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoFetch: false, manualTexts: [{ label: "rollback-guard", text: "等待取消的本地文本" }], budgetMs: 60_000 })
  });
  const rollbackWhileRunning = await fetch(`${base}/api/update/rollback`, { method: "POST" });
  assert.equal(rollbackWhileRunning.status, 409, "rollback must be rejected while an analysis is active");
  await fetch(`${base}/api/update/cancel`, { method: "POST" });
  assert.match(await rollbackGuardRun.text(), /"phase":"cancelled"/, "rollback guard run should still be cancellable");

  const rollbackResponse = await fetch(`${base}/api/update/rollback`, { method: "POST" });
  const rolledBack = await rollbackResponse.json();
  assert.equal(rollbackResponse.status, 200, rolledBack.error || "rollback endpoint should succeed");
  assert.equal(rolledBack.counts.total, baselineCount, "rollback should restore the original question count");
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "rollback should byte-restore every business file");
  const questionsAfterRollback = await (await fetch(`${base}/api/questions`)).json();
  assert.equal(questionsAfterRollback.questions.some((question) => question.concept === conceptName), false, "rolled-back questions should disappear from the served bank");

  await stopApp();
  await writeFile(join(sandbox, "content", "questions.json"), "{interrupted", "utf8");
  await writeFile(join(sandbox, ".local", "content-mutation.json"), `${JSON.stringify({ schemaVersion: 1, operation: "apply", backupDir: applied.backupDir })}\n`, "utf8");
  await startApp(appPort);
  assert.deepEqual(await snapshotBusinessFiles(), baseline, "startup recovery should restore and validate an interrupted multi-file mutation");
  const recoveredHistory = JSON.parse(await readFile(join(sandbox, ".local", "update-history.json"), "utf8"));
  assert.equal(recoveredHistory.recoveredInterruptedMutation, true, "startup recovery should leave an auditable history marker");
  assert.equal((await readdir(join(sandbox, ".local"))).includes("content-mutation.json"), false, "a successful startup recovery should clear its transaction marker");

  console.log(`Server API regression passed: occupied-port fallback, key persistence states/restarts, atomic local writes, cookie masking/clear, insights/public-source safety, persistent candidate queue/ID resolution, auto-fetch, cancellation, temp-draft recovery, read-only preview, balanced evaluation, apply ${baselineCount} -> ${baselineCount + 5}, byte-equivalent rollback, and interrupted-mutation startup recovery.`);
} finally {
  await stopApp();
  await closeServer(startupBlocker);
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
  await rm(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
