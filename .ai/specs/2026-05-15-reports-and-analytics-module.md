# Reports & Analytics Module

> **Status:** Drafted in full. Open Questions resolved 2026-05-15. Ready for implementation review.

## TLDR

**Key Points:**
- New `reports` OSS module (`packages/core/src/modules/reports/`) that lets end-users self-author reports and analytical dashboards over data living across every Open Mercato module — including custom entities and custom fields — without writing SQL.
- Read path goes through the existing query engine + `entity_indexes` doc store (already RBAC-aware, tenant-scoped, custom-field-aware). Cross-entity reach is expressed as **code-declared datasets** auto-discovered from each module's new `reports.ts` file; admin-registered Postgres views deferred to Phase 2; user-defined joins explicitly out of scope.
- Reports are typed (`flat_list`, `grouped`, `pivot`, `chart`, `summary`), parametrizable, schedulable to email, embeddable as widgets on record pages with context-bound parameters, and stored in folders with **private / public / folder-level ACL** sharing.

**Scope (MVP):**
- `Report` definitions + execution (flat list, grouped, pivot, chart) using shadcn/ui chart primitives over Recharts.
- `ReportFolder` hierarchy with private (per-user) and public (per-org) roots + folder-level shares.
- Parameters + 12 pre-defined date-range tokens.
- `ReportDashboard` analytical dashboards composing multiple report tiles with shared parameters and drill-through.
- Embed-as-widget on record pages (`crud-form:<entityId>:fields` and `detail:<entityId>:*` spots) with context parameter binding (e.g. `companyId` from the URL).
- Scheduled runs (weekly / monthly / cron) with CSV + Excel email delivery; PDF deferred to Phase 2.
- Custom fields and custom entities supported natively via existing indexer flattening (`cf:<key>` selectors).
- Standalone left-sidebar menu entries: **Reports**, **Dashboards**.
- **Per-field RBAC** with aggregate-safe enforcement (a hidden field cannot be summed, averaged, grouped, or pivoted on).

**Concerns (acknowledged, addressed in spec):**
- Naming collision with existing `dashboards` module → resolved: this module owns the new `reports_dashboards` table; existing `dashboard_*` tables remain untouched.
- Field-level RBAC must hold under aggregation → resolved: aggregate path executes only after field-ACL filtering and refuses measures over redacted fields with HTTP 403.
- Heavy pivot/group-by over `entity_indexes` → resolved: bounded in-memory aggregation (`OM_REPORTS_INMEMORY_CAP`, default 25 000 rows); over-cap auto-dispatches to async worker with notification on completion.
- New auto-discovery file `<module>/reports.ts` extends the **platform extensibility contract** (`BACKWARD_COMPATIBILITY.md`) → handled as additive-only with generator-level discovery, no FROZEN surface modified.

---

## Overview

The `reports` module turns Open Mercato into a self-serve analytical platform without exposing raw SQL. Module authors register **datasets** — curated, RBAC-aware projections over an indexed entity (and its pre-declared extension links and custom fields) — and end-users compose **reports** on top of those datasets in a drag-and-drop builder. Reports compose into **dashboards**, both are first-class navigable artifacts on the left sidebar, embeddable as widgets on record pages with context-bound parameters, and schedulable for email delivery. Reports inherit their access from their parent folder; folders are private (owner-only) or public (org-wide), with optional per-folder shares to specific users or roles.

> **Market Reference**: Studied **Metabase** (open-source, Apache 2.0), **Apache Superset** (Apache 2.0), **Grafana** (AGPLv3 — its dashboarding only), and **Looker LookML** (proprietary, conceptual study). Adopted:
> - Metabase's split between a curated **question** (saved query) and a **dashboard** (composition of cards) — matches our `report` / `report_dashboard` split.
> - Looker's "dataset-as-code" pattern (LookML) — adapted to `<module>/reports.ts` with TypeScript + zod. Code-defined datasets fit our extensibility model and let us enforce field ACL at compile time.
> - Superset's typed report-kind switch (table / pivot / chart) inside a single editor — adapted to a single `Report.type` discriminator with `definition_json` shape varying per type.
>
> Rejected:
> - Metabase's free-form SQL editor — collides with our RBAC and tenant-isolation guarantees; we keep raw SQL behind admin-defined Postgres views (Phase 2 only).
> - Superset's per-database connection model — Open Mercato has one logical data model per tenant; datasets are the dimensional facade.
> - Grafana's time-series-first model — we are tabular-first; charts are derivative views over tabular results, not the primary surface.

## Problem Statement

Operators and customer-facing teams routinely need answers that span entities (orders × customers × products, deals × people × activities, etc.) and that include custom fields and custom entities created per tenant. Today their only paths are:

1. Ask an engineer to write a SQL query, build a one-off page, or export to a spreadsheet.
2. Use the `perspectives` module, which saves DataTable column/filter/sort state per single table — no projection, no aggregation, no pivot, no chart, no sharing, no scheduling, no embedding.
3. Use the `dashboards` module, which is about which **dev-defined** widgets show on the user's home page — no user-authored content.

There is no in-product way to:

- Author a report against curated, RBAC-respecting data — including custom fields — without writing code.
- Save it, organize it in folders, share it with the team, schedule it as a weekly email.
- Compose it with other reports into a dashboard, parametrize that dashboard, and embed it onto a record page so it auto-filters by that record's ID.

This spec adds the missing self-serve analytical layer while reusing every existing primitive (query engine, indexer, query_index, custom fields, custom entities, command pattern, widget injection, notifications, queue, email).

## Proposed Solution

A new `reports` module composed of:

- A **dataset registry** auto-discovered from `<module>/reports.ts` files, declaring which fields of which indexed entities are reportable, with field-level ACL.
- A **report definition** stored in the `reports` table, holding the user's choices (dataset, fields, filters, group-by, pivot, chart, parameters, limit).
- A **report execution engine** that translates a definition into one or more query-engine calls, applies field redaction, performs in-memory group-by / pivot / aggregation, and returns rows + totals + chart-ready data.
- **Folders** with `private` / `public` kinds and optional `reports_folder_shares` granting additional users or roles `view` or `edit` permission. Reports and dashboards inherit folder permissions.
- **Dashboards** as compositions of multiple report tiles laid out on a grid, with **shared dashboard-level parameters** that propagate to all tiles.
- **Embed widgets** registered in a tenant-scoped `reports_embeds` table, rendered through the existing widget injection runtime on `crud-form:<entityId>:fields` and `detail:<entityId>:*` spots, with parameters bound from the host record.
- **Scheduled runs** stored in `reports_schedules`, fired by a periodic queue worker, executing the report, building CSV + Excel attachments, and emailing through the existing notifications module.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Datasets declared in code (`<module>/reports.ts`), not by end-users | Performance, RBAC, and security cannot be re-validated per-user-query; curated datasets let dataset authors lock down what's reportable and how. |
| Read exclusively via `QueryEngine` over `entity_indexes` | Already enforces tenant + org scope, user features, custom fields, decryption-awareness. Reinventing means re-implementing the security boundary. |
| Aggregation in-memory for MVP (cap 25k rows) | The query engine has no native GROUP BY today; building a SQL-side aggregator on `entity_indexes.doc` requires Postgres JSONB aggregation paths that need careful index work. Phase 2 extends `QueryEngine` with `aggregate: { groupBy, measures }`. |
| Embed config in `reports_embeds` table, not in widget injection-table | Widget `injection-table.ts` is **code-declared per module**; admins need to attach reports to record pages **per tenant** without code changes. A separate runtime table that the host widget queries is the correct mechanism. |
| Per-field ACL declared in dataset, enforced at three points: builder load, query execution, aggregation | Aggregate-only enforcement is insufficient (a SUM leaks per-row information indirectly); single-point enforcement risks bypass via direct definition editing. |
| `reports_dashboards` sibling of `dashboard_*` tables | Existing `dashboards` module owns home-page widget layout; conflating it with analytical dashboards mixes concerns and increases BC risk on home dashboards used by every install. |
| Folder-level ACL only in MVP (no per-report shares) | Matches the user's stated mental model ("private folder + public folder"); per-report sharing can be added in Phase 2 without breaking the model (folders remain the primary unit). |
| Single `Report.type` discriminator with `definition_json` shape varying by type | Avoids polymorphic tables; zod discriminated union validates per-type definition shape. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Free-form SQL editor for power users | Breaks RBAC (row-level), breaks tenant isolation guarantees, breaks the encryption contract (decryption is keyed by `findWithDecryption`, not arbitrary SQL). |
| Arbitrary user-defined joins in the builder | Combinatorial RBAC explosion; no way to guarantee performance or field-level ACL across user-picked joins. |
| Materialised views for all reports | Premature optimisation; most reports are run a handful of times. Materialisation deferred to Phase 2 as an opt-in per-report toggle. |
| Reuse `perspectives` module by extending its schema | `Perspective.settingsJson` is opaque DataTable state — not a query model. Extending it would couple analytical reports to the DataTable widget. |
| Extending `dashboards` module to host analytical dashboards | Mixes "which widgets show on home" with "user-authored analytical canvas"; doubles the BC surface on a module that's already in production. |
| User-authored datasets via UI | Would need to be a SQL view builder in disguise; runs into the same RBAC/perf problems as free-form SQL. |
| Storing dashboard tiles as full `report` rows (snapshots) | Loses live updates; if the underlying report changes, the tile would silently diverge. We store a `reportId` reference + per-tile parameter overrides instead. |

## User Stories / Use Cases

- **Sales manager** wants to **build a "Top 10 customers this quarter" report from the orders dataset, filtered by status = paid and grouped by customer**, so that **they can pin it to the home dashboard and email it weekly to the leadership team**.
- **Tenant admin** wants to **embed a "Recent activities" dashboard on each customer detail page parametrized by `companyId`** so that **every account manager sees that company's last 30 days of activity inline without leaving the record**.
- **Operations user** wants to **create a private report comparing inventory levels across warehouses including their tenant-specific custom field `reorder_threshold`** so that **they can save it in their private folder and re-run it on demand**.
- **HR power user** wants to **share an "Onboarding completion" report folder with the HR role** so that **all HR team members see the same folder of reports without per-report sharing**.
- **Marketing analyst** wants to **build a pivot table of campaigns × week with conversion rate in cells** so that **they can visualise YoY trends and export to Excel**.
- **Account manager** wants to **drill from a dashboard tile (top customers) into the underlying flat list** so that **they can investigate individual records without rebuilding the query**.
- **Compliance officer** wants to **guarantee that users without `customers.view_pii` cannot see `email`/`phone` columns even in aggregate results** so that **PII is not exfiltrated through SUM/COUNT side-channels**.

---

## Architecture

### High-level read path

