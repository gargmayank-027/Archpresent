/**
 * lib/ai.ts
 *
 * AI adapter — providers in priority order:
 *
 * Plan analysis & strengths:
 *   1. Google Gemini 1.5 Flash  [FREE — 1,500 req/day, 15 req/min]
 *   2. Anthropic Claude          [paid fallback]
 *   3. OpenAI GPT-4o             [paid fallback]
 *   4. Stub                      [demo mode, no key needed]
 *
 * Moodboard image generation:
 *   1. Pollinations.ai           [FREE — works without a key, more reliable with one]
 *   2. Replicate FLUX            [paid fallback — only if configured]
 *   3. OpenAI DALL-E 3           [paid fallback — only if configured]
 *   4. Stub (Unsplash placeholder) [only if every provider above fails]
 *
 * Set in .env.local:
 *   GOOGLE_AI_KEY=...           ← get free at aistudio.google.com
 *   POLLINATIONS_API_KEY=pk_... ← optional but recommended, free at enter.pollinations.ai
 *                                  (without it, requests share an overloaded public queue
 *                                  and may need retries — we handle that automatically)
 *
 * Paid fallbacks (optional, only used if Pollinations is unreachable):
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / REPLICATE_API_TOKEN
 */

import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import type { PlanAnalysis, PlotInfo, RoomDetail, StyleProfile, MoodImage, RoomMoodboard, OverallMoodboard } from "@/types";
import { saveUploadedFile } from "@/lib/store";
import { searchUnsplashPhotos, getReplacementPhoto, buildUnsplashQuery } from "@/lib/unsplash";

// ─────────────────────────────────────────────────────────────────────────────
// 1. PLAN IMAGE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

export async function analyzePlanImage(
  planImageUrl: string,
  plotInfo?: PlotInfo
): Promise<PlanAnalysis> {
  if (process.env.GOOGLE_AI_KEY) {
    return analyzeWithGemini(planImageUrl, plotInfo);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return analyzeWithClaude(planImageUrl, plotInfo);
  }
  if (process.env.OPENAI_API_KEY) {
    return analyzeWithGPT4o(planImageUrl, plotInfo);
  }
  console.log("[ai] No AI key configured — using stub analysis. Set GOOGLE_AI_KEY in environment variables.");
  return analyzeStub(plotInfo);
}

// ── Google Gemini 1.5 Flash (FREE) ───────────────────────────────────────────

async function analyzeWithGemini(
  planImageUrl: string,
  plotInfo?: PlotInfo
): Promise<PlanAnalysis> {
  const imageData = await loadImageAsBase64(planImageUrl);
  if (!imageData) throw new Error("Could not load plan image");

  const systemPrompt = buildAnalysisSystemPrompt(plotInfo);

  const makeBody = () => JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: imageData.mediaType, data: imageData.base64 } },
          { text: systemPrompt + "\n\nAnalyse this floor plan. Return ONLY the JSON object." },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  // Confirmed working on Gemini free tier (June 2025)
  const models = [
    "gemini-2.0-flash-lite",  // 30 RPM free — most generous
    "gemini-2.0-flash",       // 10 RPM free — fallback
  ];

  let lastError: Error | null = null;

  for (const model of models) {
    // Retry up to 3 times with exponential backoff for 429s
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          const waitMs = 8000; // wait 8s once then give up
          console.log(`[ai] Gemini 429 — waiting ${waitMs/1000}s before retry…`);
          await delay(waitMs);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_KEY}`;
        console.log(`[ai] Trying Gemini model: ${model} (attempt ${attempt + 1})`);

        const response = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: makeBody(),
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        console.log(`[ai] Gemini success with model: ${model}`);
        return parseAnalysisJson(text as string);

      } catch (err) {
        const msg = String(err);
        if (msg.includes("429")) {
          console.warn(`[ai] ${model} rate limited (429) — attempt ${attempt + 1}`);
          lastError = err as Error;
          continue; // retry same model with backoff
        }
        if (msg.includes("404")) {
          console.warn(`[ai] ${model} not found — trying next model`);
          lastError = err as Error;
          break; // skip to next model immediately
        }
        throw err; // other errors (401, 500 etc) — fail fast
      }
    }
  }

  const isQuota = lastError && String(lastError).includes("429");
  throw new Error(
    isQuota
      ? "QUOTA_EXHAUSTED: Your Gemini API key has hit its rate limit. Please wait a minute and try again, or create a new API key at aistudio.google.com/apikey"
      : String(lastError ?? "All Gemini models failed")
  );
}

// ── Anthropic Claude (paid fallback) ─────────────────────────────────────────

async function analyzeWithClaude(
  planImageUrl: string,
  plotInfo?: PlotInfo
): Promise<PlanAnalysis> {
  const imageData = await loadImageAsBase64(planImageUrl);
  if (!imageData) throw new Error("Could not load plan image");

  const body = JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    system: buildAnalysisSystemPrompt(plotInfo),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.base64 } },
          { type: "text", text: "Analyse this floor plan. Return ONLY the JSON object." },
        ],
      },
    ],
  });

  const response = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body,
  });

  const resp = response as { content?: Array<{ type: string; text?: string }> };
  const text = resp.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "").join("");
  return parseAnalysisJson(text as string);
}

// ── OpenAI GPT-4o (paid fallback) ────────────────────────────────────────────

async function analyzeWithGPT4o(
  planImageUrl: string,
  plotInfo?: PlotInfo
): Promise<PlanAnalysis> {
  const imageData = await loadImageAsBase64(planImageUrl);
  if (!imageData) throw new Error("Could not load plan image");

  const body = JSON.stringify({
    model: "gpt-4o",
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildAnalysisSystemPrompt(plotInfo) },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${imageData.mediaType};base64,${imageData.base64}`, detail: "high" } },
          { type: "text", text: "Analyse this floor plan." },
        ],
      },
    ],
  });

  const response = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body,
  });

  return parseAnalysisJson(response.choices?.[0]?.message?.content ?? "{}");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PLAN STRENGTHS
// ─────────────────────────────────────────────────────────────────────────────

export async function generatePlanStrengths(
  analysis: PlanAnalysis,
  plotInfo?: PlotInfo
): Promise<string[]> {
  if (process.env.GOOGLE_AI_KEY) return generateStrengthsGemini(analysis, plotInfo);
  if (process.env.ANTHROPIC_API_KEY) return generateStrengthsClaude(analysis, plotInfo);
  if (process.env.OPENAI_API_KEY) return generateStrengthsGPT(analysis, plotInfo);
  return strengthsStub(analysis, plotInfo);
}

