# Checkpoint 2 — Steps 1.6..1.10 (Phase 1 close)

**Date:** 2026-05-15T18:55:00Z
**Covers:** Step 1.6 (64acc614f) → Step 1.10 (db8535e15)
**Touched packages:** `@open-mercato/core`

## Targeted validation

| Check | Scope | Status | Notes |
|-------|-------|--------|-------|
| `yarn workspace @open-mercato/core test src/modules/reports/__tests__` | every reports unit test | PASS | 6 suites / 80 tests. |
| `yarn workspace @open-mercato/core typecheck` | core package | PASS for reports | No typecheck errors in `modules/reports/**` or `modules/customers/reports.ts`. Pre-existing `#generated/entities.ids.generated` errors in unrelated modules persist on `develop` and are not introduced by this branch. |

## UI verification

Skipped — no UI Steps in this window (Phase 1 is API + lib only).

## Artifacts

None — the per-suite Jest summaries above are the sole verification artifact.

## Phase 1 close — summary

Phase 1 is functionally complete:

- **DSL** (`packages/shared/src/modules/reports/dsl.ts`) — `defineDataset()` + `defineMeasure()` + every shape the rest of the module depends on (ParameterDef, FilterExpr, MeasureExpr, ChartSpec, ReportDefinition discriminated union).
- **Generator** — `packages/cli/src/lib/generators/module-registry.ts` now emits `apps/mercato/.mercato/generated/reports-datasets.generated.ts` listing every module's `reports.ts`.
- **Module skeleton** — `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `translations.ts` declare the module identity, features, role defaults, events, and translatable fields.
- **Field-ACL** — three-point enforcement (`lib/field-redact.ts`) covers builder load, save, and run including aggregations.
- **Date-ranges** — 12 spec tokens (`lib/date-ranges.ts`) with UTC math.
- **Parameters** — typed parameter resolver + filter binding (`lib/parameters.ts`).
- **Datasets registry** — runtime view over the generated bootstrap (`lib/datasets-registry.ts`).
- **Query translator** — `flat_list` → QueryEngine.QueryOptions (`lib/query-translator.ts`).
- **Execute** — sync orchestrator chaining all of the above (`lib/execute.ts`) + the `shouldDispatchAsync` helper for Phase 4.
- **API** — `GET /api/reports/datasets` and `GET /api/reports/datasets/[id]`.
- **Example dataset** — `customers.entities` lives in `packages/core/src/modules/customers/reports.ts`.

Test totals for Phase 1: **80 unit tests across 6 suites**.

## Decisions and notes carried into Phase 2

- The `customers.entities` dataset uses the unified `customer_entities` table; reports filter on `kind` to scope to people only or companies only. The spec example referenced `customers:person` which does not exist — using the real entity is more honest and matches the indexer.
- Phase 1 keeps OR-groups out of the query translator on purpose; the aggregator in Phase 3 will own OR support. Authors who need an OR today should use the upstream query engine's `WhereOps` directly.
- The CLI generator change is strictly additive — existing collectors and outputs are untouched, so no BC concern. BACKWARD_COMPATIBILITY.md will be updated in Phase 2 alongside the new entity tables.
