# Checkpoint 9 — Steps 4.4, 4.6, 5.1, 5.3, 5.4 verified

**Resume window:** 2026-05-16 08:55..09:25 UTC (after checkpoint 8, post-compaction resume).
**Steps covered:** 4.6 (00b6be67a), 4.4 (8fb755420), 5.1 (510a1feef), 5.3 (f22db9366 → final SHA da572b6a5 after PLAN amend), 5.4 (d49778e7f → 37822d6ab after PLAN amend).
**SHA range:** 00b6be67a..37822d6ab inclusive.

## Touched packages
- `@open-mercato/core` — reports module: schedule editor UI, notifications config + renderers, result cache, retention worker + new `ReportExecution` entity + migration, CLI commands.
- i18n: en/pl/es/de.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✓ | ~10–18s per step. Picked up: schedule pages, notifications types + renderers, new `ReportExecution` entity, `reports-executions-prune` worker, CLI commands. |
| `npx tsc -p packages/core/tsconfig.json --noEmit` (filtered to reports) | ✓ | 0 errors at end of every step. One mid-step fix in 4.4 (`primaryActionId` is on the type definition, not the runtime DTO — read from `actions[]` instead) and one in 5.4 (Dataset uses `moduleId`/`requiredFeatures`/`labelKey`, not `module`/`features`/`label`). |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | **251/251** across 16 suites. Net +32 tests (16 cache, 9 prune, 7 CLI args). |
| `yarn i18n:fix` | ✓ | Step 4.6 added 47 EN keys (+138 across pl/es/de). Step 4.4 added 11 EN keys (+33 across pl/es/de). No leftover missing keys. |
| Integration tests | skipped | `.ai/qa/tests/` still has no `reports/` scenarios; 5.6 is the dedicated step. |
| Playwright screenshots | skipped | UI verification deferred until 5.6 lands a real scenario. |

## Per-step summary

- **4.6 (00b6be67a)** — Schedule editor UI. `/backend/reports/schedules` list (DataTable, toggle/delete row actions, refresh, empty state with "New schedule" CTA). `/backend/reports/schedules/new` CrudForm: report picker (loads first 100 reports), name, cadence text field, IANA timezone (defaults to browser tz), recipient emails textarea (comma/newline-separated, parsed locally for emails — user/role recipients via API), formats text field (csv only for now; xlsx ready for 3.6b). Gated by `reports.schedule`. 47 new EN keys.
- **4.4 (8fb755420)** — Notifications config + client renderers. Declared three types: `reports.execution_ready`, `reports.schedule_delivered`, `reports.export_ready`. Server side lives in `notifications.ts`; client renderers live in `notifications.client.ts` plus three React components under `widgets/notifications/`. All three renderers share `ReportNotificationCard.tsx` — a status-token-driven shell (no hardcoded color shades) with severity → border + tint + icon. 11 new EN keys.
- **5.1 (510a1feef)** — Result cache + tag-based invalidation. `lib/result-cache.ts` exports `executeReportCached(...)` (read-through), `buildReportCacheKey`, `buildReportInvalidationTags`, `buildUserFeatureFingerprint`, `invalidateReportCache`. Key = sha256 of `(definition, params, parameterDefs, userFeatureFingerprint)` scoped by `(tenantId, organizationId, reportId)`. Tags: `tenant:<id>`, `reports:org:<id>`, `reports:report:<id>`, `reports:dataset:<id>`. Truncated results bypass caching to avoid masking a growing dataset. Wired into `/api/reports/[id]/run` and the dashboards tile runner; report `update/delete/move` commands invalidate after `emitCrudSideEffects`. Workers and `lib/export.ts` left uncached on purpose (queue/one-shot semantics). 16 new unit tests.
- **5.3 (f22db9366 → da572b6a5)** — `reports-executions-prune` retention worker + the missing `ReportExecution` entity. New table `reports_executions` (Migration20260516000004) with 4 indexes (report, schedule, tenant+status, started_at). Worker reads `OM_REPORTS_EXECUTION_RETENTION_DAYS` (30) and `OM_REPORTS_ASYNC_TIMEOUT_MS` (15m), runs two passes per tick: delete rows older than the retention cutoff; reap `running` rows older than `timeout + 60s` and mark them `failed` with an informative error string. Pure cutoff math lives in `lib/prune.ts`; 9 new tests. The entity is additive — Phase 4.5 will start populating it once the attachments wiring lands.
- **5.4 (d49778e7f → 37822d6ab)** — CLI commands. `mercato reports rebuild-folders [--tenant <id>] [--org <id>]` ensures every Organization has a Public root folder. `mercato reports list-datasets` prints declared datasets with `moduleId`/`entityType`/required features/fields. `mercato reports run <reportId> [--tenant <id>] [--org <id>] [--params <json>] [--json]` executes a saved report from the terminal with optional JSON params. Pure `parseArgs` helper has 7 dedicated unit tests.

## Artifacts
None this checkpoint.

## Definition of "Done" for this window
- Schedules are user-manageable end-to-end via the admin UI (4.6).
- Notification types are declared and the in-app renderer pad is ready for emitters (4.4) — emitters land with 4.3 / 4.5.
- Hot sync paths (`/run`, dashboards tile runner) read from the cache with tag-based invalidation on report writes (5.1).
- The retention infra is in place — the entity + worker exist; once 4.5 starts populating `reports_executions`, retention runs without further work (5.3).
- Operators can debug + test reports from the terminal (5.4).

## Open items (deferred)
- 4.3 `lib/email-attachments.ts` + `ScheduledReportEmail` template (blocked on email module wiring).
- 4.5 Async execute → write to `attachments`, emit notification (blocked on 4.3 + attachments adapter).
- 3.6b XLSX export (blocked on `exceljs` dependency add).
- 5.2 Query profile integration in execute engine.
- 5.5 Docs (`apps/docs/docs/framework/modules/reports.mdx`).
- 5.6 Playwright e2e covering build → save → schedule → email → embed.
