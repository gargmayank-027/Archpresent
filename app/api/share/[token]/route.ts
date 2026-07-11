/**
 * app/api/share/[token]/route.ts
 * GET — public, returns project data if token valid, increments view count
 */
import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 400 });

    console.log(`[share] Looking up token: ${token.slice(0, 8)}…`);

    const all = await projectStore.list();
    console.log(`[share] Total projects found: ${all.length}`);

    const project = all.find((p) => p.shareToken === token);

    if (!project) {
      // Log available tokens for debugging
      const tokens = all.filter(p => p.shareToken).map(p => p.shareToken?.slice(0, 8));
      console.log(`[share] Available tokens: ${tokens.join(", ") || "none"}`);
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    if (project.shareEnabled === false)
      return NextResponse.json({ error: "This link has been disabled by the architect" }, { status: 403 });

    if (project.shareExpiresAt && new Date(project.shareExpiresAt) < new Date())
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });

    // Track view count + last viewed timestamp (non-blocking)
    projectStore.update(project.id, {
      shareViewCount: (project.shareViewCount ?? 0) + 1,
      shareLastViewedAt: new Date().toISOString(),
    }).catch(() => {});

    console.log(`[share] Serving project: ${project.name} (${project.id.slice(0, 8)}…)`);

    // Strip internal server paths before sending to client
    const { planImagePath: _p, ...clientProject } = project as unknown as Record<string, unknown>;
    void _p;

    return NextResponse.json({ project: clientProject });
  } catch (err) {
    console.error("[GET /api/share/token]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
