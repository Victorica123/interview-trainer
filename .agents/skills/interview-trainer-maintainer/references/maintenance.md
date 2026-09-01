# Maintenance and roadmap

## Change ownership

| Change | Edit first | Verify/update |
| --- | --- | --- |
| Built-in concept or answer seed | `scripts/catalog-*.mjs` | generator, schema, counts, browser sample |
| Explicit content-review state | `research/content-reviews.json` | generator status, validator, review source links, all current core IDs |
| Curated worked example/code | `research/content-enhancements.json` | `{scenario,steps,expected,sourceIds,code}`, phase scope, content-quality regression, browser rendering |
| Evidence/source | `research/sources.json` | methodology, source IDs, regenerated score changes |
| Scoring | `scripts/generate-questions.mjs` | methodology, updater baseline, validator, score migration |
| Study UI/state | `public/*` | storage sanitizer/export version, desktop/mobile browser flow |
| AI adapter/API | `server.mjs` | compatible stub, redaction, timeout/stream fallback, interfaces ref |
| Update pipeline | `scripts/updater.mjs`, `server.mjs`, update UI | cache version, second-run IDs/dedup, cancel, apply/rollback, interfaces ref |
| Release | README + explicit ZIP allowlist | no `.local`, tests, caches, logs, or browser profiles |

## Minimum verification

Run the full local verification before release:

```powershell
npm run verify
```

For a narrow change, the underlying checks are:

```powershell
npm run check
node --check server.mjs
node --check public/app.js
node --check scripts/updater.mjs
node --check scripts/browser-login.mjs
```

Then test only the affected surface. For update work use a local upstream/source stub and prove:

1. extraction creates a review draft without writes;
2. applying selected items regenerates and validates;
3. a second update uses unique source IDs and recognizes prior dynamic concepts;
4. cancellation stops new work and leaves no applicable draft;
5. rollback restores byte-equivalent source/question/sidecar state;
6. `.local` config/cookies are restored after tests.

For UI work check desktop and 390px mobile layouts, reload persistence, console errors, and the complete user flow rather than selector existence alone.

## Content maintenance

- Prefer recent direct interview evidence; de-duplicate reposts and record uncertainty.
- Keep questions concise but beginner answers explanatory. The five angles need distinct answer bodies, actionable examples, registered verification sources, and question-specific follow-ups. Separate “frequency evidence” from “where to learn/verify it”; official docs and papers do not raise interview frequency.
- New concepts add five angles and therefore change expected counts by five.
- Never hand-edit generated questions as a lasting fix.

## Release procedure

1. Run checks and relevant stub/browser tests.
2. Ensure `.gitignore` covers `.local/`, `data/*.json`, logs, and dependencies.
3. Run `npm run package:release`; it builds the compressed cross-platform archive from an explicit file/directory allowlist, not a recursive workspace glob.
4. For the Windows x64 portable archive, use only an official Node.js runtime whose published SHA-256 has been verified, then run `npm run package:windows -- --runtime-dir <path>`.
5. Run `npm run package:checksums`, list both archives, and reject `.local`, keys, cookies, profiles, caches, backups, drafts, and work logs.
6. A matching `vX.Y.Z` tag triggers `.github/workflows/release.yml`, repeats verification/build/runtime checksum validation, and creates or refreshes the GitHub Release without browser upload.
7. Update only the current facts in `references/status.md`.

## Optimization directions

Prioritize by user impact:

1. Updater reliability and auditable content review: cancellation, repeat-run dedup, atomic writes, source-quality flags, labeled grounding evaluation, opt-in aggregate telemetry, and deterministic stub tests.
2. Beginner content QA: core/high are fully registered and enhanced; spot-check factual deltas when sources or framework versions change, then refine extended questions by measured demand.
3. Learning effectiveness: v5 uses a bounded deterministic adaptive schedule and distinguishes independent, hinted, revealed, and legacy attempts; calibrate its factors only from anonymized retention evidence, and do not call it FSRS.
4. Search/discovery: aliases, typo tolerance, saved filters, and cross-links from path stages to prerequisites.
5. Optional deployment hardening: only if remote hosting is introduced, add authentication, CSRF/host checks, encrypted secrets, rate limits, and a real persistence layer.