async function generateStrengthsGemini(
  analysis: PlanAnalysis,
  plotInfo?: PlotInfo
): Promise<string[]> {
  const prompt = buildStrengthsPrompt(analysis, plotInfo);

  const makeBody = () => JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  });

  const models = ["gemini-2.0-flash-lite", "gemini-2.0-flash"];
  let lastError: Error | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await delay(8000);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_KEY}`;
        console.log(`[ai] Strengths: trying ${model} (attempt ${attempt + 1})`);
        const response = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: makeBody(),
        });
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        return parseStrengthsJson(text as string);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("429")) { lastError = err as Error; continue; }
        if (msg.includes("404")) { lastError = err as Error; break; }
        throw err;
      }
    }
  }

  const isQuota2 = lastError && String(lastError).includes("429");
  throw new Error(isQuota2 ? "QUOTA_EXHAUSTED" : String(lastError ?? "Gemini failed"));
}

async function generateStrengthsClaude(analysis: PlanAnalysis, plotInfo?: PlotInfo): Promise<string[]> {
  const body = JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildStrengthsPrompt(analysis, plotInfo) }],
  });
  const response = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body,
  });
  const text = response.content?.filter((b: {type:string}) => b.type === "text").map((b:{text:string}) => b.text).join("");
  return parseStrengthsJson(text as string);
}

async function generateStrengthsGPT(analysis: PlanAnalysis, plotInfo?: PlotInfo): Promise<string[]> {
  const body = JSON.stringify({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: buildStrengthsPrompt(analysis, plotInfo) }],
  });
  const response = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body,
  });
  return parseStrengthsJson(response.choices?.[0]?.message?.content ?? "{}");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MOODBOARD IMAGE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export async function generateMoodboardImage(
  room: RoomDetail,
  style: StyleProfile
): Promise<string> {
  // First draft = a real, sourceable photo (the Pinterest-style workflow).
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const query = buildUnsplashQuery(room.name, style.overallStyle, style.palette);
      const results = await searchUnsplashPhotos(query, 1);
      if (results[0]) return results[0].url;
    } catch (err) {
      console.warn("[ai] Unsplash failed, trying AI generation:", err);
    }
  }
  // AI generation fallback — Pollinations is free, tried first
  try {
    return await generateWithPollinations(buildMoodboardPrompt(room, style), room.name);
  } catch (err) {
    console.warn("[ai] Pollinations failed, trying paid fallbacks:", err);
  }
  if (process.env.REPLICATE_API_TOKEN) return generateWithReplicate(room, style);
  if (process.env.OPENAI_API_KEY)      return generateWithDallE(room, style);
  return moodboardStub(room, style);
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-IMAGE ROOM MOODBOARDS — real photos first (Pinterest-style first
// draft), AI generation as an explicit per-image alternative
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate 3-4 mood images for a specific room.
 *
 * First draft = real Unsplash search results (genuine, buildable reference
 * photography — what most firms already pull from Pinterest). Each image
 * can later be individually regenerated with AI or swapped for a different
 * real photo via the per-image actions in the UI (see PATCH /api/moodboards).
 *
 * `contextPrompt` is the architect's optional plain-English brief for this
 * room (e.g. "client wants a reading nook by the window") — folded into
 * the search query so results are more relevant to the actual brief.
 */
export async function generateRoomMoodboard(
  room: RoomDetail,
  style: StyleProfile,
  contextPrompt?: string,
  roomIndex = 0  // position of this room in the generation order — used to
                  // offset Unsplash page so similar rooms (e.g. Bedroom 2 vs
                  // Bedroom 3) don't pull from the same cached result page
): Promise<MoodImage[]> {
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      return await generateRoomMoodboardFromUnsplash(room, style, contextPrompt, roomIndex);
    } catch (err) {
      console.warn(`[ai] Unsplash failed for ${room.name}, falling back to AI generation:`, err);
    }
  }
  return generateRoomMoodboardReal(room, style);
}

const ROOM_IMAGE_CAPTIONS = ["Wide view", "Detail", "Atmosphere", "Close-up"];

async function generateRoomMoodboardFromUnsplash(
  room: RoomDetail,
  style: StyleProfile,
  contextPrompt?: string,
  roomIndex = 0
): Promise<MoodImage[]> {
  // Strategy: 1-2 API calls per room.
  // Each room uses a different starting page (roomIndex % 3) so similar
  // rooms (Bedroom 2 vs Bedroom 3) don't pull from the same cached result set.

  const baseQuery = buildUnsplashQuery(
    room.name, style.overallStyle, style.palette, contextPrompt, room, 0
  );

  // Cap page offset at 1 — Unsplash runs out of results at page 3+
  // for specific interior queries. Pages 0 and 1 reliably return results.
  const startPage = roomIndex % 2; // alternate between page 0 and page 1 only

  let pool: MoodImage[] = [];

  try {
    const page1 = await searchUnsplashPhotos(baseQuery, 10, startPage);
    pool = [...page1];

    // Second page from the other offset
    const page2Start = 1 - startPage; // if startPage=0, use 1; if 1, use 0
    if (pool.length < 8) { // only fetch page 2 if page 1 didn't give enough
      try {
        const page2 = await searchUnsplashPhotos(baseQuery, 10, page2Start);
        pool = [...pool, ...page2.filter((p) => !pool.some((e) => e.url === p.url))];
      } catch {
        // page 2 optional
      }
    }
  } catch (err) {
    console.warn(`[ai] Unsplash fetch failed for ${room.name}:`, err);
    // Try a simpler fallback query (just room type + style, no palette)
    try {
      const fallbackQuery = buildUnsplashQuery(room.name, style.overallStyle, "LightAiry", undefined, undefined, 0);
      const fallback = await searchUnsplashPhotos(fallbackQuery, 10, 0);
      pool = [...fallback];
      console.log(`[ai] Fallback query succeeded for ${room.name}: ${fallback.length} results`);
    } catch {
      // pool stays empty, will fall through to AI generation per slot
    }
  }

  const images: MoodImage[] = [];
  const usedUrls: string[] = [];

  for (let i = 0; i < 4; i++) {
    // Pick distinct photos spread across the pool — each slot gets a different
    // section so all 4 images are visually distinct.
    const sectionSize = Math.max(1, Math.floor(pool.length / 4));
    const sectionStart = i * sectionSize;
    // For slot 0 (Wide View), prefer photos with actual rooms — skip pure detail/texture shots
    // by preferring those with longer, more descriptive alt text
    const sectionPool = pool.slice(sectionStart);
    let candidate = sectionPool.find((r) => !usedUrls.includes(r.url) && (r.caption?.split(" ").length ?? 0) > 2)
      ?? sectionPool.find((r) => !usedUrls.includes(r.url))
      ?? pool.find((r) => !usedUrls.includes(r.url)); // fallback: any unused

    if (candidate) {
      usedUrls.push(candidate.url);
      images.push({ ...candidate, caption: ROOM_IMAGE_CAPTIONS[i], source: "unsplash" as const });
    } else {
      // Truly exhausted — fill remaining slots with AI generation
      console.warn(`[ai] Unsplash pool exhausted at slot ${i} for ${room.name} (pool size: ${pool.length})`);
      try {
        const prompt = buildMoodboardPrompt(room, style) +
          (i === 1 ? " detail shot" : i === 2 ? " atmospheric lighting" : i === 3 ? " close-up materials" : "");
        const url = await generateWithPollinations(prompt, room.name);
        images.push({ url, caption: ROOM_IMAGE_CAPTIONS[i], source: "ai" as const });
      } catch {
        const stubUrl = await moodboardStub(room, style);
        images.push({ url: stubUrl, caption: ROOM_IMAGE_CAPTIONS[i], source: "ai" as const });
      }
    }
  }

  return images;
}

// AI-generated fallback — 3-4 images via varied prompts (wide shot, detail,
// atmosphere, close-up). Used when Unsplash isn't configured or fails.
async function generateRoomMoodboardReal(
  room: RoomDetail,
  style: StyleProfile
): Promise<MoodImage[]> {
  const promptVariants = [
    buildMoodboardPrompt(room, style),
    buildMoodboardPrompt(room, style) + " detail shot, close-up",
    buildMoodboardPrompt(room, style) + " atmospheric, moody lighting",
    buildMoodboardPrompt(room, style) + " textural close-up, materials",
  ];

  const images: MoodImage[] = [];

  for (let i = 0; i < 4; i++) {
    try {
      const url = await generateSingleImage(promptVariants[i]);
      images.push({ url, caption: ROOM_IMAGE_CAPTIONS[i], source: "ai" });
    } catch (err) {
      console.warn(`[ai] Room image ${i + 1} failed:`, err);
      const stubUrl = await moodboardStub(room, style);
      images.push({ url: stubUrl, caption: ROOM_IMAGE_CAPTIONS[i], source: "ai" });
    }
  }

  return images;
}

// Generate a single image — tries Pollinations first (free), falls back to
// paid providers only if explicitly configured.
async function generateSingleImage(prompt: string): Promise<string> {
  try {
    return await generateWithPollinations(prompt, "room");
  } catch (err) {
    console.warn("[ai] Pollinations failed for variant image:", err);
  }
  throw new Error("Image generation failed — Pollinations unavailable and no paid fallback configured");
}

/**
 * Regenerate a single image for a room, either as a different real photo
 * (Unsplash, excluding URLs already shown) or as a fresh AI generation.
 * Used by the per-image "Try another" / "Generate with AI" actions.
 */
export async function regenerateSingleRoomImage(
  room: RoomDetail,
  style: StyleProfile,
  mode: "photo" | "ai",
  contextPrompt: string | undefined,
  existingUrls: string[],
  caption?: string
): Promise<MoodImage> {
  if (mode === "photo") {
    if (!process.env.UNSPLASH_ACCESS_KEY) {
      throw new Error(
        "UNSPLASH_NOT_CONFIGURED: Add UNSPLASH_ACCESS_KEY to .env.local to browse real photos. " +
        "Get a free key at unsplash.com/developers."
      );
    }
    const query = buildUnsplashQuery(room.name, style.overallStyle, style.palette, contextPrompt);
    const replacement = await getReplacementPhoto(query, existingUrls);
    return { ...replacement, caption: caption ?? replacement.caption, source: "unsplash" as const };
  }

  // mode === "ai"
  const prompt = buildMoodboardPrompt(room, style) +
    (caption === "Detail" ? " detail shot, close-up" :
     caption === "Atmosphere" ? " atmospheric, moody lighting" :
     caption === "Close-up" ? " textural close-up, materials" : "");
  const url = await generateSingleImage(prompt);
  return { url, caption: caption ?? "AI concept", source: "ai" };
}

/**
 * Generate the overall whole-home style moodboard (4 hero images).
 * Real Unsplash photos first; AI generation as fallback.
 */
export async function generateOverallMoodboard(
  rooms: RoomDetail[],
  style: StyleProfile
): Promise<OverallMoodboard> {
  const captions = ["Living spaces", "Kitchen & dining", "Bedrooms", "Bathrooms & details"];
  const styleStatement = STYLE_STATEMENTS[style.overallStyle] ?? "A considered interior designed around your life.";

  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const queries: Record<string, string> = {
        "Living spaces":       `living room ${style.overallStyle} interior design`,
        "Kitchen & dining":    `kitchen dining ${style.overallStyle} interior design`,
        "Bedrooms":            `bedroom ${style.overallStyle} interior design`,
        "Bathrooms & details": `bathroom ${style.overallStyle} interior design`,
      };
      const images: MoodImage[] = [];
      for (const caption of captions) {
        const results = await searchUnsplashPhotos(queries[caption], 1);
        if (results[0]) images.push({ ...results[0], caption, source: "unsplash" as const });
      }
      if (images.length === captions.length) {
        return { images, styleStatement };
      }
    } catch (err) {
      console.warn("[ai] Unsplash failed for overall moodboard, falling back to AI:", err);
    }
  }

  // AI generation fallback
  const promptsByCaption: Record<string, string> = {
    "Living spaces":         `Professional interior design photograph, living room and lounge area, ${style.overallStyle} style, photorealistic, 4K, magazine quality, no people.`,
    "Kitchen & dining":      `Professional interior design photograph, kitchen and dining area, ${style.overallStyle} style, photorealistic, 4K, magazine quality, no people.`,
    "Bedrooms":              `Professional interior design photograph, bedroom interior, ${style.overallStyle} style, photorealistic, 4K, magazine quality, no people.`,
    "Bathrooms & details":   `Professional interior design photograph, bathroom interior with fine details, ${style.overallStyle} style, photorealistic, 4K, magazine quality, no people.`,
  };

  const images: MoodImage[] = [];
  for (const caption of captions) {
    try {
      const url = await generateWithPollinations(promptsByCaption[caption], caption);
      images.push({ url, caption, source: "ai" });
    } catch (err) {
      console.warn(`[ai] Overall moodboard image "${caption}" failed, using stub:`, err);
      const stub = await overallMoodboardStub(rooms, style);
      const fallback = stub.images.find((i) => i.caption === caption) ?? stub.images[0];
      images.push(fallback);
    }
  }

  return { images, styleStatement };
}

// ── Pollinations.ai (FREE — key recommended, no credit card) ──────────────────
//
// Model: flux. Docs: github.com/pollinations/pollinations/blob/main/APIDOCS.md
//
// Pollinations migrated off the old unauthenticated `image.pollinations.ai`
// endpoint, which is now a legacy, overloaded, frequently-queue-full path
// shared by every anonymous caller worldwide ("Queue full (50/50)" errors).
// The current endpoint is `gen.pollinations.ai`, which works without a key
// for light/occasional use but is far more reliable with a free key from
// enter.pollinations.ai (no credit card, just sign in with GitHub).
//
// Set POLLINATIONS_API_KEY in .env.local to use a key. Without one, this
// still works — just more likely to hit transient queue-full errors, which
// we retry with backoff before giving up.

async function generateWithPollinations(prompt: string, label: string): Promise<string> {
  const seed = Date.now() % 1000000 + Math.floor(Math.random() * 1000);
  const encodedPrompt = encodeURIComponent(prompt);
  const apiKey = process.env.POLLINATIONS_API_KEY;

  const url = `https://gen.pollinations.ai/image/${encodedPrompt}` +
    `?model=flux&width=1344&height=768&seed=${seed}&nologo=true`;
  // API key (if set) is sent via Authorization header below, not the URL

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[ai] Pollinations request for "${label}" (attempt ${attempt}/${maxAttempts})`);

      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });

      // Queue-full / overload — back off and retry rather than failing immediately
      if (res.status === 500 || res.status === 503 || res.status === 429) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`Pollinations HTTP ${res.status}: ${body.slice(0, 150)}`);
        if (attempt < maxAttempts) {
          const waitMs = attempt * 4000; // 4s, 8s
          console.warn(`[ai] Pollinations overloaded — retrying in ${waitMs / 1000}s…`);
          await delay(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Pollinations HTTP ${res.status}: ${body.slice(0, 150)}`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        const body = await res.text().catch(() => "");
        throw new Error(`Pollinations non-image response (${contentType}): ${body.slice(0, 150)}`);
      }

      const imageBuffer = Buffer.from(await res.arrayBuffer());
      if (imageBuffer.length < 1000) {
        throw new Error("Pollinations response too small — likely an error page");
      }

      const slug  = label.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      const ext   = contentType.includes("png") ? "png" : "jpg";
      const fname = `moodboard-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { url: localUrl } = await saveUploadedFile(imageBuffer, fname);

      console.log(`[ai] Pollinations success → ${fname} (${(imageBuffer.length / 1024).toFixed(0)} KB)`);
      return localUrl;

    } catch (err) {
      lastError = err as Error;
      const msg = String(err);
      // Non-retryable errors (bad URL, auth, etc.) — fail fast
      if (!msg.includes("500") && !msg.includes("503") && !msg.includes("429")) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await delay(attempt * 4000);
      }
    }
  }

  throw lastError ?? new Error("Pollinations generation failed after retries");
}

// ── Replicate FLUX (paid fallback) ────────────────────────────────────────────

async function generateWithReplicate(room: RoomDetail, style: StyleProfile): Promise<string> {
  const prompt = buildMoodboardPrompt(room, style);

  const prediction = await fetchJson(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: { prompt, width: 1344, height: 768, num_outputs: 1, num_inference_steps: 4, output_format: "jpg", output_quality: 90 },
      }),
    }
  );

  if (prediction.output && Array.isArray(prediction.output) && prediction.output[0]) {
    return downloadAndSaveImage(prediction.output[0] as string, room.name);
  }
  if (prediction.urls?.get) {
    return pollReplicateAndSave(prediction.urls.get as string, room.name);
  }
  throw new Error(`Replicate failed: ${JSON.stringify(prediction)}`);
}

async function pollReplicateAndSave(pollUrl: string, roomName: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await delay(2000);
    const result = await fetchJson(pollUrl, { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } });
    if (result.status === "succeeded" && result.output?.[0]) return downloadAndSaveImage(result.output[0] as string, roomName);
    if (result.status === "failed") throw new Error(`Replicate failed: ${result.error}`);
  }
  throw new Error("Replicate timed out");
}

// ── DALL-E 3 (paid fallback) ──────────────────────────────────────────────────

async function generateWithDallE(room: RoomDetail, style: StyleProfile): Promise<string> {
  const response = await fetchJson("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "dall-e-3", prompt: buildMoodboardPrompt(room, style),
      n: 1, size: "1792x1024", quality: "standard", response_format: "url",
    }),
  });
  const imageUrl = response.data?.[0]?.url;
  if (!imageUrl) throw new Error("DALL-E returned no URL");
  return downloadAndSaveImage(imageUrl as string, room.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// STUBS (active when no keys set — keeps demo mode working)
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeStub(plotInfo?: PlotInfo): Promise<PlanAnalysis> {
  await delay(1200); // realistic feel
  const totalArea  = plotInfo?.builtUpAreaSqm ?? plotInfo?.plotAreaSqm ?? 92;
  const bedrooms   = plotInfo?.numberOfBedrooms ?? 2;
  const facing     = plotInfo?.facing ?? "South";
  const propType   = plotInfo?.propertyType ?? "Apartment";
  const isApartment = propType !== "Independent House" && propType !== "Villa";

  // Proportions based on real residential norms
  const livingArea  = Math.round(totalArea * 0.25);
  const kitchenArea = Math.round(totalArea * 0.12);
  const masterArea  = Math.round(totalArea * 0.18);
  const bed2Area    = Math.round(totalArea * 0.14);
  const bed3Area    = Math.round(totalArea * 0.11);
  const bathArea    = Math.round(totalArea * 0.055);
  const balcArea    = Math.round(totalArea * 0.07);

  // Facing-aware orientation hints
  const facingDesc: Record<string, string> = {
    North: "north-facing, diffused light", South: "south-facing, abundant light",
    East: "east-facing, morning sun", West: "west-facing, afternoon light",
    "North-East": "north-east corner, best light", "North-West": "north-west, good ventilation",
    "South-East": "south-east, morning light", "South-West": "south-west, warm afternoon light",
  };

  const rooms: RoomDetail[] = [
    {
      name: "Living Room",
      sizeEstimateSqm: livingArea,
      notes: `${facingDesc[facing] ?? facing + "-facing"}, connects to dining`,
      windowCount: 2,
      orientation: `${facing.toLowerCase()}-facing`,
      adjacentRooms: ["Kitchen", "Dining", ...(isApartment ? ["Balcony"] : [])],
      specialFeatures: ["open-plan dining", "feature wall"],
      furnitureHints: ["3-seater sofa", "coffee table", "TV unit", "dining table for 4"],
    },
    {
      name: "Kitchen",
      sizeEstimateSqm: kitchenArea,
      notes: bedrooms >= 3 ? "Closed kitchen with utility area" : "Semi-open, connects to living",
      windowCount: 1,
      orientation: "interior",
      adjacentRooms: ["Living Room", "Utility"],
      specialFeatures: bedrooms >= 3 ? ["closed kitchen", "utility room"] : ["breakfast counter"],
      furnitureHints: ["L-shaped counter", "overhead cabinets", "refrigerator space"],
    },
    {
      name: "Master Bedroom",
      sizeEstimateSqm: masterArea,
      notes: "Private zone, ensuite attached",
      windowCount: 1,
      orientation: bedrooms >= 3 ? "rear-facing, quiet" : `${facing.toLowerCase()}-facing`,
      adjacentRooms: ["Master Bathroom"],
      specialFeatures: ["attached bath", "built-in wardrobe", "dressing area"],
      furnitureHints: ["king bed", "bedside tables", "wardrobe", "dresser"],
    },
  ];

  if (bedrooms >= 2) {
    rooms.push({
      name: "Bedroom 2",
      sizeEstimateSqm: bed2Area,
      notes: "Children's room or guest bedroom",
      windowCount: 1,
      orientation: "side-facing",
      adjacentRooms: ["Common Bathroom"],
      specialFeatures: ["study nook"],
      furnitureHints: ["single/double bed", "study desk", "wardrobe"],
    });
  }

  if (bedrooms >= 3) {
    rooms.push({
      name: "Bedroom 3",
      sizeEstimateSqm: bed3Area,
      notes: "Flexible — guest, study or nursery",
      windowCount: 1,
      orientation: "side-facing",
      adjacentRooms: ["Common Bathroom"],
      specialFeatures: [],
      furnitureHints: ["single bed", "compact desk"],
    });
  }

  if (bedrooms >= 4) {
    rooms.push({
      name: "Bedroom 4",
      sizeEstimateSqm: Math.round(totalArea * 0.1),
      notes: "Compact room, ideal as office or guest",
      windowCount: 1,
      orientation: "rear-facing",
      adjacentRooms: [],
      specialFeatures: [],
      furnitureHints: ["single bed or day bed"],
    });
  }

  rooms.push({
    name: "Master Bathroom",
    sizeEstimateSqm: bathArea,
    notes: "Ensuite with shower + vanity",
    windowCount: 0,
    orientation: "interior",
    adjacentRooms: ["Master Bedroom"],
    specialFeatures: ["shower cubicle", "vanity unit"],
    furnitureHints: [],
  });

  rooms.push({
    name: "Common Bathroom",
    sizeEstimateSqm: bathArea,
    notes: "Shared bath for secondary bedrooms",
    windowCount: 0,
    orientation: "interior",
    adjacentRooms: [],
    specialFeatures: [],
    furnitureHints: [],
  });

  if (isApartment) {
    rooms.push({
      name: "Balcony",
      sizeEstimateSqm: balcArea,
      notes: `${facing}-facing, off living room`,
      windowCount: 0,
      orientation: `${facing.toLowerCase()}-facing`,
      adjacentRooms: ["Living Room"],
      specialFeatures: ["utility connection point"],
      furnitureHints: ["2 chairs", "side table", "planter"],
    });
  }

  if (propType === "Independent House" || propType === "Villa") {
    rooms.push({
      name: "Pooja Room",
      sizeEstimateSqm: 4,
      notes: "North-east corner, traditional placement",
      windowCount: 0,
      orientation: "north-east corner",
      adjacentRooms: [],
      specialFeatures: ["built-in mandir"],
      furnitureHints: [],
    });
  }

  const comments = [
    "Public-private zoning is well-defined — bedrooms sit away from the main social areas.",
    `The ${facing.toLowerCase()}-facing aspect brings strong natural light into the primary living spaces.`,
    "Corridor efficiency is good — minimal dead space between rooms.",
    `Estimated built-up: ${totalArea} sqm across ${rooms.length} rooms.`,
  ];
  if (plotInfo?.vaastuCompliance) comments.push("Room placement and entrance orientation broadly align with Vaastu principles.");
  if (plotInfo?.additionalNotes)   comments.push(`Architect note: ${plotInfo.additionalNotes}`);

  return {
    rooms,
    hasBalcony: isApartment,
    hasClearZoning: true,
    totalAreaSqm: totalArea,
    lightningSide: facing,
    circulationQuality: totalArea > 100 ? "generous" : totalArea > 70 ? "comfortable" : "tight",
    comments,
  };
}

async function strengthsStub(analysis: PlanAnalysis, plotInfo?: PlotInfo): Promise<string[]> {
  await delay(700);
  const facing  = plotInfo?.facing ?? analysis.lightningSide ?? "South";
  const area    = analysis.totalAreaSqm ?? 90;
  const rooms   = analysis.rooms;
  const hasBal  = analysis.hasBalcony;
  const circ    = analysis.circulationQuality ?? "comfortable";

  const bullets: string[] = [];

  // Light bullet — based on actual facing
  const lightMap: Record<string, string> = {
    South: "Generous south-facing orientation means sunlight fills the living spaces for most of the day, reducing electricity bills and lifting the mood of the home.",
    North: "The north-facing plan delivers consistent, glare-free natural light — ideal for working from home and displaying artwork without harsh shadows.",
    East:  "East-facing living areas catch the best morning light, making every day start with a naturally bright and energising space.",
    West:  "West-facing rooms enjoy warm afternoon and evening light — perfect for relaxed sunsets from the living room and balcony.",
    "North-East": "The north-east orientation is considered the most auspicious and gives bright morning light to the key living spaces.",
    "South-East": "South-east orientation combines good morning light with warm afternoon brightness across the social spaces.",
  };
  bullets.push(lightMap[facing] ?? `The ${facing.toLowerCase()}-facing layout brings excellent natural light into the core living areas throughout the day.`);

  // Zoning bullet
  if (analysis.hasClearZoning) {
    bullets.push("Social and private zones are cleanly separated — bedrooms are tucked away from the living area, so the home supports both lively gatherings and peaceful sleep with equal ease.");
  }

  // Kitchen / living connection
  const kitchen = rooms.find((r) => r.name === "Kitchen");
  if (kitchen?.specialFeatures?.includes("closed kitchen")) {
    bullets.push("A closed kitchen keeps cooking smells and sounds out of the living area — ideal for families who cook daily and entertain regularly.");
  } else {
    bullets.push("The open-plan kitchen and living area creates a natural, connected heart for the home — great for keeping an eye on children while cooking, or hosting friends.");
  }

  // Master bedroom bullet
  const master = rooms.find((r) => r.name === "Master Bedroom");
  if (master?.specialFeatures?.includes("attached bath")) {
    bullets.push(`The master bedroom at ${master.sizeEstimateSqm ?? "16"} sqm with an attached bathroom creates a complete private retreat — a sanctuary that doesn't require sharing with the rest of the household.`);
  }

  // Circulation bullet
  const circMap: Record<string, string> = {
    generous: `At ${area} sqm the plan has generous proportions — rooms breathe, there is space to grow, and the flow from room to room feels unhurried.`,
    comfortable: "The layout uses space efficiently without feeling tight — corridors are short, rooms are well-proportioned, and there is very little wasted floor area.",
    tight: "Every square metre has been carefully assigned — a compact but highly efficient layout where smart furniture choices will make the most of every corner.",
  };
  bullets.push(circMap[circ]);

  // Balcony / outdoor
  if (hasBal) {
    bullets.push("The balcony extends the living area outdoors — a private outdoor space for morning tea, evening relaxation, or growing plants, rare to find in urban apartments.");
  }

  // Vaastu
  if (plotInfo?.vaastuCompliance) {
    bullets.push("The room placement and entrance orientation follow Vaastu Shastra principles — the home is designed to channel positive energy flow through all key spaces.");
  }

  return bullets.slice(0, 6);
}