```
┌──────────────────────────────────────────────────────────────────────────┐
│  REPORTS MODULE — read path                                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Builder UI ─┐                                                          │
│   Run UI    ─┼─► Report definition (zod, persisted in `reports`)         │
│   Schedule  ─┘    { dataset_id, type, fields[], filters[],               │
│                     groupBy[], pivot{...}, chart{...},                   │
│                     sort[], parameters[], limit }                        │
│                              │                                           │
│                              ▼                                           │
│            ┌─────────────────────────────────────────┐                   │
│            │ Execution Engine                        │                   │
│            │  reports/lib/execute.ts                 │                   │
│            │  1. Resolve dataset by id               │                   │
│            │  2. RBAC: requiredFeatures gate         │                   │
│            │  3. Resolve parameters (URL/record ctx, │                   │
│            │     date-range token resolution)        │                   │
│            │  4. Field-ACL projection (redact)       │                   │
│            │  5. Translate def → QueryEngine.query() │                   │
│            │     (primary entity)                    │                   │
│            │  6. Batch-fetch joined datasets         │                   │
│            │     (dataset.joins[*])                  │                   │
│            │  7. Merge joined rows in-memory         │                   │
│            │  8. Aggregate (group/pivot) in-memory   │                   │
│            │     OR enqueue worker if > inMemoryCap  │                   │
│            │  9. Apply final sort + limit            │                   │
│            │ 10. Cache by {reportId, paramsHash}     │                   │
│            └─────────────────────────────────────────┘                   │
│                              │                                           │
│                              ▼                                           │
│             ┌──────────────────────────────────────┐                     │
│             │ Existing Query Engine                │                     │
│             │  - Reads `entity_indexes.doc`        │                     │
│             │  - Tenant + org scoping (mandatory)  │                     │
│             │  - User-feature row filtering        │                     │
│             │  - Custom-field selectors `cf:<key>` │                     │
│             │  - Decryption-aware                  │                     │
│             └──────────────────────────────────────┘                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Dataset registry — new auto-discovery file `<module>/reports.ts`

Each module that wants to expose data to the reports builder declares one or more datasets. The generator picks this up alongside `events.ts`, `acl.ts`, `ce.ts` etc.

```ts
// packages/core/src/modules/sales/reports.ts
import { defineDataset } from '@open-mercato/shared/modules/reports/dsl'
import { E } from '@/generated/entities.ids.generated'

export const datasets = [
  defineDataset({
    id: 'sales.orders',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.orders.label',
    descriptionKey: 'sales.reports.datasets.orders.description',
    entityType: E.sales.order,                       // must be indexed
    requiredFeatures: ['sales.view'],                // dataset ACL gate
    fields: [
      { key: 'id',          labelKey: 'sales.fields.id',          kind: 'id' },
      { key: 'created_at',  labelKey: 'sales.fields.created_at',  kind: 'datetime', aggregations: ['min', 'max', 'count'] },
      { key: 'total',       labelKey: 'sales.fields.total',       kind: 'money',    aggregations: ['sum', 'avg', 'min', 'max', 'count'] },
      { key: 'status',      labelKey: 'sales.fields.status',      kind: 'enum',     dictionary: 'sales.order_status' },
      { key: 'customer_id', labelKey: 'sales.fields.customer_id', kind: 'fk',       joinTo: 'customers.people' },
      { key: 'cf:vip',      labelKey: 'sales.fields.cf_vip',      kind: 'custom_field', customField: { entityId: E.sales.order, key: 'vip', valueKind: 'boolean' } },
    ],
    joins: [
      { id: 'customer', dataset: 'customers.people', on: { local: 'customer_id', remote: 'id' }, cardinality: 'many-to-one' },
    ],
    fieldAcl: {
      'customer.email': ['customers.view_pii'],
      'customer.phone': ['customers.view_pii'],
    },
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
  }),
]
```

**Generator wiring**: `yarn generate` walks every module, collects `datasets[]`, and emits `apps/mercato/.mercato/generated/reports-datasets.generated.ts`. The reports module's runtime registry reads this generated file (never imported from packages).

**Custom-entity datasets**: emitted **automatically** from `ce.ts` declarations so any user-defined custom entity is reportable with zero additional code. The generator synthesises a dataset id `<module>.<customEntity>` with the entity's declared custom-field keys as fields. ACL inherits from the custom entity's `requiredFeatures` (declared in `ce.ts`).

### Field-level ACL — three enforcement points

1. **Builder load** (`GET /api/reports/datasets/[id]`): the runtime resolves the user's features and strips fields they cannot see from the response. Hidden fields never reach the React builder.
2. **Definition save** (`POST/PUT /api/reports/reports`): the validator rejects any definition that references a field the saving user cannot see. Direct database writes cannot bypass since we go through `makeCrudRoute` + command pattern.
3. **Execution** (`POST /api/reports/reports/[id]/run`): the executor re-resolves field ACL at runtime against the **running** user (not the owner) and:
   - Refuses to project any redacted field from query output (response array filtered).
   - Refuses to aggregate over a redacted field: if `pivot.value.field` or any `groupBy` reference is redacted, the request returns `403 Forbidden` with a structured error (no partial results).
   - Refuses to filter on a redacted field (would be an oracle attack).

This three-point enforcement is non-negotiable and lives in `reports/lib/field-redact.ts`. Tests in `__tests__/field-redact.test.ts` cover each bypass attempt.

### Aggregation strategy

| Path | When | How |
|------|------|-----|
| **Sync in-memory** | Default. Estimated row count ≤ `OM_REPORTS_INMEMORY_CAP` (default 25 000). | Fetch rows via `QueryEngine.query()` paginated until cap, run group-by/pivot/aggregation in JS in the request thread, return immediately. |
| **Async worker** | Row count exceeds cap, or `definition_json.executionMode === 'async'`. | Enqueue `reports-async-execute` worker job; return `202 Accepted` with `progressJobId`; UI shows `ProgressTopBar`; on completion the result is stored under `reports_executions.result_blob_id` and the user is notified via in-app notification (`reports.execution_ready`). |
| **Phase 2 — Postgres-side aggregation** | Out of MVP. | Extend `QueryEngine` types with `aggregate: { groupBy: string[], measures: AggregationMeasure[] }`. Implement via JSONB aggregation over `entity_indexes.doc`. Specced separately. |
| **Phase 2 — Materialisation** | Out of MVP. Opt-in per report. | Periodic worker materialises result into `reports_materializations` keyed by `(reportId, paramsHash)`; reads serve from materialised blob until invalidated. |

Row-count estimation uses `QueryEngine.query({ ...filters, pageSize: 1 })` and inspects `total` from the result meta (already returned). If `total` is unavailable, we fall back to a one-page probe + threshold heuristic.

### RBAC model (three layers)

| Layer | Mechanism | Where enforced |
|-------|-----------|----------------|
| **Tenant + Org scope** | Existing query engine auto-applies `tenant_id` and `organization_id` guards. Reports never pass `omitAutomaticTenantOrgScope`. | `QueryEngine` itself. |
| **Row-level RBAC** | Query engine's `userFeatures` parameter applies feature-based row filters declared by each module's indexer. | `QueryEngine` itself. |
| **Field-level RBAC** | Dataset-declared `fieldAcl` enforced at builder load, definition save, and execution (including aggregates). | `reports/lib/field-redact.ts` + `lib/execute.ts`. |
| **Artifact RBAC** | Reports and dashboards inherit access from their parent folder (`private` vs `public` vs folder-share grants). Owners always have full edit access. Module-level features: `reports.view`, `reports.author`, `reports.share`, `reports.schedule`, `reports.admin`. | `reports/lib/folder-acl.ts` + per-route `requireFeatures` guards. |

### Folder ACL model

```
reports_folders
  kind: 'private' | 'public'
  owner_user_id NULL for public roots; required for private folders

Visibility rules:
  - kind='private' & owner_user_id=X → visible only to X (plus admins)
  - kind='public'                    → visible to anyone with reports.view
  - reports_folder_shares grants     → visible to listed principals as additional users
                                       (a private folder shared with role 'sales' is visible to all sales-role users)

Edit rules:
  - Owner of a private folder        → edit
  - Anyone with reports.admin        → edit (god mode)
  - reports_folder_shares permission='edit' → edit
  - Public root folder is system-managed; only admins create top-level subfolders
```

Reports and dashboards live in folders. Their visibility = parent folder visibility. Their edit = parent folder edit OR `owner_user_id === currentUserId` (the author always retains edit on their own artifacts).

### Embed runtime

Two embed paths share one renderer:

1. **Configured embed** (admin-curated): `reports_embeds` rows stored per tenant; a per-tenant React widget (registered via `widgets/injection/`) queries `GET /api/reports/embeds?spot=<spotId>&hostEntityId=<id>` at render-time and lays out matching embed cards. Parameters resolve from the host record context (e.g. `companyId: record.id`).
2. **Dashboard tile** (user-curated): a tile inside a `report_dashboard` references a `reportId` and per-tile parameter overrides; the dashboard runner orchestrates parallel execution of all tiles and shares the dashboard-level parameters.

Both paths call `lib/execute.ts` with the resolved parameters. The same field-ACL enforcement applies; if the running user can't see a field the embed references, the tile renders an `<Alert variant="warning">` with a localised "Insufficient access" message instead of leaking partial data.

### Schedule + email pipeline

```
                  (queue cron tick — every 15 min)
                              │
                              ▼
            workers/reports-schedule-runner.ts
            SELECT * FROM reports_schedules
            WHERE enabled = true
              AND next_run_at <= now()
              AND deleted_at IS NULL
                              │
                              ▼  (one per due schedule)
            queue.enqueue('reports-schedule-execute',
                          { scheduleId, tenantId, organizationId })
                              │
                              ▼
            workers/reports-schedule-execute.ts
              1. Load schedule + report
              2. Resolve parameters (frozen params + re-evaluate date tokens)
              3. lib/execute.ts → result rows
              4. lib/export.ts  → CSV + XLSX buffers
              5. For each recipient:
                  sendEmail({ to, subject, react: ScheduledReportEmail(...), attachments })
              6. Insert reports_executions row (status='completed')
              7. UPDATE reports_schedules
                   SET last_run_at = now(), next_run_at = <next per cadence>
              8. emit('reports.schedule.delivered', { scheduleId, ... })
