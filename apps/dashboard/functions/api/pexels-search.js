import { json } from "../_shared.js";

export async function onRequestGet(context) {
  const apiKey = context.env.PEXELS_API_KEY;

  if (!apiKey) {
    return json(
      {
        ok: false,
        message:
          "PEXELS_API_KEY is not configured for this dashboard environment yet.",
      },
      { status: 501 },
    );
  }

  const url = new URL(context.request.url);
  const query = String(url.searchParams.get("query") || "").trim();
  const perPage = Math.min(
    8,
    Math.max(1, Number.parseInt(url.searchParams.get("per_page") || "6", 10) || 6),
  );

  if (!query) {
    return json({ ok: false, message: "query is required." }, { status: 400 });
  }

  const apiUrl = new URL("https://api.pexels.com/v1/search");
  apiUrl.searchParams.set("query", query);
  apiUrl.searchParams.set("per_page", String(perPage));
  apiUrl.searchParams.set("orientation", "landscape");

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return json(
      {
        ok: false,
        message: `Pexels search failed with status ${response.status}.`,
        detail: body.slice(0, 300),
      },
      { status: 502 },
    );
  }

  const payload = await response.json();
  const photos = (payload.photos || []).map((photo) => ({
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

  return json({
    ok: true,
    query,
    photos,
  });
}
