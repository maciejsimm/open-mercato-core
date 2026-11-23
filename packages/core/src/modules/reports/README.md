# Reports & Analytics — manual test guide

Hands-on checklist for trying the `reports` module in a running app. The spec is
`.ai/specs/2026-05-15-reports-and-analytics-module.md`.

## Before you start

1. Apply migrations and regenerate: `yarn db:migrate && yarn generate`.
2. Sync role ACLs so existing roles get the reports features: `yarn mercato auth sync-role-acls`.
3. Refresh cached navigation: `yarn mercato configs cache structural --all-tenants`.
4. Have some data: a few customers (people + companies), deals, products and sales quotes/orders. The demo seed (`yarn initialize` with examples) is enough.
5. For scheduled emails, configure an outbound email provider (SMTP / Resend / SES) and set `APP_URL`.
6. Use two users to test sharing and access: an **admin** (has `reports.*`) and an **employee** (has `reports.view`, `reports.author`).

Useful knobs: `OM_REPORTS_INMEMORY_CAP` (default 25 000, lower it to e.g. `50` to force async runs), `OM_REPORTS_ASYNC_CAP` (100 000), `OM_REPORTS_EMAIL_ATTACHMENT_MAX_BYTES` (10 MB).

## 1. Folders

| # | Steps | Expected |
|---|-------|----------|
| 1.1 | Open **Reports**. | Folder navigator shows *My Reports*, *Public*, *Shared with me*. |
| 1.2 | Click **New** next to *Folders*, enter a name, keep *Private*, press Cmd/Ctrl+Enter. | Toast "Folder created", folder appears under *My Reports* and is selected. |
| 1.3 | As **employee**, create a folder with *Public*. | Error toast (public folders need `reports.admin`). As **admin** it succeeds. |
| 1.4 | Select a folder you can edit, click **New**. | Dialog says it is created inside that folder with the same visibility. |

## 2. Datasets and the builder

| # | Steps | Expected |
|---|-------|----------|
| 2.1 | **New report** → open the *Dataset* picker. | Labels first, id in brackets, e.g. "Sales quotes (sales.quotes)". 14 datasets: customer entities, deals, activities; catalog products, variants; sales orders, order lines, quotes, quote lines, invoices, payments, shipments; staff time entries; WMS inventory balances. |
| 2.2 | Create a *Flat list* on *Sales quotes*, drag 4–5 fields from the sidebar into **Fields**. | Each drop lands in the zone under the pointer; chips can be reordered and removed via the remove strip that appears only while dragging a chip. |
| 2.3 | Use the sidebar **search**, then collapse the sidebar and reload. | Search filters by label and key; collapsed state survives reload. |
| 2.4 | **Filters & Sorting** → add a sort on *Status*, then a second key; reorder them. | Preview re-sorts. For *Grouped* reports on an enum field the declared option order is used (e.g. draft → sent → accepted). |
| 2.5 | Switch type *Flat list → Grouped → Chart → Grouped*. | A warning toast lists what the target type could not keep; switching back without editing restores the previous setup. |
| 2.6 | *Grouped*: group by *Status*, add measure *Sum of Grand total (net)*. | Money is formatted with the currency symbol; counts are integers; dates/booleans/enums are human-readable. |
| 2.7 | Click the format icon on a measure column, set precision 0 / compact. | Table and preview reformat; the setting is saved with the report. |
| 2.8 | *Chart*: pick X = Status, add a measure. | Chart renders immediately (no manual Y-series pick), with palette colours, grid, formatted axis and tooltip; multiple measures show a legend. |
| 2.9 | **Parameters** tab: add a parameter and type its name. | The preview does not re-run on each keystroke (500 ms debounce, label edits never re-run it). |
| 2.10 | Mix currencies: sum a money field over orders in two currencies without grouping by currency. | Column header shows a *Mixed currencies* flag; the value is not labelled with one currency. Grouping by the currency column shows per-currency totals. |
| 2.11 | Save, then **Export** → CSV and XLSX. | CSV has raw values plus a currency column; XLSX opens in Excel/Numbers with numeric and date cells (sum works). |