```

**Email primitive**: `sendEmail` from `@open-mercato/shared/lib/email/send`. Attachments use the underlying provider's attachment shape; we wrap with a thin helper `lib/email-attachments.ts` so providers without attachment support fall back to a "view in app + download link" pattern.

**Failure handling**: worker is idempotent on `scheduleId + paramsHash + runWindowStart`. Failed deliveries retry up to 3 times with exponential backoff. After 3 failures the row remains in `reports_executions` with `status='failed'` and an `error` payload; a notification fires to the schedule owner.

### Commands & Events

Every mutation goes through the command pattern (`packages/shared/src/lib/commands`):

| Command id | Input | Result | Undoable |
|-----------|-------|--------|----------|
| `reports.report.create` | `ReportCreateInput` | `{ reportId }` | Yes (recreate definition_json) |
| `reports.report.update` | `ReportUpdateInput` | `{ reportId }` | Yes (snapshot before/after) |
| `reports.report.delete` | `{ reportId }` | `{ reportId }` | Yes (soft delete; undo unsets deleted_at) |
| `reports.report.move` | `{ reportId, folderId }` | `{ reportId }` | Yes |
| `reports.folder.create` | `FolderCreateInput` | `{ folderId }` | Yes |
| `reports.folder.update` | `FolderUpdateInput` | `{ folderId }` | Yes |
| `reports.folder.delete` | `{ folderId }` | `{ folderId, movedItemCount }` | Yes (soft delete; moves children to trash bucket, restore reverses) |
| `reports.folder.share` | `{ folderId, principalType, principalId, permission }` | `{ shareId }` | Yes |
| `reports.dashboard.create` | `DashboardCreateInput` | `{ dashboardId }` | Yes |
| `reports.dashboard.update` | `DashboardUpdateInput` | `{ dashboardId }` | Yes |
| `reports.dashboard.delete` | `{ dashboardId }` | `{ dashboardId }` | Yes |
| `reports.schedule.create` | `ScheduleCreateInput` | `{ scheduleId }` | Yes |
| `reports.schedule.update` | `ScheduleUpdateInput` | `{ scheduleId }` | Yes |
| `reports.schedule.delete` | `{ scheduleId }` | `{ scheduleId }` | Yes |
| `reports.embed.create` | `EmbedCreateInput` | `{ embedId }` | Yes |
| `reports.embed.update` | `EmbedUpdateInput` | `{ embedId }` | Yes |
| `reports.embed.delete` | `{ embedId }` | `{ embedId }` | Yes |
| `reports.execution.run` | `RunInput` | `{ executionId, rows? OR progressJobId }` | No (read-only; logged but no state to undo) |

All write commands emit `emitCrudSideEffects` with `indexer: { entityType: 'reports:<entity>' }` so reports themselves are indexed and the platform's command-log + cache-invalidation contract holds.

Events declared in `reports/events.ts`:

```ts
const events = [
  { id: 'reports.report.created',          label: 'Report Created',     entity: 'report',    category: 'crud' },
  { id: 'reports.report.updated',          label: 'Report Updated',     entity: 'report',    category: 'crud' },
  { id: 'reports.report.deleted',          label: 'Report Deleted',     entity: 'report',    category: 'crud' },
  { id: 'reports.report.executed',         label: 'Report Executed',    entity: 'report',    category: 'lifecycle', clientBroadcast: true },
  { id: 'reports.dashboard.created',       label: 'Dashboard Created',  entity: 'dashboard', category: 'crud' },
  { id: 'reports.dashboard.updated',       label: 'Dashboard Updated',  entity: 'dashboard', category: 'crud' },
  { id: 'reports.dashboard.deleted',       label: 'Dashboard Deleted',  entity: 'dashboard', category: 'crud' },
  { id: 'reports.folder.created',          label: 'Folder Created',     entity: 'folder',    category: 'crud' },
  { id: 'reports.folder.updated',          label: 'Folder Updated',     entity: 'folder',    category: 'crud' },
  { id: 'reports.folder.deleted',          label: 'Folder Deleted',     entity: 'folder',    category: 'crud' },
  { id: 'reports.folder.shared',           label: 'Folder Shared',      entity: 'folder',    category: 'lifecycle' },
  { id: 'reports.schedule.created',        label: 'Schedule Created',   entity: 'schedule',  category: 'crud' },
  { id: 'reports.schedule.updated',        label: 'Schedule Updated',   entity: 'schedule',  category: 'crud' },
  { id: 'reports.schedule.deleted',        label: 'Schedule Deleted',   entity: 'schedule',  category: 'crud' },
  { id: 'reports.schedule.delivered',      label: 'Schedule Delivered', entity: 'schedule',  category: 'lifecycle' },
  { id: 'reports.embed.created',           label: 'Embed Created',      entity: 'embed',     category: 'crud' },
  { id: 'reports.embed.updated',           label: 'Embed Updated',      entity: 'embed',     category: 'crud' },
  { id: 'reports.embed.deleted',           label: 'Embed Deleted',      entity: 'embed',     category: 'crud' },
] as const
```

### Module file structure

```
packages/core/src/modules/reports/
├── index.ts                        # metadata
├── acl.ts                          # features
├── setup.ts                        # defaultRoleFeatures + seedDefaults (private/public roots)
├── events.ts                       # see above
├── translations.ts                 # translatable fields (report.name, report.description, folder.name, ...)
├── reports.ts                      # this module's own datasets (`reports.reports` for meta-reporting, optional)
├── encryption.ts                   # encryption map for free-text fields
├── ce.ts                           # custom-field surface for reports themselves
├── notifications.ts                # notification types: execution_ready, schedule_delivered, export_ready
├── notifications.client.ts         # client-side renderers
├── data/
│   ├── entities.ts                 # ORM entities (7 tables)
│   ├── validators.ts               # zod schemas
│   ├── extensions.ts               # FK-id links (schedule→report, share→folder, embed→report|dashboard)
│   └── enrichers.ts                # (none in MVP)
├── commands/
│   ├── report.ts                   # create/update/delete/move/run
│   ├── folder.ts                   # create/update/delete/share
│   ├── dashboard.ts                # create/update/delete
│   ├── schedule.ts                 # create/update/delete
│   ├── embed.ts                    # create/update/delete
│   └── execution.ts                # run (sync) / dispatch (async)
├── lib/
│   ├── datasets-registry.ts        # runtime view over generated registry
│   ├── execute.ts                  # the read-path orchestrator
│   ├── query-translator.ts         # report definition → QueryEngine call
│   ├── aggregator.ts               # in-memory group-by + pivot + measures
│   ├── parameters.ts               # parameter typing + URL/record-context binding
│   ├── date-ranges.ts              # 12 pre-defined tokens + custom
│   ├── field-redact.ts             # fieldAcl enforcement (3 points)
│   ├── folder-acl.ts               # folder/share resolution
│   ├── export.ts                   # CSV + XLSX writers
│   ├── embed.ts                    # embed config resolution at host render time
│   ├── email-attachments.ts        # provider-aware attachment shim
│   └── chart-spec.ts               # shadcn chart config builder
├── api/
│   ├── openapi.ts                  # createCrudOpenApiFactory wrapper
│   ├── reports/route.ts            # makeCrudRoute (list/get/create/update/delete)
│   ├── reports/[id]/run/route.ts   # POST execute (sync or async)
│   ├── reports/[id]/export/route.ts # GET CSV / XLSX
│   ├── folders/route.ts            # makeCrudRoute
│   ├── folder-shares/route.ts      # makeCrudRoute
│   ├── dashboards/route.ts         # makeCrudRoute
│   ├── dashboards/[id]/run/route.ts # POST execute all tiles
│   ├── schedules/route.ts          # makeCrudRoute
│   ├── embeds/route.ts             # makeCrudRoute
│   ├── datasets/route.ts           # GET list visible datasets
│   ├── datasets/[id]/route.ts      # GET dataset detail (fields filtered by user ACL)
│   └── interceptors.ts             # narrow lists by ids (per platform contract)
├── backend/
│   ├── page.tsx                    # /backend/reports — folder navigator + list
│   ├── reports/
│   │   ├── new/page.tsx            # builder
│   │   └── [id]/page.tsx           # builder + run/preview
│   ├── dashboards/
│   │   ├── page.tsx                # dashboards list
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx           # dashboard editor + run
│   ├── schedules/page.tsx          # all schedules across user's reports
│   └── embeds/page.tsx             # admin: configure record-page embeds
├── frontend/                       # (none in MVP; no portal pages)
├── widgets/
│   ├── injection-table.ts          # maps widgets to spots
│   ├── injection/
│   │   ├── reports-menu-item.ts    # main sidebar entry
│   │   ├── dashboards-menu-item.ts # main sidebar entry
│   │   ├── reports-settings-menu.ts # settings sidebar entry (admin: embeds, datasets viewer)
│   │   ├── record-embed-host/      # the widget that queries reports_embeds for `crud-form:*` and `detail:*` spots
│   │   └── notifications/          # render notifications for execution_ready, schedule_delivered
│   └── components.ts               # (none in MVP)
├── subscribers/
│   ├── reports-execution-progress.ts # bridges execution events to DOM event bus when clientBroadcast
│   └── reports-folder-deleted-cascade-cleanup.ts # cleans schedules + embeds for soft-deleted folders' reports
└── workers/
    ├── reports-schedule-runner.ts   # cron tick
    ├── reports-schedule-execute.ts  # actual run + email
    ├── reports-async-execute.ts     # async heavy-report execution
    └── reports-export-build.ts      # async CSV/XLSX build for large downloads
```

---

## Data Models

All tables include `id` (uuid PK), `organization_id` (uuid, FK, NOT NULL), `tenant_id` (uuid, FK, NOT NULL), `created_at`, `updated_at`, `deleted_at` (nullable timestamptz) unless noted.

Naming: tables are `reports_*` (plural-snake_case), columns are `snake_case`, code identifiers are camelCase. Module id is `reports`. Entity ids are singular (`reports:report`, `reports:folder`, `reports:dashboard`, `reports:schedule`, `reports:embed`, `reports:execution`, `reports:folder_share`).

### `reports_reports` — Report

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `folder_id` | uuid FK → `reports_folders` | required (every report lives in a folder; root folders are system-seeded) |
| `owner_user_id` | uuid FK → `users` | required; the original author; never null |
| `name` | text | required; translatable |
| `description` | text | nullable; translatable |
| `type` | text | required; enum `flat_list` \| `grouped` \| `pivot` \| `chart` \| `summary` |
| `dataset_id` | text | required; references generated dataset registry entry |
| `definition_json` | jsonb | required; zod-validated per type (see below) |
| `parameters_json` | jsonb | default `[]`; `ParameterDef[]` |
| `version` | int | default 1; incremented on every update for optimistic locking |
| `last_executed_at` | timestamptz | nullable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard |

`UNIQUE (tenant_id, organization_id, folder_id, name) WHERE deleted_at IS NULL` — no two reports with the same name in the same folder.

`definition_json` is a discriminated union by `type`:

```ts
type ReportDefinition =
  | { type: 'flat_list'; fields: string[];    filters: FilterExpr[]; sort: Sort[]; limit?: number }
  | { type: 'grouped';   fields: string[];    groupBy: string[]; measures: MeasureExpr[]; filters: FilterExpr[]; sort: Sort[]; limit?: number }
  | { type: 'pivot';     rows: string[];      cols: string[]; value: MeasureExpr; filters: FilterExpr[] }
  | { type: 'chart';     chart: ChartSpec;    filters: FilterExpr[]; groupBy?: string[]; measures?: MeasureExpr[] }
  | { type: 'summary';   measures: MeasureExpr[]; filters: FilterExpr[] }
