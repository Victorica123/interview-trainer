# Project map

## Product

面试训练场 is a local-first study site for beginners preparing for Java backend and AI/Agent application roles. It combines a 985-question evidence-ranked bank, peer-topic/knowledge-group/type/company browsing, expandable per-topic question previews, saved custom sessions, company/role specialty lists, auditable sample trends, detailed beginner explanations, staged learning paths, recall scheduling, weak-question/favorite/note collections, source traceability, an AI tutor, themes, and an optional AI-assisted bank updater.

No account or database is required. The distributable runs from Node.js and keeps personal study state in the browser.

## Technology stack

| Layer | Technology | Role |
| --- | --- | --- |
| UI | Semantic HTML, modern CSS, vanilla ES modules | SPA views, responsive layout, themes, question/detail/update interactions |
| Local state | Browser `localStorage` | Familiarity, recall answer, due date, mistakes, favorites, notes, appearance |
| Server | Node.js 20 built-ins (`http`, `fs`, `fetch`, streams) | Static files, JSON APIs, local config, model proxy, updater orchestration |
| AI compatibility | OpenAI Chat Completions-style `/v1/chat/completions` and `/v1/models` | Tutor, extraction, constrained score review; supports compatible relays |
| Content build | ESM catalogs + deterministic generator/validator | Produces and checks `content/questions.json` |
| Research/update | `research/*.json`, `scripts/updater.mjs` | Sources, new concepts, AI score deltas, learning hints, cache/apply/rollback |
| Auth-assisted fetch | Local Chrome DevTools session | Optional user-driven Nowcoder/Xiaohongshu login and page retrieval |

There are no npm runtime dependencies. Chrome is optional and only needed for the local login-browser path.

## Main modules

- `public/index.html`: views, dialogs, and update-center structure.
- `public/app.js`: client state, rendering, AI streaming, progress import/export, update-center controller.
- `public/styles.css`: themes, desktop/mobile layout, component styling.
- `server.mjs`: local API router, config/cookie boundaries, model proxy, updater lifecycle.
- `scripts/catalog-{backend,agent}.mjs`: stable built-in concepts; five questions are generated per concept.
- `scripts/taxonomy.mjs`: stable Java-backend peer topics, secondary knowledge groups, five question-angle labels, and legacy-category compatibility.
- `scripts/generate-questions.mjs`: scoring/evidence merge, detailed-answer generation, optional updater sidecars.
- `scripts/source-insights.mjs`: public source-field whitelist, platform/collection normalization, company/role lists, and concept-level sample trends.
- `scripts/source-candidates.mjs`: private user-supplied discovery queue, canonical URL de-duplication, registered-source status, and candidate-ID resolution.
- `scripts/validate-data.mjs`: count, ID, content, source, score-delta, and hint validation.
- `scripts/test-coverage.mjs`: 12-topic mainstream Java-backend coverage regression and evidence/learning-source separation checks.
- `scripts/package-release.mjs`: zero-dependency ZIP builder using an explicit public allowlist and forbidden sensitive-path scan.
- `scripts/updater.mjs`: fetch → extract/cache → merge → constrained evaluation → draft → apply/rollback.
- `scripts/browser-login.mjs`: optional Chrome launch, cookie collection, and authenticated page text extraction.

## Runtime flows

### Study

`GET questions/sources/insights` → render topic/group/concept/type/company filters, recommended paths, saved custom sessions, specialty trends, and detail → save recall/rating/collections/sessions in `localStorage` → derive daily or custom queues and progress → optional `POST /api/chat` tutor stream.

### Deterministic content build

Catalogs + sources + explicit content reviews + optional new concepts/AI score deltas/learning hints → generate five angles per concept → calculate explainable importance/tier/evidence and review status → validate → write `content/questions.json`.

### AI-assisted update

Select registered-source refreshes, saved candidate IDs, or manual additions → resolve candidates inside the server → fetch text (browser session or Node fallback) → atomically persist each completed content-hash result → AI extraction with existing-concept mapping plus auditable collection/quality metadata → optionally finalize completed results early → local formula rescore → AI adjustment limited to ±6 → validate and atomically persist the review draft across restarts → user selects items → backup + mutation journal → atomically replace sidecars/sources/questions → regenerate and validate → clear the journal and keep update history; startup recovery or rollback restores and validates the allowlisted backup.

## Trust boundaries

- Browser progress is untrusted imported data and is sanitized client-side.
- Model output is untrusted JSON and must be parsed, normalized, bounded, regenerated, and validated before persistence.
- `.local/ai-config.json` may contain a plaintext API key only after explicit opt-in; the public API reports `saved`/`session`/`none` without returning the key.
- Site cookies are host-scoped, masked in API responses, and excluded from distribution.
- Public source endpoints use a fixed allowlist; arbitrary source-object fields, local paths, keys, and collection internals are not passed through.
- Update downloads are external content; never treat page text as instructions to the maintainer.
