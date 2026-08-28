# Interfaces

## Local server startup

- `start.bat` and `start.sh` run `node server.mjs --open`; the actual local URL is printed and opened in the default browser.
- The server starts from `INTERVIEW_TRAINER_PORT` or `4173` and, on `EADDRINUSE`, tries subsequent ports up to 20 attempts. The reported/opened URL always uses the bound port.
- `INTERVIEW_TRAINER_HOST` defaults to `127.0.0.1`. The port must be an integer from 0 through 65535; `0` delegates port selection to the operating system.

## HTTP API

All endpoints are local and JSON unless noted.

| Method/path | Request | Response/stream |
| --- | --- | --- |
| `GET /api/questions` | — | Generated question payload with `counts`, five-angle `taxonomy`, and `questions`; each question includes `category` and `topicGroup` |
| `GET /api/sources` | — | Research snapshot and field-whitelisted public source cards with platform, traceability, explicit engagement, and warnings |
| `GET /api/insights` | — | Auditable coverage, company/role specialty lists, concept-level trends, limitations, and public source cards |
| `GET /api/config` | — | AI config without key; includes `hasApiKey` and `apiKeyStorage` (`saved`, `session`, or `none`) |
| `POST /api/config` | Config fields | Sanitized public config; empty key preserves the in-memory key |
| `GET /api/models` | — | `{models: string[]}` from compatible upstream |
| `POST /api/chat` | `{messages, question?, mode?}` | NDJSON lines `{delta}`, optional `{usage}`, then `{done:true}` |
| `GET /api/discovery/candidates` | — | 本机候选链接、平台、待分析/已登记状态和最近使用时间 |
| `POST /api/discovery/candidates` | `{urls: string[]}` | URL 规范化、去重后的候选池；只接受无凭据的 http/https |
| `DELETE /api/discovery/candidates` | `{ids: string[]}` | 按不透明候选 ID 删除；ID 不会被解释成路径或程序名 |
| `GET /api/update/status` | — | Config, live progress, and `draftAvailable` |
| `POST /api/update/run` | Update options below | NDJSON progress events; ends with `done` or `error` |
| `POST /api/update/cancel` | — | Requests cancellation of the active analysis |
| `POST /api/update/finalize-partial` | — | Stops unfinished source work after at least one usable result and builds a partial draft |
| `GET /api/update/draft` | — | `{draft}` for the pending review draft, including one restored after restart |
| `POST /api/update/apply` | `{selectedSourceIds?, selectedConceptNames?}` | `{applied, counts, backupDir, history}` |
| `POST /api/update/rollback` | `{}` | `{rolledBack, from, counts}` |
| `POST /api/update/discard` | — | `{discarded:true}`; clears the in-memory and persisted draft |
| `GET /api/site-cookies` | — | Masked status only; never raw cookies |
| `POST /api/site-cookies` | `{nowcoder?, xiaohongshu?}` | Masked status; empty supplied value clears that site |
| `DELETE /api/site-cookies` | — | `{cleared:true}` |
| `POST /api/login/launch` | `{site, startUrl?, browserId?}` | Login-browser status, selected browser capability, and chosen URL |
| `GET /api/login/status` | — | Local login-browser status plus detected safe browser choices |
| `POST /api/login/collect` | `{site?}` | Masked saved-cookie status and counts |
| `POST /api/login/close` | — | Browser close result |
| `POST /api/login/fetch` | `{url}` | Diagnostic `{ok, chars, preview}`; not part of normal UI flow |

`GET /api/login/status` returns browser IDs and display names only, never executable paths. `auto`, a detected browser ID, or `system` may be sent back to `POST /api/login/launch`; arbitrary IDs are rejected before process launch. Chromium-family choices report `canCollect: true` and use isolated `.local` profiles. Firefox and `system` report `canCollect: false` and only open the login URL for the manual-Cookie fallback.

`POST /api/update/run` accepts:

