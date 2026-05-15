# Checkpoint 1 — Steps 1.1..1.5

**Date:** 2026-05-15T18:25:00Z
**Covers:** Step 1.1 (75c575599) → Step 1.5 (0b26a1c5a)
**Touched packages:** `@open-mercato/shared`, `@open-mercato/core`, `@open-mercato/cli`

## Targeted validation

| Check | Scope | Status | Notes |
|-------|-------|--------|-------|
| `yarn workspace @open-mercato/shared test --testPathPatterns reports` | reports DSL tests in shared | PASS | 28 suites / 248 tests (full shared suite). |
| `yarn workspace @open-mercato/core test src/modules/reports/__tests__` | new reports lib tests | PASS | 3 suites / 44 tests (field-redact 19 + date-ranges 13 + parameters 12). |
| `yarn workspace @open-mercato/cli test --testPathPatterns generators` | generator regression | PASS | 3 suites / 61 tests / 1 skipped — pre-existing skip. |
| `yarn workspace @open-mercato/core typecheck` | core package | PARTIAL | 176 pre-existing errors from missing `#generated/entities.ids.generated`; zero errors in `modules/reports/**`. These exist on `origin/develop` and are resolved by `yarn generate` in the @open-mercato/app workspace (which generates the `apps/mercato/.mercato/generated/` files that the `#generated/*` aliases point at). Not blocking. |

## UI verification

Skipped — no Step in this window touched UI (Phase 1 is API+lib only).

## Artifacts

None — no Playwright run, no screenshots, no captured command output worth keeping. The full pass/fail summaries above suffice.

## Decisions and notes

- The CLI generator extension (Step 1.2) is strictly additive: a new `processStandaloneConfig` call appended after the existing inbox-actions block, and a new generated file (`reports-datasets.generated.ts`) + checksum. No existing collector is modified.
- The reports module skeleton (Step 1.3) intentionally defers `encryption.ts` — encryption maps are configured per-tenant via the `entities.EncryptionMap` table in this codebase, not via a static module file. The spec's `defaultEncryptionMaps` shape will be revisited in Phase 2 once entities exist.
- Field-ACL wildcard matching uses the same `*` / `<ns>.*` expansion the platform's menus/notification helpers already implement, so dataset authors get familiar behavior.
- Date-range math runs in UTC; schedule timezone handling will layer offsets on top in Phase 4.
