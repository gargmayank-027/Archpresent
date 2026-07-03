/**
 * lib/unsplash.ts
 *
 * Real photo search via the official Unsplash API — used as the "first
 * draft" moodboard source so architects start from genuine, buildable
 * reference photography (the Pinterest-style workflow most firms already
 * use) rather than AI-generated images that may not be sourceable.
 *
 * Pinterest itself has no public search API for third-party apps, so
 * Unsplash is the closest legitimate equivalent: real photographer-credited
 * interior photography, searchable by keyword, with a genuine free tier.
 *
 * SETUP REQUIRED — this only works once you add an Unsplash Access Key:
 *   1. Go to unsplash.com/developers -> "New Application"
 *   2. Accept the API terms, name your app "ArchPresent" (or similar)
 *   3. Copy the "Access Key" (NOT the Secret Key)
 *   4. Add to .env.local: UNSPLASH_ACCESS_KEY=...
 *   5. Restart: npm run dev
 *
 * Free tier: 50 requests/hour (Demo mode). Each "regenerate" or room-load
 * action is one request. A simple in-memory cache (5 min TTL) is used to
 * avoid burning requests on repeated identical searches within a session.
 *
 * Attribution: Unsplash's API terms require crediting the photographer
 * with a link to their profile wherever a photo is displayed. Every
 * MoodImage returned here includes `photographer` and `photographerUrl`
 * for exactly this purpose -- the UI must render them (see moodboards page).
 */

import type { MoodImage, RoomDetail, PlotInfo } from "@/types";

/**
 * Regional style vocabulary — when a project has location context,
 * these terms are blended into search queries so Unsplash returns
 * regionally appropriate interiors rather than generic Western ones.
 *
 * The mapping is intentionally broad (country + optional region) rather
 * than city-level, because Unsplash's search corpus isn't deep enough
 * for "Ludhiana living room" to return results, but "Indian living room"
 * works well.
 */
function getRegionalTerms(plotInfo?: PlotInfo): string {
  if (!plotInfo) return "";

  const country = (plotInfo.country ?? "").toLowerCase();
  const state   = (plotInfo.state ?? "").toLowerCase();
  const city    = (plotInfo.city ?? "").toLowerCase();

  // India — by far the most common case for this app
  if (country === "india" || country === "in" || !country) {
    // Regional nuances within India
    if (["rajasthan", "jaipur", "jodhpur", "udaipur"].some(t => state.includes(t) || city.includes(t))) {
      return "Indian Rajasthani";
    }
    if (["kerala", "kochi", "trivandrum"].some(t => state.includes(t) || city.includes(t))) {
      return "Indian Kerala";
    }
    if (["goa"].some(t => state.includes(t) || city.includes(t))) {
      return "Indian tropical Goa";
    }
    if (["tamil nadu", "chennai", "coimbatore"].some(t => state.includes(t) || city.includes(t))) {
      return "Indian South Indian";
    }
    // Default Indian — works for Punjab, Maharashtra, UP, Delhi, etc.
    if (plotInfo.city || plotInfo.state) return "Indian";
  }

  // Other countries — just prefix the country name
  if (country) {
    const countryName = country.charAt(0).toUpperCase() + country.slice(1);
    return countryName;
  }

  return "";
}

