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

  // Jeff Martin's auction inventory is overwhelmingly wheeled / mobile
  // cranes (~89% mobile: truck, all-terrain, rough-terrain, carry deck,
  // boom truck) — tower cranes are <2%, crawler ~6%. So unless the article
  // is specifically about a tower/crawler, image picks should reflect a
  // hydraulic mobile crane on outriggers, not a tall lattice tower.
  const persona = detectCranePersona({
    topic,
    primaryKeyword,
    category: job?.seo_strategy?.category_name || "",
    categorySlug,
  });

  const featuredQuery = cranesFeaturedQuery(persona, primaryKeyword, topic);
  const featuredPrompt = cranesFeaturedPrompt(persona, topic);

  const plans = [
    {
      placement: "Featured image",
      asset_hint: draft.heroImage || "Not assigned yet",
      query: featuredQuery,
      prompt: featuredPrompt,
    },
  ];

  if (sections.length >= 2) {
    plans.push({
      placement: `After section: ${sections[1]?.heading || "Buyer information"}`,
      asset_hint: "Prompt only",
      query: cranesInspectionQuery(persona),
      prompt:
        "Detailed crane inspection scene with paperwork, serial plate, and maintenance records visible, professional industrial photography, natural light, no staged AI look, no text.",
    });
  }

  if (sections.length >= 3) {
    plans.push({
      placement: `After section: ${sections[2]?.heading || "Preparation checklist"}`,
      asset_hint: "Prompt only",
      query: cranesPrepQuery(persona, primaryKeyword),
      prompt:
        `Heavy equipment seller preparing a crane for listing, showing cleaning, inspection, and photo capture steps, credible B2B industrial style, sharp realistic details, visually supports keyword '${primaryKeyword}'.`,
    });
  }

  return { status: "planned", items: plans, selected_images: selectedImages };
}

// Persona detection — looks at the topic/keyword/category strings for an
// explicit crane type. Defaults to "mobile" since that matches the bulk of
// the auction inventory. Order matters: check the most specific terms first.
function detectCranePersona({ topic, primaryKeyword, category, categorySlug }) {
  const haystack = `${topic || ""} ${primaryKeyword || ""} ${category || ""} ${categorySlug || ""}`.toLowerCase();
  if (/(tower\s*crane|self[-\s]*erecting|luffing jib)/.test(haystack)) return "tower";
  if (/(crawler\s*crane|lattice\s*boom|tracked\s*crane)/.test(haystack)) return "crawler";
  if (/(rough\s*terrain|rt\s*crane|rough-terrain)/.test(haystack)) return "rough-terrain";
  if (/(all[-\s]*terrain|at\s*crane)/.test(haystack)) return "all-terrain";
  if (/(truck\s*crane|boom\s*truck|carrier\s*mounted)/.test(haystack)) return "truck";
  if (/(carry\s*deck|industrial\s*pick|pick\s*and\s*carry)/.test(haystack)) return "carry-deck";
  return "mobile"; // default: hydraulic wheeled mobile crane
}

function cranesFeaturedQuery(persona, primaryKeyword, topic) {
  const base = {
    "tower": "tower crane construction site skyline",
    "crawler": "crawler crane lattice boom construction site",
    "rough-terrain": "rough terrain crane yard outriggers",
    "all-terrain": "all terrain mobile crane truck outriggers",
    "truck": "truck mounted hydraulic crane outriggers",
    "carry-deck": "industrial carry deck crane warehouse",
    "mobile": "mobile hydraulic crane outriggers construction site",
  }[persona] || "mobile hydraulic crane outriggers construction site";
  return primaryKeyword
    ? `${primaryKeyword} ${base}`.trim()
    : `${topic || "used crane"} ${base}`.trim();
}

function cranesFeaturedPrompt(persona, topic) {
  const description = {
    "tower": "a tall stationary tower crane silhouetted against the skyline of an active construction site",
    "crawler": "a tracked crawler crane with a lattice boom lifting on a heavy construction site",
    "rough-terrain": "a four-wheel rough-terrain mobile crane set up on outriggers on a dirt construction site",
    "all-terrain": "a multi-axle all-terrain mobile crane with telescoping boom and outriggers extended at a job site",
    "truck": "a truck-mounted hydraulic boom crane with outriggers extended at a job site",
    "carry-deck": "a compact industrial carry-deck pick-and-carry crane inside a warehouse",
    "mobile": "a wheeled hydraulic mobile crane with telescoping boom and outriggers extended at a job site",
  }[persona] || "a wheeled hydraulic mobile crane with telescoping boom and outriggers extended at a job site";
  return `Realistic editorial photo of ${description}, clean daylight, documentary style, no text overlay, trustworthy heavy-equipment marketplace mood, visually supports the topic '${topic}'.`;
}