// ─── Curated Unsplash photo library ──────────────────────────────────────────

const ROOM_PHOTOS: Record<string, Record<string, string[]>> = {
  "Living Room": {
    Modern:       ["photo-1567767292278-a204e43f6cd1","photo-1555041469-a586c61ea9bc","photo-1618221195710-dd6b41faaea6","photo-1600210491369-e753d80a41f3"],
    Contemporary: ["photo-1555041469-a586c61ea9bc","photo-1586023492125-27b2c045efd7","photo-1616486338812-3dadae4b4ace","photo-1615529182904-14819c35db37"],
    Scandinavian: ["photo-1586023492125-27b2c045efd7","photo-1556020685-ae41abfc9365","photo-1565182999561-18d7dc61c393","photo-1484101403633-562f891dc89a"],
    Minimal:      ["photo-1449247709967-d4461a6a6103","photo-1505693416388-ac5ce068fe85","photo-1513694203232-719a280e022f","photo-1567767292278-a204e43f6cd1"],
    Industrial:   ["photo-1505409628601-edc9af17fda6","photo-1493809842364-78817add7ffb","photo-1560185893-a55cbc8c57e8","photo-1515263487990-61b07816b324"],
    Classic:      ["photo-1540518614846-7eded433c457","photo-1616594039964-ae9021a400a0","photo-1600607687939-ce8a6c25118c","photo-1560185007-cde436f6a4d0"],
  },
  "Kitchen": {
    // Note: photo-1556909114-f6e7ad7d3136 removed — rotted ID (serves fruit jug on Unsplash now)
    Modern:       ["photo-1556909114-f6e7ad7d3136","photo-1556909172-54557c7e4fb7","photo-1556909045-9e56fa833e9c","photo-1588854337221-4cf9fa96059c"],
    Contemporary: ["photo-1556909114-f6e7ad7d3136","photo-1588854337221-4cf9fa96059c","photo-1556909172-54557c7e4fb7","photo-1556909045-9e56fa833e9c"],
    Scandinavian: ["photo-1588854337221-4cf9fa96059c","photo-1556909114-f6e7ad7d3136","photo-1556909172-54557c7e4fb7","photo-1556909045-9e56fa833e9c"],
    Minimal:      ["photo-1556909172-54557c7e4fb7","photo-1556909114-f6e7ad7d3136","photo-1556909045-9e56fa833e9c","photo-1588854337221-4cf9fa96059c"],
    Industrial:   ["photo-1585515320310-259814833e62","photo-1556909114-f6e7ad7d3136","photo-1556909172-54557c7e4fb7","photo-1556909045-9e56fa833e9c"],
    Classic:      ["photo-1556909045-9e56fa833e9c","photo-1588854337221-4cf9fa96059c","photo-1556909114-f6e7ad7d3136","photo-1556909172-54557c7e4fb7"],
  },
  "Master Bedroom": {
    Modern:       ["photo-1631049307264-da0ec9d70304","photo-1588046130717-0eb0c9a3ba15","photo-1505693416388-ac5ce068fe85","photo-1540304801897-4bd1e5fe2a98"],
    Contemporary: ["photo-1616594039964-ae9021a400a0","photo-1631049307264-da0ec9d70304","photo-1522771739844-6a9f6d5f14af","photo-1588046130717-0eb0c9a3ba15"],
    Scandinavian: ["photo-1540304801897-4bd1e5fe2a98","photo-1505693416388-ac5ce068fe85","photo-1540304801897-4bd1e5fe2a98","photo-1631049307264-da0ec9d70304"],
    Minimal:      ["photo-1505693416388-ac5ce068fe85","photo-1631049307264-da0ec9d70304","photo-1540304801897-4bd1e5fe2a98","photo-1522771739844-6a9f6d5f14af"],
    Industrial:   ["photo-1631049307264-da0ec9d70304","photo-1522771739844-6a9f6d5f14af","photo-1540304801897-4bd1e5fe2a98","photo-1505693416388-ac5ce068fe85"],
    Classic:      ["photo-1616594039964-ae9021a400a0","photo-1522771739844-6a9f6d5f14af","photo-1540518614846-7eded433c457","photo-1631049307264-da0ec9d70304"],
  },
  "Bedroom 2": {
    // All IDs confirmed as actual bedroom photos from Master Bedroom stubs
    // Different rotation from Master Bedroom and Bedroom 3 in every slot
    Modern:       ["photo-1522771739844-6a9f6d5f14af","photo-1540304801897-4bd1e5fe2a98","photo-1505693416388-ac5ce068fe85","photo-1631049307264-da0ec9d70304"],
    Contemporary: ["photo-1588046130717-0eb0c9a3ba15","photo-1522771739844-6a9f6d5f14af","photo-1540304801897-4bd1e5fe2a98","photo-1616594039964-ae9021a400a0"],
    Scandinavian: ["photo-1505693416388-ac5ce068fe85","photo-1522771739844-6a9f6d5f14af","photo-1631049307264-da0ec9d70304","photo-1540304801897-4bd1e5fe2a98"],
    Minimal:      ["photo-1540304801897-4bd1e5fe2a98","photo-1505693416388-ac5ce068fe85","photo-1522771739844-6a9f6d5f14af","photo-1631049307264-da0ec9d70304"],
    Industrial:   ["photo-1588046130717-0eb0c9a3ba15","photo-1540304801897-4bd1e5fe2a98","photo-1522771739844-6a9f6d5f14af","photo-1505693416388-ac5ce068fe85"],
    Classic:      ["photo-1540304801897-4bd1e5fe2a98","photo-1616594039964-ae9021a400a0","photo-1522771739844-6a9f6d5f14af","photo-1631049307264-da0ec9d70304"],
  },
  "Bedroom 3": {
    // Third rotation — all confirmed bedroom photos, all slot 0 unique vs master/bed2
    Modern:       ["photo-1505693416388-ac5ce068fe85","photo-1631049307264-da0ec9d70304","photo-1522771739844-6a9f6d5f14af","photo-1588046130717-0eb0c9a3ba15"],
    Contemporary: ["photo-1540304801897-4bd1e5fe2a98","photo-1505693416388-ac5ce068fe85","photo-1616594039964-ae9021a400a0","photo-1522771739844-6a9f6d5f14af"],
    Scandinavian: ["photo-1522771739844-6a9f6d5f14af","photo-1631049307264-da0ec9d70304","photo-1505693416388-ac5ce068fe85","photo-1540304801897-4bd1e5fe2a98"],
    Minimal:      ["photo-1631049307264-da0ec9d70304","photo-1522771739844-6a9f6d5f14af","photo-1505693416388-ac5ce068fe85","photo-1540304801897-4bd1e5fe2a98"],
    Industrial:   ["photo-1540304801897-4bd1e5fe2a98","photo-1522771739844-6a9f6d5f14af","photo-1631049307264-da0ec9d70304","photo-1505693416388-ac5ce068fe85"],
    Classic:      ["photo-1505693416388-ac5ce068fe85","photo-1540304801897-4bd1e5fe2a98","photo-1631049307264-da0ec9d70304","photo-1522771739844-6a9f6d5f14af"],
  },
  "Bathroom":        { Modern: ["photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Contemporary: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1600566752355-35792bedcfea","photo-1507652955-f3dcef5a3be5"], Scandinavian: ["photo-1507652955-f3dcef5a3be5","photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1600566752355-35792bedcfea"], Minimal: ["photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600607687939-ce8a6c25118c","photo-1600566752355-35792bedcfea"], Industrial: ["photo-1603512500383-b6f84e07e79f","photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5"], Classic: ["photo-1600566752355-35792bedcfea","photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5"] },
  "Master Bathroom": { Modern: ["photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Contemporary: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1600566752355-35792bedcfea","photo-1507652955-f3dcef5a3be5"], Scandinavian: ["photo-1507652955-f3dcef5a3be5","photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1600566752355-35792bedcfea"], Minimal: ["photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea","photo-1600607687939-ce8a6c25118c"], Industrial: ["photo-1603512500383-b6f84e07e79f","photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5"], Classic: ["photo-1600566752355-35792bedcfea","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600607687939-ce8a6c25118c"] },
  "Common Bathroom": { Modern: ["photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Contemporary: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1600566752355-35792bedcfea","photo-1507652955-f3dcef5a3be5"], Scandinavian: ["photo-1507652955-f3dcef5a3be5","photo-1552321554-5fefe8c9ef14","photo-1600607687939-ce8a6c25118c","photo-1600566752355-35792bedcfea"], Minimal: ["photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea","photo-1600607687939-ce8a6c25118c"], Industrial: ["photo-1603512500383-b6f84e07e79f","photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5"], Classic: ["photo-1600566752355-35792bedcfea","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600607687939-ce8a6c25118c"] },
  "Balcony": {
    Modern:       ["photo-1571026289496-e29ffee09ca3","photo-1567767292278-a204e43f6cd1","photo-1449247709967-d4461a6a6103","photo-1586023492125-27b2c045efd7"],
    Contemporary: ["photo-1586023492125-27b2c045efd7","photo-1571026289496-e29ffee09ca3","photo-1556020685-ae41abfc9365","photo-1567767292278-a204e43f6cd1"],
    Scandinavian: ["photo-1556020685-ae41abfc9365","photo-1571026289496-e29ffee09ca3","photo-1586023492125-27b2c045efd7","photo-1449247709967-d4461a6a6103"],
    Minimal:      ["photo-1449247709967-d4461a6a6103","photo-1571026289496-e29ffee09ca3","photo-1567767292278-a204e43f6cd1","photo-1586023492125-27b2c045efd7"],
    Industrial:   ["photo-1505409628601-edc9af17fda6","photo-1571026289496-e29ffee09ca3","photo-1515263487990-61b07816b324","photo-1560185893-a55cbc8c57e8"],
    Classic:      ["photo-1540518614846-7eded433c457","photo-1571026289496-e29ffee09ca3","photo-1586023492125-27b2c045efd7","photo-1567767292278-a204e43f6cd1"],
  },
  "Pooja Room": { Modern: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Contemporary: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Scandinavian: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Minimal: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Industrial: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"], Classic: ["photo-1600607687939-ce8a6c25118c","photo-1552321554-5fefe8c9ef14","photo-1507652955-f3dcef5a3be5","photo-1600566752355-35792bedcfea"] },
};

const ROOM_CAPTIONS: Record<string, string[]> = {
  "Living Room":    ["Seating area","Feature wall","Dining corner","Evening mood"],
  "Kitchen":        ["Full kitchen view","Counter & cabinetry","Backsplash detail","Breakfast zone"],
  "Master Bedroom": ["Bed zone","Wardrobe wall","Dressing area","Bedside detail"],
  "Bedroom 2":      ["Full room view","Study corner","Wardrobe","Window light"],
  "Bedroom 3":      ["Full room view","Flexible layout","Storage","Natural light"],
  "Bathroom":       ["Full bathroom","Vanity detail","Shower area","Fixture close-up"],
  "Master Bathroom":["Full bathroom","Vanity & mirror","Shower enclosure","Ambiance"],
  "Common Bathroom":["Full bathroom","Vanity","Fixtures","Tile detail"],
  "Balcony":        ["Full balcony","Seating area","Planters","Evening view"],
  "Pooja Room":     ["Full room","Mandir detail","Lighting","Ambiance"],
};

const OVERALL_PHOTOS: Record<string, string[]> = {
  Modern:       ["photo-1567767292278-a204e43f6cd1","photo-1556909114-f6e7ad7d3136","photo-1631049307264-da0ec9d70304","photo-1552321554-5fefe8c9ef14"],
  Contemporary: ["photo-1555041469-a586c61ea9bc","photo-1556909114-f6e7ad7d3136","photo-1616594039964-ae9021a400a0","photo-1600607687939-ce8a6c25118c"],
  Scandinavian: ["photo-1586023492125-27b2c045efd7","photo-1588854337221-4cf9fa96059c","photo-1540304801897-4bd1e5fe2a98","photo-1507652955-f3dcef5a3be5"],
  Minimal:      ["photo-1449247709967-d4461a6a6103","photo-1556909172-54557c7e4fb7","photo-1505693416388-ac5ce068fe85","photo-1552321554-5fefe8c9ef14"],
  Industrial:   ["photo-1505409628601-edc9af17fda6","photo-1585515320310-259814833e62","photo-1493809842364-78817add7ffb","photo-1603512500383-b6f84e07e79f"],
  Classic:      ["photo-1540518614846-7eded433c457","photo-1556909045-9e56fa833e9c","photo-1616594039964-ae9021a400a0","photo-1600566752355-35792bedcfea"],
};

const OVERALL_CAPTIONS = ["Living spaces","Kitchen & dining","Bedrooms","Bathrooms & details"];

const STYLE_STATEMENTS: Record<string, string> = {
  Modern:       "Clean geometry, restrained palette — every element earns its place.",
  Contemporary: "Current trends, timeless comfort — a home that feels of its moment.",
  Scandinavian: "Warmth, simplicity, and a deep respect for natural materials.",
  Minimal:      "Silence is a material. Space is the luxury.",
  Industrial:   "Raw honesty — materials left as they are, spaces left to breathe.",
  Classic:      "Proportion, craft, and permanence — design that stands apart from fashion.",
};

function unsplashUrl(id: string, w = 900, h = 600): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}`;
}

async function moodboardStub(room: RoomDetail, style: StyleProfile): Promise<string> {
  await delay(300);
  const ids = (ROOM_PHOTOS[room.name] ?? ROOM_PHOTOS["Living Room"])[style.overallStyle] ?? (ROOM_PHOTOS[room.name] ?? ROOM_PHOTOS["Living Room"])["Modern"];
  return unsplashUrl(ids[0]);
}

async function roomMoodboardStub(room: RoomDetail, style: StyleProfile): Promise<MoodImage[]> {
  await delay(400);
  const ids      = (ROOM_PHOTOS[room.name] ?? ROOM_PHOTOS["Living Room"])[style.overallStyle] ?? (ROOM_PHOTOS[room.name] ?? ROOM_PHOTOS["Living Room"])["Modern"];
  const captions = ROOM_CAPTIONS[room.name] ?? ["Wide view","Detail","Atmosphere","Close-up"];
  return ids.map((id, i) => ({
    url: unsplashUrl(id, i === 0 ? 1200 : 800, i === 0 ? 675 : 600),
    caption: captions[i] ?? `Image ${i+1}`,
    source: "ai" as const, // stub/placeholder, treated as non-photo-credited
  }));
}

async function overallMoodboardStub(_rooms: RoomDetail[], style: StyleProfile): Promise<OverallMoodboard> {
  await delay(500);
  const ids = OVERALL_PHOTOS[style.overallStyle] ?? OVERALL_PHOTOS["Modern"];
  return {
    images: ids.map((id, i) => ({
      url: unsplashUrl(id, 900, 600),
      caption: OVERALL_CAPTIONS[i] ?? `Space ${i+1}`,
      source: "ai" as const,
    })),
    styleStatement: STYLE_STATEMENTS[style.overallStyle] ?? "A considered interior designed around your life.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildAnalysisSystemPrompt(plotInfo?: PlotInfo): string {
  const context = plotInfo ? buildPlotContext(plotInfo) : "";
  return `You are an expert residential architect with 20 years experience reading floor plans.
