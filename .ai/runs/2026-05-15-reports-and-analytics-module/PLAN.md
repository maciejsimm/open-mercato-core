# Plan — Reports & Analytics Module

**Source spec:** [.ai/specs/2026-05-15-reports-and-analytics-module.md](../../specs/2026-05-15-reports-and-analytics-module.md)
**Branch:** `feat/reports-and-analytics-module`
**Mode:** Local-only run (no `gh` CLI available). Branch will be pushed; PR creation/labeling/auto-review-pr left for the user to run manually.
**Scope budget:** As many of the 5 phases as time permits, with the 20-step safety stop applied. Run is expected to land as `in-progress`; subsequent phases continue via `auto-continue-pr-loop`.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Seed run folder (PLAN/HANDOFF/NOTIFY) | done | aed0a4e76 |
| 1 | 1.1 | Add `defineDataset` DSL + types in `packages/shared/src/modules/reports/` | done | 75c575599 |
| 1 | 1.2 | Extend CLI generator to discover `<module>/reports.ts` and emit `reports-datasets.generated.ts` | done | a29689c34 |
| 1 | 1.3 | Scaffold reports module: `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `translations.ts`, `encryption.ts` | done | 0a26b027d |
| 1 | 1.4 | Build `lib/field-redact.ts` + unit tests | done | 87a00e900 |
| 1 | 1.5 | Build `lib/parameters.ts` + `lib/date-ranges.ts` + unit tests | done | 0b26a1c5a |
| 1 | 1.6 | Build `lib/datasets-registry.ts` (runtime view over generated registry) + tests | done | 64acc614f |
| 1 | 1.7 | Build `lib/query-translator.ts` for `flat_list` definitions + unit tests | done | 5d7baf1bc |
| 1 | 1.8 | Build `lib/execute.ts` orchestrator (sync flat_list path) + unit tests | done | 2e403ab6a |
| 1 | 1.9 | Add datasets API: `api/datasets/route.ts` + `api/datasets/[id]/route.ts` | done | d029aadbf |
| 1 | 1.10 | Seed `customers/reports.ts` (people dataset) — canonical example | done | db8535e15 |
| 2 | 2.1 | Add ORM entities: `Report`, `ReportFolder`, `ReportFolderShare` | done | 075e2012c |
| 2 | 2.2 | Add zod validators in `data/validators.ts` (flat_list discriminator only) | done | e8e9e1a31 |
| 2 | 2.3 | Add commands: folder.create/update/delete/share + report.create/update/delete/move | done | dd8128f69 |
| 2 | 2.4 | Add `lib/folder-acl.ts` + unit tests for visibility/edit rules | done | fc0bf4664 |
| 2 | 2.5 | Add CRUD routes: folders, folder-shares, reports (`makeCrudRoute`) | done | bf379914e |
| 2 | 2.6 | Add `api/reports/[id]/run/route.ts` (sync flat_list run) | done | c41fa9d5d |
| 2 | 2.7 | Wire `setup.ts seedDefaults` for Public root folder + lazy-create My Reports | done | 6e7f56c25 |
| 2 | 2.8 | Backend pages: `/backend/reports/page.tsx` (folder navigator + DataTable) | done | f2afcc377 |
| 2 | 2.9 | Backend pages: `/backend/reports/reports/new/page.tsx` + `[id]/page.tsx` (builder shell, flat-list only) | done | e229b917c |
| 2 | 2.10 | Menu injection: `widgets/injection-table.ts` for main sidebar Reports entry | done | ca337e05d |
| 2 | 2.11-fix | Fix `/backend/reports/*` URLs in list + new pages (auto-discovery collapses duplicate prefix) | done | 78b7d9071 |
| 2 | 2.12-fix | MikroORM v7 compatibility (decorators/legacy import + `em.remove(...).flush()`) after main merge | done | 7f7b8aa30 |
| 3 | 3.1 | `lib/aggregator.ts` — in-memory group-by + pivot + measures + unit tests | done | 8005f6ed6 |
| 3 | 3.2 | Extend validators for `grouped`, `pivot`, `chart`, `summary` types | done | 5110a7bf2 |
| 3 | 3.3a | Builder canvas — type switcher + per-type drop zones (click-to-add) + spinner fix on detail page | done | bc40a0bb4 |
| 3 | 3.3b | Builder canvas — drag fields from FieldList into per-type zones via `@dnd-kit` (alongside click-to-add) | done | 525857ed4 |
| 3 | 3.3c | Builder canvas — filters editor typed by field kind (literal + date_range) | done | d455525f6 |
| 3 | 3.3d | Builder canvas — parameters declaration UI | done | f47082520 |
| 3 | 3.4 | Add missing chart wrappers (`AreaChart`, `DonutChart`, `ScatterChart`, `ComboChart`) to `packages/ui/src/backend/charts/` | done | 697550a55 |
| 3 | 3.5 | `lib/chart-spec.ts` + `<ReportChart>` adapter | done | bd0838eef |
| 3 | 3.5b | Extend `lib/execute.ts` to dispatch grouped/pivot/chart/summary through the aggregator; run route supports all types | done | 400bf8a79 |
| 3 | 3.6a | `api/reports/[id]/export/route.ts` + `lib/export.ts` (CSV + JSON + XML + Markdown via shared serializer) | done | ac4606075 |
| 3 | 3.6b | XLSX export support (adds `exceljs` dependency) | todo | — |
| 3 | 3.7 | `ReportDashboard` entity + commands + CRUD route (backend foundation) | done | c92c1699a |
| 3 | 3.7b | Dashboards UI — list, new, composer (`/backend/reports/dashboards/*`) | done | 0511800cb |
| 3 | 3.8 | `api/dashboards/[id]/run/route.ts` (parallel tile execution) | done | e4ae57186 |
| 3 | 3.9 | `ReportEmbed` entity + CRUD + commands + render endpoint (admin page deferred to 3.9b) | done | 5ac77f4af |
| 3 | 3.9b | Embeds admin page (`/backend/reports/embeds`) — list + new + toggle + delete | done | cb6c3563b |
| 3 | 3.10 | Expose `detail:customers.company:after-header` and `detail:customers.person:after-header` injection spots | done | 369ddf0ef |
| 3 | 3.11 | `record-embed-host` widget registered on `detail:customers.{person,company}:after-header` | done | 5cc28de8f |
| 3 | 3.3a-fix2 | Bullet-proof the report detail spinner: drop cancelled-guard, add diagnostics + 15s safety timeout | done | 27e189842 |
| 3 | 3.3a-fix3 | Read `params.id` from page props (not `useParams()`) — root cause of the spinner | done | 0be646d5c |
| 3 | 3.3b-fix | Add `<DragOverlay>` so dragged field follows the mouse cursor | done | 8ce925173 |
| 4 | 4.1 | `ReportSchedule` entity + CRUD + commands | done | 000894c23 |
| 4 | 4.2 | Workers: `reports-schedule-runner`, `reports-schedule-execute`, `reports-async-execute`, `reports-export-build` | done | a0534e018 |
| 4 | 4.3 | `lib/email-attachments.ts` + `ScheduledReportEmail` React template | todo | — |
| 4 | 4.4 | `notifications.ts` + `notifications.client.ts` (execution_ready, schedule_delivered, export_ready) | done | f19601a6a |
| 4 | 4.5 | Async execute path: write result to `attachments`, emit notification | todo | — |
| 4 | 4.6 | Schedule editor UI: `/backend/reports/schedules` + per-report Schedule modal | done | 4863923fa |
| 5 | 5.1 | Result cache (Redis tier via DI `cache`) + tag-based invalidation | done | 833602d42 |
| 5 | 5.2 | Query profile integration in execute engine | todo | — |
| 5 | 5.3 | `reports-executions-prune` retention worker | todo | — |
| 5 | 5.4 | CLI: `yarn mercato reports rebuild-folders`, `reports run`, `reports list-datasets` | todo | — |
| 5 | 5.5 | Docs: `apps/docs/docs/framework/modules/reports.mdx` | todo | — |
| 5 | 5.6 | Playwright e2e per `.ai/qa/AGENTS.md` covering build → save → schedule → email → embed | todo | — |

## Goal

Land a working OSS `reports` module per the spec, starting with the foundational dataset DSL + flat-list execution and progressively delivering persisted reports, folders, sharing, full builder, dashboards, embeds, schedules, and polish. Subsequent phases continue via `auto-continue-pr-loop` if the run does not complete in one session.

## Scope

- New `reports` OSS module under `packages/core/src/modules/reports/`.
- New shared DSL `packages/shared/src/modules/reports/dsl.ts` (`defineDataset`).
- New CLI generator step that discovers `<module>/reports.ts` and emits `reports-datasets.generated.ts`.
- New example datasets in `customers/reports.ts` (Phase 1), `sales/reports.ts` (Phase 3), `catalog/reports.ts` (Phase 3).
- Three-point field-ACL enforcement (`lib/field-redact.ts`).
- Folder-level ACL with private/public roots + per-folder shares.
- Bounded in-memory aggregation with async dispatch on `OM_REPORTS_INMEMORY_CAP`.
- Builder UI using existing `@dnd-kit` primitives and `@open-mercato/ui/backend/charts/*` wrappers.
- Dashboards, embeds, schedules, notifications, async worker, retention worker.
- BACKWARD_COMPATIBILITY.md updated to record `<module>/reports.ts` as ADDITIVE-ONLY auto-discovery.

## Non-goals

- Free-form SQL editor.
- User-defined joins in the builder (only dataset-author-declared joins).
- Materialised views (Phase 2 of the spec; not this run).
- PDF export (deferred to Phase 2 of the spec).
- Postgres-side aggregation (deferred — in-memory only this run).
- Portal pages (no MVP frontend portal surface).

## External References

None — no `--skill-url` passed.

## Risks (brief)

- Spec breadth (~46 steps, 7 tables, full UI) exceeds a single session's reasonable scope. Mitigation: respect the 20-step safety stop and leave the PR `in-progress` for `auto-continue-pr-loop`.
- `gh` CLI unavailable in this environment. Mitigation: skip PR creation/labeling/auto-review-pr; push branch and let user open the PR manually.
- New auto-discovery file (`<module>/reports.ts`) is additive but touches `packages/cli/src/lib/generators/module-registry.ts` (a frozen generator surface). Mitigation: only **append** a new `processStandaloneConfig` call + new output file + new checksum; never modify existing collectors. Record in BACKWARD_COMPATIBILITY.md.
- Field-ACL bypass via direct definition save — mitigated by three-point enforcement in `lib/field-redact.ts`.
- In-memory aggregation OOM — mitigated by default cap of 25 000 rows + async dispatch.

## Implementation Plan

### Phase 0 — Run-folder seed

- **0.1** Commit `.ai/runs/2026-05-15-reports-and-analytics-module/PLAN.md`, `HANDOFF.md`, `NOTIFY.md` so resumability is anchored on the remote branch from the start.

### Phase 1 — Dataset registry + minimum API (single-entity, flat list)

- **1.1** Add `packages/shared/src/modules/reports/dsl.ts` exporting `defineDataset()` + `defineMeasure()` types. Keep zero-dependency. Include `DatasetField`, `DatasetFieldKind`, `DatasetFieldAclMap`, `DatasetJoin`, `Dataset`, `Aggregation`, `Sort`, `MeasureExpr`, `FilterExpr`, `DateRangeToken`, `ParameterDef`. Unit-test the DSL emits the expected shape.
- **1.2** Extend `packages/cli/src/lib/generators/module-registry.ts` to call `processStandaloneConfig({ relativePath: 'reports.ts', prefix: 'REPORTS', configExpr: (n,id) => "{ moduleId: '"+id+"', datasets: ((${n}.datasets ?? ${n}.default ?? []) as Dataset[]) }" })` and emit `reports-datasets.generated.ts` with `reportsDatasetConfigEntries`. Add checksum file. Pure additive change. Cover with the existing generator test pattern in `__tests__/generators.test.ts` if straightforward — otherwise add a focused test.
- **1.3** Create `packages/core/src/modules/reports/{index.ts,acl.ts,setup.ts,events.ts,translations.ts,encryption.ts}` mirroring the customers module skeleton. ACL features: `reports.view`, `reports.author`, `reports.share`, `reports.schedule`, `reports.export`, `reports.embed.manage`, `reports.admin`. Setup declares `defaultRoleFeatures` for admin + employee.
- **1.4** Build `packages/core/src/modules/reports/lib/field-redact.ts` exporting `redactDatasetFields(dataset, userFeatures)` and `validateDefinitionAgainstAcl(definition, dataset, userFeatures)`. Tests cover: hidden fields stripped, filter on redacted field rejected, group-by on redacted field rejected, measure over redacted field rejected, joins with redacted fields produce safe output.
- **1.5** Build `lib/parameters.ts` + `lib/date-ranges.ts` exporting 12 pre-defined date tokens (`today`, `yesterday`, `last_7_days`, `last_30_days`, `mtd`, `last_month`, `qtd`, `last_quarter`, `ytd`, `last_year`, `last_24h`, `custom`). `resolveParameters(params, defs, now)` returns concrete filter expressions. Unit tests cover every token and reject malformed input.
- **1.6** Build `lib/datasets-registry.ts` — `getDataset(id)`, `listDatasets({ userFeatures })`. Reads from the generated `reports-datasets.generated.ts`. Filtering by `requiredFeatures` happens here. Tests use a mocked generated file.
- **1.7** Build `lib/query-translator.ts` exporting `translateFlatList(def, dataset, params)`. Converts to `QueryEngine.query()` args: filters, sort, page. Tenant/org scopes flow through the engine; never set `omitAutomaticTenantOrgScope`. Tests cover happy path + redaction.
- **1.8** Build `lib/execute.ts` — `executeReport({ container, dataset, definition, params, userFeatures, tenantId, organizationId })` for `flat_list` type only. Returns `{ mode: 'sync', rows, total, meta }`. Tests use mocked QueryEngine.
- **1.9** Add datasets API:
  - `api/datasets/route.ts` — `GET` returns datasets visible to user (passes `userFeatures`).
  - `api/datasets/[id]/route.ts` — `GET` returns one dataset with `fieldAcl` redaction applied.
  Both export `openApi` (custom payload, not `makeCrudRoute`) and per-method `metadata.requireAuth + requireFeatures: ['reports.author']`.
- **1.10** Seed `packages/core/src/modules/customers/reports.ts` declaring `customers.people` dataset (mirrors spec example minus joins). Run `yarn generate` after committing — verify the generated file appears.

### Phase 2 — Persisted reports + folders + UI shell

- **2.1** ORM entities under `packages/core/src/modules/reports/data/entities.ts`: `Report`, `ReportFolder`, `ReportFolderShare`. MikroORM v7 decorators. Tables `reports_reports`, `reports_folders`, `reports_folder_shares`. Generate migration via `yarn db:generate`.
- **2.2** zod schemas in `data/validators.ts`. `ReportDefinitionFlatListSchema` (discriminator-ready, but only the `flat_list` arm). Validators are derived from the schemas via `z.infer`.
- **2.3** Commands under `commands/` for folder + report + folder-share. Use the Command pattern from `packages/shared/src/lib/commands`. Each command declares `entityType` + `cacheAliases` for `emitCrudSideEffects`. Snapshot before/after for undo.
- **2.4** `lib/folder-acl.ts` — `canViewFolder({folder, user, shares})`, `canEditFolder(...)`. Tests cover private vs public, role-share, user-share, owner-of-private, admin god mode.
- **2.5** CRUD routes via `makeCrudRoute`: `api/folders/route.ts`, `api/folder-shares/route.ts`, `api/reports/route.ts` (list + get + create + update + delete). Custom routes (`/run`, `/export`, `/render`) come later. Reject shares on public folders.
- **2.6** `api/reports/[id]/run/route.ts` — `POST` runs the report. Body `{ params?, mode? }`; returns `ReportRunResponse`. Calls `execute.ts` with sync path.
- **2.7** `setup.ts seedDefaults` writes the org Public root folder; folder list API lazily creates the per-user My Reports private root.
- **2.8** Backend page `/backend/reports/page.tsx` with `<DataTable entityId="reports:report">` + folder tree on the left. Empty state, search field, type filter.
- **2.9** Backend builder shell pages: `/backend/reports/reports/new/page.tsx` + `[id]/page.tsx`. Flat-list-only this phase; later phases add the canvas type switcher.
- **2.10** `widgets/injection-table.ts` maps a `Reports` menu entry into `menu:sidebar:main`. After this lands, run `yarn mercato configs cache structural --all-tenants` (if available).

### Phase 3 — Grouped + Pivot + Charts + Dashboards + Embeds

Per spec — driven Step-by-Step from the Tasks table. Each Step is one commit, scope confined to the row.

### Phase 4 — Scheduling + Async + Notifications

Per spec.

### Phase 5 — Polish + Performance + Docs

Per spec.

## Validation strategy

- Per-Step: quick scratch typecheck + jest scoped to the new files. Not recorded.
- Checkpoint every 5 Steps: `yarn typecheck` + `yarn test` (scoped), `yarn generate` if module structure changed, `yarn build:packages` if package exports changed. Record in `checkpoint-<N>-checks.md`.
- Final gate (only when all Tasks are `done` AND time permits): full validation gate per skill workflow.

## Stop conditions

This run stops early — leaving `Status: in-progress` — when **any** of the following is true:

- 20 consecutive Steps have landed (safety stop per skill rules).
- A checkpoint regresses and the fix is non-trivial.
- A failing test or typecheck cannot be resolved within the next Step.
- The remaining work clearly exceeds available session time.

When this happens, `HANDOFF.md` points to the first `todo` Step in the Tasks table; the user resumes via `auto-continue-pr-loop` (or the equivalent `auto-continue-pr` if they create the PR manually first).