```

### `reports_folders` — ReportFolder

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `parent_folder_id` | uuid FK → `reports_folders` | nullable (NULL = root) |
| `owner_user_id` | uuid FK → `users` | nullable; required when `kind='private'`, NULL when `kind='public'` |
| `kind` | text | required; enum `private` \| `public` |
| `name` | text | required; translatable |
| `position` | int | default 0; for stable sibling ordering |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard |

Seed (per tenant, in `setup.ts seedDefaults`):
- One `kind='public'` root folder named "Public" with `parent_folder_id IS NULL`.
- Per-user `kind='private'` root folder named "My Reports" is created lazily on first access (in API handler when listing folders).

`CHECK (kind = 'public' AND owner_user_id IS NULL) OR (kind = 'private' AND owner_user_id IS NOT NULL)`.

### `reports_folder_shares` — FolderShare

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `folder_id` | uuid FK → `reports_folders` | required |
| `principal_type` | text | required; enum `user` \| `role` |
| `principal_id` | uuid | required |
| `permission` | text | required; enum `view` \| `edit` |
| `granted_by_user_id` | uuid FK → `users` | required (audit) |
| `created_at`, `updated_at` | timestamptz | standard (no soft delete; shares are hard-deleted) |

`UNIQUE (folder_id, principal_type, principal_id)`.

Note: sharing a `public` folder is meaningless (public is already org-wide); shares only apply to `private` folders. Validator rejects shares on public folders.

### `reports_dashboards` — ReportDashboard

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `folder_id` | uuid FK → `reports_folders` | required |
| `owner_user_id` | uuid FK → `users` | required |
| `name` | text | required; translatable |
| `description` | text | nullable; translatable |
| `layout_json` | jsonb | required; `DashboardLayout` (tiles + grid) |
| `parameters_json` | jsonb | default `[]`; `ParameterDef[]` for the dashboard |
| `version` | int | default 1 |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard |

`UNIQUE (tenant_id, organization_id, folder_id, name) WHERE deleted_at IS NULL`.

`layout_json`:

```ts
type DashboardLayout = {
  grid: { cols: number; rowHeight: number; gap: number }  // default { cols: 12, rowHeight: 80, gap: 8 }
  tiles: DashboardTile[]
}
type DashboardTile = {
  id: string
  reportId: string
  x: number; y: number; w: number; h: number  // grid units
  mode: 'inline' | 'summary' | 'chart-only'
  paramBindings?: Record<string, ParameterBinding>  // per-tile overrides on top of dashboard params
  title?: string
  showFooter?: boolean
}
```

### `reports_schedules` — ReportSchedule

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `report_id` | uuid FK → `reports_reports` | required |
| `name` | text | required; translatable |
| `cadence` | text | required; format `'weekly:mon@09:00'` \| `'monthly:1@09:00'` \| `'cron:<expr>'` |
| `timezone` | text | required; e.g. `'Europe/Warsaw'`; defaults to tenant's locale tz |
| `recipients_json` | jsonb | required; `Recipient[] = ({ type: 'user', userId } \| { type: 'role', roleId } \| { type: 'email', email: string })[]` |
| `params_json` | jsonb | default `{}`; resolved parameter values (date tokens stored as tokens, evaluated per-run) |
| `formats_json` | jsonb | default `["csv","xlsx"]`; subset of `['csv','xlsx']` in MVP |
| `enabled` | boolean | default true |
| `last_run_at` | timestamptz | nullable |
| `next_run_at` | timestamptz | indexed; computed from cadence at create/update |
| `failure_count` | int | default 0; consecutive failures (resets on success) |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard |

Indexes: `(next_run_at, enabled) WHERE deleted_at IS NULL`, `(report_id)`.

### `reports_executions` — ReportExecution

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `report_id` | uuid FK → `reports_reports` | required |
| `schedule_id` | uuid FK → `reports_schedules` | nullable; NULL for ad-hoc runs |
| `requested_by_user_id` | uuid FK → `users` | required for ad-hoc; NULL for scheduled (system) |
| `params_hash` | text | sha-256 of resolved parameter values |
| `status` | text | enum `running` \| `completed` \| `failed` \| `cancelled` |
| `started_at` | timestamptz | required |
| `completed_at` | timestamptz | nullable |
| `row_count` | int | nullable |
| `duration_ms` | int | nullable |
| `error_text` | text | nullable; truncated to 2 000 chars |
| `result_blob_id` | uuid | nullable; FK into the existing `attachments` module for async-generated artifacts |
| `created_at` | timestamptz | (no `updated_at`, no soft delete) |

Retention: a daily worker `reports-executions-prune` deletes rows older than `OM_REPORTS_EXECUTION_RETENTION_DAYS` (default 30).

### `reports_embeds` — ReportEmbed

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid FK | required |
| `tenant_id` | uuid FK | required |
| `host_spot_id` | text | required; e.g. `'crud-form:customers.person:fields'` |
| `host_entity_id` | text | required; e.g. `'customers.person'` |
| `artifact_type` | text | required; enum `report` \| `dashboard` |
| `artifact_id` | uuid | required; FK by `artifact_type` to `reports_reports` or `reports_dashboards` |
| `param_bindings_json` | jsonb | default `{}`; `Record<paramKey, { source: 'record-field', recordField: string } \| { source: 'literal', value: unknown }>` |
| `display_title` | text | nullable; overrides artifact name in the embed card; translatable |
| `position` | int | default 0; ordering when multiple embeds target the same spot |
| `enabled` | boolean | default true |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard |

Indexes: `(tenant_id, host_spot_id, host_entity_id) WHERE deleted_at IS NULL AND enabled = true`.

### Migrations

Generated by `yarn db:generate`. Seven new tables + indexes; no changes to any existing table. Migration is forward-only and additive. No backfill required (greenfield module). New tenants get root folders via `setup.ts seedDefaults`; existing tenants get root folders via the `setup-app sync` upgrade action.

### Encryption (`encryption.ts`)

Declared as `defaultEncryptionMaps: ModuleEncryptionMap[]` per `packages/shared/modules/encryption`. Reads through `findWithDecryption` / `findOneWithDecryption` (5-arg signature) wherever a command loads an entity directly; reads through the query engine inherit `entity_indexes` doc decryption-awareness already provided by the platform.

```ts
// packages/core/src/modules/reports/encryption.ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { E } from '@/generated/entities.ids.generated'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entity: E.reports.report,
    fields: [
      { field: 'name' },
      { field: 'description' },
      // definition_json and parameters_json: filter literals may contain PII; encrypted whole
      { field: 'definition_json' },
      { field: 'parameters_json' },
    ],
  },
  {
    entity: E.reports.folder,
    fields: [
      { field: 'name' },
    ],
  },
  {
    entity: E.reports.dashboard,
    fields: [
      { field: 'name' },
      { field: 'description' },
      { field: 'layout_json' },        // per-tile titles + param bindings may include PII
      { field: 'parameters_json' },
    ],
  },
  {
    entity: E.reports.schedule,
    fields: [
      { field: 'name' },
      { field: 'recipients_json' },    // contains email addresses + user/role ids
      { field: 'params_json' },
    ],
  },
  {
    entity: E.reports.execution,
    fields: [
      { field: 'error_text' },         // may leak query values from upstream errors
      // params_hash is sha-256 — not encrypted (used for cache lookups)
    ],
  },
  {
    entity: E.reports.embed,
    fields: [
      { field: 'display_title' },
      { field: 'param_bindings_json' },
    ],
  },
  // reports_folder_shares stores only principal ids — no PII; no encryption needed
]
```

**Read-path rules:**
- Commands that load a `Report` / `ReportDashboard` / `ReportSchedule` / `ReportEmbed` before mutating MUST use `findWithDecryption(em, EntityClass, where, undefined, { tenantId, organizationId })`.
- The execution engine reads result rows through `QueryEngine` which is already decryption-aware (`entity_indexes.doc` payloads decrypted via `decryptIndexDocCustomFields` / `decryptIndexDocForSearch`).
- Async result blobs stored in `attachments` inherit the `attachments` module's encryption contract; no module-local encryption needed on `reports_executions.result_blob_id` (it is a uuid FK only).
- No hand-rolled crypto. No `crypto.subtle` calls. No `// TODO encrypt later` stubs.

---

## API Contracts

All routes export `openApi` for documentation generation. All CRUD routes use `makeCrudRoute` with `indexer: { entityType: '...' }`. All write routes flow through commands. All non-CRUD writes wrap mutations in `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess`. Routes export `metadata` with per-method `requireAuth` and `requireFeatures` (no top-level `export const requireAuth`).

### Common response shapes

```ts
type ReportListItem = {
  id: string
  name: string
  description: string | null
  type: ReportDefinition['type']
  datasetId: string
  folderId: string
  ownerUserId: string
  lastExecutedAt: string | null
  visibility: 'private' | 'public'
  permission: 'view' | 'edit'                  // computed for caller
  createdAt: string
  updatedAt: string
}
type ReportRunResponse =
  | { mode: 'sync';  executionId: string; rows: Record<string, unknown>[]; total: number; meta: { duration_ms: number; truncated: boolean } }
  | { mode: 'async'; executionId: string; progressJobId: string }
```

### Reports

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/reports` | List visible reports (folder + share aware) | `reports.view` | Filters: `folderId?`, `datasetId?`, `type?`, `q?`. Pagination `pageSize ≤ 100`. |
| `GET /api/reports/reports/[id]` | Get one report (rejects if user has no folder access) | `reports.view` | |
| `POST /api/reports/reports` | Create | `reports.author` | Validates definition against dataset's field ACL. |
| `PUT /api/reports/reports/[id]` | Update | `reports.author` + folder edit | Bumps `version`. Rejects if optimistic-lock `version` mismatch. |
| `DELETE /api/reports/reports/[id]` | Soft-delete | `reports.author` + folder edit | Soft delete; undoable via command log. |
| `POST /api/reports/reports/[id]/run` | Execute (sync or async) | `reports.view` + folder view | Body: `{ params?: Record<string,unknown>, mode?: 'sync'\|'async' }`. Returns `ReportRunResponse`. |
| `GET /api/reports/reports/[id]/export?format=csv\|xlsx` | Download | `reports.view` + folder view + `reports.export` | Large exports streamed via `result_blob_id`. |

### Folders

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/folders` | List folders visible to the user | `reports.view` | Returns a tree: private root, public root, and share-granted folders. |
| `GET /api/reports/folders/[id]` | Get one (with children, items) | `reports.view` | |
| `POST /api/reports/folders` | Create | `reports.author` (for private) / `reports.admin` (for public top-level) | |
| `PUT /api/reports/folders/[id]` | Update (rename, move) | folder edit | |
| `DELETE /api/reports/folders/[id]` | Soft-delete (cascade soft-delete reports inside) | folder edit | Refuses if any report or dashboard inside has an active schedule (must delete schedule first or pass `?withSchedules=true`). |

### Folder shares

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/folder-shares?folderId=` | List shares on a folder | folder owner OR `reports.admin` | |
| `POST /api/reports/folder-shares` | Add a share | folder owner OR `reports.admin` | Body: `{ folderId, principalType, principalId, permission }`. Rejects shares on public folders. |
| `DELETE /api/reports/folder-shares/[id]` | Remove a share | folder owner OR `reports.admin` | |

### Dashboards

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/dashboards` | List | `reports.view` | |
| `GET /api/reports/dashboards/[id]` | Get one (with tile metadata) | `reports.view` | |
| `POST /api/reports/dashboards` | Create | `reports.author` | |
| `PUT /api/reports/dashboards/[id]` | Update (layout, tiles) | `reports.author` + folder edit | |
| `DELETE /api/reports/dashboards/[id]` | Soft-delete | `reports.author` + folder edit | |
| `POST /api/reports/dashboards/[id]/run` | Execute all tiles in parallel | `reports.view` | Body: `{ params?: Record<string,unknown> }`. Returns `{ tiles: { tileId, result }[] }`. Tiles the user can't see return `{ tileId, error: 'forbidden' }`. |

### Schedules

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/schedules` | List schedules for caller's reports | `reports.schedule` | |
| `POST /api/reports/schedules` | Create | `reports.schedule` + folder edit on the target report | |
| `PUT /api/reports/schedules/[id]` | Update | as above | |
| `DELETE /api/reports/schedules/[id]` | Soft-delete | as above | |

### Embeds

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/embeds` | List embed configs | `reports.embed.manage` | Filters: `hostSpotId?`, `hostEntityId?`. |
| `GET /api/reports/embeds/render?hostSpotId=&hostEntityId=&recordId=` | **Runtime** call from the host widget — returns embed cards already executed (or `progressJobId` for async). | `reports.view` (caller); admin who configured the embed must have had access at config time. | Caches by `(orgId, hostSpotId, hostEntityId, recordId, paramsHash)` for 60 s. |
| `POST /api/reports/embeds` | Create | `reports.embed.manage` | |
| `PUT /api/reports/embeds/[id]` | Update | `reports.embed.manage` | |
| `DELETE /api/reports/embeds/[id]` | Soft-delete | `reports.embed.manage` | |

### Datasets

| Method + Path | Purpose | Features | Notes |
|---------------|---------|----------|-------|
| `GET /api/reports/datasets` | List datasets visible to caller | `reports.author` (read-only) | Server filters by `dataset.requiredFeatures` matching user's features. |
| `GET /api/reports/datasets/[id]` | Get one (fields filtered by `fieldAcl`) | `reports.author` | Returns only the fields the caller can use; joins only to datasets the caller can see. |

### OpenAPI

Every route exports an `openApi` object built via `createCrudOpenApiFactory({ defaultTag: 'Reports' })` for CRUD endpoints; custom endpoints (`/run`, `/export`, `/render`) declare bespoke `openApi` payloads.

### Error model

All routes return errors via the platform's standard error shape (`{ error: { code, message, fields? } }`). Specific report-only error codes:

