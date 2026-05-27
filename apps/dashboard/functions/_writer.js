import {
  buildFallbackQueries,
  buildImagePlanForJob,
  chooseBestPexelsPhoto,
  normalizePhotoId,
  searchPexels,
} from "./_images.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";

const SITE_CONFIGS = {
  "cranes-auctions": {
    siteName: "CranesAuctions",
    siteUrl: "https://www.cranesauctions.com/",
    ctaUrl: "https://www.cranesauctions.com/#connect",
    leadGenerationBrand: "Jeff Martin Auctioneers",
    tone:
      "Experienced crane marketplace specialists who make buying, selling, and auctioning equipment feel credible, straightforward, and well-supported.",
    leadGenerationContext:
      "This micro-site exists to generate qualified leads for Jeff Martin Auctioneers. Content should position Jeff Martin Auctioneers as the real auction and advisory brand behind the experience, especially in CTAs, contact language, and trust-building references.",
    audience: [
      "Crane owners looking to sell underutilized equipment",
      "Equipment dealers with inventory to move",
      "Contractors sourcing cranes and heavy equipment",
      "Fleet managers handling surplus or replacement cycles",
      "Heavy transport and rigging businesses",
    ],
    avoid: [
      "keyword stuffing",
      "thin affiliate-style content",
      "overly generic AI phrasing",
      "overpromising on equipment valuation or auction outcomes",
      "using the microsite name as the speaking brand in CTAs when Jeff Martin Auctioneers should be named instead",
    ],
  },
  "jma-golfcarts": {
    siteName: "JMA Golf Carts",
    siteUrl: "https://www.jmagolfcarts.com/",
    ctaUrl: "https://www.jmagolfcarts.com/#buyer-register",
    leadGenerationBrand: "Jeff Martin Auctioneers",
    tone:
      "Practical golf cart marketplace specialists who make buying, selling, and comparing carts feel simple, transparent, and trustworthy.",
    leadGenerationContext:
      "This micro-site exists to generate qualified leads for Jeff Martin Auctioneers. Content should make Jeff Martin Auctioneers the trusted marketplace and contact brand behind the site, especially in CTAs and conversion language.",
    audience: [
      "Golf cart buyers comparing personal, utility, and fleet carts",
      "Dealers looking to move multiple carts through a marketplace",
      "Property owners and communities sourcing utility or street-legal carts",
      "Businesses evaluating fleet and maintenance cart options",
      "Sellers listing used golf carts online",
    ],
    avoid: [
      "keyword stuffing",
      "thin comparison content without useful buying guidance",
      "generic AI phrasing",
      "unverified claims about cart pricing, battery life, or availability",
      "using the microsite name as the speaking brand in CTAs when Jeff Martin Auctioneers should be named instead",
    ],
  },
};

