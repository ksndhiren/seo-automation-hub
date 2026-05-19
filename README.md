# SEO Automation Hub

Central control repo for multi-site blog automation using Codex cron.

This repo is the orchestration layer, not the website itself. It is designed to:

- manage one master cron across multiple websites
- store topic queue and article job state
- store site-specific publishing rules
- pause for two human approval checkpoints
- resume jobs after approval
- publish approved content into site repos connected to Cloudflare Pages

## Core Idea

Each content job includes a `site_id`.

The master cron reads:

- site configuration from `config/sites`
- pending jobs from `data/jobs`
- approval state from `data/reviews`

Then it decides what to do next:

1. create a brief and outline
2. pause for `brief_pending` approval
3. draft and optimize article
4. pause for `final_pending` approval
5. publish approved jobs to the correct site repo

## Folder Structure

```text
seo-automation-hub/
  apps/
    dashboard/           # lightweight review UI later
  automation/
    prompts/             # master cron and specialist agent prompts
    templates/           # reusable prompt and payload templates
  config/
    sites/               # one JSON file per website
  data/
    jobs/                # article job records
    reviews/             # human review decisions and comments
    runs/                # execution logs and run summaries
  docs/
    architecture.md
    workflow.md
  scripts/               # utility scripts added later
```

## Job Lifecycle

- `new`
- `brief_pending`
- `brief_approved`
- `drafting`
- `final_pending`
- `final_approved`
- `publishing`
- `published`
- `needs_revision`
- `failed`

## Human Checkpoints

### Checkpoint 1

`brief_pending`

SEO expert reviews:

- topic
- keyword plan
- target URL
- search intent
- H1/H2/H3 outline
- target word count

### Checkpoint 2

`final_pending`

SEO expert reviews:

- final draft
- NeuronWriter score
- plagiarism status from manual check
- metadata
- internal links
- image plan

## What Belongs Here vs Site Repos

This repo should contain:

- workflow state
- dashboard
- prompts
- site configs
- approval records
- run logs

Site repos should contain:

- actual website content
- site-specific code
- publish branch history

## Next Setup Steps

1. fill in real site configs in `config/sites`
2. add the first real content jobs in `data/jobs`
3. add secrets handling for API keys
4. build the lightweight dashboard
5. create the master Codex cron against this repo
