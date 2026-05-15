# Checkpoint 3 — Steps 2.2..2.6 (Phase 2 data + API layer)

**Date:** 2026-05-15T16:42:00Z
**Covers:** Step 2.2 (e8e9e1a31) → Step 2.6 (c41fa9d5d)
**Touched package:** `@open-mercato/core`

## Targeted validation

| Check | Scope | Status | Notes |
|-------|-------|--------|-------|
| `yarn workspace @open-mercato/core test src/modules/reports/__tests__` | every reports unit test | PASS | 8 suites / 125 tests. Phase 1 totals (80) + Phase 2 additions (45: 17 validators + 28 folder-acl). |
| `yarn workspace @open-mercato/core typecheck` | core package | PASS for reports | No typecheck errors in `modules/reports/**`. Pre-existing `#generated/entities.ids.generated` errors elsewhere persist on `develop` and are unrelated. |

## UI verification

Skipped — no UI Steps in this window (the API + commands layer of Phase 2 is API-only). UI verification fires at Steps 2.8–2.9.

## Artifacts

None — Jest summaries above are the sole verification artifact.

## Phase 2 progress so far

| Step | Commit | Delivered |
|------|--------|-----------|
| 2.1 | 075e2012c | ORM entities + initial migration (entities + DDL only; snapshot deferred) |
| 2.2 | e8e9e1a31 | zod validators (flat_list discriminator implemented, others placeholders) |
| 2.3 | dd8128f69 | 9 commands (folder create/update/delete/share/share-delete + report create/update/delete/move) |
| 2.4 | fc0bf4664 | folder-acl predicates (visibility, edit, share, artifact-owner override) |
| 2.5 | bf379914e | CRUD routes for folders, folder-shares, reports |
| 2.6 | c41fa9d5d | POST /api/reports/reports/[id]/run (sync flat_list) |

Phase 2 remaining:
- 2.7 (light) — seedDefaults wires Public root folder per tenant; lazy-create My Reports on first folder list call.
- 2.8–2.9 (heavy UI) — folder navigator + builder shell, both need a runnable dev environment to validate.
- 2.10 (light) — main sidebar Reports menu entry via widgets/injection-table.ts.

## Decisions / notes carried forward

- Commands use the standard `registerCommand` registry pattern. They were written without undo handlers; the spec calls for full undo, which is deferred to Phase 5 polish. The audit-log shape (`buildLog`) is wired so the command-log surface still reports each mutation.
- The run route refuses non-flat_list reports with HTTP 501 and code `REPORT_TYPE_UNSUPPORTED`. The Phase 3 aggregator will lift this restriction.
- The async dispatch is a placeholder — `shouldDispatchAsync` returns the right decision but the route returns a stub 202; the actual worker lands in Phase 4.
- `auth.features` is not a property on the platform's `AuthContext`. The commands' shared.ts reads features through a typed cast; runtime values are populated by the `requireFeatures` middleware which materialises them on the request scope. This is consistent with how other modules read features.
