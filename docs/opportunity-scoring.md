# Opportunity Scoring Model

Status: Active for new-site editorial prioritization

Because both `CranesAuctions` and `JMA Golf Carts` are new sites, the content queue should currently be prioritized by an `opportunity score`, not by Search Console data.

This score is intended to answer:

- Which topics are most likely to help the site enter search results?
- Which topics are closest to commercial value?
- Which topics help build category authority and internal linking strength fastest?

## Scoring Components

Each topic is scored out of `100`.

### 1. Commercial Intent Fit (`0-25`)

How closely the keyword aligns with a buyer, seller, valuation, comparison, or decision-stage search.

High examples:
- sell used crane at auction
- sell used golf cart online
- how to buy a used crane at auction

### 2. Demand Likelihood (`0-20`)

A directional estimate of whether the topic is likely to have real search demand in the market, even before we have GSC data.

This is based on:
- phrase naturalness
- recurring buyer/seller language
- obvious marketplace relevance

### 3. SERP Entry Potential (`0-20`)

How realistic it is that a new site can compete for this topic with a high-quality, well-structured page.

Higher scores go to:
- long-tail questions
- practical guides
- decision support topics

Lower scores go to:
- broad head terms
- highly brand-dominated SERPs

### 4. Cluster Leverage (`0-20`)

How much the topic strengthens a category and creates internal-linking value around adjacent topics.

High scores go to:
- foundational cluster pages
- topics that support multiple future posts
- topics that connect cleanly to category pages or service pages

### 5. Differentiation / Helpfulness Potential (`0-15`)

How likely the site can produce a more useful, more specific, more trustworthy version of the topic than thin existing content.

Higher scores go to:
- checklists
- practical comparisons
- workflow explainers
- preparation guides

## Practical Interpretation

- `90-100`: core first-wave opportunity
- `80-89`: strong next-wave opportunity
- `70-79`: useful support content
- `<70`: lower priority for a new site unless needed for cluster completeness

## Current Rule

For new sites, queue order should use:

1. workflow status
2. explicit priority (`high` before `medium`)
3. opportunity score
4. job age

## Future Shift

Once the sites accumulate meaningful Search Console data, this model should become:

- editorial opportunity score
- plus GSC evidence

At that stage, queue order should become:

- status
- commercial priority
- GSC opportunity
- editorial opportunity score

