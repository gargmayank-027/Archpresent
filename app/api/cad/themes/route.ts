/**
 * app/api/cad/themes/route.ts
 *
 * GET /api/cad/themes -> { themes: CadThemeMeta[] }
 *
 * Proxies the CAD service's theme list for the picker UI
 * (components/CadThemePicker.tsx). See lib/cadClient.ts for why this is
 * a static list in V1 rather than a subprocess call.
 */

import { NextResponse } from "next/server";
import { CAD_THEMES } from "@/lib/cadClient";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ themes: CAD_THEMES });
}
