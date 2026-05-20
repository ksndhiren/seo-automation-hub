# Master Cron Prompt

Run the SEO automation hub workflow from `/Users/abhishekutkarsha/Documents/Codex/seo-automation-hub`.

Use the existing script runner instead of hand-editing state:

```bash
python3 scripts/run_automation_cycle.py
```

The script already handles the required workflow:

1. Sync live dashboard review state from Cloudflare D1 back into the source job JSON files.
2. Process up to one eligible job per site for this run.
3. If a site has a `brief_approved` job, generate its draft and move it to `final_pending`.
4. After a draft is generated, if that site has no other active brief-stage item, generate the next calendar-aligned brief and move it to `brief_pending`.
5. Rebuild dashboard snapshot artifacts.
6. Sync the refreshed dashboard job state back into D1.
7. Write a run log.

Rules:

- This scheduled run is for drafting only, not publishing.
- Never publish from this automation.
- Ignore `final_approved` jobs because final approval publishing is handled immediately by the dashboard workflow.
- If a script step fails, stop and report the failure rather than trying to improvise manual JSON edits across many jobs.
- Preserve Jeff Martin Auctioneers as the named brand in CTA/conversion copy where applicable, and never use the microsite name as the speaking brand.
