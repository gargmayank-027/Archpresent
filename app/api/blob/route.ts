/**
 * app/api/blob/route.ts
 * GET /api/blob?url=...
 *
 * Proxy for serving private Vercel Blob files in <img> tags.
 * Only needed if the blob store is configured as "private".
 * With a public store, images can be served directly from their URL.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  // Only proxy Vercel Blob URLs — prevent open-redirect abuse
  if (!url.includes("vercel-storage.com") && !url.includes("blob.vercel.app")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        // Vercel Blob SDK automatically signs requests using BLOB_READ_WRITE_TOKEN
        Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      },
      cache: "no-store",
    });

    if (!res.ok) return NextResponse.json({ error: "Blob not found" }, { status: 404 });

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch blob" }, { status: 500 });
  }
}