## 3. Correctness and access

| # | Steps | Expected |
|---|-------|----------|
| 3.1 | Create 150+ records (or use a big dataset), build a *Summary* with *Count of ID*. | The count equals the real total, not 100. |
| 3.2 | Set `OM_REPORTS_INMEMORY_CAP=50`, run a grouped report over more rows. | Run answers "running in the background"; a notification "Report ready" arrives with a CSV download link. |
| 3.3 | As **employee**, open the download link of an admin's execution. | 404 — only the requester can download. |
| 3.4 | Share a private folder with a **role** the employee has (folder sharing). | The employee sees the folder and its reports. |
| 3.5 | Remove `customers.view_pii` (or another field-ACL feature) from a user and run a report using that field. | 403 "references fields you may not see"; saving such a report is also refused. |
| 3.6 | As super-admin pick "All organizations" in the organization switcher and open Reports. | You only see reports of your own organization (or a "Select an organization" message when switched to another tenant) — never a mix of organizations. |

## 4. Dashboards

| # | Steps | Expected |
|---|-------|----------|
| 4.1 | **Dashboards → New dashboard**, add 3 tiles (the same report twice is allowed), save. | — |
| 4.2 | Open the dashboard. | View mode: tiles run automatically in the 12-column grid, no composer chrome. |
| 4.3 | Change a dashboard parameter (e.g. a date range). | All tiles re-run; a tile with its own binding override keeps its value. |
| 4.4 | Click **Edit**, move/resize tiles, save, reload. | Layout persists. Viewers without edit permission do not see **Edit**. |
| 4.5 | **Open report** on a tile. | Navigates to the underlying report. |

## 5. Embeds and the home screen

| # | Steps | Expected |
|---|-------|----------|
| 5.1 | **Reports → Embeds → New embed**. *Where* offers: Customer — person, Customer — company, Customer — deal, Sales order, Sales quote, Catalog product. | — |
| 5.2 | Pick *Customer — company*, a report with a `companyId` parameter, bind it *From this record → Company ID*, save. | The list shows "Customer — company · <report> · companyId ← Company ID". |
| 5.3 | Open a company detail page. | The embed renders below the header, filtered to that company. |
| 5.4 | Leave a required parameter unbound. | Save is blocked. |
| 5.5 | Home screen: **Customize dashboard → Add widget → Report**, pick a report or dashboard and fixed parameter values. | The widget renders the formatted result with an *Open* link and refreshes with the dashboard. (Roles with a dashboard widget allowlist need `reports.dashboard.report` added.) |

## 6. Schedules

| # | Steps | Expected |
|---|-------|----------|
| 6.1 | **Schedules → New schedule**. Frequency *Weekly*, pick Mon + Wed pills, 09:00, timezone. | Summary "Every Mon and Wed at 09:00 (<tz>)" and the next 3 run times. |
| 6.2 | Try *Daily*, *Monthly* (day 15 and *Last day*), *Custom cron* (`0 8 * * 1-5`). | Summary and next runs update; invalid cron shows an inline error. |
| 6.3 | **Formats** dropdown: pick CSV + XLSX. Recipients: a user and a role. | Saved. |
| 6.4 | Add an external email recipient as **employee**. | Refused — external recipients need `reports.admin`. |
| 6.5 | Make the schedule due (set the time a minute ahead) and wait for the scheduler tick. | One email per recipient with a preview table and the CSV/XLSX attachments; owner gets "Schedule delivered". No duplicates even if the run is slow. |
| 6.6 | Revoke the owner's access to the report folder, let it run 3 times (or break the dataset). | Failures retry with backoff (15 min, 30 min…); after 3 the schedule is disabled and the owner gets "Schedule disabled". |

## Automated checks

```bash
cd packages/core && npx jest src/modules/reports          # unit tests
yarn test:integration --grep TC-REPORTS                     # Playwright: TC-REPORTS-001..003 (needs a running app)
```