export async function generateDraftForApprovedBrief(context, reviewRow) {
  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "OPENAI_API_KEY is not configured in Cloudflare Pages. Brief approval cannot generate drafts instantly yet.",
    };
  }

  const assetJob = await loadAssetJob(context, reviewRow.job_id);
  if (!assetJob?.brief?.summary || !assetJob?.brief?.outline?.length) {
    return {
      ok: false,
      message: "The current brief snapshot is unavailable, so drafting could not continue.",
    };
  }

  const site = SITE_CONFIGS[reviewRow.site_id];
  if (!site) {
    return {
      ok: false,
      message: `No writer config found for site_id ${reviewRow.site_id}.`,
    };
  }

  const systemPrompt =
    "You are a senior B2B content writer generating structured blog drafts for publication. Return only valid JSON. Write naturally, use short clear paragraphs, and keep SEO useful rather than forced.";
  const userPrompt = `
Site name: ${site.siteName}
Site URL: ${site.siteUrl}
CTA destination URL: ${site.ctaUrl}
Lead generation brand: ${site.leadGenerationBrand}
Brand tone: ${site.tone}
Lead generation context: ${site.leadGenerationContext}
Audience: ${JSON.stringify(site.audience)}
Avoid: ${JSON.stringify(site.avoid)}

Job topic: ${assetJob.topic}
Primary keyword: ${assetJob.primary_keyword}
Secondary keywords: ${JSON.stringify(assetJob.secondary_keywords || [])}
Target URL: ${assetJob.target_url}
Brief summary: ${assetJob.brief?.summary || ""}
Outline: ${JSON.stringify(assetJob.brief?.outline || [])}
SEO strategy: ${JSON.stringify(assetJob.seo_strategy || {})}
Target word count: ${assetJob.word_count || ""}

Return a JSON object with exactly these keys:
- title: string
- description: string
- readTime: string
- category: string
- tags: array of 3 to 6 strings
- seoTitle: string
- seoDescription: string
- intro: array of 2 strings
- sections: array of objects with keys heading (string), paragraphs (array of 2 strings minimum), optional bullets (array of strings), optional callout (string)
- faq: array of 2 to 4 objects with keys question and answer
- cta: object with keys title, body, buttonLabel, buttonHref

Rules:
- Use the category from seo_strategy where possible.
- The CTA and conversion language should name Jeff Martin Auctioneers as the trusted contact brand behind the micro-site whenever a company name is used.
- Do not make the microsite itself the speaking auction brand in CTA copy if Jeff Martin Auctioneers should be the named contact.
- Set cta.buttonHref exactly to the CTA destination URL provided above.
- Keep conversion intent strong. When the article references internal navigation or next steps, prioritize registration, connect, inquiry, or lead-capture destinations ahead of generic browsing paths.
- Do not include markdown fences.
- Do not include any extra keys.
`;

  const result = await callOpenAIJson({
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens: 5200,
  });

  const targetUrl = String(assetJob.target_url || "");
  const slug = targetUrl.replace(/\/$/, "").split("/").pop() || reviewRow.job_id;
  const publishedAt = new Date().toISOString().slice(0, 10);
  const draft = {
    slug,
    title: result.title,
    description: result.description,
    publishedAt,
    author: `${site.leadGenerationBrand} Editorial Team`,
    readTime: result.readTime,
    category: result.category,
    tags: result.tags,
    heroImage: "/hero.webp",
    featured: false,
    seoTitle: result.seoTitle,
    seoDescription: result.seoDescription,
    intro: result.intro,
    sections: result.sections,
    faq: result.faq,
    cta: result.cta,
  };

  const mergedJob = {
    ...assetJob,
    site_id: reviewRow.site_id,
    draft,
    image_plan: assetJob.image_plan || {},
  };
  const imagePlan = buildImagePlanForJob(mergedJob);
  const selectedImages = await autoSelectDraftImages(context, reviewRow, mergedJob, imagePlan);

  if (selectedImages[0]) {
    draft.heroImage = selectedImages[0].large || selectedImages[0].thumb || draft.heroImage;
    draft.heroImageAlt = selectedImages[0].alt || draft.title;
  }

  return {
    ok: true,
    draft,
    imagePlan: {
      ...imagePlan,
      selected_images: selectedImages,
    },
    selectedImages,
  };
}

