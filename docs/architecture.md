# Architecture

## Overview

This repo is the automation hub for one master Codex cron.

It coordinates:

- Codex cron execution
- OpenAI writing/editing agents
- NeuronWriter optimization
- Pexels-driven visual sourcing
- GitHub publishing into site repos
- Cloudflare Pages deployment by GitHub push

## High-Level Flow

1. Read pending jobs.
2. Resolve target `site_id`.
3. Load site-specific config.
4. Run the correct stage for each job.
5. Pause at approval checkpoints.
6. Publish approved jobs to the correct site repo.

## Main Entities

### Site Config

One config file per website.

Contains:

- `site_id`
- `site_name`
- `github_repo`
- `publish_branch`
- `content_path`
- `cloudflare_project`
- `brand_guidelines`
- `seo_defaults`
- `internal_link_rules`

### Job

One file per article.

Contains:

- article topic
- keywords
- target URL
- current status
- generated brief
- generated draft
- score summaries
- review references
- publish result

### Review

Stores reviewer decision and comments for each checkpoint.

## Suggested Master Cron Pattern

One daily cron can safely handle multiple sites if:

- jobs are small enough per run
- state is explicit
- publish is blocked unless `final_approved`

If scale grows later, this hub can still support:

- one cron per site
- one cron for briefing and another for publishing

without changing the core data model.