const UNSPLASH_API = "https://api.unsplash.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface UnsplashPhoto {
  id: string;
  description: string | null;
  alt_description: string | null;
  urls: { regular: string; small: string; raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

interface SearchCacheEntry {
  results: UnsplashPhoto[];
  fetchedAt: number;
}

// Simple in-memory cache, keyed by search query -- survives across requests
// within the same server process (resets on restart, fine for a 5-min TTL).
const searchCache = new Map<string, SearchCacheEntry>();

/**
 * Search Unsplash for interior photos matching a room + style + optional
 * architect context prompt. Returns up to `count` results.
 */
export async function searchUnsplashPhotos(
  query: string,
  count: number,
  pageOffset = 0
): Promise<MoodImage[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    throw new Error(
      "UNSPLASH_NOT_CONFIGURED: Add UNSPLASH_ACCESS_KEY to .env.local. " +
      "Get a free key at unsplash.com/developers (no credit card, instant approval for demo tier)."
    );
  }

  const cacheKey = `${query}::page${pageOffset}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(`[unsplash] Cache hit for "${query}" (page ${pageOffset})`);
    return toMoodImages(cached.results.slice(0, count));
  }

  const page = pageOffset + 1; // Unsplash pages are 1-indexed
  const url = `${UNSPLASH_API}/search/photos?query=${encodeURIComponent(query)}` +
    `&per_page=10&page=${page}&orientation=landscape&content_filter=high`;

  console.log(`[unsplash] Searching: "${query}" (page ${page})`);

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });

  if (res.status === 403) {
    throw new Error(
      "UNSPLASH_RATE_LIMITED: Hit the 50 requests/hour demo limit. Wait an hour, " +
      "or apply for Production access (5,000/hour, free) at unsplash.com/developers."
    );
  }
  if (res.status === 401) {
    throw new Error("UNSPLASH_AUTH_ERROR: Invalid UNSPLASH_ACCESS_KEY -- check .env.local and restart.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Unsplash HTTP ${res.status}: ${body.slice(0, 150)}`);
  }

  const data = await res.json() as { results: UnsplashPhoto[] };
  const results = data.results ?? [];

  if (results.length === 0) {
    throw new Error(`No Unsplash results for "${query}"`);
  }

  searchCache.set(cacheKey, { results, fetchedAt: Date.now() });

  return toMoodImages(results.slice(0, count));
}

/**
 * Get a single replacement photo for "try another" -- pulls from a
 * different page than what's already been shown, so the architect
 * doesn't see the same photo cycle back immediately.
 */
export async function getReplacementPhoto(
  query: string,
  excludeUrls: string[]
): Promise<MoodImage> {
  for (let page = 0; page < 3; page++) {
    const results = await searchUnsplashPhotos(query, 10, page);
    const fresh = results.find((img) => !excludeUrls.includes(img.url));
    if (fresh) return fresh;
  }
  const fallback = await searchUnsplashPhotos(query, 10, 0);
  return fallback[Math.floor(Math.random() * fallback.length)];
}

function toMoodImages(photos: UnsplashPhoto[]): MoodImage[] {
  return photos.map((p) => ({
    url: p.urls.regular,
    caption: p.alt_description ?? p.description ?? undefined,
    source: "unsplash" as const,
    sourceUrl: p.links.html,
    photographer: p.user.name,
    photographerUrl: p.user.links.html,
  }));
}

/**
 * Unsplash requires pinging this endpoint whenever a photo is meaningfully
 * "used" (separate from the search call itself, per their API guidelines).
 * Called once per photo when a moodboard is finalised, fire-and-forget.
 */
export async function trackUnsplashDownload(photoUrl: string): Promise<void> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return;

  try {
    const match = photoUrl.match(/photo-([a-zA-Z0-9_-]+)/);
    if (!match) return;
    const photoId = `photo-${match[1]}`.split("?")[0];

    await fetch(`${UNSPLASH_API}/photos/${photoId}/download`, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
  } catch {
    // Non-critical -- don't fail the user-facing flow over a tracking ping
  }
}

/**
 * Build a search query for a room, blending the room type, chosen style,
 * palette, and the architect's optional plain-English context prompt.
 */