export async function generateBriefForJob(context, reviewRow) {
  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "OPENAI_API_KEY is not configured in Cloudflare Pages. Brief generation cannot run instantly yet.",
    };
  }

  const assetJob = await loadAssetJob(context, reviewRow.job_id);
  if (!assetJob?.topic || !assetJob?.primary_keyword || !assetJob?.target_url) {
    return {
      ok: false,
      message: "The current job snapshot is unavailable, so brief generation could not continue.",
    };
  }

  const site = SITE_CONFIGS[reviewRow.site_id];
  if (!site) {
    return { ok: false, message: `No writer config found for site_id ${reviewRow.site_id}.` };
  }

  const systemPrompt =
    "You are an SEO strategist building article briefs for a human-reviewed content workflow. Return only valid JSON. Be specific, commercially aware, and avoid keyword stuffing.";
  const userPrompt = `
Site name: ${site.siteName}
Site URL: ${site.siteUrl}
CTA destination URL: ${site.ctaUrl}
Lead generation brand: ${site.leadGenerationBrand}
Brand tone: ${site.tone}
Lead generation context: ${site.leadGenerationContext}
Audience: ${JSON.stringify(site.audience)}

Job topic: ${assetJob.topic}
Primary keyword: ${assetJob.primary_keyword}
Secondary keywords: ${JSON.stringify(assetJob.secondary_keywords || [])}
Target URL: ${assetJob.target_url}
SEO strategy: ${JSON.stringify(assetJob.seo_strategy || {})}

Return a JSON object with exactly these keys:
- brief_summary: string
- outline: array of 6 to 8 strings
- search_intent: string
- cluster: string
- category_slug: string
- category_name: string
- suggested_tags: array of 3 to 6 strings
- recommended_internal_link_types: array of 3 to 5 strings
- target_word_count: integer

Rules:
- recommended_internal_link_types must prioritize lead-generation paths first.
- The first recommended_internal_link_types item must be the site's primary registration, connect, or lead capture destination type.
- Secondary internal link suggestions can support inventory, category, and landing-page discovery, but should not outrank the lead-generation path.
`;

  const result = await callOpenAIJson({
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens: 2200,
  });

  return {
    ok: true,
    brief: {
      summary: result.brief_summary,
      outline: result.outline,
    },
    seoStrategy: {
      ...(assetJob.seo_strategy || {}),
      search_intent: result.search_intent,
      cluster: result.cluster,
      category_slug: result.category_slug,
      category_name: result.category_name,
      suggested_tags: result.suggested_tags,
      recommended_internal_link_types: result.recommended_internal_link_types,
    },
    targetWordCount: Number(result.target_word_count) || null,
  };
}

export async function reviseBriefFromFeedback(context, reviewRow, reviewerNote) {
  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "OPENAI_API_KEY is not configured in Cloudflare Pages. Brief revision cannot run instantly yet.",
    };
  }

  const assetJob = await loadAssetJob(context, reviewRow.job_id);
  if (!assetJob?.brief?.summary || !assetJob?.brief?.outline?.length) {
    return {
      ok: false,
      message: "The current brief snapshot is unavailable, so brief revision could not continue.",
    };
  }
  const site = SITE_CONFIGS[reviewRow.site_id];
  if (!site) {
    return { ok: false, message: `No writer config found for site_id ${reviewRow.site_id}.` };
  }

  const systemPrompt =
    "You are an SEO strategist revising article briefs after human reviewer feedback. Return only valid JSON. Preserve the core keyword opportunity, but improve clarity, angle, and structure based on the note.";
  const userPrompt = `
Site name: ${site.siteName}
Site URL: ${site.siteUrl}
CTA destination URL: ${site.ctaUrl}
Lead generation brand: ${site.leadGenerationBrand}
Brand tone: ${site.tone}
Lead generation context: ${site.leadGenerationContext}
Audience: ${JSON.stringify(site.audience)}

Job topic: ${assetJob.topic}
Primary keyword: ${assetJob.primary_keyword}
Secondary keywords: ${JSON.stringify(assetJob.secondary_keywords || [])}
Target URL: ${assetJob.target_url}
Existing brief summary: ${assetJob.brief?.summary || ""}
Existing outline: ${JSON.stringify(assetJob.brief?.outline || [])}
SEO strategy: ${JSON.stringify(assetJob.seo_strategy || {})}
Reviewer note: ${reviewerNote}

Return a JSON object with exactly these keys:
- brief_summary: string
- outline: array of 6 to 8 strings
- search_intent: string
- cluster: string
- category_slug: string
- category_name: string
- suggested_tags: array of 3 to 6 strings
- recommended_internal_link_types: array of 3 to 5 strings
- target_word_count: integer

Rules:
- recommended_internal_link_types must prioritize lead-generation paths first.
- The first recommended_internal_link_types item must be the site's primary registration, connect, or lead capture destination type.
- Secondary internal link suggestions can support inventory, category, and landing-page discovery, but should not outrank the lead-generation path.
`;

  const result = await callOpenAIJson({
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens: 2200,
  });

  return {
    ok: true,
    brief: {
      summary: result.brief_summary,
      outline: result.outline,
    },
    seoStrategy: {
      ...(assetJob.seo_strategy || {}),
      search_intent: result.search_intent,
      cluster: result.cluster,
      category_slug: result.category_slug,
      category_name: result.category_name,
      suggested_tags: result.suggested_tags,
      recommended_internal_link_types: result.recommended_internal_link_types,
    },
    targetWordCount: Number(result.target_word_count) || null,
  };
}

