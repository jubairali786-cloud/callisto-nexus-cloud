# Callisto Nexus — Cloud Accounting

A full multi-user, cloud, double-entry accounting system for Callisto Nexus Technical
Services L.L.C. — built from scratch, separate from the local single-file "Callisto Nexus
Billing" app (`callisto-nexus-billing.html`), which has no login and keeps its data only in
one browser.

## What's in here

- **Accounts & multi-tenancy**: email/password login, organizations, roles
  (owner/admin/staff), staff invites.
- **Full double-entry ledger**: chart of accounts, journal entries, trial balance,
  Profit & Loss, Balance Sheet. Every financial action in the app posts a balanced
  journal entry — nothing writes to the ledger directly.
- **Sales**: Clients, Quotes (convertible to Invoices), VAT Invoices, Credit Notes
  (with optional restocking), Payments, invoice voiding.
- **Purchases**: Vendors, Purchase Orders (convertible to Bills), Bills (with input
  VAT tracking and automatic inventory restocking), Bill Payments.
- **Inventory**: weighted-average-cost costing, full stock-movement audit trail,
  manual stock adjustments (with a clear opening-balance vs. shrinkage/correction
  distinction so the books stay honest), named Price Lists, reorder-point alerts.
- **Banking**: bank accounts, CSV statement import, manual reconciliation matching
  against the ledger.
- **Multi-currency**: every quote/invoice/PO/bill can carry its own currency and
  FX rate (manual rates recorded in Settings; the most recent rate for a currency
  is used automatically when a document doesn't specify one).
- **Reports**: P&L, Balance Sheet, Trial Balance, VAT Summary (output vs. input,
  net payable), Stock Valuation, AR Aging, AP Aging.
- **Branding**: Callisto Nexus name, logo and color palette throughout the app and
  every printed quote/invoice/credit note (including the bold, bordered "Amount in
  words" line carried over from the billing app).

## Explicitly deferred (flagged, not hidden)

- **Real UAE FTA e-invoicing submission** — VAT is calculated correctly on every
  document (5%, TRN on the printout, VAT summary report), but actually transmitting
  invoices to the FTA requires registering with an FTA-Accredited Service Provider
  (a business/legal step via the Peppol network), which nothing built in a coding
  session can do on its own.
- **Live bank feed** — needs a paid Open Banking aggregator; CSV import + manual
  matching is the substitute.
- **"Email to Client" / automated email delivery** — this app has no outbound email
  service configured. (The local billing app has a `mailto:`-based version of this;
  it can be ported here if wanted.)
- **Password reset** — not implemented; an admin can re-invite a user from Settings
  if needed.

## Tech stack

**Bun** (JS runtime with a built-in Postgres driver and password hashing — no npm
dependencies at all) + **PostgreSQL**, with a vanilla-JS frontend (no build step,
no framework, no bundler). Chosen so the whole thing runs and can be tested with
nothing beyond `bun` and `postgres` installed.

## Local development

1. Install [Bun](https://bun.sh) and have a PostgreSQL server running.
2. Create a database and copy `.env.example` to `.env`, filling in `DATABASE_URL`.
3. Start the app:
   ```
   bun run dev
   ```
   The server applies its database migrations automatically on startup (see
   `migrations/001_init.sql`) and serves the app at `http://localhost:3000`.
4. Open the app and sign up — the first account you create becomes the **owner**
   of a brand-new organization, with the standard chart of accounts seeded
   automatically.

### Running the automated tests

```
DATABASE_URL=postgres://user:pass@host/your_test_db bun test
```

Use a separate database for this — the tests insert real rows. They check the
core accounting invariants directly: every posted journal entry must balance,
weighted-average inventory costing computes correctly, VAT/discount totals compute
correctly, and an opening-balance stock adjustment nets against equity rather than
fabricating phantom profit through Cost of Goods Sold.

## Deploying it live

This app is a single Bun process plus a Postgres database — it runs on any host
that gives you both. Two straightforward options:

### Option A — Render

1. Push this folder to a GitHub repository.
2. On [Render](https://render.com), create a new **PostgreSQL** instance (free
   tier is fine to start) and copy its internal connection string.
3. Create a new **Web Service** from the same repo. Render will detect the
   `Dockerfile` automatically.
4. Set the environment variable `DATABASE_URL` to the connection string from
   step 2.
5. Deploy. Render builds the Docker image and starts the app; migrations run
   automatically on first boot.

### Option B — Railway

1. Push this folder to a GitHub repository.
2. On [Railway](https://railway.app), create a new project, add a **PostgreSQL**
   plugin, and add a service from your GitHub repo (it will use the included
   `Dockerfile`).
3. Railway automatically exposes `DATABASE_URL` for the Postgres plugin — link it
   to the web service's environment variables (Railway's "Variable Reference"
   feature does this with one click).
4. Deploy. Migrations run automatically on first boot.

Either way, once it's live: open the URL, sign up, and you're in your own
organization with its own data — every table is scoped by `org_id`, so multiple
organizations can safely share the same database if you ever need that.

## Project layout

```
server/
  index.js           — HTTP entry point, routing, static file serving
  db.js              — Postgres connection + migration runner
  lib/
    auth.js          — sessions, password hashing
    ledger.js        — the double-entry posting engine + report queries
    inventory.js     — weighted-average-cost stock engine
    sales-posting.js     — GL posting for invoices/payments/credit notes
    purchase-posting.js  — GL posting for bills/bill payments
    doclines.js      — line-item persistence helpers
    helpers.js       — numbering, currency, totals, response helpers
    router.js         — tiny path-param router
  routes/            — one file per resource (auth, contacts, items, quotes,
                        invoices, creditnotes, purchases, banking, reports)
public/
  index.html, styles.css
  js/                — vanilla-JS frontend: api.js (REST client), components.js
                        (reusable UI incl. the line-items editor), print.js
                        (printable document rendering), and one pages-*.js per module
migrations/001_init.sql — full database schema
tests/accounting.test.js — automated accounting-invariant tests
```