function cranesInspectionQuery(persona) {
  const noun = persona === "tower"
    ? "tower crane"
    : persona === "crawler"
      ? "crawler crane"
      : "mobile crane truck";
  return `${noun} inspection maintenance records industrial equipment`;
}

function cranesPrepQuery(persona, primaryKeyword) {
  const noun = persona === "tower"
    ? "tower crane"
    : persona === "crawler"
      ? "crawler crane lattice"
      : "mobile crane truck";
  return `${primaryKeyword || "used crane"} ${noun} preparation yard`.trim();
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

  // Default to mobile crane fallback queries — same rationale as the
  // image plan above. Only switch to tower / crawler when the article
  // is specifically about that type. Even when the article topic is
  // generic ("How to value a used crane"), Pexels has far more good
  // mobile-crane stock than tower-crane stock.
  const persona = detectCranePersona({
    topic,
    primaryKeyword: primary,
    category,
    categorySlug,
  });
  const personaNoun = {
    "tower": "tower crane",
    "crawler": "crawler crane lattice",
    "rough-terrain": "rough terrain crane outriggers",
    "all-terrain": "all terrain crane outriggers",
    "truck": "truck mounted crane",
    "carry-deck": "carry deck crane",
    "mobile": "mobile hydraulic crane",
  }[persona] || "mobile hydraulic crane";

  return uniqueStrings([
    item?.query,
    primary,
    `${primary} ${personaNoun}`,
    `${category} ${personaNoun}`,
    personaNoun,
    "mobile crane truck",
    "hydraulic crane outriggers",
    "used crane",
    placement.includes("Featured") ? `${personaNoun} yard` : `${personaNoun} inspection`,
  ]);
}

export function chooseBestPexelsPhoto(job, item, photos, usedIds = new Set()) {
  if (!photos?.length) return null;

  const siteId = job.site_id || "";
  const persona = siteId === "cranes-auctions"
    ? detectCranePersona({
        topic: job.topic,
        primaryKeyword: job.primary_keyword,
        category: job.seo_strategy?.category_name || "",
        categorySlug: job.seo_strategy?.category_slug || "",
      })
    : null;
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
      score: scorePexelsPhoto(photo, terms, siteId, usedIds, persona),
    }))
    .sort((a, b) => b.score - a.score);

  const uniqueChoice = ranked.find((item_) => !usedIds.has(normalizePhotoId(item_.photo)));
  return uniqueChoice?.photo || null;
}

function scorePexelsPhoto(photo, keywordTerms, siteId, usedIds, persona) {
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

    // Mobile-crane bias for cranesauctions: the auction inventory is ~89%
    // wheeled cranes (truck, all-terrain, rough-terrain, carry deck, boom
    // truck). Reward shots that look like that and penalize tower / lattice
    // / construction-skyline shots — UNLESS the article is specifically
    // about that crane type, in which case we *want* those.
    const mobileTerms = [
      "truck",
      "wheel",
      "tire",
      "tyres",
      "outrigger",
      "hydraulic",
      "boom truck",
      "mobile crane",
      "rough terrain",
      "all terrain",
      "carry deck",
    ];
    const towerLikeTerms = [
      "tower crane",
      "tower-crane",
      "lattice",
      "skyline",
      "skyscraper",
      "high rise",
      "high-rise",
      "rooftop",
    ];
    const crawlerTerms = ["crawler", "tracked", "tracks", "lattice boom"];

    for (const term of mobileTerms) {
      if (text.includes(term)) {
        // Big reward when persona is mobile-ish, mild reward otherwise.
        score += persona && persona !== "tower" && persona !== "crawler" ? 4 : 2;
      }
    }
    for (const term of towerLikeTerms) {
      if (text.includes(term)) {
        // Reward only when the article is actually about tower cranes,
        // otherwise penalize so generic crane articles avoid them.
        score += persona === "tower" ? 5 : -6;
      }
    }
    for (const term of crawlerTerms) {
      if (text.includes(term)) {
        score += persona === "crawler" ? 5 : -3;
      }
    }
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