export async function reviseDraftFromFeedback(context, reviewRow, reviewerNote) {
  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "OPENAI_API_KEY is not configured in Cloudflare Pages. Draft revision cannot run instantly yet.",
    };
  }

  const assetJob = await loadAssetJob(context, reviewRow.job_id);
  if (!assetJob?.draft) {
    return {
      ok: false,
      message: "The current draft snapshot is unavailable, so draft revision could not continue.",
    };
  }
  const site = SITE_CONFIGS[reviewRow.site_id];
  if (!site) {
    return { ok: false, message: `No writer config found for site_id ${reviewRow.site_id}.` };
  }

  const systemPrompt =
    "You are a senior B2B content writer revising a structured blog draft after human reviewer feedback. Return only valid JSON. Address the reviewer note directly while preserving the article's keyword intent and commercial usefulness.";
  const userPrompt = `
Site name: ${site.siteName}
Site URL: ${site.siteUrl}
Lead generation brand: ${site.leadGenerationBrand}
Brand tone: ${site.tone}
Lead generation context: ${site.leadGenerationContext}
Audience: ${JSON.stringify(site.audience)}
Avoid: ${JSON.stringify(site.avoid)}

Job topic: ${assetJob.topic}
Primary keyword: ${assetJob.primary_keyword}
Secondary keywords: ${JSON.stringify(assetJob.secondary_keywords || [])}
Target URL: ${assetJob.target_url}
Brief summary: ${assetJob.brief?.summary || ""}
Outline: ${JSON.stringify(assetJob.brief?.outline || [])}
SEO strategy: ${JSON.stringify(assetJob.seo_strategy || {})}
Current draft: ${JSON.stringify(assetJob.draft || {})}
Reviewer note: ${reviewerNote}

Return a JSON object with exactly these keys:
- title: string
- description: string
- readTime: string
- category: string
- tags: array of 3 to 6 strings
- seoTitle: string
- seoDescription: string
- intro: array of 2 strings
- sections: array of objects with keys heading (string), paragraphs (array of 2 strings minimum), optional bullets (array of strings), optional callout (string)
- faq: array of 2 to 4 objects with keys question and answer
- cta: object with keys title, body, buttonLabel, buttonHref

Rules:
- Preserve the CTA destination by setting cta.buttonHref exactly to the CTA destination URL provided above.
- When revising any internal navigation or next-step language, prioritize registration, connect, inquiry, or lead-capture destinations ahead of generic browsing paths.
`;

  const result = await callOpenAIJson({
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens: 5200,
  });

  const currentDraft = assetJob.draft || {};
  const draft = {
    ...currentDraft,
    title: result.title,
    description: result.description,
    readTime: result.readTime,
    category: result.category,
    tags: result.tags,
    seoTitle: result.seoTitle,
    seoDescription: result.seoDescription,
    intro: result.intro,
    sections: result.sections,
    faq: result.faq,
    cta: result.cta,
  };

  const mergedJob = {
    ...assetJob,
    site_id: reviewRow.site_id,
    draft,
    image_plan: assetJob.image_plan || {},
  };
  const imagePlan = buildImagePlanForJob(mergedJob);
  const selectedImages = await autoSelectDraftImages(context, reviewRow, mergedJob, imagePlan);

  if (selectedImages[0]) {
    draft.heroImage = selectedImages[0].large || selectedImages[0].thumb || draft.heroImage || "/hero.webp";
    draft.heroImageAlt = selectedImages[0].alt || draft.title;
  }

  return {
    ok: true,
    draft,
    imagePlan: {
      ...imagePlan,
      selected_images: selectedImages,
    },
    selectedImages,
  };
}