Analyse the floor plan image and return a single JSON object matching EXACTLY this schema:

{
  "rooms": [
    {
      "name": string,
      "sizeEstimateSqm": number,
      "notes": string,
      "windowCount": number,
      "orientation": string,
      "adjacentRooms": string[],
      "specialFeatures": string[],
      "furnitureHints": string[],
      "boundingBox": {
        "x": number,
        "y": number,
        "width": number,
        "height": number
      }
    }
  ],
  "hasBalcony": boolean,
  "hasClearZoning": boolean,
  "totalAreaSqm": number,
  "lightningSide": string,
  "circulationQuality": "tight" | "comfortable" | "generous",
  "comments": string[]
}

Rules:
- Identify ALL rooms visible including bathrooms, store rooms, balconies
- Estimate sizes from furniture scale and typical proportions
- adjacentRooms must use exact same names as in rooms array
- boundingBox: REQUIRED for every room. Estimate normalised 0.0-1.0 coordinates
  of where this room sits within the floor plan image.
  x,y = top-left corner, width/height = extent. Origin (0,0) is top-left of the image.
  Example: a room occupying the top-left quarter = {"x":0.0,"y":0.0,"width":0.5,"height":0.5}
  A room in the bottom-right = {"x":0.5,"y":0.5,"width":0.5,"height":0.5}
  Look at the room label position on the plan and estimate accordingly.
  Every room MUST have a boundingBox — do not omit it.
