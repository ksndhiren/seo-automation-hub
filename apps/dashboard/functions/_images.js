import { json } from "./_shared.js";

export async function searchPexels(apiKey, query, perPage = 6) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    return [];
  }

  const apiUrl = new URL("https://api.pexels.com/v1/search");
  apiUrl.searchParams.set("query", cleanQuery);
  apiUrl.searchParams.set("per_page", String(Math.min(8, Math.max(1, perPage))));
  apiUrl.searchParams.set("orientation", "landscape");

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return (payload.photos || []).map((photo) => ({
    id: photo.id,
    alt: photo.alt || "",
    photographer: photo.photographer || "",
    thumb: photo.src?.medium || photo.src?.small || "",
    large: photo.src?.large2x || photo.src?.large || photo.src?.medium || "",
    original: photo.src?.original || photo.src?.large2x || "",
    width: photo.width || null,
    height: photo.height || null,
    pexels_url: photo.url || "",
  }));
}

export function buildImagePlanForJob(job) {
  const draft = job?.draft || {};
  const sections = draft.sections || [];
  const topic = job?.topic || "blog article";
  const primaryKeyword = job?.primary_keyword || "";
  const siteId = job?.site_id || "";
  const selectedImages = job?.image_plan?.selected_images || [];
  const categorySlug = job?.seo_strategy?.category_slug || "";

  if (siteId === "jma-golfcarts") {
    const plans = [
      {
        placement: "Featured image",
        asset_hint: draft.heroImage || "Not assigned yet",
        query: golfCartFeaturedQuery(categorySlug, primaryKeyword, topic),
        prompt:
          `Realistic editorial photo of a used golf cart prepared for sale outdoors, clean daylight, trustworthy marketplace mood, no text overlay, visually supports the topic '${topic}'.`,
      },
    ];

    if (sections.length >= 2) {
      plans.push({
        placement: `After section: ${sections[1]?.heading || "Listing details"}`,
        asset_hint: "Prompt only",
        query: "golf cart inspection listing details realistic",
        prompt:
          "Detailed golf cart inspection scene with close-up listing details, service notes, and condition checks, natural light, realistic marketplace photography, no staged AI look, no text.",
      });
    }

    if (sections.length >= 3) {
      plans.push({
        placement: `After section: ${sections[2]?.heading || "Preparation checklist"}`,
        asset_hint: "Prompt only",
        query: "cleaning golf cart for sale realistic",
        prompt:
          `Seller preparing a golf cart for online sale with cleaning, photo setup, and checklist steps visible, credible commercial style, realistic details, supports keyword '${primaryKeyword}'.`,
      });
    }

    return { status: "planned", items: plans, selected_images: selectedImages };
  }

  const plans = [
    {
      placement: "Featured image",
      asset_hint: draft.heroImage || "Not assigned yet",
      query: "used crane industrial yard equipment auction",
      prompt:
        `Realistic editorial photo of a used crane prepared for auction in an industrial yard, clean daylight, documentary style, no text overlay, trustworthy heavy-equipment marketplace mood, supports the topic '${topic}'.`,
    },
  ];

  if (sections.length >= 2) {
    plans.push({
      placement: `After section: ${sections[1]?.heading || "Buyer information"}`,
      asset_hint: "Prompt only",
      query: "crane inspection maintenance records industrial equipment",
      prompt:
        "Detailed crane inspection scene with paperwork, serial plate, and maintenance records visible, professional industrial photography, natural light, no staged AI look, no text.",
    });
  }

  if (sections.length >= 3) {
    plans.push({
      placement: `After section: ${sections[2]?.heading || "Preparation checklist"}`,
      asset_hint: "Prompt only",
      query: "preparing crane for sale inspection heavy equipment yard",
      prompt:
        `Heavy equipment seller preparing a crane for listing, showing cleaning, inspection, and photo capture steps, credible B2B industrial style, sharp realistic details, visually supports keyword '${primaryKeyword}'.`,
    });
  }

  return { status: "planned", items: plans, selected_images: selectedImages };
}

export function buildFallbackQueries(job, item) {
  const siteId = job.site_id || "";
  const category = job.seo_strategy?.category_name || "";
  const categorySlug = job.seo_strategy?.category_slug || "";
  const primary = job.primary_keyword || "";
  const topic = job.topic || "";
  const placement = item?.placement || "";

  if (siteId === "jma-golfcarts") {
    return uniqueStrings([
      item?.query,
      topic,
      primary,
      `${primary} golf cart`,
      `${category} golf cart`,
      golfCartFeaturedQuery(categorySlug, primary, topic),
      "used golf cart",
      "golf cart",
      placement.includes("Featured") ? "golf cart outdoors" : "golf cart detail",
    ]);
  }

  return uniqueStrings([
    item?.query,
    primary,
    `${primary} crane`,
    `${category} crane`,
    "used crane",
    "construction crane",
    placement.includes("Featured") ? "industrial crane yard" : "crane inspection",
  ]);
}

export function chooseBestPexelsPhoto(job, item, photos, usedIds = new Set()) {
  if (!photos?.length) return null;

  const siteId = job.site_id || "";
  const terms = uniqueStrings(
    [
      job.primary_keyword,
      item?.placement,
      job.seo_strategy?.category_name,
      siteId === "jma-golfcarts" ? "golf cart" : "crane",
      siteId === "jma-golfcarts" ? "vehicle" : "industrial",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

  const ranked = [...photos]
    .map((photo) => ({
      photo,
      score: scorePexelsPhoto(photo, terms, siteId, usedIds),
    }))
    .sort((a, b) => b.score - a.score);

  const uniqueChoice = ranked.find((item_) => !usedIds.has(normalizePhotoId(item_.photo)));
  return uniqueChoice?.photo || null;
}

function scorePexelsPhoto(photo, keywordTerms, siteId, usedIds) {
  const text = `${photo.alt || ""} ${photo.photographer || ""}`.toLowerCase();
  let score = 0;

  keywordTerms.forEach((term) => {
    if (term && text.includes(term)) score += 2;
  });

  if (siteId === "jma-golfcarts") {
    if (text.includes("golf")) score += 6;
    if (text.includes("cart")) score += 6;
    if (text.includes("vehicle")) score += 1;
  } else {
    if (text.includes("crane")) score += 6;
    if (text.includes("construction")) score += 2;
    if (text.includes("industrial")) score += 2;
    if (text.includes("equipment")) score += 1;
  }

  if (photo.width && photo.height && photo.width > photo.height) score += 1;
  if (usedIds.has(normalizePhotoId(photo))) score -= 100;

  return score;
}

export function normalizePhotoId(photo) {
  if (photo?.id != null) return `id:${photo.id}`;
  if (photo?.pexels_url) return `url:${photo.pexels_url}`;
  if (photo?.large) return `img:${photo.large}`;
  return "";
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function golfCartFeaturedQuery(categorySlug, primaryKeyword, topic) {
  switch (categorySlug) {
    case "utility-work-carts":
      return "utility golf cart work property maintenance realistic";
    case "brand-comparisons":
      return "club car ezgo golf carts comparison realistic";
    case "maintenance-ownership":
      return "golf cart maintenance service inspection realistic";
    case "street-legal-carts":
      return "street legal golf cart neighborhood realistic";
    case "selling-guides":
      return "used golf cart for sale listing realistic";
    case "buying-guides":
      return "used golf cart buyer guide realistic";
    default:
      return primaryKeyword
        ? `${primaryKeyword} realistic`
        : `${topic || "used golf cart"} realistic`;
  }
}

export function jsonOk(data, init = {}) {
  return json({ ok: true, ...data }, init);
}
