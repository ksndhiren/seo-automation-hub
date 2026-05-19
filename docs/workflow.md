# Workflow

## Stage 1: Intake

- read a new content job from `data/jobs`
- validate `site_id`
- load the matching site config

## Stage 2: Briefing

- create topic brief
- create outline
- fetch optimization guidance
- set status to `brief_pending`

## Stage 3: Human Review 1

- SEO expert approves or requests changes
- on approval set status to `brief_approved`
- on changes set status to `needs_revision`

## Stage 4: Drafting

- generate article sections
- edit for structure and readability
- optimize naturally
- prepare visuals
- set status to `final_pending`

## Stage 5: Human Review 2

- SEO expert approves for publish or requests changes
- SEO expert performs plagiarism check manually at this stage for now
- on approval set status to `final_approved`
- on changes set status to `needs_revision`

## Stage 6: Publishing

- write article into correct site repo
- commit and push
- wait for Cloudflare Pages deploy
- record live URL and status

## Revision Handling

If status is `needs_revision`, the master cron should:

- read stored review comments
- infer the correct stage to resume from
- apply only the requested changes
- avoid redoing already-approved work unless the reviewer asked for it
