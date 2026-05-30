import { json } from "../_shared.js";

// Lightweight pre-flight check for the publish path.
// Verifies the GITHUB_TOKEN secret exists, is accepted by GitHub, and can read
// each configured site repo. Hit this before clicking Approve to confirm the
// publish step will work.
const SITE_REPOS = [
  { site_id: "cranes-auctions", owner: "ksndhiren", repo: "Auctioncrane", branch: "main", path: "src/web/content/blog" },
  { site_id: "jma-golfcarts", owner: "ksndhiren", repo: "golfcarts", branch: "main", path: "src/content/blog/generated" },
];

export async function onRequestGet(context) {
  const checks = [];

  const d1 = context.env.DASHBOARD_DB;
  checks.push({
    name: "D1 binding (DASHBOARD_DB)",
    ok: Boolean(d1),
    detail: d1 ? "bound" : "missing — approvals cannot persist",
  });

  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    checks.push({
      name: "GITHUB_TOKEN secret",
      ok: false,
      detail: "not set on Cloudflare Pages — Approve will fail",
    });
    return json(buildReport(checks), { status: 200 });
  }

  let tokenLogin = null;
  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: githubHeaders(token),
    });
    if (!userResponse.ok) {
      const body = await userResponse.json().catch(() => ({}));
      checks.push({
        name: "GITHUB_TOKEN accepted by GitHub",
        ok: false,
        detail: `HTTP ${userResponse.status}: ${body?.message || "rejected"}`,
      });
      return json(buildReport(checks), { status: 200 });
    }
    const userBody = await userResponse.json();
    tokenLogin = userBody?.login || null;
    checks.push({
      name: "GITHUB_TOKEN accepted by GitHub",
      ok: true,
      detail: `authenticated as ${tokenLogin || "unknown"}`,
    });

    const rateRemaining = userResponse.headers.get("x-ratelimit-remaining");
    if (rateRemaining != null) {
      const remaining = Number(rateRemaining);
      checks.push({
        name: "GitHub rate limit",
        ok: remaining > 100,
        detail: `${remaining} of ${userResponse.headers.get("x-ratelimit-limit") || "?"} requests remaining`,
      });
    }
  } catch (error) {
    checks.push({
      name: "GITHUB_TOKEN accepted by GitHub",
      ok: false,
      detail: `request failed: ${error?.message || String(error)}`,
    });
    return json(buildReport(checks), { status: 200 });
  }

  for (const site of SITE_REPOS) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${site.owner}/${site.repo}/contents/${encodePath(site.path)}?ref=${encodeURIComponent(site.branch)}`,
        { headers: githubHeaders(token) },
      );
      if (response.ok) {
        checks.push({
          name: `Repo access: ${site.owner}/${site.repo}`,
          ok: true,
          detail: `readable @ ${site.branch}:${site.path}`,
        });
      } else {
        const body = await response.json().catch(() => ({}));
        checks.push({
          name: `Repo access: ${site.owner}/${site.repo}`,
          ok: false,
          detail: `HTTP ${response.status}: ${body?.message || "not readable"} — check token scopes`,
        });
      }
    } catch (error) {
      checks.push({
        name: `Repo access: ${site.owner}/${site.repo}`,
        ok: false,
        detail: `request failed: ${error?.message || String(error)}`,
      });
    }
  }

  return json(buildReport(checks), { status: 200 });
}

function buildReport(checks) {
  const failing = checks.filter((check) => !check.ok);
  return {
    ok: failing.length === 0,
    summary: failing.length === 0
      ? "All publish dependencies healthy."
      : `${failing.length} of ${checks.length} checks failed.`,
    checked_at: new Date().toISOString(),
    checks,
  };
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "seo-automation-dashboard-health",
  };
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