- `REPORT_FIELD_ACL_DENIED` — definition references a field the user cannot see.
- `REPORT_DATASET_NOT_FOUND` — datasetId not in generated registry.
- `REPORT_FOLDER_FORBIDDEN` — caller has no view/edit access to target folder.
- `REPORT_RUN_TOO_LARGE` — sync run exceeded inMemoryCap and async mode not requested (or async disabled).
- `REPORT_RUN_TIMEOUT` — sync run exceeded `OM_REPORTS_SYNC_TIMEOUT_MS` (default 20 000).
- `REPORT_SCHEDULE_INVALID_CADENCE` — cadence string did not parse.

---

## Internationalization (i18n)

All user-facing strings keyed under `reports.*` in `i18n/en.json` (and per-locale equivalents). Examples:

```
reports.nav.reports
reports.nav.dashboards
reports.nav.settings
reports.folders.root_private
reports.folders.root_public
reports.folders.new
reports.folders.share_with
reports.folders.share_added
reports.builder.title
reports.builder.choose_dataset
reports.builder.fields_panel.title
reports.builder.filters_panel.title
reports.builder.preview_panel.title
reports.builder.run
reports.builder.save
reports.builder.parameters_panel.title
reports.builder.parameters_panel.add
reports.builder.date_range.tokens.last_7_days
reports.builder.date_range.tokens.mtd
reports.builder.date_range.tokens.ytd
reports.builder.date_range.tokens.custom
reports.builder.errors.field_acl_denied
reports.runs.empty
reports.runs.too_large
reports.runs.async_dispatched
reports.dashboard.builder.title
reports.dashboard.builder.add_tile
reports.dashboard.builder.tile.drill_through
reports.schedules.cadence.weekly
reports.schedules.cadence.monthly
reports.schedules.cadence.cron
reports.schedules.recipients.user
reports.schedules.recipients.role
reports.schedules.recipients.email
reports.schedules.email.subject
reports.schedules.email.body
reports.embeds.title
reports.embeds.configure
reports.notifications.execution_ready
reports.notifications.schedule_delivered
reports.notifications.export_ready
```

Datasets declare their own `labelKey` per field — every label that ends up in the builder UI is a translation key, never a literal string.

---

## UI / UX

All UI uses the design system canon:
- **Status colour:** semantic tokens only — `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-destructive`, `bg-destructive`. No hardcoded `text-red-*` / `bg-green-*` / `text-amber-*`. No `dark:` overrides on status tokens.
- **Typography:** Tailwind text scale (`text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl`) or the `text-overline` token for 11px uppercase labels. No `text-[11px]` / `text-[13px]` / `p-[13px]` / arbitrary values.
- **Shared primitives:** `<DataTable entityId="reports:report">` and `<DataTable entityId="reports:dashboard">` for lists; `<CrudForm>` for folder / share / schedule / embed editors; `<FormField label error>` for inputs; `<SectionHeader title count action>` for section headers; `<CollapsibleSection>` for collapsible regions; `<Alert variant="warning">` for embed-tile insufficient-access fallback; `<StatusBadge>` for execution status; `<LoadingMessage>` / `<Spinner>` / `<DataLoader>` for async states; `<EmptyState>` (or DataTable `emptyState`) for empty folders / lists; `flash('msg', 'success'|'error'|'warning'|'info')` for toasts; `useConfirmDialog()` for destructive confirmations.
- **Icons:** lucide-react in all page-body UI; sizes from the `size-{3|4|5|6}` scale; no inline `<svg>`. `page.meta.ts` icons follow the `React.createElement('svg', …)` pattern.
- **Dialogs:** every editor supports `Cmd/Ctrl+Enter` submit and `Escape` cancel; every icon-only button has an `aria-label`.
- **Drag-and-drop:** `@dnd-kit` (`@dnd-kit/core` + `@dnd-kit/sortable`) — already a `@open-mercato/ui` dependency and used by `DataTable` (column / row reorder), `CrudForm` (section reorder), `SidebarCustomizationEditor`, `AdvancedFilterBuilder`, `ColumnChooserPanel`, and `customers/.../ManageTagsDialog`. The report builder canvas, dashboard tile grid, and field-tree drop zones all reuse these primitives. No new drag library introduced. Drop targets render with `border-dashed border-border` and switch to `border-primary` on hover. No DS exceptions.
- **Charts:** reuse the existing `@open-mercato/ui/backend/charts` wrappers — `BarChart`, `LineChart`, `PieChart`, and the shared `ChartUtils` (`ChartTooltipContent`, `resolveChartColor`). They are shadcn-style typed wrappers over `recharts ^3.8.1` and live in `packages/ui/src/backend/charts/`. The reports module ships a thin `<ReportChart>` adapter that switches on `definition_json.chart.type` and renders the matching wrapper — no `<ChartContainer>` re-implementation. Missing chart kinds for MVP (`AreaChart`, `DonutChart`, `ScatterChart`, `ComboChart`) are **added to `packages/ui/src/backend/charts/` following the existing pattern**, not invented inside the reports module, so other modules can consume them too. Chart palette uses the DS chart token slots (`--chart-1` … `--chart-5`) via `resolveChartColor`; no inline hex.
- **Boy Scout rule:** every existing page we touch (notably customers detail page when wiring the embed host) gets its surviving hardcoded shades / arbitrary text sizes migrated in the same PR.

ASCII mockups below are layout/affordance sketches — colour and typography are described in prose using DS token names, not encoded into the ASCII.

### Mockup 1 — Folder navigator + report list (`/backend/reports`)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Reports                                                            [ + New Report ▾ ]       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌──────────────── FOLDERS ──────────────────┐  ┌──────────────── REPORTS ───────────────┐  │
│  │                                           │  │                                        │  │
│  │  📁 My Reports          (12)              │  │  ┌─ Filter ──────────────────────────┐ │  │
│  │   ├ 📁 Drafts            (3)              │  │  │ q [____________]  type [▾]        │ │  │
│  │   ├ 📁 Q2 reviews        (5)              │  │  └───────────────────────────────────┘ │  │
│  │   └ 📁 Personal pivots   (4)              │  │                                        │  │
│  │                                           │  │  ┌─ Name ─────┬─ Type ──┬─ Dataset ──┐ │  │
│  │  📁 Public              (38)              │  │  │ Top 10 cust│ Grouped │ sales.…    │ │  │
│  │   ├ 📁 Sales            (14)              │  │  │ MTD revenue│ Chart   │ sales.…    │ │  │
│  │   ├ 📁 Operations       (10)              │  │  │ Open deals │ Flat lis│ customers… │ │  │
│  │   └ 📁 HR                (8)              │  │  │ Pipeline   │ Pivot   │ customers… │ │  │
│  │                                           │  │  │ …                                 │ │  │
│  │  📁 Shared with me       (4)              │  │  └───────────────────────────────────┘ │  │
│  │   └ 📁 Marketing (HR-shared)  (4)         │  │                                        │  │
│  │                                           │  │  [ Page 1 of 4 ]                       │  │
│  └───────────────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Tree on the left uses the existing folder list endpoint; private + public roots are virtual nodes.
• Click a folder → filters the right-side list (the right side is a <DataTable entityId="reports:report" …>).
• "+ New Report" dropdown: Flat list, Grouped, Pivot, Chart, Summary.
• Right-click on a folder: New folder, Rename, Move, Share… (private only), Delete.
• Right-click on a report row: Run, Edit, Move…, Duplicate, Schedule…, Delete.
```

### Mockup 2 — Drag-and-drop report builder (`/backend/reports/[id]`)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  ←  My Reports / Drafts / Top 10 customers          [Run ▷] [Save] [Schedule…] [Share…] [⋯]  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────── DATASETS ─────────┐  ┌──────────────── CANVAS ──────────────┐  ┌─ FILTERS ───┐ │
│  │                             │  │                                      │  │             │ │
│  │  ▾ sales.orders             │  │  Type:  ( ) Flat   (•) Grouped       │  │ status      │ │
│  │   • id                      │  │         ( ) Pivot  ( ) Chart         │  │   = "paid"  │ │
│  │   • created_at              │  │                                      │  │             │ │
│  │   • total            🔢      │  │  ┌─ Group by ─────────────────────┐ │  │ + add       │ │
│  │   • status                  │  │  │ ⤓ customer_id                  │ │  │             │ │
│  │   • customer.email   🔒      │  │  │ ⤓ status                       │ │  ├─ DATE RANGE─┤ │
│  │     (hidden — needs PII)    │  │  └────────────────────────────────┘ │  │             │ │
│  │   • cf:vip          🆕 cf    │  │                                      │  │ {Last 30 d ▾}│ │
│  │                             │  │  ┌─ Measures ─────────────────────┐ │  │             │ │
│  │  ▸ customers.people         │  │  │ SUM(total)        AS revenue   │ │  ├─ PARAMETERS─┤ │
│  │  ▸ catalog.products         │  │  │ COUNT(id)         AS orders    │ │  │             │ │
│  │                             │  │  │ AVG(total)        AS aov       │ │  │ ⊕ companyId │ │
│  │  ( Drag fields → canvas )   │  │  └────────────────────────────────┘ │  │   (FK pick) │ │
│  │                             │  │                                      │  │             │ │
│  │                             │  │  ┌─ Sort ──────────────────────────┐ │  └─────────────┘ │
│  │                             │  │  │ revenue DESC, customer_id ASC  │ │                  │
│  │                             │  │  └────────────────────────────────┘ │                  │
│  │                             │  │                                      │                  │
│  │                             │  │  Limit: [ 100 ]                      │                  │
│  └─────────────────────────────┘  └──────────────────────────────────────┘                  │
│                                                                                              │
│  ┌──────────────────────────────── PREVIEW ─────────────────────────────────────────────┐   │
│  │ customer_id     status   revenue       orders   aov                                  │   │
│  │ cust_001        paid     14 320.00     12       1 193.33                             │   │
│  │ cust_044        paid     12 100.00      9       1 344.44                             │   │
│  │ …                                                                                    │   │
│  │ [Showing 1–10 of 100] [Run again to refresh]                                          │   │
│  └──────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Left rail: dataset tree; fields are draggable. Field-ACL-hidden fields show grey 🔒 + tooltip with
  the required feature. They cannot be dragged.
• Center canvas changes shape with the type toggle. Each drop zone is a small drop target with
  hover affordance; reordering is by drag handles. Aggregation picker appears next to a measure
  field; only the dataset-declared aggregations are offered.
• Right panel: Filters (typed editor by field kind — date pickers for datetime, enum dropdowns
  for enum, text input for text, numeric range for number, FK pickers for fk). Date Range
  selector at the top of Filters offers the 12 pre-defined tokens + custom range. Parameters
  panel lets you declare named parameters that bind to filters.
• Preview pane re-runs on "Run" (or auto-debounced when "Auto-refresh" is toggled on, capped at
  200 rows for snappy feedback). Switching to async dispatches a ProgressTopBar job.
• Cmd/Ctrl+Enter saves; Escape closes any open panel.
• Every field icon is lucide-react; no inline SVG.
```

### Mockup 3 — Run / preview screen (full execution)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Top 10 customers — paid, last 30 days                                          [Edit] [⋯]   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  Date range: [Last 30 days ▾]   companyId: [ — all — ▾]   [Apply parameters]                 │
│                                                                                              │
│  Last run: 2026-05-15 14:22 (took 1.2 s, 100 rows)             [⤓ CSV] [⤓ Excel] [Schedule…] │
│                                                                                              │
│  ┌─ customer ──── status ─── revenue ──── orders ──── aov ──────────────────────────────┐    │
│  │ Acme Inc       paid      14 320.00     12         1 193.33                           │    │
│  │ Globex SA      paid      12 100.00      9         1 344.44                           │    │
│  │ Initech        paid       9 880.00      8         1 235.00                           │    │
│  │ …                                                                                    │    │
│  └──────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─ Drill-through (when clicking a row) ────────────────────────────────────────────────┐    │
│  │ Underlying records (flat list) for customer = Acme Inc                                │    │
│  │ id          created_at         total      status                                      │    │
│  │ ord_…       2026-05-12 09:11   1 990.00   paid                                        │    │
│  │ …                                                                                     │    │
│  └──────────────────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Parameters bar (top): live, re-runs on Apply. Date range supports the 12 pre-defined tokens
  + custom calendar.
