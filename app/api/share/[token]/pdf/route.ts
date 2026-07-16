/**
 * app/api/share/[token]/pdf/route.ts
 *
 * GET — public. Returns the actual deck PDF for a valid share token.
 *
 * The share viewer used to hand-rebuild the whole deck in JSX (~700 lines of
 * CoverSlide / SiteSlide / WalkthroughSlide / …), completely independent of
 * lib/pdf.ts. That guaranteed drift: redesigning the PDF left the share link
 * showing the old layout, missing the Thank You slide, and ignoring the firm's
 * chosen theme.
 *
 * Now the viewer renders these bytes with pdf.js, exactly like the Export
 * screen. One builder, one document, one source of truth.
 *
 * Token validation mirrors ../route.ts — a bad, disabled, or expired token
 * must not hand out the PDF. View counting deliberately lives in ../route.ts
 * only, so loading the deck doesn't double-count a single visit.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { buildProjectPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 400 });

    const all = await projectStore.list();
    const project = all.find((p) => p.shareToken === token);

    if (!project) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
    if (project.shareEnabled === false) {
      return NextResponse.json({ error: "This link has been disabled by the architect" }, { status: 403 });
    }
    if (project.shareExpiresAt && new Date(project.shareExpiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const { bytes, pageLabels } = await buildProjectPdf(project);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Content-Length": String(bytes.byteLength),
        // Labels emitted by the builder, one per real page — lets the viewer
        // name slides without duplicating any deck-structure logic.
        "X-Deck-Page-Labels": encodeURIComponent(JSON.stringify(pageLabels)),
        "Access-Control-Expose-Headers": "X-Deck-Page-Labels",
        // Rebuilt per request so the client always sees the architect's latest
        // edits — the same reason the Export preview is no-store.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (err) {
    console.error("[GET /api/share/token/pdf]", err);
    return NextResponse.json({ error: "Could not build presentation" }, { status: 500 });
  }
}
