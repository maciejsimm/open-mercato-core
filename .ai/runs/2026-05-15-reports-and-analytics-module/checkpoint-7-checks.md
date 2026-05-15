# Checkpoint 7 — Steps 3.6a..3.11 verified (dashboards + embeds end-to-end)

**Resume window:** 2026-05-15 22:08..22:55 UTC (continuing this session)
**Steps covered:** 3.6a (ac4606075), 3.7 (c92c1699a), 3.8 (e4ae57186), 3.9 (5ac77f4af), 3.10 (369ddf0ef), 3.11 (5cc28de8f).
**SHA range:** ac4606075..5cc28de8f (HEAD on this checkpoint commit will be the docs one).

## Touched packages
- `@open-mercato/core` — reports module (entities, migrations, validators, commands, dashboards run route, embeds CRUD, widget host) + customers module (two new `<InjectionSpot>` mount points).

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✓ | 11–34s across runs; no errors. Registries refresh after the two new migration files + the new injection-table wiring. |
| `tsc -p packages/core/tsconfig.json --noEmit` (filtered to reports + customers) | ✓ | 0 errors. |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | **209/209** across 12 suites (chart-spec, aggregator, validators, execute, field-redact, export, parameters, date-ranges, folder-acl, datasets-registry, query-translator, dsl). |
| `yarn i18n:check` | ✓ | No new strings added in this window; advisory unused-keys count unchanged. |
| Integration tests | skipped | No reports `.ai/qa/tests/` scenario yet; 5.6 covers the Playwright e2e. The new endpoints are unit-tested at the executor + aggregator + serializer layer. |
| Playwright screenshots | skipped | No MCP Playwright tool in this environment; the user can verify in-browser. |

## Per-step summary

- **3.6a (ac4606075)** — `lib/export.ts` + `api/reports/[id]/export/route.ts` reusing the shared `serializeExport` helper for CSV / JSON / XML / Markdown. Builder header gains an Export dropdown. +8 unit tests. XLSX deferred to 3.6b.
- **3.7 (c92c1699a)** — `ReportDashboard` entity on `reports_dashboards` (migration + indexes + unique-name partial index). Zod validators for `dashboardLayout` (grid + tiles + paramBindings) + dashboard CRUD shapes. Commands (create / update / delete / move) mirroring report commands with folder-ACL gating. `api/dashboards/route.ts` with `makeCrudRoute` writes + custom GET. +5 validator tests.
- **3.8 (e4ae57186)** — `api/dashboards/[id]/run/route.ts` orchestrates parallel tile execution via `Promise.all`. Per-tile pipeline merges dashboard-level params with tile bindings (`literal`/`parameter`/`record-field`), then runs through `executeReport`. One failing tile does not fail the dashboard — failures land as `{ error: { code, message } }`. Updates `lastExecutedAt`.
- **3.9 (5ac77f4af)** — `ReportEmbed` entity on `reports_embeds`. Partial index on `(tenant_id, host_spot_id, host_entity_id) WHERE deleted_at IS NULL AND enabled = true`. Validators reject `parameter`-source bindings (only `literal` and `record-field`). Commands + CRUD route at `api/embeds/route.ts` with `spot=`, `hostEntityId=`, `enabledOnly=` query params. ACL: GET = `reports.view` (widgets need it), writes = `reports.embed.manage`.
- **3.10 (369ddf0ef)** — Added `<InjectionSpot spotId="detail:customers.person:after-header" />` and `<InjectionSpot spotId="detail:customers.company:after-header" />` to the customers detail pages, mirroring the existing `detail:customers.deal:header` pattern.
- **3.11 (5cc28de8f)** — `record-embed-host` widget. Reads `spotId` + host record id from the injection context, calls `GET /api/reports/embeds?spot=…&hostEntityId=…&enabledOnly=1`, resolves param bindings (`literal` / `record-field`) against the host record, runs the reports/dashboards run routes, and renders inline. Errors per embed (not per page). Registered in `widgets/injection-table.ts` for the two new customers slots.

## Deferred / not done this resume

- **3.6b (XLSX export)** — needs an `exceljs` (or similar) workspace dep. Skipped per user direction; the four text formats cover the immediate need.
- **3.7b (dashboards UI)** — backend is complete, but the list / new / composer pages haven't been built. Dashboards can be created via the API today; the composer is the next big UI piece.
- **3.9b (embeds admin page)** — embeds can be created via the API; the admin page is a small follow-up.
- **Filters↔Parameters bridge** — small polish noted earlier in HANDOFF.

## What works end-to-end now

1. Create reports of any type via the builder, including drag-and-drop, filters, and parameters.
2. Run reports of any type via the executor + aggregator.
3. Export reports to CSV / JSON / XML / Markdown.
4. Create dashboards via the API and run all tiles in parallel.
5. Create embed configs via the API; the `record-embed-host` widget renders them on customers detail pages.