• Result table uses <DataTable>; download buttons go through /export endpoint.
• Drill-through opens an in-page side panel; the panel runs a derived flat_list query with the
  group-by fields pre-filtered to the clicked row.
```

### Mockup 4 — Dashboard composer

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  ←  Public / Sales / Q2 Pipeline Dashboard               [Run ▷] [Save] [Embed…] [Share…]    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  Date range: [Quarter to date ▾]   region: [—all—▾]                                          │
│                                                                                              │
│  ┌─ ADD TILE ─┐ ┌──── Grid 12 columns ─────────────────────────────────────────────────────┐ │
│  │ ⊕ Report   │ │  ┌─ Tile A (8×4) ──────┐  ┌─ Tile B (4×4) ─┐                             │ │
│  │   (search) │ │  │ Pipeline by stage   │  │ Revenue MTD    │                             │ │
│  │            │ │  │ [chart: bar]        │  │ [big number]   │                             │ │
│  │ ⊕ Existing │ │  └─────────────────────┘  └────────────────┘                             │ │
│  │   reports  │ │                                                                          │ │
│  │            │ │  ┌─ Tile C (6×4) ──────┐  ┌─ Tile D (6×4) ─────────────────────────┐    │ │
│  │ Library:   │ │  │ Top 10 customers    │  │ Win/Loss by region                     │    │ │
│  │ • Top 10…  │ │  │ [table — summary]   │  │ [chart: stacked bar]                   │    │ │
│  │ • MTD rev… │ │  └─────────────────────┘  └────────────────────────────────────────┘    │ │
│  │ • …        │ │                                                                          │ │
│  └────────────┘ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                                              │
│  Per-tile actions (right-click on a tile): Edit binding…, Resize, Remove,                    │
│      Drill into source report                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Drag a report from the left library into the grid → a tile is placed; default size 4×4.
• Resize via grid handles; reposition via drag header.
• Each tile shows the report's summary or chart (per its `mode`); a footer link "Open report"
  drills through to the full execution view.
• Dashboard parameters (top bar) propagate to every tile; per-tile param bindings can override.
• shadcn/ui chart primitives wrap Recharts; chart spec from the underlying report's
  definition_json.
```

### Mockup 5 — Embed configurator (admin: `/backend/reports/embeds`)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Record-page embeds                                                          [ + New embed ] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  Filter: host entity [ customers.person ▾ ]   spot [ crud-form:customers.person:fields ▾ ]   │
│                                                                                              │
│  ┌─ Title ───────────── Artifact ─────────── Bindings ─────────────── On ── Position ─ ⋯ ──┐ │
│  │ Last 30d activity   📊 dashboard          companyId ← record.id     ✓     1     [Edit] │ │
│  │ Open deals          📊 report             companyId ← record.id     ✓     2     [Edit] │ │
│  └────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                              │
│  ┌─ New embed ──────────────────────────────────────────────────────────────────────────┐   │
│  │ Host entity:   [ customers.person ▾ ]                                                 │   │
│  │ Host spot:     [ crud-form:customers.person:fields ▾ ]                                │   │
│  │ Artifact:      ( ) Report  (•) Dashboard                                              │   │
│  │ Pick:          [ Q2 Pipeline Dashboard ▾ ]   ← only artifacts you can view            │   │
│  │ Display title: [ Last 30d activity ]                                                  │   │
│  │ Parameter bindings:                                                                   │   │
│  │   • companyId      ← [ record-field ▾ ] [ id ▾ ]                                       │   │
│  │   • region         ← [ literal ▾ ] [ EMEA ]                                            │   │
│  │ Position:      [ 1 ]                                                                  │   │
│  │ Enabled:       [✓]                                                                    │   │
│  │                                                                                       │   │
│  │  [ Cancel ]   [ Save embed (Ctrl+Enter) ]                                              │   │
│  └──────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Admin-only page (requires reports.embed.manage).
• "Host spot" dropdown is filtered to the spots the host entity actually exposes
  (the host-spot registry is maintained alongside the widget injection-table).
• "Pick" dropdown filters the artifacts to those the admin can see (you can only embed what you
  can view); however the running user's ACL is checked at render time.
• Saving creates a `reports_embeds` row; the record-embed-host widget on the record page
  immediately reflects on next render.
```

### Mockup 6 — Schedule editor

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Schedule "Weekly leadership digest"                                          [Save] [Delete] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  Report:        Top 10 customers — paid, last 30 days        (locked)                        │
│                                                                                              │
│  Cadence:       (•) Weekly    Day [ Mon ▾ ]   Time [ 09:00 ▾ ]                                │
│                  ( ) Monthly   Day [ 1 ▾ ]    Time [ 09:00 ▾ ]                                │
│                  ( ) Custom (cron)   [ 0 9 * * 1 ]                                            │
│  Timezone:      [ Europe/Warsaw ▾ ]                                                          │
│                                                                                              │
│  Next run:      Mon, 2026-05-18, 09:00 Europe/Warsaw                                         │
│                                                                                              │
│  Recipients:    • User: jane@acme.com                       [✕]                              │
│                 • Role: sales-leadership (12 users)         [✕]                              │
│                 • Email: cfo@external.com                   [✕]                              │
│                 [ + Add recipient… ]                                                          │
│                                                                                              │
│  Formats:       [✓] CSV   [✓] Excel   [ ] PDF (Phase 2)                                       │
│                                                                                              │
│  Parameters:    Date range: [ Last 7 days ▾ ]  ← re-evaluated each run                       │
│                 companyId:  [ Acme Corp ▾ ]    ← frozen at this value                         │
│                                                                                              │
│  Enabled:       [✓]                                                                          │
│                                                                                              │
│  Last 5 runs:                                                                                 │
│   2026-05-12 09:00  completed  1.4 s  100 rows  delivered to 3 recipients  [view log]        │
│   2026-05-05 09:00  completed  1.6 s   98 rows  delivered to 3 recipients  [view log]        │
│   2026-04-28 09:00  failed     —      —         SES throttled              [view log]        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Behaviour:
• Date-range parameters and other "dynamic" parameters carry their token (e.g. last_7_days);
  static parameters get frozen values.
• Failed runs show a red status (using semantic destructive tokens — no hardcoded red).
• `view log` opens the corresponding `reports_executions` row with stack trace.
```

---

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `OM_REPORTS_INMEMORY_CAP` | `25000` | Row threshold above which sync runs auto-dispatch to async worker. |
| `OM_REPORTS_SYNC_TIMEOUT_MS` | `20000` | Hard time cap for sync runs (request thread). |
| `OM_REPORTS_ASYNC_TIMEOUT_MS` | `600000` | Hard time cap for async worker runs (10 min). |
| `OM_REPORTS_EXECUTION_RETENTION_DAYS` | `30` | Days to keep `reports_executions` rows before pruning. |
| `OM_REPORTS_RESULT_CACHE_TTL_S` | `300` | Result cache TTL (5 min) for sync runs. |
| `OM_REPORTS_EMBED_CACHE_TTL_S` | `60` | Embed render cache TTL. |
| `OM_REPORTS_SCHEDULE_TICK_S` | `900` | Schedule runner cron tick interval (15 min). |
| `OM_REPORTS_EXPORT_MAX_ROWS` | `100000` | Hard cap on export row count (CSV/Excel). |

## Migration & Backward Compatibility

- **DB:** Five new tables + indexes via `yarn db:generate`. No existing table modified. Migration is forward-only and additive; rollback drops the new tables.
- **Auto-discovery contract:** new file `<module>/reports.ts` is **additive** to the platform contract enumerated in `BACKWARD_COMPATIBILITY.md`. The generator gains a new collector but no existing collector is changed. Documented in `BACKWARD_COMPATIBILITY.md` under "Auto-discovery files — ADDITIVE-ONLY".
- **DI keys:** `reportsExecutionEngine`, `reportsDatasetRegistry`, `reportsScheduleService`, `reportsEmbedRegistry` — all new, no collisions.
- **Event IDs:** all new under `reports.*` namespace.
- **ACL features:** all new under `reports.*` namespace.
- **Widget spot IDs:** none new; we **consume** existing `crud-form:<entityId>:fields`, `detail:<entityId>:*`, `menu:sidebar:main`, `menu:sidebar:settings`.
- **Generated files:** new `reports-datasets.generated.ts` added to the existing generator output set. No existing generated file's shape is changed.
- **CLI:** new commands `yarn mercato reports rebuild-folders`, `yarn mercato reports run <reportId> [--params=…]` (no-op for the main runtime).
- **No deprecations.** The existing `perspectives` and `dashboards` modules continue unchanged. The "perspective vs report" distinction is documented in `apps/docs/docs/framework/modules/reports.mdx`.

---

## Implementation Plan

Phased delivery; every phase ends in a working application. Each phase is broken into testable steps. Every step is committed independently.

### Phase 1 — Dataset registry + minimum API (single-entity, flat list)

**Goal:** read-only reporting on a single indexed entity using a `<module>/reports.ts` declaration, with field-ACL, parameters, and pagination — no folders, no UI yet.

1. Add `defineDataset()` DSL + types in `@open-mercato/shared/modules/reports/dsl`.
2. Generator: discover `<module>/reports.ts`, emit `reports-datasets.generated.ts`. Update `packages/cli` codegen.
3. Module skeleton: `index.ts`, `acl.ts`, `setup.ts` (features only; root folders deferred to Phase 2), `events.ts` (subset), `translations.ts`, empty `encryption.ts`.
4. `reports/lib/datasets-registry.ts` runtime view; `reports/api/datasets/route.ts` + `[id]/route.ts` (with field ACL applied).
5. `reports/lib/field-redact.ts` + tests.
6. `reports/lib/query-translator.ts` for the `flat_list` type (no aggregation, no joins yet); apply tenant/org/feature scopes.
7. `reports/lib/parameters.ts` + `date-ranges.ts` (literal + 12 tokens).
8. `reports/lib/execute.ts` orchestrator for `flat_list`.
9. Seed one dataset in `customers/reports.ts` (people, no joins) as the canonical example for unit + integration tests.
10. Unit tests: dataset registry resolution, field ACL on builder load, definition validation rejection, parameter resolution incl. date-token translation, execution rejects unknown dataset / unknown field.

### Phase 2 — Persisted reports + folders + sharing + UI shell

**Goal:** users can create, save, run, and share flat-list reports through the UI.

1. ORM entities: `Report`, `ReportFolder`, `ReportFolderShare`. Migrations.
2. zod validators in `data/validators.ts` (incl. discriminated `definition_json` union for `flat_list` only initially).
3. Commands: `reports.folder.create/update/delete/share`, `reports.report.create/update/delete/move`, `reports.execution.run`.
4. CRUD routes via `makeCrudRoute`: folders, folder-shares, reports.
5. `reports/api/reports/[id]/run/route.ts` (sync only in this phase).
6. `reports/lib/folder-acl.ts` + tests for visibility/edit rules including private + public + share-grant.
7. `setup.ts seedDefaults` seeds the per-org `Public` root folder; lazy creation of per-user `My Reports` private root in the folders API handler.
8. Backend pages: `/backend/reports/page.tsx` (folder navigator + DataTable), `/backend/reports/reports/new/page.tsx` and `[id]/page.tsx` (builder shell, flat-list mode only).
9. Menu injections in `widgets/injection-table.ts`: main sidebar entry `Reports` (using existing `menu:sidebar:main`).
10. Integration tests: create folder → share → another user sees it; create report → run → field ACL applied; delete folder cascades.

