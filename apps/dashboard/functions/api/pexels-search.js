import { json } from "../_shared.js";
import { searchPexels } from "../_images.js";

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

  const photos = await searchPexels(apiKey, query, perPage);

  return json({
    ok: true,
    query,
    photos,
  });
}