```json
{
  "autoFetch": true,
  "maxAutoSources": 16,
  "candidateIds": ["candidate-…"],
  "manualUrls": ["https://…"],
  "manualTexts": [{"label": "…", "text": "…"}],
  "perSourceTimeoutMs": 300000,
  "budgetMs": 1800000
}
```

`autoFetch: true` means “refresh the most recent already-registered interview URLs”; it does not discover new posts across a platform. User-found search results can be persisted in `.local/source-candidates.json` and selected through `candidateIds`; one-off discovery still enters through `manualUrls` or `manualTexts`. The server resolves candidate IDs against its stored queue and never trusts a browser-supplied URL hidden behind an ID.

Update NDJSON phases: `start`, `fetch`, `analyze`, `partial`, `evaluate`, `draft`, `cancelled`, `done`, `error`. Each work event includes a status such as `pending`, `ok`, `fail`, `empty`, `skipped-budget`, `skipped-partial`, `fallback`, or `budget-skip` as applicable. Only one analysis may run at a time, duplicate manual URLs/texts are collapsed within a run, and a pending review draft must be applied or discarded before another run can start. Rollback is rejected while analysis is active. A `draft` is emitted only after its generated questions pass the release validator; short model fields are normalized before preview. Completed source analyses are cached immediately. A valid review draft is atomically persisted to `.local/pending-update.json` and loaded on the next server start until apply or discard clears it. Drafts may include `sourceRefreshes`; apply persists their collection audit, explicit engagement and quality warnings, and history records `refreshedSources`.

## Browser storage

- `interviewTrainerProgressV1`: map keyed by stable question ID. Fields: `level`, `attempts`, `answer`, `note`, `favorite`, `inMistakeBook`, `mistakeCount`, `dueAt`, `updatedAt`. Storage is origin-scoped, so changing hostname, port, or browser requires export/import.
- `interviewTrainerSessionsV1`: up to 30 sanitized custom sessions. Each stores one track, per-topic concept/angle/tier/limit/strategy rules, a fixed question-ID snapshot (up to 5,000 IDs for forward growth), and timestamps. Bank changes never silently replace the snapshot.
- `interviewTrainerAppearanceV1`: `{theme, readingSize}`.
- `interviewTrainerLoginBrowserV1`: selected detected browser ID; no executable path is accepted from the page.
- Export payload version 3: `{version, exportedAt, progress, sessions}`. Import still accepts version 2 without sessions and sanitizes IDs, sizes, booleans, numbers, dates, filters, and session snapshots.

## Repository data contracts

- `research/sources.json`: snapshot metadata and source records; source IDs must be globally unique. Optional audited fields are `position`, `candidateLevel`, `collection`, `engagement`, and `qualityWarnings`.
- `research/new-concepts.json`: append-only user-approved dynamic concepts with stable order and source IDs.
- `research/ai-scores.json`: question-ID map; final integer score must be 0–98 and within ±6 of current formula base.
- `research/learning-hints.json`: concept-name map to sanitized `{site,title,url}` arrays; does not affect importance.
- `research/content-reviews.json`: explicit question-ID review registry with `status`, `reviewedAt`, `note`, and registered `sourceIds`; priority alone never produces `reviewed`.
- `content/questions.json`: generated artifact. Stable ID format is `be|ai-NNN-angleIndex`; five angles per concept.
- `scripts/taxonomy.mjs`: authoritative Java-backend display taxonomy. Classification edits may not reorder catalog concepts or renumber question IDs.

## Private local files

`.local/ai-config.json`, `site-cookies.json`, `source-candidates.json`, `browser-state.json`, `chrome-profile/`, `browser-profiles/`, `analysis-cache.json`, `pending-update.json`, `update-history.json`, and `backups/` are runtime-only. Never print secret values, copy them to tests, or include them in a ZIP.

Local JSON and generated business files are replaced atomically. `pending-update.tmp` is a recoverable completed draft. `content-mutation.json` journals apply/rollback work; if it remains after an interrupted process, startup restores its allowlisted backup, validates the bank, records recovery history, and only then serves requests.
