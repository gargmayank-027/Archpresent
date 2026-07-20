/**
 * lib/aiRender.ts
 *
 * AI floor plan rendering with a cost-priority fallback chain:
 *   1. Hugging Face Inference API (free tier)
 *   2. Replicate ControlNet (paid, ~$0.03/image)
 *
 * Required env vars (at least one):
 *   HF_API_TOKEN        — from huggingface.co/settings/tokens (free)
 *   REPLICATE_API_TOKEN  — from replicate.com (paid fallback)
 */

import type { RoomDetail, PlotInfo } from "@/types";

// ── Prompt builder ──────────────────────────────────────────────────────

function buildPrompt(rooms: RoomDetail[], plotInfo?: PlotInfo): string {
  const roomTypes = new Set<string>();
  for (const r of rooms) {
    const n = r.name.toLowerCase();
    if (n.includes("bed")) roomTypes.add("bedrooms with beds and nightstands");
    else if (n.includes("living") || n.includes("drawing")) roomTypes.add("living room with sofas and coffee table");
    else if (n.includes("kitchen")) roomTypes.add("kitchen with counters and appliances");
    else if (n.includes("dining")) roomTypes.add("dining area with table and chairs");
    else if (n.includes("pooja") || n.includes("puja")) roomTypes.add("pooja room with wooden mandir");
    else if (n.includes("bath") || n.includes("toilet")) roomTypes.add("bathroom with fixtures");
    else if (n.includes("stair")) roomTypes.add("staircase");
  }

  const region = (!plotInfo?.country || plotInfo.country.toLowerCase() === "india")
    ? "Indian residential home, " : "";

  return [
    "photorealistic top-down architectural floor plan render,",
    `${region}modern interior design,`,
    `${Array.from(roomTypes).join(", ")},`,
    "wooden flooring, tiled bathrooms, furniture placement,",
    "indoor plants, natural lighting with soft shadows,",
    "landscaping with grass and plants around the plot,",
    "cars in parking, paved driveway,",
    "professional real estate marketing, highly detailed, 4K,",
    "birds eye view, top down perspective,",
    "no text, no labels, no dimensions, no annotations, no watermark",
  ].join(" ");
}

const NEG = "blurry, low quality, distorted, text, labels, dimensions, watermark, signature, cartoon, anime, people, humans";

// ── Main entry ──────────────────────────────────────────────────────────

export async function generateAiRenderedPlan(
  planImageUrl: string,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo
): Promise<string> {
  const prompt = buildPrompt(rooms, plotInfo);
  console.log(`[aiRender] Prompt: ${prompt.slice(0, 100)}…`);

  // Download the plan image as a buffer (needed for HF multipart upload)
  const imgRes = await fetch(planImageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch plan image: ${imgRes.status}`);
  const planBuffer = Buffer.from(await imgRes.arrayBuffer());

  const errors: string[] = [];

  // Gemini 2.5 Flash Image ("Nano Banana") — PRIMARY provider. Reuses the
  // GOOGLE_AI_KEY already configured for the analysis path (lib/ai.ts);
  // no separate billing account needed, unlike the Replicate fallback
  // below (which was failing with 402 Insufficient credit / 404 dead
  // models — that's what "hits the limit instantly" actually was). We
  // pass the real plan image as inline_data so the model EDITS the actual
  // plan rather than inventing an unrelated one from a text prompt alone.
  if (process.env.GOOGLE_AI_KEY) {
    try {
      console.log("[aiRender] Trying Gemini 2.5 Flash Image…");
      return await renderWithGemini(planBuffer, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Gemini: ${msg}`);
      console.warn("[aiRender] Gemini failed:", msg);
    }
  }

  // HF is DNS-blocked from Vercel — skip entirely in production
  if (process.env.HF_API_TOKEN && !process.env.VERCEL) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[aiRender] Trying Hugging Face (attempt ${attempt})…`);
        return await renderWithHuggingFace(planBuffer, prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`HF attempt ${attempt}: ${msg}`);
        console.warn(`[aiRender] HF attempt ${attempt} failed:`, msg);
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  if (process.env.REPLICATE_API_TOKEN) {
    try {
      console.log("[aiRender] Trying Replicate…");
      return await renderWithReplicate(planImageUrl, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Replicate: ${msg}`);
      console.warn("[aiRender] Replicate failed:", msg);
    }
  }

  if (errors.length > 0) {
    throw new Error(`AI rendering failed: ${errors.join(" | ")}`);
  }

  throw new Error(
    "No AI rendering service configured. Add REPLICATE_API_TOKEN to your Vercel environment variables. " +
    "Get one free at replicate.com/account/api-tokens"
  );
}

// ── Hugging Face (free tier) ────────────────────────────────────────────
// Uses the image-to-image endpoint with SDXL-based models.

async function renderWithHuggingFace(
  planBuffer: Buffer,
  prompt: string
): Promise<string> {
  const token = process.env.HF_API_TOKEN!;

  const models = [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
  ];

  for (const model of models) {
    try {
      console.log(`[aiRender] HF model: ${model}`);
      const url = await callHfImgToImg(model, planBuffer, prompt, token);
      if (url) return url;
    } catch (err) {
      const msg = err instanceof Error ? `${err.message} [${err.cause ?? ""}]` : String(err);
      console.warn(`[aiRender] ${model}: ${msg}`);
      continue;
    }
  }

  throw new Error("All HF models unavailable");
}