### Phase 3 — Grouped + Pivot + Charts + Dashboards + Embeds

**Goal:** full builder UX, dashboards, and embeddable widgets.

1. `reports/lib/aggregator.ts` — in-memory group-by + pivot + measures.
2. Extend definition validators to cover `grouped`, `pivot`, `chart`, `summary` variants.
3. Builder canvas UI using `@dnd-kit`: type switcher, drag-and-drop fields, drop zones per type, filters editor (typed by field kind), parameters declaration UI.
4. Extend `packages/ui/src/backend/charts/` with the missing chart wrappers — `AreaChart`, `DonutChart`, `ScatterChart`, `ComboChart` — following the existing `BarChart` / `LineChart` / `PieChart` pattern (typed props + Recharts + `resolveChartColor`). These are platform-level additions usable by any module.
5. `reports/lib/chart-spec.ts` + `<ReportChart>` adapter that switches on `chart.type` and renders the matching `@open-mercato/ui/backend/charts/*` wrapper. No re-implementation of `<ChartContainer>` / `<ChartTooltip>` primitives.
6. `reports/api/reports/[id]/export/route.ts` (CSV + XLSX); `reports/lib/export.ts`.
7. `ReportDashboard` entity + CRUD + commands; backend pages `/backend/reports/dashboards/*` (tile grid uses `@dnd-kit/sortable`).
8. `reports/api/dashboards/[id]/run/route.ts` (parallel tile execution).
9. `ReportEmbed` entity + CRUD + commands; admin page `/backend/reports/embeds`.
10. **Expose record-page embed spots on customers detail pages** — add `<InjectionSpot id="detail:customers.company:after-header" />` and `<InjectionSpot id="detail:customers.person:after-header" />` to the customers company / person detail pages (`packages/core/src/modules/customers/backend/customers/companies/[id]/page.tsx`, `.../people/[id]/page.tsx`). Mirrors the existing `detail:customers.deal:header` pattern. Without this step, embeds on company / person pages must overload `crud-form:customers.<entity>:fields`, which mixes embedded analytics with the form field block. Document the convention so other modules expose `detail:<module>.<entity>:after-header` spots on their detail pages.
11. `record-embed-host` widget registered against `crud-form:*:fields`, `detail:*:after-header`, and `detail:*:*` spots; calls `GET /api/reports/embeds/render`.
12. Integration tests: pivot computation correctness incl. field-ACL refusal of redacted measure; dashboard run with shared parameters; embed render on a customers/person detail page returns correctly bound parameters; embed render on a customers/company detail page resolves `companyId` from `record.id`.

### Phase 4 — Scheduling + Async + Notifications

**Goal:** reports run on a schedule, large reports run async with progress.

1. `ReportSchedule` entity + CRUD + commands.
2. Workers: `reports-schedule-runner`, `reports-schedule-execute`, `reports-async-execute`, `reports-export-build`.
3. `reports/lib/email-attachments.ts`; ScheduledReportEmail React template.
4. `notifications.ts` + `notifications.client.ts`: types `reports.execution_ready`, `reports.schedule_delivered`, `reports.export_ready`. Subscribers emit notifications on completion.
5. `reports-async-execute` writes the result to the existing `attachments` module (for later download) and emits the notification.
6. Schedule editor UI (`/backend/reports/schedules` + per-report Schedule modal).
7. Integration tests: schedule fires within tick window; failure path increments `failure_count` and notifies owner after 3 failures; async run produces downloadable artifact.

### Phase 5 — Polish + Performance + Docs

**Goal:** observability, performance tuning, public docs.

1. Result cache (Redis tier via DI-resolved `cache`); tag-based invalidation when underlying dataset entity changes (cross-module subscriber pattern).
2. Query profile integration: emit `[crud:profile]` payloads from execution engine with `query_engine` child.
3. Retention worker `reports-executions-prune`.
4. CLI: `yarn mercato reports rebuild-folders`, `reports run`, `reports list-datasets`.
5. Docs: `apps/docs/docs/framework/modules/reports.mdx` covering datasets-as-code, builder, scheduling, embedding, and the field-ACL contract.
6. End-to-end Playwright tests per `.ai/qa/AGENTS.md` covering: build → save → schedule → email-arrives → embed-on-record.
7. Boy-Scout DS sweep on any touched neighbouring pages (e.g. customers detail page where the embed lives).

