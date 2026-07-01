/**
 * app/api/share/route.ts
 * POST — create/refresh share token
 * DELETE — disable share link
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { projectStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { projectId, expiresIn = "never" } = await req.json() as {
      projectId: string;
      expiresIn?: "7d" | "30d" | "never";
    };

    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await projectStore.get(projectId);
    if (!project)  return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const token = project.shareToken ?? randomBytes(16).toString("base64url");

    let expiresAt: string | undefined;
    if (expiresIn === "7d")  expiresAt = new Date(Date.now() + 7  * 86400000).toISOString();
    if (expiresIn === "30d") expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

    await projectStore.update(projectId, {
      shareToken:    token,
      shareEnabled:  true,
      shareExpiresAt: expiresAt,
      shareViewCount: project.shareViewCount ?? 0,
    });

    // Build base URL — works locally and on Vercel
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    const base  = process.env.APP_URL ?? `${proto}://${host}`;

    return NextResponse.json({
      token,
      shareUrl:  `${base}/share/${token}`,
      expiresAt: expiresAt ?? null,
    });
  } catch (err) {
    console.error("[POST /api/share]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { projectId } = await req.json() as { projectId: string };
    const project = await projectStore.get(projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await projectStore.update(projectId, { shareEnabled: false });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
