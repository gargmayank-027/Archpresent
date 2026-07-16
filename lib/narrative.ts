import type { RoomDetail, PlotInfo } from "@/types";

/**
 * Build a short narrative description of a room for the client walkthrough.
 * Written in second person, varied per room type, avoiding generic filler.
 *
 * NOTE: This file must stay free of server-only imports (fs, sharp, pdf-lib,
 * lib/store, etc.) — it is imported directly by client components like
 * components/NarrativePreview.tsx. Server-only PDF generation code lives in
 * lib/pdf.ts, which re-exports this function for use in API routes.
 */
export function buildRoomNarrative(room: RoomDetail, plotInfo?: PlotInfo): string {
  const name = room.name.toLowerCase();
  const sqm = room.sizeEstimateSqm;
  const orient = (room.orientation ?? "").toLowerCase();
  const features = room.specialFeatures ?? [];
  const adjacent = room.adjacentRooms ?? [];

  // ── Room-type-specific openers ──────────────────────────────────────
  if (name.includes("master") || (name.includes("bed") && name.includes("1"))) {
    const parts = [`Your primary bedroom${sqm ? ` (${sqm} sqm)` : ""} is positioned for privacy.`];
    if (orient.includes("east")) parts.push("Morning light wakes the room naturally — no alarm needed.");
    else if (orient.includes("north")) parts.push("North-facing for even, glare-free daylight throughout the day.");
    if (features.some(f => f.toLowerCase().includes("walk-in") || f.toLowerCase().includes("wardrobe")))
      parts.push("The attached walk-in keeps the bedroom clutter-free.");
    if (adjacent.some(a => a.toLowerCase().includes("dress") || a.toLowerCase().includes("toilet")))
      parts.push("Dressing and bathroom are directly accessible — a self-contained suite.");
    return parts.join(" ");
  }

  if (name.includes("bed")) {
    const parts = [`This bedroom${sqm ? ` at ${sqm} sqm` : ""} is well-proportioned for comfortable daily use.`];
    if (orient) parts.push(orient.includes("east") ? "East-facing for fresh morning light." : orient.includes("west") ? "Afternoon warmth from the west." : "");
    if (features.length) parts.push(`Includes ${features[0].toLowerCase()}.`);
    return parts.filter(Boolean).join(" ");
  }

  if (name.includes("drawing") || name.includes("living")) {
    const parts = [`The main living space${sqm ? ` (${sqm} sqm)` : ""} is where your family gathers and guests are welcomed.`];
    if (orient.includes("east")) parts.push("East-facing — bright and inviting through the morning hours.");
    if (features.some(f => f.toLowerCase().includes("double height"))) parts.push("Double-height volume gives it a sense of grandeur.");
    if (features.some(f => f.toLowerCase().includes("deck"))) parts.push("The attached deck extends the living space outdoors.");
    return parts.join(" ");
  }

  if (name.includes("kitchen")) {
    const parts = [`The kitchen${sqm ? ` (${sqm} sqm)` : ""} is designed for efficient workflow.`];
    if (adjacent.some(a => a.toLowerCase().includes("dining") || a.toLowerCase().includes("lobby")))
      parts.push("Direct access to the dining area keeps serving seamless.");
    if (adjacent.some(a => a.toLowerCase().includes("servant") || a.toLowerCase().includes("utility")))
      parts.push("A connected service area handles the heavy-duty work.");
    return parts.join(" ");
  }

  if (name.includes("lobby") || name.includes("dining") || name.includes("dinning")) {
    const parts = [`The lobby and dining area${sqm ? ` (${sqm} sqm)` : ""} forms the circulation spine of the home.`];
    parts.push("It connects the social and private zones while providing a generous dining space for family meals.");
    return parts.join(" ");
  }

  if (name.includes("pooja") || name.includes("puja")) {
    return `A dedicated prayer space${sqm ? ` (${sqm} sqm)` : ""} — quiet, inward-facing, and positioned per tradition. ${orient.includes("east") ? "East-facing for morning worship." : ""}`.trim();
  }

  if (name.includes("dress") || name.includes("w.i.w") || name.includes("wardrobe")) {
    return `Attached dressing area${sqm ? ` (${sqm} sqm)` : ""} with room for organised storage — keeping the bedroom itself clean and restful.`;
  }

  if (name.includes("toilet") || name.includes("bath")) {
    const attached = adjacent.length ? `Serves ${adjacent[0]}.` : "";
    return `${sqm ? `${sqm} sqm` : "A compact"} bathroom designed for efficient daily use. ${attached}`.trim();
  }

  if (name.includes("porch") || name.includes("entry")) {
    return `The entry porch${sqm ? ` (${sqm} sqm)` : ""} creates a transition from the street to the home — a moment of arrival before stepping inside.`;
  }

  if (name.includes("stair")) {
    return `The staircase area${sqm ? ` (${sqm} sqm)` : ""} provides vertical circulation between floors.`;
  }

  if (name.includes("servant") || name.includes("utility") || name.includes("maid")) {
    return `Service area${sqm ? ` (${sqm} sqm)` : ""} — kept separate from the main living spaces for practical daily operation.`;
  }

  if (name.includes("lift")) {
    return `Future-ready lift provision${sqm ? ` (${sqm} sqm)` : ""} — adds convenience and long-term accessibility to the home.`;
  }

  // Generic fallback. Kept deliberately plain — it only runs for room types
  // we don't recognise, and inventing detail we can't verify would be worse
  // than saying little.
  const bits: string[] = [];
  if (sqm) bits.push(`${sqm} sqm`);
  if (orient) bits.push(`${orient}-facing`);
  const lead = bits.length ? `${room.name} — ${bits.join(", ")}.` : `${room.name}.`;
  const extra = features.length ? ` Features ${features.slice(0, 2).join(" and ").toLowerCase()}.` : "";
  return (lead + extra).trim();
}
