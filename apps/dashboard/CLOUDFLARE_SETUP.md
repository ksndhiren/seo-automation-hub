# Cloudflare Pages + D1 Setup

This dashboard can run in two modes:

- `static fallback` using `data/dashboard-state.json`
- `live review mode` using Cloudflare Pages Functions + D1

## Recommended token permissions

For a token used to deploy and configure this dashboard, the minimum practical
account-level permissions are:

- `Pages Edit`
- `D1 Edit`

If you only need read-only API access later, Cloudflare documents that:

- `Pages Read` or `Pages Write` can access Pages API endpoints
- `D1 Read` and `D1 Edit` are separate account permissions

If you want to automate Cloudflare Access configuration for protecting the
dashboard by API, add:

- `Access: Apps and Policies Edit`

Otherwise, you can configure Cloudflare Access manually in the dashboard and do
not need that token permission for now.

Sources:

- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Cloudflare Pages API token permissions](https://developers.cloudflare.com/pages/configuration/api/)
- [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)

## Suggested token scope

Scope the token to the specific Cloudflare account that owns:

- the Pages project
- the D1 database

Do not create a broader token than needed.

## Setup steps

1. Create a new Cloudflare Pages project for this dashboard.
2. Create a D1 database.
3. Apply the schema from `schema.sql`.
4. Generate seed SQL from the current dashboard snapshot.
5. Import the seed SQL into D1.
6. Bind the D1 database to the Pages project as `DASHBOARD_DB`.
7. Deploy the dashboard.
8. Optionally protect it with Cloudflare Access.

## Commands

From the dashboard directory:

```bash
python3 ../../scripts/build_dashboard_state.py
python3 ../../scripts/build_dashboard_seed_sql.py
```

Then apply schema and seed with Wrangler:

```bash
wrangler d1 execute <YOUR_DB_NAME> --file=./schema.sql
wrangler d1 execute <YOUR_DB_NAME> --file=./seed.sql
```

## Binding

Bind the database in Cloudflare Pages as:

- `DASHBOARD_DB`

The dashboard API will automatically switch from static fallback to live D1 mode
when that binding is present.

## Optional protection

For v1, the cleanest way to share the dashboard with your SEO expert is:

- deploy the dashboard publicly on Pages
- protect it with Cloudflare Access
- allow only your email and the SEO expert's email

This avoids building full custom auth immediately.
