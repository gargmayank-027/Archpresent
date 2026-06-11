/**
 * app/api/moodboards/route.ts
 *
 * POST /api/moodboards
 *   body: { projectId, styleProfile, rooms? }
 *   Saves styleProfile, generates:
 *     1. overallMoodboard  — 4-image whole-home style hero
 *     2. roomMoodboards[]  — per room: plan snippet + 3-4 images
 *
 * PATCH /api/moodboards
 *   body: { projectId, roomName, imageIndex, imageUrl }
 *   Replace a single image within a room's moodboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import {
  generateRoomMoodboard,
  generateOverallMoodboard,
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
    } = body as {
      projectId: string;
      styleProfile: StyleProfile;
      rooms?: string[];
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

    // ── Determine target rooms ─────────────────────────────────────────────
    let targetNames: string[];
    if (requestedRooms && requestedRooms.length > 0) {
      targetNames = requestedRooms;
    } else {
      // Key rooms that appear in the analysis
      targetNames = KEY_ROOMS.filter((kr) =>
        detectedRooms.some((r) => r.name.toLowerCase().includes(kr.toLowerCase()))
      );
      // If no key rooms matched, use first 4 detected
      if (targetNames.length === 0) {
        targetNames = detectedRooms.slice(0, 4).map((r) => r.name);
      }
    }

    // ── 1. Overall moodboard ──────────────────────────────────────────────
    console.log("[moodboards] Generating overall moodboard…");
    const overallMoodboard: OverallMoodboard = await generateOverallMoodboard(
      detectedRooms,
      styleProfile
    );

    // ── 2. Per-room moodboards ────────────────────────────────────────────
    console.log(`[moodboards] Generating ${targetNames.length} room moodboards…`);

    const existing = project.roomMoodboards ?? [];
    const generated: RoomMoodboard[] = [];

    for (const roomName of targetNames) {
      const roomDetail =
        detectedRooms.find((r) => r.name === roomName) ?? { name: roomName };

      // Generate 3-4 mood images
      const images = await generateRoomMoodboard(roomDetail as RoomDetail, styleProfile);

      // Crop plan snippet for this room
      const planSnippetUrl = await cropRoomFromPlan(
        project.planImagePath,
        roomName,
        projectId
      );

      generated.push({
        roomName,
        planSnippetUrl: planSnippetUrl ?? undefined,
        images,
      });

      console.log(
        `[moodboards] ${roomName}: ${images.length} images, snippet: ${planSnippetUrl ? "✓" : "—"}`
      );
    }

    // Merge: keep existing rooms not being regenerated
    const merged = [
      ...existing.filter((e) => !targetNames.includes(e.roomName)),
      ...generated,
    ];

    // Also keep legacy moodboards[] for backward compat (PDF uses it)
    const legacyMoodboards = merged.map((rm) => ({
      roomName: rm.roomName,
      imageUrl: rm.images[0]?.url ?? "",
    }));

    await projectStore.update(projectId, {
      styleProfile,
      overallMoodboard,
      roomMoodboards: merged,
      moodboards:     legacyMoodboards, // keeps export/PDF working
      status: "styled",
    });

    return NextResponse.json({
      overallMoodboard,
      roomMoodboards: merged,
      styleProfile,
    });
  } catch (err) {
    console.error("[POST /api/moodboards]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, roomName, imageIndex, imageUrl } = body as {
      projectId: string;
      roomName: string;
      imageIndex: number;
      imageUrl: string;
    };

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const roomMoodboards = (project.roomMoodboards ?? []).map((rm) => {
      if (rm.roomName !== roomName) return rm;
      const images = rm.images.map((img, i) =>
        i === imageIndex ? { ...img, url: imageUrl } : img
      );
      return { ...rm, images };
    });

    await projectStore.update(projectId, { roomMoodboards });
    return NextResponse.json({ roomMoodboards });
  } catch (err) {
    console.error("[PATCH /api/moodboards]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
