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

import type { MoodImage, RoomDetail } from "@/types";

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
  imageIndex?: number  // 0-3 — used to vary the search angle per image
): string {
  const roomTerms: Record<string, string> = {
    "Living Room":     "living room interior",
    "Kitchen":         "kitchen interior design",
    "Master Bedroom":  "master bedroom interior design",
    "Bedroom 2":       "guest bedroom interior design",
    "Bedroom 3":       "children bedroom interior design",
    "Bedroom 4":       "bedroom interior design",
    "Bathroom":        "bathroom interior design",
    "Master Bathroom": "luxury ensuite bathroom",
    "Common Bathroom": "modern bathroom interior",
    "Balcony":         "balcony terrace outdoor",
    "Dining Room":     "dining room interior",
    "Study":           "home office study room",
    "Pooja Room":      "meditation prayer room interior",
  };

  // Different search angles per image slot so all 4 images are distinct
  const imageAngle: Record<number, string> = {
    0: "wide angle interior photography",
    1: "interior detail furniture",
    2: "ambient lighting atmosphere",
    3: "interior design close-up materials",
  };

  const paletteTerms: Record<string, string> = {
    LightAiry:   "light airy bright",
    NeutralWarm: "warm earthy neutral tones",
    DarkMoody:   "dark moody rich tones",
  };

  const parts: string[] = [
    roomTerms[roomName] ?? `${roomName.toLowerCase()} interior`,
  ];

  // Fold in architect's context prompt first — highest specificity
  if (contextPrompt?.trim()) {
    parts.push(contextPrompt.trim());
  }

  // Room-specific attributes to differentiate similar rooms
  if (room?.orientation) parts.push(room.orientation);
  if (room?.specialFeatures?.length) {
    // Pick one feature per image slot to vary results
    const feat = room.specialFeatures[(imageIndex ?? 0) % room.specialFeatures.length];
    if (feat) parts.push(feat);
  }
  if (room?.sizeEstimateSqm) {
    parts.push(room.sizeEstimateSqm > 150 ? "large spacious room" : "cozy compact room");
  }

  parts.push(style.toLowerCase());
  parts.push(paletteTerms[palette] ?? "");

  // Per-image angle variation — makes each slot search for a distinct shot type
  if (imageIndex !== undefined) {
    parts.push(imageAngle[imageIndex] ?? "");
  }

  return parts.filter(Boolean).join(" ");
}
