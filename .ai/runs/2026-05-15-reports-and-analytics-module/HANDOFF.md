# Handoff — 2026-05-15-reports-and-analytics-module

**Last updated:** 2026-05-15T22:55:00Z
**Branch:** feat/reports-and-analytics-module
**PR:** not yet opened (gh CLI unavailable; user opens manually after pushing the branch)
**Current phase/step:** Phase 3 — all eleven primary steps complete (3.1–3.11). Deferred small items: 3.6b XLSX, 3.7b dashboards UI, 3.9b embeds admin page. Phase 4 next.
**Last commit:** 5cc28de8f — `feat(core/reports): record-embed-host widget (3.11)`; the checkpoint 7 commit follows in this push.
**Final status this resume:** in-progress — embed pipeline lives end-to-end. Phase 4 (schedules + async + notifications) and the deferred UI/UX items are still ahead.

## What just happened (this session)

This session shipped **16 code Steps** across Phase 2 review-fix work and the entire Phase 3 happy path. Reports unit tests grew from 125 → 209 across 12 suites.

Steps in this final stretch (since checkpoint 6):

| Step | Commit | What |
|------|--------|------|
| 3.6a | ac4606075 | Export route (CSV / JSON / XML / Markdown) + `lib/export.ts` + Export dropdown in the builder header |
| 3.7 | c92c1699a | `ReportDashboard` entity + migration + validators + commands + CRUD route |
| 3.8 | e4ae57186 | `api/dashboards/[id]/run` parallel tile execution |
| 3.9 | 5ac77f4af | `ReportEmbed` entity + migration + validators + commands + CRUD route |
| 3.10 | 369ddf0ef | `detail:customers.{person,company}:after-header` injection spots |
| 3.11 | 5cc28de8f | `record-embed-host` widget — closes the embed pipeline end-to-end |

End-to-end the module now supports:

1. **Reports** — list at `/backend/reports`, create at `/backend/reports/new`, builder + run + export at `/backend/reports/<id>` (all five types).
2. **Dashboards** — backend complete (entity, CRUD, parallel run). UI not built yet (3.7b).
3. **Embeds** — backend complete (entity, CRUD, render endpoint). Admin UI not built yet (3.9b). Widget host already renders configured embeds on the two customers detail pages.

## Next concrete action

Three sensible next moves — pick whichever fits the session:

- **Step 3.7b — Dashboards UI** (list / new / composer with `@dnd-kit/sortable` tile grid). Big UI step (~800–1000 LOC). Closes the dashboards story for end users; without it operators have to use the API to compose dashboards.
- **Step 3.9b — Embeds admin page** (`/backend/reports/embeds`). Smaller (~300 LOC). Lets admins attach reports/dashboards to host spots via UI instead of the API.
- **Phase 4 kick-off — `ReportSchedule` entity + workers + email pipeline**. Biggest scope; touches schedules, queue workers, notifications, and async dispatch all together.

Pick `3.7b` if you want to deliver a fully usable dashboard experience next; pick `3.9b` if you want admins to configure embeds without touching the API; pick `Phase 4` if you want to start the scheduling story.

The filters↔parameters bridge (literal filter → parameter filter dropdown) remains a small polish item worth picking up alongside any of the above.

## Phase 3 remaining items (deferred)
- 3.6b XLSX export (needs `exceljs` workspace dep)
- 3.7b Dashboards UI
- 3.9b Embeds admin page

## Phase 4 plan (when ready)
- 4.1 `ReportSchedule` entity + CRUD + commands
- 4.2 Workers: `reports-schedule-runner`, `reports-schedule-execute`, `reports-async-execute`, `reports-export-build`
- 4.3 `lib/email-attachments.ts` + `ScheduledReportEmail` React template
- 4.4 `notifications.ts` + `notifications.client.ts`
- 4.5 Async execute path → attachments + notifications
- 4.6 Schedule editor UI

## Phase 5 plan
- 5.1 Result cache (Redis) + tag-based invalidation
- 5.2 Query profile integration
- 5.3 `reports-executions-prune` retention worker
- 5.4 CLI commands
- 5.5 Docs
- 5.6 Playwright e2e

## Blockers / open questions
- `gh` CLI still unavailable. PR creation, label normalization, and `auto-review-pr` autofix pass remain user actions after pushing the branch.
- Remote push requires user credentials. Branch remains local.
- MikroORM snapshot for the reports module is still not committed (carry-over). Two new migrations landed in Phase 3 (`Migration20260516000001` for dashboards, `Migration20260516000002` for embeds) on top of the original `Migration20260515182452`. The user should run `yarn db:migrate` then `yarn db:generate` to refresh the snapshot.
- No Playwright e2e for the reports module yet (5.6).

## Environment caveats
- Dev runtime: yes, on this branch in the primary worktree.
- The embed pipeline, dashboards run route, and chart preview are unit-tested via the existing reports test suite (209/209) and typecheck — please verify in the running dev server before continuing.

## Worktree
- Path: `/Users/maciejsimm/Documents/Workspaces/Dainamite/open-mercato-core`
- Primary checkout — no isolated worktree (per recorded user preference).

## Resume instructions
Re-enter with `/auto-continue-pr-loop` and tell me which direction: `3.7b`, `3.9b`, `Phase 4`, or the filters↔parameters bridge. Default if you just say "continue": **Step 3.7b (dashboards UI)**.