async function autoSelectDraftImages(context, reviewRow, job, imagePlan) {
  const apiKey = context.env.PEXELS_API_KEY;
  const items = imagePlan?.items || [];
  if (!apiKey || !items.length) {
    return [];
  }

  const d1 = context.env.DASHBOARD_DB;
  const duplicateRows = await d1
    .prepare(
      `SELECT selected_images_json
       FROM dashboard_jobs
       WHERE site_id = ? AND job_id <> ? AND status IN ('brief_pending', 'final_pending', 'final_approved', 'published')`,
    )
    .bind(reviewRow.site_id, reviewRow.job_id)
    .all();

  const usedIds = new Set();
  for (const row of duplicateRows.results || []) {
    const images = JSON.parse(row.selected_images_json || "[]");
    for (const image of images) {
      const key = normalizePhotoId(image);
      if (key) usedIds.add(key);
    }
  }

  const selections = [];
  for (const item of items) {
    const queries = buildFallbackQueries(job, item);
    let chosen = null;
    for (const query of queries) {
      const photos = await searchPexels(apiKey, query, 6);
      if (!photos.length) continue;
      chosen = chooseBestPexelsPhoto(job, item, photos, usedIds);
      if (chosen) break;
    }
    selections.push(chosen || null);
    const key = normalizePhotoId(chosen);
    if (key) usedIds.add(key);
  }

  return selections;
}

async function loadAssetJob(context, jobId) {
  const requestUrl = new URL(context.request.url);
  const dataUrl = new URL("/data/dashboard-state.json", requestUrl.origin);
  const assetResponse = await context.env.ASSETS.fetch(dataUrl);
  if (!assetResponse.ok) {
    return null;
  }

  const assetState = await assetResponse.json();
  const assetJob = (assetState.jobs || []).find((job) => job.job_id === jobId) || null;
  if (!assetJob) {
    return null;
  }

  const d1 = context.env.DASHBOARD_DB;
  if (!d1) {
    return assetJob;
  }

  const row = await d1
    .prepare(
      `SELECT brief_summary, outline_json, draft_json, selected_images_json, word_count
       FROM dashboard_jobs
       WHERE job_id = ?
       LIMIT 1`,
    )
    .bind(jobId)
    .first();

  if (!row) {
    return assetJob;
  }

  return {
    ...assetJob,
    brief: {
      summary: row.brief_summary || assetJob.brief?.summary || "",
      outline: JSON.parse(row.outline_json || "[]").length
        ? JSON.parse(row.outline_json || "[]")
        : assetJob.brief?.outline || [],
    },
    draft: row.draft_json && row.draft_json !== "null"
      ? JSON.parse(row.draft_json)
      : assetJob.draft || null,
    image_plan: {
      ...(assetJob.image_plan || {}),
      selected_images: JSON.parse(row.selected_images_json || "[]"),
    },
    word_count: row.word_count || assetJob.word_count || "",
  };
}

async function callOpenAIJson({ apiKey, systemPrompt, userPrompt, maxOutputTokens = 4000 }) {
  const payload = {
    model: DEFAULT_MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_output_tokens: maxOutputTokens,
  };

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
          throw new Error(body?.error?.message || body?.message || "OpenAI request failed.");
        }
        lastError = new Error(body?.error?.message || body?.message || "OpenAI request failed.");
      } else {
        const rawText = extractText(body);
        return parseJsonObject(rawText);
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw lastError || new Error("OpenAI request failed.");
}

function extractText(body) {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }
  const chunks = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  const joined = chunks.join("\n").trim();
  if (joined) return joined;
  throw new Error("OpenAI response did not contain extractable text.");
}

function parseJsonObject(rawText) {
  let text = String(rawText || "").trim();
  if (text.startsWith("```")) {
    text = stripFence(text);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("OpenAI response JSON must be an object.");
    }
    return parsed;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("OpenAI response was not valid JSON.");
    }
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("OpenAI response JSON must be an object.");
    }
    return parsed;
  }
}

function stripFence(text) {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("```")) lines.shift();
  if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
  return lines.join("\n").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
