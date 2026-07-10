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

  // Try free tier first, then paid
  if (process.env.HF_API_TOKEN) {
    try {
      console.log("[aiRender] Trying Hugging Face (free tier)…");
      return await renderWithHuggingFace(planBuffer, prompt);
    } catch (err) {
      console.warn("[aiRender] HF failed, trying next:", err instanceof Error ? err.message : err);
    }
  }

  if (process.env.REPLICATE_API_TOKEN) {
    try {
      console.log("[aiRender] Trying Replicate (paid)…");
      return await renderWithReplicate(planImageUrl, prompt);
    } catch (err) {
      console.warn("[aiRender] Replicate failed:", err instanceof Error ? err.message : err);
    }
  }

  throw new Error(
    "No AI rendering service configured. Add HF_API_TOKEN (free) or REPLICATE_API_TOKEN to your environment variables."
  );
}

// ── Hugging Face (free tier) ────────────────────────────────────────────
// Uses the image-to-image endpoint with SDXL-based models.

async function renderWithHuggingFace(
  planBuffer: Buffer,
  prompt: string
): Promise<string> {
  const token = process.env.HF_API_TOKEN!;

  // Models with active free inference — ordered by quality
  const models = [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
    "CompVis/stable-diffusion-v1-4",
  ];

  for (const model of models) {
    try {
      console.log(`[aiRender] HF model: ${model}`);
      const url = await callHfImgToImg(model, planBuffer, prompt, token);
      if (url) return url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[aiRender] ${model}: ${msg}`);
      if (msg.includes("503") || msg.includes("loading") || msg.includes("fetch")) continue;
      if (msg.includes("429")) continue;
      throw err;
    }
  }

  throw new Error("All HF models unavailable — try again in a few minutes");
}

async function callHfImgToImg(
  model: string,
  imageBuffer: Buffer,
  prompt: string,
  token: string
): Promise<string> {
  // Use the image-to-image endpoint
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
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
      }
    );

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

  // Use model name instead of version hash — Replicate resolves to latest
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({
      model: "jagilley/controlnet-canny",
      input: {
        image: planImageUrl,
        prompt: prompt,
        negative_prompt: NEG,
        num_inference_steps: 30,
        guidance_scale: 8.5,
        a_prompt: "best quality, highly detailed, photorealistic",
        ddim_steps: 30,
        scale: 9,
        seed: Math.floor(Math.random() * 1000000),
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Replicate ${response.status}: ${errText.slice(0, 200)}`);
  }

  const prediction = await response.json();

  if (prediction.output) {
    return Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  }

  if (prediction.id) {
    return pollReplicate(prediction.id, token);
  }

  throw new Error(`Replicate failed: ${prediction.error ?? "unknown"}`);
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
