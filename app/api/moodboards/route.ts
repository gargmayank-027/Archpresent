/**
 * app/api/moodboards/route.ts
 *
 * POST /api/moodboards
 *   body: { projectId, styleProfile, rooms?, contextPrompts? }
 *   Saves styleProfile, generates:
 *     1. overallMoodboard  -- 4-image whole-home style hero
 *     2. roomMoodboards[]  -- per room: plan snippet + 3-4 images
 *
 *   `contextPrompts` is an optional map of roomName -> architect's plain-
 *   English brief for that space (e.g. "client wants a reading nook by
 *   the window"). Folded into the Unsplash search query / AI prompt.
 *
 * PATCH /api/moodboards
 *   body: { projectId, roomName, imageIndex, mode: "photo" | "ai" }
 *   Regenerates a single image within a room's moodboard -- either a
 *   different real photo (Unsplash, "Try another") or a fresh AI
 *   generation ("Generate with AI") -- and persists the result.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import {
  generateRoomMoodboard,
  generateOverallMoodboard,
  regenerateSingleRoomImage,
} from "@/lib/ai";
import { cropRoomFromPlan } from "@/lib/planCrop";
import type { StyleProfile, RoomMoodboard, OverallMoodboard, RoomDetail } from "@/types";

export const runtime = "nodejs";

// Rooms we always try to generate moodboards for (if detected in analysis)
const KEY_ROOMS = [
  "Living Room",
  "Kitchen",
  "Master Bedroom",
  "Bedroom 2",
  "Bedroom 3",
  "Balcony",
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      styleProfile,
      rooms: requestedRooms,
      contextPrompts,
    } = body as {
      projectId: string;
      styleProfile: StyleProfile;
      rooms?: string[];
      contextPrompts?: Record<string, string>;
    };

    if (!projectId || !styleProfile) {
      return NextResponse.json(
        { error: "projectId and styleProfile are required" },
        { status: 400 }
      );
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.analysis) {
      return NextResponse.json(
        { error: "Analyse the plan first before generating moodboards" },
        { status: 400 }
      );
    }

    const detectedRooms = project.analysis.rooms as RoomDetail[];

    // -- Determine target rooms ----------------------------------------------
    let targetNames: string[];
    if (requestedRooms && requestedRooms.length > 0) {
      targetNames = requestedRooms;
    } else {
      targetNames = KEY_ROOMS.filter((kr) =>
        detectedRooms.some((r) => r.name.toLowerCase().includes(kr.toLowerCase()))
      );
      if (targetNames.length === 0) {
        targetNames = detectedRooms.slice(0, 4).map((r) => r.name);
      }
    }

    const usingRealPhotos = !!process.env.UNSPLASH_ACCESS_KEY;
    console.log(`[moodboards] Source: ${usingRealPhotos ? "Unsplash real photos (first draft)" : "AI generation (no UNSPLASH_ACCESS_KEY set)"}`);

    // -- 1. Overall moodboard -------------------------------------------------
    console.log("[moodboards] Generating overall moodboard…");
    const overallMoodboard: OverallMoodboard = await generateOverallMoodboard(
      detectedRooms,
      styleProfile
    );

    // -- 2. Per-room moodboards -------------------------------------------------
    console.log(`[moodboards] Generating ${targetNames.length} room moodboards…`);

    const existing = project.roomMoodboards ?? [];
    const generated: RoomMoodboard[] = [];

    for (const [roomIdx, roomName] of targetNames.entries()) {
      const roomDetail =
        detectedRooms.find((r) => r.name === roomName) ?? { name: roomName };
      const contextPrompt = contextPrompts?.[roomName]?.trim() || undefined;

      // Pass roomIdx so each room fetches from a different Unsplash page offset,
      // preventing similar rooms (Bedroom 2 vs Bedroom 3) from sharing photos.
      const images = await generateRoomMoodboard(roomDetail as RoomDetail, styleProfile, contextPrompt, roomIdx);

      // Crop plan snippet for this room -- only if real coordinates exist.
      const planSnippetUrl = await cropRoomFromPlan(
        project.planImagePath,
        roomName,
        projectId,
        (roomDetail as RoomDetail).boundingBox
      );

      generated.push({
        roomName,
        planSnippetUrl: planSnippetUrl ?? undefined,
        images,
        contextPrompt,
      });

      const sourceSummary = images.map((i) => i.source).join(",");
      console.log(`[moodboards] ✓ ${roomName}: ${images.length} images (${sourceSummary}), snippet: ${planSnippetUrl ? "✓" : "—"}`);
    }

    // Merge: keep existing rooms not being regenerated
    const merged = [
      ...existing.filter((e) => !targetNames.includes(e.roomName)),
      ...generated,
    ];

    // Legacy moodboards[] for backward compat (PDF uses it)
    const legacyMoodboards = merged.map((rm) => ({
      roomName: rm.roomName,
      imageUrl: rm.images[0]?.url ?? "",
    }));

    await projectStore.update(projectId, {
      styleProfile,
      overallMoodboard,
      roomMoodboards: merged,
      moodboards: legacyMoodboards,
      status: "styled",
    });

    return NextResponse.json({ overallMoodboard, roomMoodboards: merged, styleProfile });
  } catch (err) {
    console.error("[POST /api/moodboards]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, roomName, imageIndex, mode } = body as {
      projectId: string;
      roomName: string;
      imageIndex: number;
      mode: "photo" | "ai";
    };

    if (!projectId || !roomName || imageIndex === undefined || !mode) {
      return NextResponse.json(
        { error: "projectId, roomName, imageIndex, and mode are required" },
        { status: 400 }
      );
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const roomMoodboard = project.roomMoodboards?.find((rm) => rm.roomName === roomName);
    if (!roomMoodboard) {
      return NextResponse.json({ error: `Room "${roomName}" not found` }, { status: 404 });
    }

    const roomDetail = (project.analysis?.rooms.find((r) => r.name === roomName) ?? { name: roomName }) as RoomDetail;
    const styleProfile = project.styleProfile;
    if (!styleProfile) {
      return NextResponse.json({ error: "No style profile set for this project" }, { status: 400 });
    }

    const existingUrls = roomMoodboard.images.map((img) => img.url);
    const targetCaption = roomMoodboard.images[imageIndex]?.caption;

    console.log(`[moodboards] Regenerating ${roomName} image ${imageIndex} via ${mode}…`);

    const newImage = await regenerateSingleRoomImage(
      roomDetail,
      styleProfile,
      mode,
      roomMoodboard.contextPrompt,
      existingUrls,
      targetCaption
    );

    const roomMoodboards = (project.roomMoodboards ?? []).map((rm) => {
      if (rm.roomName !== roomName) return rm;
      const images = rm.images.map((img, i) => (i === imageIndex ? newImage : img));
      return { ...rm, images };
    });

    // Keep legacy moodboards[] in sync too
    const legacyMoodboards = roomMoodboards.map((rm) => ({
      roomName: rm.roomName,
      imageUrl: rm.images[0]?.url ?? "",
    }));

    await projectStore.update(projectId, { roomMoodboards, moodboards: legacyMoodboards });

    console.log(`[moodboards] ✓ ${roomName} image ${imageIndex} replaced (${newImage.source})`);

    return NextResponse.json({ roomMoodboards, newImage });
  } catch (err) {
    console.error("[PATCH /api/moodboards]", err);
    const msg = String(err);
    const status = msg.includes("UNSPLASH_NOT_CONFIGURED") || msg.includes("UNSPLASH_RATE_LIMITED") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