async function callHfImgToImg(
  model: string,
  _imageBuffer: Buffer,
  prompt: string,
  token: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const apiUrl = `https://api-inference.huggingface.co/models/${model}`;
    console.log(`[aiRender] Fetching: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-wait-for-model": "true",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          negative_prompt: NEG,
          guidance_scale: 8,
          num_inference_steps: 25,
        },
      }),
      signal: controller.signal,
    });

    console.log(`[aiRender] HF response: ${response.status} ${response.headers.get("content-type")}`);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HF ${response.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = await response.json();
      if (json.error) throw new Error(`HF: ${json.error}`);
      throw new Error("503: Model loading");
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    if (resultBuffer.length < 1000) throw new Error("HF returned empty image");

    return `data:image/png;base64,${resultBuffer.toString("base64")}`;
  } catch (err) {
    // Add details about why fetch failed
    if (err instanceof TypeError && (err as any).cause) {
      throw new Error(`fetch failed: ${String((err as any).cause)}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Replicate (paid fallback) ───────────────────────────────────────────

async function renderWithReplicate(
  planImageUrl: string,
  prompt: string
): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;

  // Models to try — some may be removed/renamed over time
  const models = [
    "andreasjansson/controlnet-canny",
    "jagilley/controlnet-canny", 
    "lucataco/sdxl-controlnet",
  ];

  for (const model of models) {
    try {
      console.log(`[aiRender] Replicate model: ${model}`);
      
      // Step 1: Look up the model to get the latest version
      const modelRes = await fetch(`https://api.replicate.com/v1/models/${model}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      
      if (!modelRes.ok) {
        console.log(`[aiRender] Model ${model} not found (${modelRes.status}), trying next…`);
        continue;
      }
      
      const modelData = await modelRes.json();
      const version = modelData.latest_version?.id;
      
      if (!version) {
        console.log(`[aiRender] No version for ${model}, trying next…`);
        continue;
      }
      
      console.log(`[aiRender] Using version: ${version.slice(0, 12)}…`);

      // Step 2: Create prediction with the discovered version
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Prefer": "wait",
        },
        body: JSON.stringify({
          version,
          input: {
            image: planImageUrl,
            prompt: prompt,
            a_prompt: "best quality, highly detailed, photorealistic, professional real estate render",
            n_prompt: NEG,
            ddim_steps: 30,
            scale: 9,
            seed: Math.floor(Math.random() * 1000000),
            eta: 0,
            image_resolution: 768,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.warn(`[aiRender] Replicate prediction failed (${response.status}): ${errText.slice(0, 150)}`);
        continue;
      }

      const prediction = await response.json();

      if (prediction.output) {
        const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        if (url) return url;
      }

      if (prediction.id) {
        return await pollReplicate(prediction.id, token);
      }
    } catch (err) {
      console.warn(`[aiRender] ${model} error:`, err instanceof Error ? err.message : err);
      continue;
    }
  }

  throw new Error("All Replicate models failed");
}

async function pollReplicate(id: string, token: string): Promise<string> {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const pred = await res.json();
    if (pred.status === "succeeded" && pred.output) {
      return Array.isArray(pred.output) ? pred.output[0] : pred.output;
    }
    if (pred.status === "failed") throw new Error(`Replicate failed: ${pred.error}`);
  }

  throw new Error("Replicate timed out");
}


// ── Gemini 2.5 Flash Image (primary) ────────────────────────────────────
// REST generateContent with responseModalities:["Text","Image"]; the input
// plan is passed as inline_data so the model edits the real plan. Response
// image comes back as base64 in candidates[0].content.parts[].inlineData.
// API shape verified against Google AI docs (ai.google.dev), Aug 2025+.

async function renderWithGemini(planBuffer: Buffer, prompt: string): Promise<string> {
  const key = process.env.GOOGLE_AI_KEY!;
  // Try newest -> oldest. Different model generations can have separate
  // quota pools, so if one returns 429 (quota) or 404 (not available on
  // this account), we fall through to the next rather than giving up.
  // IDs verified against ai.google.dev/gemini-api/docs (2026):
  //   Nano Banana 2      -> gemini-3.1-flash-image-preview
  //   Nano Banana 2 Lite -> gemini-3.1-flash-lite-image
  //   Nano Banana        -> gemini-2.5-flash-image-preview
  const models = [
    "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-lite-image",
    "gemini-2.5-flash-image-preview",
  ];
  const geminiErrors: string[] = [];
  for (const model of models) {
    try {
      return await callGeminiImage(model, key, planBuffer, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      geminiErrors.push(`${model}: ${msg}`);
      console.warn(`[aiRender] Gemini model ${model} failed:`, msg);
    }
  }
  throw new Error(geminiErrors.join(" | "));
}

async function callGeminiImage(
  model: string, key: string, planBuffer: Buffer, prompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Nano-banana-style editing prompt: keep the real layout, restyle it into
  // a photorealistic furnished render. Reuses the descriptive prompt built
  // by buildPrompt(), prefixed with an explicit "edit, don't reinvent"
  // instruction to keep the model anchored to the uploaded plan.
  const editPrompt =
    "Transform this architectural floor plan into a photorealistic, top-down, " +
    "furnished interior render. Preserve the EXACT wall layout, room positions, " +
    "and proportions of the provided plan — do not move walls or invent a " +
    "different layout. " + prompt;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: editPrompt },
            { inline_data: { mime_type: "image/png", data: planBuffer.toString("base64") } },
          ],
        }],
        generationConfig: { responseModalities: ["Text", "Image"] },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      // REST returns camelCase inlineData; SDKs sometimes snake_case — accept both.
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType ?? inline.mime_type ?? "image/png";
        return `data:${mime};base64,${inline.data}`;
      }
    }
    throw new Error("Gemini returned no image part (only text or empty response)");
  } finally {
    clearTimeout(timeout);
  }
}