- comments: 3-5 short architectural observations
- Return ONLY the JSON object. No markdown, no explanation.
${context}`;
}

function buildStrengthsPrompt(analysis: PlanAnalysis, plotInfo?: PlotInfo): string {
  const context  = plotInfo ? buildPlotContext(plotInfo) : "";
  const roomList = analysis.rooms.map((r) => `${r.name} (~${r.sizeEstimateSqm}sqm${r.notes ? ", " + r.notes : ""})`).join("; ");
  return `You are a residential architect writing a concept presentation for a homeowner client.
Tone: warm, confident, jargon-free — like a trusted expert talking to a friend.

Floor plan:
- Rooms: ${roomList}
- Total area: ${analysis.totalAreaSqm ?? "unknown"} sqm
- Balcony: ${analysis.hasBalcony ? "yes" : "no"}
- Clear zoning: ${analysis.hasClearZoning ? "yes" : "no"}
- Circulation: ${analysis.circulationQuality ?? "comfortable"}
- Best light side: ${analysis.lightningSide ?? "unknown"}
- Comments: ${(analysis.comments ?? []).join("; ")}
${context}

Write exactly 5 bullet points highlighting the strongest features for the client.
Each bullet: 15-25 words, starts with a benefit, specific to THIS plan, warm and human.

