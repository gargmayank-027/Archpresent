/**
 * app/api/moodboards/route.ts
 *
 * POST /api/moodboards
 *   body: { projectId, styleProfile, rooms? }
 *   Saves the styleProfile and generates moodboard images for key rooms.
 *   If rooms[] is provided, only regenerate those rooms.
 *
 * PATCH /api/moodboards
 *   body: { projectId, roomName, imageUrl }
 *   Replace a single moodboard image URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { generateMoodboardImage } from "@/lib/ai";
import type { StyleProfile, Moodboard, RoomDetail } from "@/types";

export const runtime = "nodejs";

const KEY_ROOMS = ["Living Room", "Kitchen", "Master Bedroom"];

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
        { error: "Project must be analyzed before generating moodboards" },
        { status: 400 }
      );
    }

    // Determine which rooms to generate
    const detectedRoomNames = project.analysis.rooms.map((r) => r.name);
    const targetRoomNames =
      requestedRooms && requestedRooms.length > 0
        ? requestedRooms
        : KEY_ROOMS.filter((kr) =>
            detectedRoomNames.some((dn) =>
              dn.toLowerCase().includes(kr.toLowerCase())
            )
          );

    // If we couldn't match any key rooms, fall back to first 3 detected
    const finalRooms =
      targetRoomNames.length > 0
        ? targetRoomNames
        : detectedRoomNames.slice(0, 3);

    // Generate in parallel
    const existing = project.moodboards ?? [];
    const generated: Moodboard[] = [];

    await Promise.all(
      finalRooms.map(async (roomName) => {
        const roomDetail: RoomDetail =
          project.analysis!.rooms.find((r) => r.name === roomName) ?? {
            name: roomName,
          };

        const imageUrl = await generateMoodboardImage(roomDetail, styleProfile);
        generated.push({ roomName, imageUrl });
      })
    );

    // Merge with any existing moodboards not being regenerated
    const merged = [
      ...existing.filter((e) => !finalRooms.includes(e.roomName)),
      ...generated,
    ];

    await projectStore.update(projectId, {
      styleProfile,
      moodboards: merged,
      status: "styled",
    });

    return NextResponse.json({ moodboards: merged, styleProfile });
  } catch (err) {
    console.error("[POST /api/moodboards]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, roomName, imageUrl } = body as {
      projectId: string;
      roomName: string;
      imageUrl: string;
    };

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const moodboards = (project.moodboards ?? []).map((mb) =>
      mb.roomName === roomName ? { ...mb, imageUrl } : mb
    );

    await projectStore.update(projectId, { moodboards });
    return NextResponse.json({ moodboards });
  } catch (err) {
    console.error("[PATCH /api/moodboards]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
