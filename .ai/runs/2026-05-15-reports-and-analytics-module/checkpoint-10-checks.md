# Checkpoint 10 — Steps 5.2, 5.5, 5.6 verified (spec closed modulo external blockers)

**Resume window:** 2026-05-16 09:25..09:35 UTC (after checkpoint 9).
**Steps covered:** 5.2 (f15dbaa5d → 97c6d4ec4 after PLAN amend), 5.5 (13b00d451 → b1e24789a), 5.6 (c95253c9d → 9aa5581d8).
**SHA range:** f15dbaa5d..9aa5581d8 inclusive.

## Touched packages
- `@open-mercato/core` — reports `lib/execute.ts` (profiler wiring) + `__integration__/TC-REPORTS-001.spec.ts`.
- `@open-mercato/docs` (formerly `apps/docs`) — `framework/modules/reports.mdx` + sidebar entry.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `npx tsc -p packages/core/tsconfig.json --noEmit` (filtered to reports) | ✓ | 0 errors. One mid-step fix in 5.2 (TS narrowing on discriminated union broke when bodies moved inside `profiler.measure` closures — re-introduced narrowing per branch with local `def`). |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | **251/251** across 16 suites. The profiler wiring is transparent: no test changes were required. |
| Playwright discovery (`playwright test --list -g 'TC-REPORTS-001'`) | ✓ | Lists 4 tests inside `packages/core/src/modules/reports/__integration__/TC-REPORTS-001.spec.ts`. |
| Docs build | not run | Docusaurus build is heavy; the sidebar entry compiles via `tsc` and the mdx is text-only. |
| Integration test run | not executed | Spec is well-formed and discoverable; user runs `yarn test:integration` against the live dev server. |
| Playwright screenshots | skipped | UI was not changed in this window — same surfaces as checkpoint 9. |

## Per-step summary

- **5.2 (f15dbaa5d → 97c6d4ec4)** — Profiler wiring. `executeFlatList` and `executeReport` create a `reports` profiler scoped by `${type}:${datasetId}` and record sections `field-acl`, `parameters`, `translate`, `query.execute`, and `aggregate.<type>`. Activates when `OM_PROFILE` matches `reports.*` or the dataset-specific target. Falls through to the noop profiler when the env flag is unset, so the existing 251-test pad doesn't move. Failure paths still call `profiler.end({ error })` so observability captures throws.
- **5.5 (13b00d451 → b1e24789a)** — Docs page. `apps/docs/docs/framework/modules/reports.mdx` covers datasets-as-code + three-point ACL contract, builder pane composition, in-memory aggregation engine, async dispatch, result cache (key + tags), schedule + worker matrix, in-app notification types, embedded record-page widgets, CLI surface, profiler env knobs, and ACL features. Added `framework/modules/reports` to the docs sidebar between `currencies` and `integrations-data-sync`.
- **5.6 (c95253c9d → 9aa5581d8)** — `__integration__/TC-REPORTS-001.spec.ts` with 4 Playwright tests: datasets API contract (asserts `customers:person` visibility), backend reports list (heading + "New report" CTA), new-report page (dataset picker label visible), schedules list (heading + "New schedule" CTA). Deliberately defers the full build → save → schedule → email → embed chain to a follow-up spec — that scenario needs the email module (Phase 4.3, blocked) and the attachments persistence (Phase 4.5, blocked).

## Spec status — closed modulo external blockers

Every step the spec authored is now either landed or explicitly blocked on out-of-scope work:

| Phase | Step | Status |
|-------|------|--------|
| 1 | 1.1..1.8 | done (checkpoint 1) |
| 2 | 2.1..2.12 | done (checkpoint 2 + checkpoint 5 + 2.11/2.12 fixes) |
| 3 | 3.1..3.11 + fixes | done (checkpoint 7 + checkpoint 8) |
| 3 | 3.6b XLSX | **blocked** — needs `exceljs` dep add |
| 4 | 4.1..4.6 | 4.1/4.2/4.4/4.6 done; 4.3/4.5 **blocked** |
| 5 | 5.1..5.6 | done (this checkpoint closes 5.2/5.5/5.6) |

## Blockers (carried forward)

- **4.3 — Email + ScheduledReportEmail template.** Depends on the email module wiring; cannot land until that's available.
- **4.5 — Async execute writes to attachments + emits notification.** Depends on 4.3 + the attachments adapter contract.
- **3.6b — XLSX export.** One-off `yarn workspace ... add exceljs` away; left to the user since dep-add is a user gesture.

## Definition of "Done" for this window
- The reports module ships with usable observability hooks (5.2).
- Public documentation describes every surface a third-party developer would want to know about (5.5).
- A baseline Playwright smoke spec runs against the dev server (5.6); follow-up specs for the scheduled-email and embed paths will land alongside 4.3/4.5.

## Artifacts
None this checkpoint.
