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

  // Models to try in order — some may be cold/unavailable
  const models = [
    "lllyasviel/sd-controlnet-canny",
    "stabilityai/stable-diffusion-xl-refiner-1.0",
    "runwayml/stable-diffusion-v1-5",
  ];

  for (const model of models) {
    try {
      console.log(`[aiRender] HF model: ${model}`);
      const url = await callHfModel(model, planBuffer, prompt, token);
      if (url) return url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("503") || msg.includes("loading")) {
        console.log(`[aiRender] ${model} is loading, trying next…`);
        continue;
      }
      if (msg.includes("429")) {
        console.log(`[aiRender] ${model} rate limited, trying next…`);
        continue;
      }
      throw err;
    }
  }

  throw new Error("All HF models unavailable — try again in a few minutes");
}

async function callHfModel(
  model: string,
  imageBuffer: Buffer,
  prompt: string,
  token: string
): Promise<string> {
  const isControlNet = model.includes("controlnet");

  if (isControlNet) {
    // ControlNet models use JSON input with base64 image
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          image: `data:image/png;base64,${imageBuffer.toString("base64")}`,
          negative_prompt: NEG,
          num_inference_steps: 25,
          guidance_scale: 8,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HF ${response.status}: ${errText.slice(0, 200)}`);
    }

    // Response is the image directly
    const resultBuffer = Buffer.from(await response.arrayBuffer());
    return bufferToDataUrl(resultBuffer);
  }

  // img2img models — send image as multipart
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/png" });
  formData.append("inputs", blob, "plan.png");

  // For img2img, we pass the prompt as a parameter
  const params = new URLSearchParams({
    prompt: prompt,
    negative_prompt: NEG,
    strength: "0.65",  // how much to change from original (0=identical, 1=completely new)
    guidance_scale: "8.0",
    num_inference_steps: "25",
  });

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${model}?${params.toString()}`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: imageBuffer,
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`HF ${response.status}: ${errText.slice(0, 200)}`);
  }

  // Check if response is JSON (error/loading) or binary (image)
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const json = await response.json();
    if (json.error) throw new Error(`HF: ${json.error}`);
    if (json.estimated_time) throw new Error(`503: Model loading (ETA: ${json.estimated_time}s)`);
    throw new Error("HF: unexpected JSON response");
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer());
  if (resultBuffer.length < 1000) throw new Error("HF returned empty/tiny image");

  return bufferToDataUrl(resultBuffer);
}

function bufferToDataUrl(buffer: Buffer): string {
  // We return a data URL temporarily — the caller will download and save it
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

// ── Replicate (paid fallback) ───────────────────────────────────────────

async function renderWithReplicate(
  planImageUrl: string,
  prompt: string
): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({
      version: "2220025c1bfed10fa2e608a03d74bde1bbacc586d60f98b76e08ece3af3f97ab",
      input: {
        image: planImageUrl,
        prompt: prompt,
        negative_prompt: NEG,
        num_inference_steps: 30,
        guidance_scale: 8.5,
        controlnet_conditioning_scale: 0.75,
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