### File Manifest (excerpt)

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/modules/reports/dsl.ts` | Create | `defineDataset`, types |
| `packages/cli/src/codegen/reports.ts` | Create | discover `<module>/reports.ts`, emit generator output |
| `packages/core/src/modules/reports/...` | Create | entire new module per file structure above |
| `packages/core/src/modules/customers/reports.ts` | Create | example dataset (Phase 1) |
| `packages/core/src/modules/sales/reports.ts` | Create | sales.orders dataset (Phase 3 reference for joins) |
| `packages/core/src/modules/catalog/reports.ts` | Create | catalog.products dataset (Phase 3 reference) |
| `BACKWARD_COMPATIBILITY.md` | Modify | document new `<module>/reports.ts` auto-discovery as ADDITIVE-ONLY |
| `apps/docs/docs/framework/modules/reports.mdx` | Create | end-user + integrator docs |

### Testing Strategy

- Unit tests for `field-redact`, `query-translator`, `aggregator`, `date-ranges`, `parameters`, `folder-acl`, `chart-spec` — > 90% line coverage on `lib/`.
- Integration tests for: dataset registry visibility per user, folder ACL incl. share grants, report save rejecting redacted fields, run-time redaction, async dispatch threshold, schedule delivery, embed render on a record page.
- Playwright e2e in `.ai/qa/`:
  - `reports/builder-flat-list.spec.ts`
  - `reports/builder-pivot.spec.ts`
  - `reports/folders-sharing.spec.ts`
  - `reports/schedules-email.spec.ts` (uses test email sink)
  - `reports/embeds-on-customer-record.spec.ts`

---

## Risks & Impact Review

### Data Integrity Failures

- Mid-execution crashes leave `reports_executions.status='running'` rows. **Mitigation:** a janitor pass in `reports-schedule-runner` reaps rows older than `OM_REPORTS_ASYNC_TIMEOUT_MS + 60s` and marks them `failed`. **Residual:** orphan rows during reaper interval (≤ 15 min) — acceptable.
- Race on `reports.update`: two users edit the same builder concurrently. **Mitigation:** optimistic `version` column; UI handles `409 Conflict` with a reload prompt.
- Cascade soft-delete of a folder with active schedules: refuse by default; require explicit `?withSchedules=true`. **Mitigation:** in the folder.delete command, scan for active schedules and reject otherwise.
- Dangling FK if a `report_id` is hard-deleted (out-of-band): schedules and embeds become orphaned. **Mitigation:** add ON DELETE RESTRICT on FK; soft-delete only path is used by commands.

### Cascading Failures & Side Effects

- A failing dataset entity index (e.g. sales reindexing) silently returns empty results. **Mitigation:** execute.ts checks `entity_indexes_coverage` for the dataset's entityType and returns a structured warning when coverage is stale > `OM_REPORTS_COVERAGE_STALE_S` (5 min).
- Email provider down → schedules pile up. **Mitigation:** retry with exponential backoff up to 3 attempts; after 3 fails the schedule's `failure_count++` and a notification fires to the owner; schedule remains enabled (no silent disabling).
- Subscriber failure on `reports.report.executed` (telemetry, audit). **Mitigation:** persistent subscribers retried by the platform queue; ephemeral subscribers' failure does not block the response.
- Circular dependency risk: a dataset that joins to another dataset that joins back to it. **Mitigation:** generator validates the dataset graph at build time and refuses cycles.

### Tenant & Data Isolation Risks

- Cross-tenant leak through cache. **Mitigation:** every cache key and tag prefixed `tenant:<id>` + `org:<id>`; cache implementation is DI-resolved (existing platform contract).
- Cross-tenant leak through dataset registry generation. **Mitigation:** registry is static per build; runtime registry filtering is `requiredFeatures` + always-on tenant scope on every QueryEngine call.
- Noisy-neighbour: one tenant runs many heavy pivots. **Mitigation:** per-tenant rate limit on `/run` endpoint (default 20 reqs / minute, configurable via `OM_REPORTS_RATE_LIMIT`); heavy reports drop to async worker which has bounded concurrency.

### Migration & Deployment Risks

- New auto-discovery file is forward-additive — existing tenants pick it up on next deploy with no data migration. Safe.
- Folder seeding on existing tenants: `setup-app sync` upgrade action creates the org's Public root folder if missing; the per-user private root is created lazily on first folders API call — no batch migration needed.
- Backward-compat path: if `<module>/reports.ts` is removed from a module (loss of a dataset), reports referencing it return `REPORT_DATASET_NOT_FOUND`. **Mitigation:** validator on save also prevents saving with a missing dataset; a deprecation pre-flight check before module removal is documented in the module-development guide.

### Operational Risks

- Schedule misfires (TZ math errors). **Mitigation:** cadence parsing tested across all 6 supported TZ patterns + DST boundaries; `next_run_at` always recomputed in the schedule's declared `timezone`.
- Email attachments oversize → SMTP reject. **Mitigation:** `OM_REPORTS_EXPORT_MAX_ROWS` hard cap; if exceeded, email body links to an in-app download (signed URL) instead of attaching.
- Storage growth on `reports_executions` and async result blobs. **Mitigation:** retention worker `reports-executions-prune`; result blobs live in the existing `attachments` module which already has a retention/quota policy.

### Risk Register

#### Field ACL bypass via direct definition save

- **Scenario:** A power user reads the API, crafts a `definition_json` that references a field they cannot see, and `POST`s it. Saved definition then runs in a different user's context (e.g. via folder share).
- **Severity:** Critical
- **Affected area:** `POST /api/reports/reports`, `PUT /api/reports/reports/[id]`, `POST /api/reports/reports/[id]/run`
- **Mitigation:** Three-point enforcement in `lib/field-redact.ts` — at builder load, at save, **and** at every run. The runtime always re-resolves field ACL against the **running** user, not the owner; aggregate measures reference checks are mandatory.
- **Residual risk:** A user who already has the feature can save a definition that exposes the field; if their feature is later revoked, the definition still exists but cannot be run by them (good) or by anyone without the feature (good). Definitions themselves do not carry data; safe.

#### Aggregation oracle through allowed dimensions over disallowed fields

- **Scenario:** A user without `view_pii` cannot see `email` but can group rows by something else; total count of "rows where email matches X" could be inferred via clever filters.
- **Severity:** High
- **Affected area:** `lib/field-redact.ts`, `lib/aggregator.ts`
- **Mitigation:** Filters on redacted fields are rejected. Group-by on redacted fields is rejected. Measures over redacted fields are rejected. No way to construct an oracle: the only fields the user can use as filter/group/measure inputs are the ones the dataset declared them allowed to use.
- **Residual risk:** A poorly designed dataset that allows filtering on a non-PII field that is 1:1 with a PII field (e.g. user_id ↔ email) would technically allow re-identification by the keys. Mitigation: dataset authors instructed in `apps/docs/docs/framework/modules/reports.mdx` to declare such proxy keys in `fieldAcl` too.

#### Async result blob leakage through guessable URLs

- **Scenario:** Async run results stored in `attachments` could be fetched by another user with the URL.
- **Severity:** High
- **Affected area:** `workers/reports-async-execute.ts`, `attachments` module integration
- **Mitigation:** Reuse the `attachments` module's existing signed-URL contract (tenant + user scoped). Result attachments tagged with `owner_user_id` and `report_id`; download endpoint re-runs folder ACL before issuing the signed URL.
- **Residual risk:** A user who is granted folder access after the result was generated will be able to download the cached blob, which may have been computed from data they could see at the time of the run. Acceptable — they could have re-run the report themselves.

#### Schedule timezone drift around DST

- **Scenario:** A schedule says "weekly, Monday 09:00, Europe/Warsaw"; DST shift miscalculates `next_run_at`.
- **Severity:** Medium
- **Affected area:** `lib/schedule.ts`, cadence parser
- **Mitigation:** Use `Intl.DateTimeFormat` + IANA TZ database. Unit tests cover all 4 DST-transition weekends in EU + US. `next_run_at` re-computed on every successful execution from the schedule's `cadence`+`timezone`, not by `last_run_at + 7 days` math.
- **Residual risk:** Newly-introduced TZs (rare IANA additions) not in the Node runtime would fail parsing — schedule creation returns `REPORT_SCHEDULE_INVALID_CADENCE`.

#### In-memory aggregation OOM on misconfigured cap

- **Scenario:** `OM_REPORTS_INMEMORY_CAP` set very high; a heavy pivot allocates huge arrays.
- **Severity:** Medium
- **Affected area:** `lib/aggregator.ts`
- **Mitigation:** Cap defaults to 25 000; node-side measurement uses streaming reads from QueryEngine and aborts when row count exceeds cap; over-cap returns `REPORT_RUN_TOO_LARGE` and suggests async mode.
- **Residual risk:** Operators can raise the cap and shoot themselves in the foot; configuration values are documented with warnings in `apps/docs/docs/user-guide/reports.mdx`.

#### Embed render fan-out overload

- **Scenario:** A record-page detail view embeds 5 reports; opening it issues 5 sync runs.
- **Severity:** Medium
- **Affected area:** `record-embed-host` widget, `GET /api/reports/embeds/render`
- **Mitigation:** The render endpoint executes embeds in parallel with a per-request semaphore (default 3 concurrent); per-spot result cache (TTL `OM_REPORTS_EMBED_CACHE_TTL_S`); embeds that would dispatch async render a placeholder card with a "Loading…" state.
- **Residual risk:** A burst of record views still issues N runs across many concurrent users; relies on per-tenant rate limit (above) to bound total impact.

---

## Final Compliance Report — 2026-05-15

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Singular naming for entities/commands/events | Compliant | `report`, `folder`, `dashboard`, `schedule`, `embed`, `execution`, `folder_share` all singular; events use `module.entity.action` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Cross-module references are FK IDs (`reports.dataset_id` is a text id; `reports_embeds.host_entity_id` is a text id); reads go through QueryEngine, not cross-module repository imports |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | Every new table includes `organization_id` + `tenant_id`; QueryEngine auto-applies guards; never uses `omitAutomaticTenantOrgScope` |
| root AGENTS.md | All inputs validated with zod | Compliant | `data/validators.ts` declares schemas; discriminated union for `definition_json` by `type` |
| root AGENTS.md | Use commands for writes (not direct ORM in handlers) | Compliant | 18 commands declared; CRUD routes use `makeCrudRoute` which binds them; non-CRUD `/run`, `/share` wrap mutations in `validateCrudMutationGuard` |
| root AGENTS.md | Use `apiCall` / `apiCallOrThrow` / `useGuardedMutation` | Compliant | UI specifies `apiCall` for reads, `useGuardedMutation` for non-CrudForm writes |
| root AGENTS.md | i18n keys for all user-facing strings | Compliant | All labels in `i18n/<locale>.json` under `reports.*`; datasets declare `labelKey`/`descriptionKey` |
| root AGENTS.md | Dialog Cmd/Ctrl+Enter + Escape | Compliant | All editors specified with these bindings |
| root AGENTS.md | `pageSize <= 100` | Compliant | Specified for `GET /api/reports/reports` |
| root AGENTS.md | Use `findWithDecryption` for sensitive reads | Compliant | Read path is QueryEngine over `entity_indexes`, which is decryption-aware; for direct `attachments` lookups in async results we use the platform's existing signed-URL contract |
| root AGENTS.md | Module setup `defaultRoleFeatures` and ACL sync | Compliant | `setup.ts` declares features for admin, employee; sync command documented |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | All routes, including custom `/run`, `/export`, `/render`, declare bespoke `openApi` |
| packages/core/AGENTS.md | CRUD via `makeCrudRoute` with `indexer.entityType` | Compliant | All 7 CRUD routes do |
| packages/core/AGENTS.md | API routes export per-method `metadata` with `requireAuth`/`requireFeatures` | Compliant | Tabulated in API Contracts section |
| packages/core/AGENTS.md | Custom-fields helpers | Compliant | Reports themselves expose custom fields via `ce.ts`; dataset declarations reference `cf:<key>` per index doc shape |
| packages/core/AGENTS.md | Encryption maps for sensitive fields (`defaultEncryptionMaps` declared; `findWithDecryption` used for direct reads) | Compliant | Full map enumerated in **Data Models → Encryption (`encryption.ts`)**. Covers all 6 entities with user-authored text, JSON, or PII (Report, Folder, Dashboard, Schedule, Execution, Embed); `folder_shares` excluded as principal-id-only. Direct ORM reads in commands use `findWithDecryption`; query-engine reads inherit `entity_indexes` doc decryption. No hand-rolled crypto. |
| packages/core/AGENTS.md | Side effects via `emitCrudSideEffects` | Compliant | All commands declare `indexer: { entityType }` and `cacheAliases` |
| packages/cache/AGENTS.md | Tag-based invalidation, tenant-scoped tags | Compliant | Cache keys/tags `tenant:<id>`, `org:<id>`, `report:<id>`, `dataset:<datasetId>`; invalidation chains on cross-module dataset entity writes |
| packages/queue/AGENTS.md | Idempotent workers; bounded concurrency | Compliant | Workers idempotent on `scheduleId + paramsHash + runWindow`; `concurrency` configured per worker |
| packages/events/AGENTS.md | `createModuleEvents` with `as const` | Compliant | events.ts pattern shown above |
| packages/ui/AGENTS.md | `<CrudForm>` for backend forms; `<DataTable>` for lists | Compliant | Folder/share/schedule editors use `<CrudForm>`; report list and execution result use `<DataTable>` |
| packages/ui/AGENTS.md | DataTable `entityId` for injection stability | Compliant | `reports:report` `entityId` declared |
| `.ai/ds-rules.md` | Semantic status tokens, no hardcoded shades | Compliant | All mockup colour cues reference status tokens (`text-status-error-text` etc.); no `text-red-*` / `bg-green-*` |
| `.ai/ds-rules.md` | Tailwind text scale, no arbitrary sizes | Compliant | Mockups specify text classes from the scale |
| `.ai/ds-rules.md` | lucide-react icons in body, no inline SVG | Compliant | Icon strategy specified |
| `.ai/ui-components.md` | Shared primitives (`SectionHeader`, `EmptyState`, `Alert`, `FormField`, `LoadingMessage`) | Compliant | Used throughout the UI section |
| BACKWARD_COMPATIBILITY.md | New auto-discovery file ADDITIVE-ONLY | Compliant | `<module>/reports.ts` added without modifying any existing discovery file; documented in the BC doc as part of Phase 1 |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | All tables exposed in CRUD routes; API responses derive from entity shape + computed fields (`permission`) |
| API contracts match UI/UX section | Pass | Builder calls `/datasets`, `/reports`, `/run`; folder navigator calls `/folders`, `/folder-shares`; dashboard composer calls `/dashboards`, `/dashboards/[id]/run`; embed configurator calls `/embeds` |
| Risks cover all write operations | Pass | All 18 commands implied in folder.delete cascade, schedule update, embed create/update risks; field-ACL risk covers every save/run path |
| Commands defined for all mutations | Pass | 18 commands tabulated; no API write path bypasses a command |
| Cache strategy covers all read APIs | Pass | Result cache for `/run`; embed cache for `/render`; dataset registry cache implicit (in-process, invalidated on deploy) |
| Phasing testable and incrementally deliverable | Pass | Each phase ends with a working slice (Phase 1: API-only flat list; Phase 2: UI + folders; Phase 3: full builder + dashboards + embeds; Phase 4: schedules; Phase 5: polish) |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant** — Approved — ready for implementation. Open Questions resolved; assumptions documented; risks registered with mitigations.

---

## Changelog

### 2026-05-15
- Skeleton spec drafted. Open Questions Q1–Q5 (architecturally critical) and Q6–Q7 (defaults to confirm) raised.
- Open Questions answered (Q1 OSS, Q2 Sibling, Q3 code-declared datasets MVP / Postgres views Phase 2, Q4 per-field ACL with aggregate enforcement, Q5 private + public + folder-level ACL, Q6 CSV + Excel MVP, Q7 live + async-over-25k).
- Full spec drafted: Architecture, Data Models (7 tables), API Contracts (7 surfaces), 6 ASCII UI mockups, 5-phase Implementation Plan, Risks Register (6 named risks), Final Compliance Report.
- Encryption section made explicit: enumerated `defaultEncryptionMaps` for all 6 PII-bearing entities; `findWithDecryption` usage rules for command-side ORM reads stated.
- UI/UX preamble tightened with concrete DS-token names, lucide-react icon strategy, and Boy Scout pledge for touched neighbouring pages.
- Corrected drag-and-drop reference: `@dnd-kit` is already in `@open-mercato/ui` and used by `DataTable`, `CrudForm`, `SidebarCustomizationEditor`, `AdvancedFilterBuilder`, `ColumnChooserPanel`, and customers' `ManageTagsDialog`. Removed stale "customers Kanban" mention (no such component exists).
- Corrected chart strategy: reuse existing `packages/ui/src/backend/charts/{BarChart,LineChart,PieChart}` wrappers (typed props over Recharts ^3.8.1, shared `ChartUtils` with `resolveChartColor`). `<ReportChart>` is a thin type-discriminating adapter, **not** a `<ChartContainer>` re-implementation. Missing wrappers (`AreaChart`, `DonutChart`, `ScatterChart`, `ComboChart`) are added to `packages/ui/src/backend/charts/` so other modules benefit.
- Phase 3 step added: expose `detail:customers.company:after-header` and `detail:customers.person:after-header` injection spots on the customers detail pages (the existing pattern is `detail:customers.deal:header`); without these, record-page embeds on company / person pages would have to overload `crud-form:*:fields`. Documented `detail:<module>.<entity>:after-header` as the recommended embed spot convention for other modules to follow.

### Review — 2026-05-15
- **Reviewer:** Agent (Claude Opus 4.7, spec-writing skill)
- **Security:** Passed — three-point field-ACL enforcement; tenant/org scope mandatory at QueryEngine; signed-URL contract reused for async result blobs; cache tags tenant-scoped.
- **Performance:** Passed — bounded in-memory aggregation (default 25k); async dispatch path; result + embed caches; per-tenant rate limit; coverage-staleness warning surfaced to UI.
- **Cache:** Passed — TTLs declared; tag invalidation chained to dataset entity writes via cross-module subscribers; tenant-scoped keys/tags.
- **Commands:** Passed — 18 commands, all undoable except `reports.execution.run` (read-only by nature); side-effect emission specified.
- **Risks:** Passed — 6 explicit scenarios with severity/mitigation/residual; no high-severity item left unmitigated.
- **Verdict:** Approved.