Return ONLY: { "bullets": ["...", "...", "...", "...", "..."] }`;
}

export function buildMoodboardPrompt(room: RoomDetail, style: StyleProfile): string {
  const styleVocab: Record<string, string> = {
    Modern:       "modern interior, clean geometric lines, handleless cabinetry, concrete and glass accents, uncluttered",
    Contemporary: "contemporary interior, current trends, mixed textures, statement furniture, curated accessories",
    Scandinavian: "Scandinavian interior, hygge warmth, light oak wood, white walls, sheepskin throws, simple functional furniture",
    Minimal:      "minimalist interior, extreme restraint, hidden storage, monochrome palette, negative space, serene",
    Industrial:   "industrial interior, exposed brick, raw steel, Edison bulbs, reclaimed wood, urban loft",
    Classic:      "classic interior, traditional craftsmanship, cornicing, panelled walls, antique brass hardware, timeless elegance",
  };
  const paletteVocab: Record<string, string> = {
    LightAiry:   "palette of white, ivory, soft grey, pale blush, flooded with natural light, airy and fresh",
    NeutralWarm: "palette of warm sand, terracotta, dusty rose, burnt sienna, earthy and enveloping",
    DarkMoody:   "palette of deep charcoal, forest green, midnight navy, warm black, dramatic and atmospheric",
  };
  const budgetVocab: Record<string, string> = {
    Practical: "affordable high-street furniture, clever styling on a budget",
    MidRange:  "mid-range quality, West Elm or Zara Home level, stylish but accessible",
    Premium:   "luxury bespoke furniture, designer lighting, premium marble and leather finishes",
  };
  const roomVocab: Record<string, string> = {
    "Living Room":    "living room with comfortable seating, statement rug, curated shelving, ambient and task lighting",
    "Kitchen":        "kitchen with countertops, cabinetry, appliances, backsplash, island if space allows",
    "Master Bedroom": "master bedroom with bed as focal point, bedside tables, soft layered lighting",
    "Bedroom 2":      "bedroom with bed, study desk, wardrobe, calm and restful atmosphere",
    "Bedroom 3":      "bedroom versatile as guest room or home office",
    "Bathroom":       "bathroom with vanity, fixtures, tile work, spa-like and clean",
    "Balcony":        "balcony with outdoor furniture, planters, string lights, indoor-outdoor living",
    "Dining Room":    "dining room with table, pendant light, artwork on wall",
    "Study":          "home office with desk, bookshelves, task lighting",
    "Pooja Room":     "pooja room, traditional joinery, soft lighting, devotional objects, serene and sacred",
  };

  const roomDesc   = roomVocab[room.name] ?? `${room.name.toLowerCase()} interior`;
  const scaleHint  = room.sizeEstimateSqm
    ? room.sizeEstimateSqm < 10 ? "compact space, clever storage,"
    : room.sizeEstimateSqm < 18 ? "medium-sized room,"
    : "spacious room, generous proportions,"
    : "";
  const lightHint  = (room.windowCount ?? 0) >= 2 ? "bright naturally lit space, sunlight streaming in,"
    : room.windowCount === 1 ? "single window with focused natural light," : "";
  const orientHint = room.orientation ? `${room.orientation} room,` : "";
  const features   = room.specialFeatures?.length ? `Features: ${room.specialFeatures.join(", ")}.` : "";
  const hardNo     = style.hardNo?.trim() ? ` Strictly exclude: ${style.hardNo}.` : "";

  return [
    "Professional interior design photograph,",
    roomDesc + ",",
    scaleHint, lightHint, orientHint,
    styleVocab[style.overallStyle] ?? style.overallStyle,
    paletteVocab[style.palette],
    budgetVocab[style.budgetVibe],
    features,
    "photorealistic, 4K, Sony A7R 24mm lens, f/2.8, golden hour light, no people, magazine quality.",
    hardNo,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function buildPlotContext(plotInfo: PlotInfo): string {
  const lines = ["Architect-provided site context:"];
  if (plotInfo.plotAreaSqm)     lines.push(`  Plot/carpet area: ${plotInfo.plotAreaSqm} sqm`);
  if (plotInfo.builtUpAreaSqm)  lines.push(`  Built-up area: ${plotInfo.builtUpAreaSqm} sqm`);
  if (plotInfo.facing)           lines.push(`  Plot facing: ${plotInfo.facing}`);
  if (plotInfo.propertyType)     lines.push(`  Property type: ${plotInfo.propertyType}`);
  if (plotInfo.numberOfBedrooms) lines.push(`  Configuration: ${plotInfo.numberOfBedrooms} BHK`);
  if (plotInfo.numberOfFloors)   lines.push(`  Building floors: ${plotInfo.numberOfFloors}`);
  if (plotInfo.floorLocation)    lines.push(`  Unit location: ${plotInfo.floorLocation} floor`);
  if (plotInfo.vaastuCompliance) lines.push(`  Vaastu: compliance required`);
  if (plotInfo.additionalNotes)  lines.push(`  Notes: ${plotInfo.additionalNotes}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// Gemini safe image size limit (~4MB base64)
