# Checkpoint 6 — Steps 3.3a .. 3.3d verified (builder polish complete)

**Resume window:** 2026-05-15 21:30 .. 22:25 UTC (this session, continuing from earlier resumes)
**Steps covered:** 3.3a (bc40a0bb4), 3.5 (bd0838eef), 3.5b (400bf8a79), 3.3b (525857ed4), 3.3c (d455525f6), 3.3d (f47082520).
**SHA range:** bc40a0bb4 .. f47082520 (HEAD on this commit will be `docs(runs): checkpoint 6 …`).
**Note:** 3.4 ships chart wrappers in `@open-mercato/ui`; everything else in this checkpoint window touches `@open-mercato/core/reports`.

## Touched packages
- `@open-mercato/core` — reports module: `backend/reports/[id]/page.tsx`, `lib/aggregator.ts`, `lib/chart-spec.ts`, `lib/execute.ts`, `lib/field-redact.ts`, `data/validators.ts`, `widgets/ReportChart.tsx`, `api/reports/[id]/run/route.ts`, `__tests__/{aggregator,validators,execute,chart-spec,field-redact}.test.ts`, i18n bundles.
- `@open-mercato/shared` — `modules/reports/dsl.ts` (ChartSpec reconciliation in 3.5b).

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✓ | 13.6s, no errors. |
| `npx tsc -p packages/core/tsconfig.json --noEmit` (filtered to `modules/reports`) | ✓ | 0 errors. |
| `yarn jest --testPathPatterns='modules/reports'` | ✓ | **195/195** passing across 11 suites. |
| `yarn i18n:check` | ✓ | sync clean across en/pl/de/es; usage check returns the preexisting branch-wide "3606 unused keys (advisory)" count — nothing new from this window. |
| Integration tests | skipped | No reports `.ai/qa/tests/` scenario yet — recommended as part of 5.6 (Playwright e2e). The user verified URL-fix manually after 2.11-fix; subsequent steps are unit-tested only. UI checks MUST NEVER block development per skill rule. |
| Playwright screenshots | skipped | Same reason — no MCP Playwright tool available in this environment; the user can verify manually in their running dev server. |

## Per-step summary

- **3.3a (bc40a0bb4)** — type-aware builder rewrite. Spinner bug fix (drop `t` from load `useEffect` deps; access translations via a ref). Per-type zones (click-to-add).
- **3.5 (bd0838eef)** — `lib/chart-spec.ts` projection helpers + `widgets/ReportChart.tsx` adapter (switches on `spec.type` and renders BarChart / LineChart / AreaChart / PieChart / DonutChart / ScatterChart / ComboChart). Wired into preview for `definition.type === 'chart'`. +17 unit tests.
- **3.5b (400bf8a79)** — `executeReport` dispatcher routes all five types through the aggregator; run route loses 501 fallback. DSL `ChartSpec` reconciled to the validator shape `{ xField, yFields }` (was the stale Step-1.1 `{ dimension, series[] }`). +6 executor tests.
- **3.3b (525857ed4)** — `@dnd-kit` integration: FieldList items `useDraggable`, zones `useDroppable`, central `addFieldToZone` helper. Click-to-add preserved; drag is the alternative.
- **3.3c (d455525f6)** — FiltersSection with literal + date_range filter editors, per-field-kind op set, typed value inputs (number/date/boolean/list/text). FilterShape is now a discriminated union.
- **3.3d (f47082520)** — ParametersSection: declare named parameters with typed default-value inputs, required toggle, fk dataset id, enum options list, key validation (pattern + duplicates).

## Artifacts
None — checkpoint is unit-tests + typecheck + i18n only.

## Definition of "Done" for the builder polish trio
- Browser smoke (manual, user verifies): open `/backend/reports/<id>`, drag a field into GroupBy, drop. Drag should add the field. Click-to-add still works.
- Add a filter on the Customers People dataset (e.g. `kind eq person`). Save. Run. Expect filtered rows.
- Declare a parameter `companyId` of kind `fk` with relatedDatasetId `customers.entities`. Save. (Bridging into filters lands in a follow-up step.)
