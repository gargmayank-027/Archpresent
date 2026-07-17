#!/usr/bin/env python3
"""
cad_service/cli.py

CLI entrypoint. This is what `lib/cadClient.ts` on the Next.js side invokes
via `child_process` for the V1 MVP local-bridge integration (see
archpresent-cad-migration-plan.md and README.md in this directory).

Usage:
    python3 cad_service/cli.py <dxf_path> --theme modern --out /tmp/cad_out

Writes:
    <out>/plan.svg   — the master SVG (always the source of truth)
    <out>/ir.json     — the full FloorPlanIR, for storage/audit/re-render

Prints one line of JSON to stdout on success:
    {"ok": true, "svgPath": "...", "irPath": "...", "rooms": [...],
     "warnings": [...], "theme": "modern"}

On failure, prints one line of JSON with "ok": false and exits non-zero,
so the Node bridge can distinguish "hard failure" from "warnings" cleanly
(mirrors the architecture doc's error-model requirement, §7).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict

# Allow running as `python3 cad_service/cli.py` from the repo root without
# needing the package pre-installed.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cad_service.pipeline import run_pipeline
from cad_service.dxf_parser import DxfParseError


def main() -> int:
    parser = argparse.ArgumentParser(description="ArchPresent CAD renderer CLI (V1 MVP)")
    parser.add_argument("dxf_path", help="Path to a .dxf file")
    parser.add_argument("--theme", default="modern", help="Theme key (default: modern)")
    parser.add_argument("--out", required=True, help="Output directory")
    args = parser.parse_args()

    try:
        with open(args.dxf_path, "r", encoding="utf-8", errors="replace") as f:
            dxf_text = f.read()
    except OSError as e:
        print(json.dumps({"ok": False, "error": f"Could not read file: {e}"}))
        return 1

    try:
        result = run_pipeline(dxf_text, os.path.basename(args.dxf_path), theme_key=args.theme)
    except DxfParseError as e:
        print(json.dumps({"ok": False, "error": f"DXF parse error: {e}"}))
        return 1
    except Exception as e:  # noqa: BLE001 — surface any unexpected failure as structured JSON
        print(json.dumps({"ok": False, "error": f"Unexpected error: {type(e).__name__}: {e}"}))
        return 1

    os.makedirs(args.out, exist_ok=True)
    svg_path = os.path.join(args.out, "plan.svg")
    ir_path = os.path.join(args.out, "ir.json")

    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(result.svg)
    with open(ir_path, "w", encoding="utf-8") as f:
        json.dump(result.ir.to_dict(), f, indent=2, default=str)

    print(json.dumps({
        "ok": True,
        "svgPath": svg_path,
        "irPath": ir_path,
        "rooms": result.rooms,
        "warnings": result.warnings,
        "theme": result.theme_key,
        "roomCount": len(result.ir.rooms),
        "furnitureCount": len(result.ir.furniture),
        "wallCount": len(result.ir.walls),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
