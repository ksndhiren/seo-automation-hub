# Dashboard V1

This is the lightweight SEO expert review dashboard for the automation hub.

## Current behavior

- reads live state from `functions/api/state.js`
- falls back to `apps/dashboard/data/dashboard-state.json` when no database is configured
- shows queue summary and job list
- shows brief and final-review detail views
- saves approval actions when D1 is configured
- otherwise previews approval actions locally in the browser

## Current limitation

This version supports a real persistence path through Cloudflare D1, but it is
not automatically provisioned yet.

That means:

- it is ready for visual review and workflow sign-off
- it becomes operational after D1 is bound in Cloudflare Pages

## Recommended next step

1. Create a D1 database.
2. Run `schema.sql` against it.
3. Bind the database to the Pages project as `DASHBOARD_DB`.
4. Deploy the dashboard.

## Local preview

Any static file server will work. Example:

```bash
cd apps/dashboard
python3 -m http.server 4173
```

## Cloudflare setup

- `functions/api/state.js` serves dashboard state
- `functions/api/review.js` persists approval actions
- `functions/api/reviews.js` returns review history for one job
- `wrangler.toml.example` shows the D1 binding needed
