# Checkpoint 5 — Steps 2.11-fix .. 3.4 verified

**Resume:** 2026-05-15 21:30 → 21:45 UTC
**Steps covered:** 2.11-fix, 2.12-fix, 3.1, 3.2, 3.4 (5 steps; 3.3 deferred).
**SHA range:** 78b7d9071 .. 697550a55 (HEAD: 527727c09 after PLAN amends)

## Touched packages

- `@open-mercato/core` — `modules/reports/lib/aggregator.ts`, `modules/reports/data/validators.ts`, `modules/reports/data/entities.ts`, `modules/reports/commands/folder.ts`, `modules/reports/backend/page.tsx`, `modules/reports/backend/reports/new/page.tsx`, `__tests__/aggregator.test.ts`, `__tests__/validators.test.ts`.
- `@open-mercato/ui` — `backend/charts/AreaChart.tsx`, `backend/charts/DonutChart.tsx`, `backend/charts/ScatterChart.tsx`, `backend/charts/ComboChart.tsx`, `backend/charts/index.ts`.
- Run folder — `PLAN.md`, `HANDOFF.md`, `NOTIFY.md`.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✓ | 14s, no errors. Registries refreshed after chart wrapper additions. |
| `npx tsc -p packages/core/tsconfig.json --noEmit` (filtered to `modules/reports`) | ✓ | 0 errors. |
| `npx tsc -p packages/ui/tsconfig.json --noEmit` | ✓ | 0 errors. |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | 172/172 passing (was 125 before this resume; +25 aggregator + +17 grouped/pivot/chart/summary validators + 5 existing untouched). |
| i18n sync | skipped | No translation strings added in this window. |
| Integration tests | skipped | Step 3.3 (builder UI) was deferred; the touched UI (chart wrappers + URL fix) is not yet exercised by any `.ai/qa/tests/` scenario. The user verified the URL fix manually in their dev server. The detail-page spinner is a known issue tracked in HANDOFF; Step 3.3 will rewrite that page. |

## Artifacts

None this checkpoint — see HANDOFF for the deferred items.

## Step-by-step

- **2.11-fix (78b7d9071)** — Replaced 7 wrong `/backend/reports/reports/*` URLs in `backend/page.tsx` (6 sites: row link, New-report button, row click, row actions) and `backend/reports/new/page.tsx` (1 site: post-create redirect). Auto-discovery resolves `backend/<path>.tsx` → `/backend/<path>` so the duplicate `reports/` prefix in the file path was already collapsed; the UI was linking to the file path instead of the route. **User-verified in dev server: New Report now reaches the create form.**
- **2.12-fix (7f7b8aa30)** — MikroORM v7 compat after main merge: decorators imported from `@mikro-orm/decorators/legacy` per the core convention (other modules already do this); `commands/folder.ts` replaces deprecated `em.removeAndFlush(share)` with `em.remove(share).flush()`.
- **3.1 (8005f6ed6)** — `lib/aggregator.ts` ships `aggregateGroupBy`, `aggregateSummary`, `aggregatePivot`, `pivotToWideRows`, plus exported helpers `readFieldValue`, `measureAlias`, `hashKey`, `pivotCellKey`. Six aggregations: `count` / `count_distinct` / `sum` / `avg` / `min` / `max`. Numeric strings are accepted; non-numeric strings ignored. Group-by preserves first-seen order. Dotted field paths (`customer.country`, `order.total`) supported. 25 unit tests.
- **3.2 (5110a7bf2)** — Replaced placeholder schemas in `data/validators.ts` with strict `discriminatedUnion` variants for `grouped`, `pivot`, `chart`, `summary`. Exported `measureExprSchema`, `MeasureExprInput`, `chartSpecSchema`, `ChartSpecInput`. Cross-field constraints: pivot rows/cols cannot overlap; chart xField must be in declared groupBy; chart yFields must match a declared measure alias; pie/donut/scatter enforce exactly one yField; duplicate measure aliases rejected. 17 new tests.
- **3.4 (697550a55)** — Added platform-level chart wrappers under `@open-mercato/ui/backend/charts/`: `AreaChart` (gradient-filled, stack-aware), `DonutChart` (thin `<PieChart variant="donut">` wrapper for 1:1 chart-type ↔ component mapping), `ScatterChart` (x/y with optional z-axis bubble size), `ComboChart` (`ComposedChart` with mixed bar/line/area series per item). `index.ts` exports them all. They follow the BarChart/LineChart/PieChart pattern (typed props over Recharts ^3.8.1, shared `Spinner`/`ChartTooltipContent`/`resolveChartColor`, loading/error/empty states). Used downstream by Step 3.5 `<ReportChart>`.

## Deferred / not done this resume

- **3.3 — Builder canvas UI (drag-and-drop, type switcher).** Skipped on purpose: large UI scope (~800-1000 LOC + @dnd-kit drop zones + per-type editor + filter/parameter editors). Tackling it next reopens the detail-page surface that is currently stuck on the load spinner. Step 3.3 will replace that page entirely, so the spinner bug becomes moot at the same time.
- **Spinner bug on `/backend/reports/<id>`** (reported by user). Investigation paused per user direction "skip diagnosis and continue with the implementation". Likely candidate: `useEffect` in `backend/reports/[id]/page.tsx` keeps re-firing because `t` from `useT()` may not be perfectly stable in the running app, causing a cancel-storm that prevents `isLoading` from ever reaching `false`. Provisional fix when we get back to it: drop `t` from the effect deps and resolve translation strings via a ref. Step 3.3 will probably make the bug disappear by rewriting the page.
