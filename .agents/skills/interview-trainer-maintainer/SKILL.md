---
name: interview-trainer-maintainer
description: Maintain, extend, validate, and release the local-first Java backend and AI/Agent interview trainer, including its generated question bank, learning UI, OpenAI-compatible model adapter, and AI-assisted update pipeline.
---

# Interview Trainer Maintainer

Work from the repository root. Preserve these invariants:

- The default build has no third-party runtime dependency and requires Node.js 20+.
- The server listens on `127.0.0.1` by default; learning data stays in browser `localStorage`.
- Secrets, cookies, browser profiles, caches, drafts, and backups stay under `.local/` and never enter a release archive.
- `content/questions.json` is generated. Change catalogs, sources, or update sidecars, then run `npm run check`.
- Question IDs and progress compatibility are stable interfaces. Do not renumber existing concepts.
- Interview evidence controls frequency scoring; official/guide learning links do not inflate frequency.

## Cheap context loading

Use a stable-prefix / small-delta workflow so repeated maintenance benefits from prompt/KV caching:

1. Read [references/status.md](references/status.md); treat source files as final truth.
2. Load only the reference needed for the task:
   - Architecture, implementation flow, or stack: [references/project-map.md](references/project-map.md)
   - HTTP, browser-storage, file, or stream contracts: [references/interfaces.md](references/interfaces.md)
   - Editing, QA, release, or roadmap work: [references/maintenance.md](references/maintenance.md)
3. Inspect narrow code slices with `rg` before opening full files.
4. After a change, update only `status.md` and the affected reference section. Do not rewrite stable sections or duplicate README prose.

## Change workflow

1. Identify the owning source and downstream generated files.
2. Preserve unrelated user changes and `.local/` state.
3. Implement the smallest coherent change.
4. Run `npm run check`, syntax checks for touched JavaScript, and a browser/API test proportional to risk.
5. For updater mutations, verify preview → apply → validation → rollback, including a second-run scenario.
6. Rebuild the ZIP from an explicit allowlist; inspect entries before delivery.

Do not use live external AI calls, saved cookies, or destructive rollback tests unless the task needs them. Prefer a local stub for update-pipeline tests.
