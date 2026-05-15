# Checkpoint 4 — Phase 2 close (Steps 2.8..2.10)

**Timestamp:** 2026-05-15T20:30:00Z
**Steps covered:** 2.8, 2.9, 2.10
**Commit range:** 774e2160f..dd0f9bc24 (the three flipped commits on this branch — short SHAs may vary after PLAN.md amends; lookup by message in git log)
**Touched packages:** @open-mercato/core (reports module + apps/mercato/src/modules.ts enabling the module)

## Targeted validation

| Check | Result | Detail |
|-------|--------|--------|
| `yarn workspace @open-mercato/core typecheck` (filtered to `reports/`) | PASS | 0 typecheck errors in `packages/core/src/modules/reports/**`. Pre-existing `#generated/entities.ids.generated` errors in unrelated modules (sales, staff, perspectives, customers, dashboards, …) persist from before this branch — same as documented in checkpoints 1–3. |
| `yarn workspace @open-mercato/core jest --testPathPatterns 'modules/reports'` | PASS | 8 suites, 125 tests passing (Phase 1: 80 + Phase 2 additions: 17 validators + 28 folder-acl). Unchanged from checkpoint 3 — UI Steps did not regress unit tests. |
| `yarn workspace @open-mercato/shared test` | PASS | 28 suites, 248 tests. No regression. |
| `yarn i18n:check-sync` | PASS after `--fix` | 4 reports locale bundles auto-sorted (`en/pl/de/es.json`). Sort-only reformat, no key content changed. Diff captured in this checkpoint's commit. |
| `yarn i18n:check-usage` (filtered to `reports.*`) | CLEAN | 0 missing keys and 0 unused keys in `reports.*`. Repo-wide totals (118 missing / 3383 unused) are pre-existing drift from other modules — not introduced by Phase 2 UI work. |
| `yarn generate` | DEFERRED to dev-server restart | Generators run on the user's primary worktree as part of their regen step (per their direction "after next major step I can regenerate everything and restart dev server"). The new module registration in `apps/mercato/src/modules.ts` and the new auto-discovery files (`backend/**.tsx`, `backend/**.meta.ts`, `widgets/injection-table.ts`, `i18n/*.json`) all rely on a generator pass before the running app sees them. |

## UI verification (conditional)

**Status:** SKIPPED — recorded reason below; UI gate is best-effort per skill rules ("UI checks MUST NEVER block development").

- The user's running dev server (localhost:3010) is on the **primary worktree** (`main` branch), not on this branch's worktree. The new module is therefore not yet wired into the running app.
- Migration `Migration20260515182452.ts` from Step 2.1 still needs `yarn db:migrate` against the dev database before the reports tables exist. From the previous handoff: "migration exists on disk but is unapplied".
- Once the user runs `yarn generate` + `yarn db:migrate` + restarts `yarn dev`, the UI smoke pass can run against:
  - `/backend/reports` — folder navigator + reports DataTable (Step 2.8)
  - `/backend/reports/reports/new` — CrudForm for new report (Step 2.9)
  - `/backend/reports/reports/[id]` — builder shell + Run preview (Step 2.9)
- Playwright + screenshots will be captured on the next resume after the user confirms the dev server is up on this branch.

No `checkpoint-4-artifacts/` directory was created — no Playwright transcripts or screenshots exist for this checkpoint.

## Summary

- Phase 2 is functionally complete: 10/10 steps done (entities → validators → commands → folder-acl → CRUD routes → run route → seed defaults → list page → builder shell → injection-table placeholder).
- 20 code commits total: Phase 1 (10) + Phase 2 (10). Safety stop at 20 reached — next resume should checkpoint and then move into Phase 3.
- Outstanding tasks for the user before UI smoke can run:
  1. `yarn db:migrate` (or `yarn initialize`) to apply the reports migration.
  2. `yarn generate` to rebuild `apps/mercato/.mercato/generated/*` so the new module is discovered.
  3. `yarn mercato configs cache structural --all-tenants` to purge `nav:*` cache after the sidebar entry lands.
  4. Restart `yarn dev` (or `yarn dev:reset && yarn dev` if Turbopack serves stale chunks).

After those steps, navigating to `/backend/reports` as `admin@acme.com` should show the navigator + DataTable, and the builder pages should be reachable from the "New Report" button.
