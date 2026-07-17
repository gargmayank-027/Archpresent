/**
 * app/api/share/[token]/route.ts
 * GET — public, returns project data if token valid, increments view count
 */
import { NextRequest, NextResponse } from "next/server";
import { projectStore, firmStore } from "@/lib/store";

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

    // Track view count + last viewed timestamp.
    //
    // Awaited deliberately. This is a read-modify-write over the whole project
    // document, and it used to be fire-and-forget — so every client opening a
    // share link raced whatever the architect was doing, and could write back a
    // stale copy that dropped a freshly-issued shareToken or a just-saved
    // analysis. lib/store.ts now serialises writes per project id, but that
    // only helps if we actually wait for our turn.
    try {
      await projectStore.update(project.id, {
        shareViewCount: (project.shareViewCount ?? 0) + 1,
        shareLastViewedAt: new Date().toISOString(),
      });
    } catch (err) {
      // View counting is analytics — never fail the client's page load for it.
      console.warn("[share] view count update failed (non-fatal):", err);
    }

    console.log(`[share] Serving project: ${project.name} (${project.id.slice(0, 8)}…)`);

    // Include firm contact info for CTA buttons on the share page
    let firmPhone: string | undefined;
    let firmEmail: string | undefined;
    try {
      const firm = await firmStore.get();
      firmPhone = firm?.phone;
      firmEmail = firm?.email;
    } catch {}

    // Strip internal server paths before sending to client
    const clientProject = {
      ...project,
      planImagePath: undefined,
    };

    // Firm contact is returned as its own field rather than smuggled into
    // plotInfo. The old version assigned `phone`/`email` onto plotInfo, which
    // has no such fields — five type errors that only shipped because
    // next.config.js sets ignoreBuildErrors.
    const firmContact = { phone: firmPhone, email: firmEmail };

    return NextResponse.json({ project: clientProject, firmContact });
  } catch (err) {
    console.error("[GET /api/share/token]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