export function buildUnsplashQuery(
  roomName: string,
  style: string,
  palette: string,
  contextPrompt?: string,
  room?: RoomDetail,
  imageIndex?: number,  // 0-3 — used to vary the search angle per image
  plotInfo?: PlotInfo    // location context for regional styling
): string {
  // Terms are intentionally explicit to prevent Unsplash from returning
  // off-topic photos (e.g. kitchen photos appearing in a living room pool).
  // Each room term includes the PRIMARY furniture/element unique to that space.
  const roomTerms: Record<string, string> = {
    // Principal spaces
    "Living Room":        "living room sofa interior design",
    "Drawing Room":       "living room interior design",
    "Dining Room":        "dining room interior design",
    "Dining Area":        "dining room interior design",
    "Kitchen":            "kitchen interior design",
    // Bedrooms
    "Master Bedroom":     "bedroom interior design",
    "Bedroom 2":          "bedroom interior",
    "Bedroom 3":          "bedroom interior design",
    "Bedroom 4":          "bedroom interior",
    "Maid's Room":        "small bedroom interior",
    "Driver's Room":      "small bedroom interior",
    // Bathrooms & powder rooms
    "Master Bathroom":    "bathroom interior design",
    "Attached Bathroom":  "bathroom interior design",
    "Common Bathroom":    "bathroom interior",
    "Bathroom":           "bathroom interior design",
    "Powder Room":        "powder room half bath interior",
    "Ensuite":            "ensuite bathroom interior",
    "Toilet":             "bathroom interior design",
    // Dressing & wardrobe
    "Dressing Room":      "dressing room walk in wardrobe interior",
    "Walk-in Wardrobe":   "walk in wardrobe closet interior",
    "WIC":                "walk in closet interior design",
    "WIW":                "walk in wardrobe interior design",
    // Outdoor
    "Balcony":            "balcony terrace outdoor",
    "Terrace":            "terrace rooftop outdoor interior",
    "Deck":               "outdoor deck terrace design",
    "Sit-out":            "outdoor sitting area garden",
    "Front Lawn":         "garden landscape outdoor",
    "Porch":              "porch entrance exterior",
    // Special
    // "prayer room" alone is too ambiguous on a Western stock library like
    // Unsplash — it returns churches/chapels (pews, crosses) rather than a
    // Hindu home shrine. Naming the actual object (mandir) disambiguates it.
    "Pooja Room":         "hindu mandir home temple shrine wood",
    "Study":              "home office interior",
    "Home Office":        "home office desk interior",
    "Library":            "home library bookshelf interior",
    "Gym":                "home gym interior design",
    // Utility
    "Utility Room":       "laundry room interior",
    "Laundry Area":       "laundry room interior design",
    // Lobby / Entry
    "Lobby":              "entrance foyer interior design",
    "Foyer":              "entrance foyer interior design",
    "Entry Hall":         "entrance hall interior design",
  };

  // Image angle suffixes — kept very short to avoid over-constraining the search.
  // The main differentiation between rooms comes from page offsets (roomIndex),
  // not from different angle queries which shrink the result pool.
  const imageAngle: Record<number, string> = {
    0: "",
    1: "",
    2: "",
    3: "",
  };

  const paletteTerms: Record<string, string> = {
    LightAiry:   "bright airy",
    NeutralWarm: "warm neutral",
    DarkMoody:   "dark tones",  // kept minimal — "dark moody rich tones" is too niche for Unsplash
  };

  // Build a tight, focused query. Unsplash performs best with 3-6 words.
  // The room base term already includes the critical anchoring keywords.
  // Style is added but palette/size/features are kept minimal to avoid
  // over-constraining the search and returning too few results.
  const base = roomTerms[roomName] ?? `${roomName.toLowerCase()} interior`;
  
  const parts: string[] = [base, style.toLowerCase()];

  // Regional context — "Indian modern living room" instead of just "modern living room"
  const regional = getRegionalTerms(plotInfo);
  if (regional) parts.splice(1, 0, regional); // insert after room term, before style

  // Palette — use only if it meaningfully changes the aesthetic
  const pal = paletteTerms[palette] ?? "";
  if (pal) parts.push(pal);

  // Context prompt from architect — append only if short and specific
  if (contextPrompt?.trim() && contextPrompt.trim().split(" ").length <= 4) {
    parts.push(contextPrompt.trim());
  }

  // Safe special features that are Unsplash-searchable interior keywords
  const SAFE_FEATURES = [
    "fireplace", "skylight", "bay window", "island counter",
    "walk-in wardrobe", "feature wall",
  ];
  if (room?.specialFeatures?.length) {
    const feat = room.specialFeatures[(imageIndex ?? 0) % room.specialFeatures.length];
    if (feat && SAFE_FEATURES.some((sf) => feat.toLowerCase().includes(sf.toLowerCase()))) {
      parts.push(feat.toLowerCase());
    }
  }

  return parts.filter(Boolean).join(" ");
}