const GEMINI_MAX_BYTES = 4 * 1024 * 1024;

async function loadImageAsBase64(
  imageUrl: string
): Promise<{ base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" } | null> {
  try {
    // Remote URL (http/https) — includes Vercel Blob URLs
    if (imageUrl.startsWith("http")) {
      console.log("[ai] Downloading from URL:", imageUrl);
      const cleanUrl = imageUrl.split("?")[0];
      const ext = cleanUrl.split(".").pop()?.toLowerCase() ?? "jpg";
      const buf = await fetchBuffer(imageUrl);
      const mediaType = (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg") as "image/png" | "image/jpeg" | "image/webp";
      return await shrinkIfNeeded(buf, mediaType);
    }

    // Local relative path e.g. /uploads/plan-xxx.png
    let diskPath = "";
    if (imageUrl.startsWith("/")) {
      diskPath = path.join(process.cwd(), "public", imageUrl);
      if (!fs.existsSync(diskPath)) diskPath = imageUrl;
    }

    if (!diskPath || !fs.existsSync(diskPath)) {
      console.error("[ai] Image not found:", imageUrl);
      return null;
    }

    const ext = path.extname(diskPath).toLowerCase();
    console.log(`[ai] Loading image: ${diskPath} (${ext})`);

    if (ext === ".pdf") {
      console.log("[ai] PDF detected — rasterising to JPEG");
      return await rasterisePdf(diskPath);
    }

    const buffer = fs.readFileSync(diskPath);
    console.log(`[ai] Image size: ${(buffer.length / 1024).toFixed(0)} KB`);
    const mediaType = (ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg") as "image/png" | "image/jpeg" | "image/webp";
    return await shrinkIfNeeded(buffer, mediaType);

  } catch (err) {
    console.error("[ai] loadImageAsBase64 failed:", err);
    return null;
  }
}


async function rasterisePdf(
  pdfPath: string
): Promise<{ base64: string; mediaType: "image/jpeg" } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const buffer = await (sharp as unknown as (input: string, opts: object) => import("sharp").Sharp)(pdfPath, { pages: 1, density: 150 })
      .jpeg({ quality: 90 })
      .toBuffer();
    console.log(`[ai] PDF rasterised: ${(buffer.length / 1024).toFixed(0)} KB`);
    return await shrinkIfNeeded(buffer, "image/jpeg");
  } catch (err) {
    console.warn("[ai] PDF rasterisation failed:", String(err));
    console.warn("[ai] TIP: Convert your PDF to PNG before uploading for best results.");
    return null;
  }
}

