/**
 * app/api/share/[token]/route.ts
 * GET — public, returns project data if token valid, increments view count
 */
import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 400 });

    const all     = await projectStore.list();
    const project = all.find((p) => p.shareToken === token);

    if (!project)
      return NextResponse.json({ error: "Link not found" }, { status: 404 });

    if (project.shareEnabled === false)
      return NextResponse.json({ error: "This link has been disabled by the architect" }, { status: 403 });

    if (project.shareExpiresAt && new Date(project.shareExpiresAt) < new Date())
      return NextResponse.json({ error: "This link has expired. Please contact your architect for an updated link." }, { status: 410 });

    // Increment view count (non-blocking)
    projectStore.update(project.id, {
      shareViewCount: (project.shareViewCount ?? 0) + 1,
    }).catch(() => {});

    // Strip internal server paths before sending to client
    const { planImagePath: _p, ...clientProject } = project as unknown as Record<string, unknown>;
    void _p;

    return NextResponse.json({ project: clientProject });
  } catch (err) {
    console.error("[GET /api/share/token]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
