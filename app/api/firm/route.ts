/**
 * app/api/firm/route.ts
 *
 * GET  /api/firm  → { firm: FirmProfile | null }
 * POST /api/firm  → multipart/form-data with firm fields + optional logo file
 *                 → { firm: FirmProfile }
 */

import { NextRequest, NextResponse } from "next/server";
import { firmStore, saveUploadedFile } from "@/lib/store";
import type { FirmProfile, PdfAccentColor, PdfFontStyle } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const firm = await firmStore.get();
  return NextResponse.json({ firm });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const name         = (formData.get("name") as string | null)?.trim();
    const tagline      = (formData.get("tagline") as string | null)?.trim();
    const address      = (formData.get("address") as string | null)?.trim();
    const phone        = (formData.get("phone") as string | null)?.trim();
    const email        = (formData.get("email") as string | null)?.trim();
    const website      = (formData.get("website") as string | null)?.trim();
    const accentColor  = (formData.get("accentColor") as PdfAccentColor | null) ?? "graphite";
    const fontStyle    = (formData.get("fontStyle") as PdfFontStyle | null) ?? "editorial";
    const coverTagline = (formData.get("coverTagline") as string | null)?.trim();
    const logoFile     = formData.get("logo") as File | null;

    if (!name) {
      return NextResponse.json({ error: "Firm name is required" }, { status: 400 });
    }

    // Fetch existing profile so we can preserve logo if not re-uploading
    const existing = await firmStore.get();

    // Handle logo upload
    let logoUrl      = existing?.logoUrl;
    let logoDiskPath = existing?.logoDiskPath;

    if (logoFile && logoFile.size > 0) {
      const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
      if (!allowedTypes.includes(logoFile.type)) {
        return NextResponse.json({ error: "Logo must be PNG, JPEG, WebP, or SVG" }, { status: 400 });
      }
      if (logoFile.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "Logo must be under 5 MB" }, { status: 400 });
      }
      const ext = logoFile.type === "image/svg+xml" ? ".svg"
                : logoFile.type === "image/png"      ? ".png"
                : logoFile.type === "image/webp"     ? ".webp"
                : ".jpg";
      const buffer = Buffer.from(await logoFile.arrayBuffer());
      const saved  = await saveUploadedFile(buffer, `firm-logo${ext}`);
      logoUrl      = saved.url;
      logoDiskPath = saved.diskPath;
    }

    const profile: FirmProfile = {
      name,
      tagline:      tagline      || undefined,
      address:      address      || undefined,
      phone:        phone        || undefined,
      email:        email        || undefined,
      website:      website      || undefined,
      coverTagline: coverTagline || undefined,
      logoUrl,
      logoDiskPath,
      accentColor,
      fontStyle,
      updatedAt: new Date().toISOString(),
    };

    await firmStore.set(profile);
    return NextResponse.json({ firm: profile });
  } catch (err) {
    console.error("[POST /api/firm]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