async function shrinkIfNeeded(
  buffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp"
): Promise<{ base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" }> {
  if (buffer.length <= GEMINI_MAX_BYTES) {
    return { base64: buffer.toString("base64"), mediaType };
  }
  console.log(`[ai] Image ${(buffer.length/1024/1024).toFixed(1)}MB exceeds limit — resizing`);
  try {
    const sharp = (await import("sharp")).default;
    const resized = await sharp(buffer)
      .resize(2000, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    console.log(`[ai] Resized to ${(resized.length/1024/1024).toFixed(1)}MB`);
    return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
  } catch {
    console.warn("[ai] Could not resize — sending full image");
    return { base64: buffer.toString("base64"), mediaType };
  }
}


async function downloadAndSaveImage(url: string, roomName: string): Promise<string> {
  const buffer = await fetchBuffer(url);
  const slug   = roomName.toLowerCase().replace(/\s+/g, "-");
  const { url: localUrl } = await saveUploadedFile(buffer, `moodboard-${slug}-${Date.now()}.jpg`);
  return localUrl;
}

function parseAnalysisJson(text: string): PlanAnalysis {
  try {
    const clean  = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.rooms)) throw new Error("No rooms array");
    return parsed as PlanAnalysis;
  } catch (err) {
    console.error("[ai] Bad analysis JSON:", String(err), "\nRaw:", text?.slice(0, 400));
    throw new Error("AI returned invalid JSON for plan analysis");
  }
}

function parseStrengthsJson(text: string): string[] {
  try {
    const clean  = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed))           return parsed as string[];
    if (Array.isArray(parsed.bullets))   return parsed.bullets as string[];
    if (Array.isArray(parsed.strengths)) return parsed.strengths as string[];
    throw new Error("No array found");
  } catch (err) {
    console.error("[ai] Bad strengths JSON:", String(err), "\nRaw:", text?.slice(0, 300));
    return ["Unable to generate strengths — please try again."];
  }
}

async function fetchJson(url: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Separate buffer fetcher for image binary responses (HF returns raw bytes)
async function fetchImageBuffer(url: string, opts: RequestInit = {}): Promise<Buffer> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 503 = model loading — tell caller to try next model
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    // HF sometimes returns JSON error even with 200 status
    const body = await res.text();
    throw new Error(`HF returned non-image response: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
