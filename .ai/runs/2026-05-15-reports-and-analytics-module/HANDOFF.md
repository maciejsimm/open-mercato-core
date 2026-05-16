# Handoff — 2026-05-15-reports-and-analytics-module

**Last updated:** 2026-05-16T09:10:00Z
**Branch:** feat/reports-and-analytics-module
**PR:** not yet opened (gh CLI unavailable; user opens manually after pushing the branch)
**Current phase/step:** Phase 4 + 5.1 — 4.1/4.2/4.4/4.6 + 5.1 landed; 4.3 + 4.5 + 3.6b deferred (need email + attachments + exceljs). Phase 5.2..5.6 next.
**Last commit:** 510a1feef — `feat(core/reports): step 5.1 result cache + tag-based invalidation`.
**Final status this resume:** in-progress — schedules CRUD + workers + admin UI + notification types are wired end-to-end and the sync `/run` path now caches results with proper tag-based invalidation on report writes.

## What just happened (this resume session — 3 code Steps since compaction)

| Step | Commit | What |
|------|--------|------|
| 4.6 | 00b6be67a | Schedule editor UI — `/backend/reports/schedules` list (DataTable + toggle/delete row actions, empty state) + `/backend/reports/schedules/new` CrudForm (report picker, cadence, IANA timezone, recipient emails, formats). 47 EN keys + `yarn i18n:fix`. |
| 4.4 | 8fb755420 | `notifications.ts` + `notifications.client.ts` declaring `reports.execution_ready`, `reports.schedule_delivered`, `reports.export_ready`. Three React renderers share a `ReportNotificationCard` shell that respects the unread state + severity color tokens (no hardcoded status colors). 11 EN keys + `yarn i18n:fix`. |
| 5.1 | 510a1feef | `lib/result-cache.ts` — read-through `executeReportCached` wrapper. SHA256 key over `(definition, params, parameterDefs, userFeatureFingerprint)` + `(tenant, org, reportId)`; tagged `tenant:<id>`, `reports:org:<id>`, `reports:report:<id>`, `reports:dataset:<id>`. Truncated results bypass caching. Wired into `/api/reports/[id]/run` + dashboards tile runner; report `update/delete/move` commands now invalidate on write. 16 new unit tests; reports pad: 235/235 across 14 suites. |

Reports unit-test pad: **235/235** across 14 suites at the end of this resume (16 new cache tests added).

## Next concrete action

- **5.3 — `reports-executions-prune` retention worker.** Self-contained: queue worker + setup-config knob for retention TTL. The natural follow-up to 5.1 since both keep the result store healthy.
- **5.4 — CLI commands.** `reports rebuild-folders`, `reports run`, `reports list-datasets` — fits the existing `packages/cli` module style.
- **5.2 — Query profile integration.** Smaller; piggybacks on `@open-mercato/shared/lib/profiler` to attach a `query_engine` node inside `[crud:profile]` payloads when `OM_PROFILE` matches `reports.*`.

When 4.3 (email + ScheduledReportEmail template) and 4.5 (async-execute → attachments + notification emit) become unblocked, return to those before 5.5 (docs) and 5.6 (Playwright e2e).

### Cache wiring not yet extended

5.1 wired the cache into `/api/reports/[id]/run` and the dashboards tile runner — the two highest-traffic sync paths. The remaining `executeReport(...)` callers were left uncached on purpose: workers (`reports-async-execute`, `reports-schedule-execute`) already run under queue concurrency control, and `lib/export.ts` is a one-shot download. Add the wrapper there if production telemetry shows hotspots after 5.5/5.6.

## Phase 4 remaining (deferred)
- 4.3 `lib/email-attachments.ts` + `ScheduledReportEmail` React template (depends on email module wiring + attachments adapter)
- 4.5 Async execute path → write result to `attachments`, emit notification (depends on 4.3)

## Phase 3 remaining (deferred)
- 3.6b XLSX export (needs `exceljs` dependency)

## Phase 5 plan
- ~~5.1 Result cache (Redis tier via DI `cache`) + tag-based invalidation~~ ✓ landed 510a1feef
- 5.2 Query profile integration in execute engine
- 5.3 `reports-executions-prune` retention worker
- 5.4 CLI commands
- 5.5 Docs (`apps/docs/docs/framework/modules/reports.mdx`)
- 5.6 Playwright e2e

## Blockers / open questions
- `gh` CLI still unavailable. PR creation, label normalization, and `auto-review-pr` autofix pass remain user actions after pushing the branch.
- Remote push requires user credentials. Branch remains local.
- MikroORM snapshot for the reports module remains uncommitted. Four migrations live on disk now (`Migration20260515182452` original, `Migration20260516000001` dashboards, `Migration20260516000002` embeds, `Migration20260516000003` schedules) — the user should `yarn db:migrate` then `yarn db:generate` to refresh the snapshot.
- No Playwright e2e for the reports module yet. 5.6 will land a smoke scenario; the spinner regression cycle remains the strongest argument for one.

## Environment caveats
- Dev runtime: works on this branch in the primary worktree. Schedules UI was not yet user-exercised in the browser — typecheck + unit tests only.
- The notification renderers are unit-tested at the typecheck level only — recommend a Playwright check once 4.3/4.5 are wired.

## Worktree
- Path: `/Users/maciejsimm/Documents/Workspaces/Dainamite/open-mercato-core`
- Primary checkout — no isolated worktree (per recorded user preference).

## Resume instructions
Re-enter with `/auto-continue-pr-loop` and tell me which direction: `5.3` (retention worker), `5.4` (CLI), `5.2` (profile), or knock off `3.6b` (XLSX) if `exceljs` is acceptable to add. Default if you just say "continue": **5.3 retention worker** since it pairs naturally with the 5.1 cache and is self-contained.
