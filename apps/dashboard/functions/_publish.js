const SITE_CONFIGS = {
  "cranes-auctions": {
    owner: "ksndhiren",
    repo: "Auctioncrane",
    branch: "main",
    contentPath: "src/web/content/blog",
    siteUrl: "https://www.cranesauctions.com",
  },
  "jma-golfcarts": {
    owner: "ksndhiren",
    repo: "golfcarts",
    branch: "main",
    contentPath: "src/content/blog/generated",
    siteUrl: "https://www.jmagolfcarts.com",
  },
};

export async function publishApprovedJob(context, reviewRow) {
  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    return {
      ok: false,
      message:
        "GITHUB_TOKEN is not configured in Cloudflare Pages. Final approval cannot publish yet.",
    };
  }

  const assetJob = await loadAssetJob(context, reviewRow.job_id);
  const d1Draft = parseJson(reviewRow.draft_json);
  if (!assetJob || !(assetJob.draft || d1Draft)) {
    return {
      ok: false,
      message: "The current draft snapshot is unavailable, so publishing could not continue.",
    };
  }

  const siteConfig = SITE_CONFIGS[reviewRow.site_id];
  if (!siteConfig) {
    return {
      ok: false,
      message: `No publish config found for site_id ${reviewRow.site_id}.`,
    };
  }

  const mergedJob = {
    ...assetJob,
    draft: d1Draft || assetJob.draft,
    status: reviewRow.status,
    final_review: {
      ...(assetJob.final_review || {}),
      manual_plagiarism_status: reviewRow.manual_plagiarism_status,
      flagged_sections_note: reviewRow.flagged_sections_note || "",
    },
    image_plan: {
      ...(assetJob.image_plan || {}),
      selected_images: JSON.parse(reviewRow.selected_images_json || "[]"),
    },
    publish: {
      ...(assetJob.publish || {}),
      branch: reviewRow.publish_branch || siteConfig.branch,
      path: reviewRow.publish_path || siteConfig.contentPath,
    },
  };

  const moduleSource = renderTypescriptModule(mergedJob);
  const filePath = `${siteConfig.contentPath}/${mergedJob.draft.slug}.ts`;
  const owner = context.env.GITHUB_OWNER || siteConfig.owner;
  const branch = reviewRow.publish_branch || siteConfig.branch;

  let existing;
  try {
    existing = await getExistingContent({
      owner,
      repo: siteConfig.repo,
      path: filePath,
      branch,
      token,
    });
  } catch (error) {
    return {
      ok: false,
      message: `GitHub lookup failed: ${error?.message || String(error)}`,
    };
  }

  let response;
  let payload;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${siteConfig.repo}/contents/${encodePath(filePath)}`,
      {
        method: "PUT",
        headers: githubHeaders(token),
        body: JSON.stringify({
          message: `Publish blog post: ${mergedJob.draft.title}`,
          content: utf8ToBase64(moduleSource),
          branch,
          sha: existing?.sha,
          committer: buildCommitAuthor(context),
        }),
      },
    );
    payload = await response.json().catch(() => ({}));
  } catch (error) {
    return {
      ok: false,
      message: `GitHub publish request failed: ${error?.message || String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: payload?.message
        ? `GitHub ${response.status}: ${payload.message}`
        : `GitHub rejected the publish request (HTTP ${response.status}).`,
    };
  }

  return {
    ok: true,
    commitSha: payload?.commit?.sha || null,
    filePath,
    liveUrl: `${siteConfig.siteUrl}${mergedJob.target_url}`,
  };
}

async function loadAssetJob(context, jobId) {
  const requestUrl = new URL(context.request.url);
  const dataUrl = new URL("/data/dashboard-state.json", requestUrl.origin);
  const assetResponse = await context.env.ASSETS.fetch(dataUrl);
  if (!assetResponse.ok) {
    return null;
  }

  const assetState = await assetResponse.json();
  return (assetState.jobs || []).find((job) => job.job_id === jobId) || null;
}

export async function loadAssetJobForReview(context, jobId) {
  return loadAssetJob(context, jobId);
}

function parseJson(value) {
  if (!value || value === "null") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getExistingContent({ owner, repo, path, branch, token }) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders(token) },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || "Failed to look up existing GitHub content.");
  }

  return response.json();
}

function renderTypescriptModule(job) {
  const draft = job.draft;
  const imagePlan = job.image_plan || {};
  const selectedImages = imagePlan.selected_images || [];
  const heroImage = selectedImages[0] || null;

  const sections = (draft.sections || []).map((section) => {
    const sectionCopy = { ...section };
    const matchedImage = findSectionImage(job, section.heading);
    if (matchedImage) {
      sectionCopy.image = {
        src: matchedImage.large || matchedImage.thumb || "",
        alt: matchedImage.alt || section.heading,
        creditName: matchedImage.photographer || "Pexels",
        creditUrl: matchedImage.pexels_url || "",
      };
    }
    return sectionCopy;
  });

  const post = {
    slug: draft.slug,
    categorySlug: job.seo_strategy?.category_slug || "",
    title: draft.title,
    description: draft.description,
    publishedAt: draft.publishedAt,
    author: draft.author || "Jeff Martin Auctioneers Editorial Team",
    readTime: draft.readTime,
    category: draft.category,
    tags: draft.tags || [],
    heroImage: heroImage?.large || draft.heroImage || "/hero.webp",
    heroImageAlt: heroImage?.alt || draft.heroImageAlt || draft.title,
    heroImageCreditName: heroImage?.photographer || "",
    heroImageCreditUrl: heroImage?.pexels_url || "",
    featured: Boolean(draft.featured),
    seoTitle: draft.seoTitle || draft.title,
    seoDescription: draft.seoDescription || draft.description,
    intro: draft.intro || [],
    sections,
    faq: draft.faq || [],
    cta: draft.cta,
  };

  return (
    'import type { BlogPost } from "@/types/blog";\n\n' +
    `const post: BlogPost = ${toTs(post)};\n\n` +
    "export default post;\n"
  );
}

function findSectionImage(job, heading) {
  const imagePlan = job.image_plan || {};
  const selectedImages = imagePlan.selected_images || [];
  const planItems = imagePlan.items || [];
  const placement = `After section: ${heading}`;
  for (let index = 0; index < planItems.length; index += 1) {
    if (planItems[index]?.placement === placement) {
      return selectedImages[index] || null;
    }
  }
  return null;
}

function toTs(value, indent = 2) {
  const spacer = " ".repeat(indent);
  const nextIndent = indent + 2;
  const nextSpacer = " ".repeat(nextIndent);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const lines = ["["];
    for (const item of value) {
      lines.push(`${nextSpacer}${toTs(item, nextIndent)},`);
    }
    lines.push(`${spacer}]`);
    return lines.join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([key, item]) => !(key.startsWith("heroImageCredit") && (item === "" || item == null)),
    );
    if (!entries.length) return "{}";
    const lines = ["{"];
    for (const [key, item] of entries) {
      lines.push(`${nextSpacer}${key}: ${toTs(item, nextIndent)},`);
    }
    lines.push(`${spacer}}`);
    return lines.join("\n");
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value == null) {
    return "null";
  }
  return String(value);
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "seo-automation-dashboard",
  };
}

function buildCommitAuthor(context) {
  const name = context.env.GIT_AUTHOR_NAME || "SEO Automation Bot";
  const email = context.env.GIT_AUTHOR_EMAIL || "seo-automation@example.com";
  return { name, email };
}
