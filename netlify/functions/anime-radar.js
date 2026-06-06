const CACHE_TTL = 1000 * 60 * 60 * 6;
const STALE_TTL = 1000 * 60 * 60 * 24;

const CATEGORIES = {
  popular: {
    label: "Popular",
    url: "https://api.jikan.moe/v4/top/anime?filter=bypopularity&sfw=true&limit=8"
  },
  trending: {
    label: "Trending",
    url: "https://api.jikan.moe/v4/top/anime?filter=airing&sfw=true&limit=8"
  },
  airing: {
    label: "Currently Airing",
    url: "https://api.jikan.moe/v4/seasons/now?sfw=true&limit=8"
  }
};

const cache = globalThis.__animeRadarCache || {};
globalThis.__animeRadarCache = cache;

function response(statusCode, body, cacheControl = "public, max-age=60") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "Netlify-CDN-Cache-Control": cacheControl
    },
    body: JSON.stringify(body)
  };
}

function normalizeAnime(anime) {
  return {
    title: anime.title_english || anime.title || "Untitled anime",
    imageUrl: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || "",
    url: anime.url || "https://myanimelist.net/",
    score: anime.score,
    type: anime.type,
    episodes: anime.episodes,
    status: anime.status,
    year: anime.year
  };
}

async function getAnimeRadar(category) {
  const config = CATEGORIES[category] || CATEGORIES.popular;
  const cached = cache[category];
  const now = Date.now();

  if (cached && now - cached.createdAt < CACHE_TTL) {
    return { ...cached, source: "cache" };
  }

  try {
    const upstream = await fetch(config.url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RegressedRanker/1.0 (+https://regressedranker.xyz)"
      }
    });

    if (!upstream.ok) {
      throw new Error(`Jikan returned ${upstream.status}`);
    }

    const payload = await upstream.json();
    const data = (payload.data || []).slice(0, 8).map(normalizeAnime);
    const fresh = {
      category,
      label: config.label,
      createdAt: now,
      data
    };
    cache[category] = fresh;
    return { ...fresh, source: "jikan" };
  } catch (error) {
    if (cached && now - cached.createdAt < STALE_TTL) {
      return { ...cached, source: "stale-cache", warning: error.message };
    }
    throw error;
  }
}

exports.handler = async (event) => {
  const requested = event.queryStringParameters?.category || "popular";
  const category = Object.prototype.hasOwnProperty.call(CATEGORIES, requested) ? requested : "popular";

  try {
    const result = await getAnimeRadar(category);
    return response(200, result, "public, max-age=900, s-maxage=21600, stale-while-revalidate=86400");
  } catch (error) {
    return response(502, {
      category,
      label: CATEGORIES[category].label,
      data: [],
      error: "Anime radar is temporarily unavailable.",
      detail: error.message
    }, "public, max-age=60");
  }
};
