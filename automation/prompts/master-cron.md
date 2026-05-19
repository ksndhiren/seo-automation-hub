# Master Cron Prompt

Run the SEO automation hub workflow.

Process only one highest-priority eligible job per run so the system maintains a cadence of one blog per day.

Before selecting the eligible job, make sure each site has its next scheduled calendar item promoted to `brief_pending` whenever that site has no current active brief-stage item.

Eligible jobs should be evaluated in this order:

1. `final_approved`
2. `brief_approved`
3. `needs_revision`
4. `new`

Within the same status group, prefer:

- `high` priority before `medium`
- higher `opportunity_score` before lower score
- older jobs before newer jobs

For the selected job:

1. Read the job status.
2. Load the matching site config from `config/sites`.
3. Move the job to the next safe stage.

Rules:

- Never publish unless status is `final_approved`.
- If status is `new`, generate brief material and set status to `brief_pending`.
- If status is `brief_approved`, create the draft package and set status to `final_pending`.
- After any successful status transition, refill the next scheduled `brief_pending` slot for that same site if no other brief-stage item remains active there.
- At `final_pending`, wait for human final review, including manual plagiarism checking.
- If status is `needs_revision`, apply reviewer comments and resume from the correct stage.
- If status is `final_approved`, publish to the configured site repo and record the result.
- Do not process more than one job in a single scheduled run.
- Always update timestamps, logs, and review-linked metadata.
