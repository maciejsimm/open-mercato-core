# Checkpoint 8 — Steps 3.3a-fix2 .. 3.9b verified (Phase 3 UI complete)

**Resume window:** 2026-05-16 07:30..08:00 UTC (after checkpoint 7)
**Steps covered:** 3.3a-fix2 (27e189842), 3.3a-fix3 (0be646d5c), 3.7b (0511800cb), 3.9b (cb6c3563b). Plus a follow-up i18n fix landed alongside this checkpoint commit (the embed widget i18n keys discovered by `yarn i18n:check`).
**SHA range:** 27e189842..cb6c3563b (HEAD on this checkpoint commit will be the docs one).

## Touched packages
- `@open-mercato/core` — reports module (detail-page spinner fix x2, dashboards UI, embeds admin page, i18n).

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✓ | 15.3s during the dashboards build; ~12s during embeds build. |
| `npx tsc -p packages/core/tsconfig.json --noEmit` (filtered to reports) | ✓ | 0 errors across all four steps. |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | **209/209** across 12 suites — no new unit tests in this window (UI-only changes; covered by integration in 5.6). |
| `yarn i18n:check` | ✓ after fix | First run flagged 5 missing keys (`reports.embed.*`) that landed in 3.11 but were never added to `en.json` because the widget shipped before the keys; added in this checkpoint commit, now clean. |
| Integration tests | skipped | No `.ai/qa/tests/` scenario covers the reports module yet (5.6 will add it). The spinner regression cycle is the strongest reason to add a smoke scenario when 5.6 lands. |
| Playwright screenshots | skipped | No MCP Playwright in this environment; user verified the spinner fix manually after 3.3a-fix3. |

## Per-step summary

- **3.3a-fix2 (27e189842)** — Bullet-proofed the detail-page spinner: removed the cancelled-flag guard from `setIsLoading(false)`, scoped diagnostic `console.warn`/`console.error` payloads (HTTP status, reportId, datasetId), 15 s safety timer that escapes any stuck loading state with a localized error message.
- **3.3a-fix3 (0be646d5c)** — Root cause: the page was using `useParams()` from Next's navigation hook, but Open Mercato's runtime registers backend pages through `apps/mercato/.mercato/generated/modules.runtime.generated.ts` and passes `{ params }` as a **prop**. Switched the signature to `function ReportBuilderPage({ params })` per the customers reference detail page. Confirmed working: the 3.3a-fix2 diagnostic immediately surfaced `{ reportId: '' }`, which made this fix one-liner-obvious.
- **3.7b (0511800cb)** — Dashboards UI: list / new / composer pages under `/backend/reports/dashboards/*`. Composer is a vertical sortable list (uses `@dnd-kit/sortable`) with add-tile sidebar, mode select per tile, run-and-render, save/delete/back. Same diagnostics+timeout pattern as the report builder. The persisted layout shape is the spec's `{ grid, tiles[{ id, reportId, x, y, w, h, mode, title?, paramBindings? }] }` so a future grid-positioning composer (3.7b2) can read/write the same data.
- **3.9b (cb6c3563b)** — Embeds admin page: list + new pages under `/backend/reports/embeds`. Enable/disable toggle + delete via row actions. New page CrudForm picks `report` or `dashboard` for the artifact type, loads the appropriate option set (cached per type), and supports record-field bindings via a single textarea with `paramKey = recordField` pairs. Gated by `reports.embed.manage`.

## Artifacts
None this checkpoint.

## Definition of "Done" for this window
- Detail-page spinner regression is closed. User confirmed the fix in browser.
- Operators can now create dashboards, add tiles, run them, and see results — all via the UI.
- Admins can attach reports/dashboards to widget spots via the embed admin page; the record-embed-host widget from Step 3.11 renders them on customers detail pages.
